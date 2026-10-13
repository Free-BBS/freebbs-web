import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import JSZip from 'jszip';
import type { Response } from 'express';
import type { OrganizationGroupFile, UserContext } from '@freebbs-development/contracts';
import {
  fail,
  moduleAccess,
  visibleEntry,
  visibleResource,
  type OrganizationState,
  type StoredAsset,
} from './domain.js';

const pngMagic = Buffer.from('89504e470d0a1a0a', 'hex');
const oleMagic = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const office: Record<string, { mime: string; part: string }> = {
  '.docx': {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    part: 'word/document.xml',
  },
  '.xlsx': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    part: 'xl/workbook.xml',
  },
  '.pptx': {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    part: 'ppt/presentation.xml',
  },
};
export async function inspectFile(
  file: Express.Multer.File,
  purpose: OrganizationGroupFile['purpose'],
) {
  const b = file.buffer;
  let mime = '';
  let previewable = false;
  // Busboy decodes legacy multipart filename parameters as latin1; restore valid UTF-8.
  const decoded = Array.from(file.originalname).every((character) => character.charCodeAt(0) <= 255)
    ? Buffer.from(file.originalname, 'latin1').toString('utf8')
    : file.originalname;
  const originalName = decoded.includes('\uFFFD') ? file.originalname : decoded;
  const characters = Array.from(originalName).map((character) =>
    character.charCodeAt(0) < 32 ||
    character.charCodeAt(0) === 127 ||
    /[/\\<>:"|?*]/.test(character)
      ? '_'
      : character,
  );
  const originalExtension = extname(characters.join(''));
  const extension = originalExtension.toLowerCase();
  const suffixLength = Array.from(originalExtension).length;
  // Keep the format suffix while limiting Unicode code points, never UTF-16 halves.
  const name =
    (characters.length > 180 && suffixLength < 180
      ? characters.slice(0, 180 - suffixLength).join('') + originalExtension
      : characters.slice(0, 180).join('')) || 'file';
  if (
    b.length >= 45 &&
    b.subarray(0, 8).equals(pngMagic) &&
    b.toString('ascii', 12, 16) === 'IHDR' &&
    b.readUInt32BE(16) > 0 &&
    b.readUInt32BE(20) > 0 &&
    b.toString('ascii', b.length - 8, b.length - 4) === 'IEND'
  ) {
    mime = 'image/png';
    previewable = true;
  } else if (
    b.length >= 12 &&
    b[0] === 0xff &&
    b[1] === 0xd8 &&
    b[2] === 0xff &&
    b[b.length - 2] === 0xff &&
    b[b.length - 1] === 0xd9
  ) {
    mime = 'image/jpeg';
    previewable = true;
  } else if (
    b.length >= 20 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP' &&
    b.readUInt32LE(4) + 8 === b.length &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(b.toString('ascii', 12, 16))
  ) {
    mime = 'image/webp';
    previewable = true;
  } else if (
    purpose === 'resource' &&
    /^%PDF-(?:1\.[0-9]|2\.0)/.test(b.toString('ascii', 0, 8)) &&
    b.subarray(Math.max(0, b.length - 1024)).includes(Buffer.from('%%EOF'))
  ) {
    mime = 'application/pdf';
    previewable = true;
  } else if (
    purpose === 'resource' &&
    b.length >= 4 &&
    b.readUInt32LE(0) === 0x04034b50 &&
    (extension === '.zip' || office[extension])
  ) {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(b);
    } catch {
      fail(400, 'invalid_file', '压缩包或 Office 文件内容损坏');
    }
    const format = office[extension];
    if (format && (!zip.file(format.part) || !zip.file('[Content_Types].xml')))
      fail(400, 'invalid_file', 'Office 文件内容与扩展名不匹配');
    mime = format?.mime ?? 'application/zip';
  } else if (purpose === 'resource' && b.length > 512 && b.subarray(0, 8).equals(oleMagic)) {
    mime =
      (
        {
          '.doc': 'application/msword',
          '.xls': 'application/vnd.ms-excel',
          '.ppt': 'application/vnd.ms-powerpoint',
        } as Record<string, string>
      )[extension] ?? '';
  } else if (
    purpose === 'resource' &&
    b.subarray(0, 6).equals(Buffer.from('377abcaf271c', 'hex')) &&
    extension === '.7z'
  )
    mime = 'application/x-7z-compressed';
  else if (
    purpose === 'resource' &&
    b.subarray(0, 6).equals(Buffer.from('526172211a07', 'hex')) &&
    extension === '.rar'
  )
    mime = 'application/vnd.rar';
  const declared = (file.mimetype ?? '').trim().toLowerCase();
  const zipAlias = mime === 'application/zip' && declared === 'application/x-zip-compressed';
  const rarAlias = mime === 'application/vnd.rar' && declared === 'application/x-rar-compressed';
  // Browsers may send an unknown resource MIME; content recognition above remains mandatory.
  const genericResource =
    purpose === 'resource' && (!declared || declared === 'application/octet-stream');
  if (!mime || (declared !== mime && !zipAlias && !rarAlias && !genericResource))
    fail(
      400,
      'invalid_file_type',
      '文件真实格式与声明不匹配；仅支持 JPEG、PNG、WebP、PDF、Office 与压缩包',
    );
  return { originalName: name, mime, previewable, size: b.length };
}
export const assetPath = (directory: string, id: string) => {
  if (!/^[0-9a-f-]{36}$/.test(id)) fail(404, 'not_found', '未找到文件');
  return join(resolve(directory), 'organization-group-assets', `${id}.bin`);
};
export async function storeFile(directory: string, id: string, buffer: Buffer) {
  await mkdir(join(resolve(directory), 'organization-group-assets'), { recursive: true });
  await writeFile(assetPath(directory, id), buffer, { flag: 'wx' });
}
export async function removeFile(directory: string, id: string) {
  await rm(assetPath(directory, id), { force: true });
}
/** Seven-day pending retention; permanently bound historical assets never removed by this cleanup. */
export async function cleanPending(directory: string, s: OrganizationState) {
  const expired = s.assets.filter(
    (a) => !a.binding && Date.parse(a.createdAt) < Date.now() - 7 * 86400000,
  );
  for (const a of expired) await removeFile(directory, a.id);
  const ids = new Set(expired.map((a) => a.id));
  s.assets = s.assets.filter((a) => !ids.has(a.id));
}
export function visibleAsset(s: OrganizationState, user: UserContext, a: StoredAsset) {
  if (!moduleAccess(s, user)) return false;
  if (!a.binding)
    return a.ownerUid === user.uid && Date.parse(a.createdAt) >= Date.now() - 7 * 86400000;
  if (a.binding.kind === 'entry') {
    const e = s.entries.find((e) => e.id === a.binding!.id);
    return Boolean(
      e && [...e.photoIds, ...e.extraPhotoIds].includes(a.id) && visibleEntry(s, user, e),
    );
  }
  const r = s.resources.find((r) => r.id === a.binding!.id);
  return Boolean(r && r.fileId === a.id && visibleResource(s, user, r));
}
export async function sendFile(
  directory: string,
  asset: StoredAsset,
  response: Response,
  preview: boolean,
) {
  if (preview && !asset.previewable) fail(400, 'preview_unavailable', '该格式请下载后查看');
  let bytes: Buffer;
  try {
    bytes = await readFile(assetPath(directory, asset.id));
  } catch {
    fail(404, 'not_found', '文件暂不可用');
  }
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  response.setHeader('Content-Type', asset.mime);
  // Older records may contain a surrogate split by the previous UTF-16 truncation.
  const originalName = asset.originalName.replace(/[\uD800-\uDFFF]/gu, '\uFFFD');
  response.setHeader(
    'Content-Disposition',
    `${preview ? 'inline' : 'attachment'}; filename="file${extname(originalName).replace(/[^a-zA-Z0-9.]/g, '')}"; filename*=UTF-8''${encodeURIComponent(originalName).replace(/'/g, '%27')}`,
  );
  response.send(bytes);
}
