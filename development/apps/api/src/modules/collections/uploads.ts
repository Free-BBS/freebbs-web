import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { HttpError } from '../../core/errors/http-error.js';

const allowedExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
  '.txt',
  '.csv',
  '.docx',
  '.xlsx',
  '.pptx',
  '.zip',
  '.mp3',
  '.wav',
  '.m4a',
  '.mp4',
  '.webm',
  '.mov',
]);

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  return bytes.every((byte, index) => buffer[index] === byte);
}

function signatureKind(
  buffer: Buffer,
): 'image' | 'pdf' | 'zip' | 'audio' | 'video' | 'text' | null {
  if (
    startsWith(buffer, [0x89, 0x50, 0x4e, 0x47]) ||
    startsWith(buffer, [0xff, 0xd8, 0xff]) ||
    buffer.subarray(0, 6).toString('ascii') === 'GIF89a' ||
    (buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP')
  )
    return 'image';
  if (buffer.subarray(0, 4).toString('ascii') === '%PDF') return 'pdf';
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (
    buffer.subarray(0, 3).toString('ascii') === 'ID3' ||
    (buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WAVE')
  )
    return 'audio';
  if (
    buffer.subarray(0, 4).toString('hex') === '1a45dfa3' ||
    buffer.subarray(4, 8).toString('ascii') === 'ftyp'
  )
    return 'video';
  if (!buffer.includes(0) && !buffer.toString('utf8').includes('\uFFFD')) return 'text';
  return null;
}

function mimeMatches(
  kind: NonNullable<ReturnType<typeof signatureKind>>,
  mimeType: string,
): boolean {
  if (kind === 'image') return mimeType.startsWith('image/');
  if (kind === 'audio') return mimeType.startsWith('audio/');
  if (kind === 'video')
    return mimeType.startsWith('video/') || mimeType === 'application/octet-stream';
  if (kind === 'pdf') return mimeType === 'application/pdf';
  if (kind === 'text') return mimeType.startsWith('text/') || mimeType === 'application/csv';
  return [
    'application/zip',
    'application/x-zip-compressed',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ].includes(mimeType);
}

export interface StoredCollectionAsset {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export async function storeCollectionUpload(input: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  directory: string;
  maxBytes?: number;
}): Promise<StoredCollectionAsset> {
  const maxBytes = input.maxBytes ?? 100 * 1024 * 1024;
  if (input.buffer.length === 0) throw new HttpError(400, 'empty_upload', '文件内容为空');
  if (input.buffer.length > maxBytes)
    throw new HttpError(413, 'upload_too_large', '文件超过 100 MiB 上限');
  if (
    /[/\\<>:"|?*]/.test(input.originalName) ||
    [...input.originalName].some((character) => character.charCodeAt(0) < 32)
  )
    throw new HttpError(400, 'invalid_file_name', '文件名含有不允许的字符');
  const extension = extname(input.originalName).toLowerCase();
  if (!allowedExtensions.has(extension))
    throw new HttpError(400, 'unsupported_file_type', '暂不支持这种文件格式');
  const kind = signatureKind(input.buffer);
  if (!kind || !mimeMatches(kind, input.mimeType))
    throw new HttpError(400, 'file_signature_mismatch', '文件内容与声明格式不一致');
  const id = randomUUID();
  await mkdir(input.directory, { recursive: true });
  await writeFile(join(input.directory, `${id}${extension}`), input.buffer, { flag: 'wx' });
  return {
    id,
    name: input.originalName,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
    url: `/api/development/v1/collections/assets/${id}`,
  };
}

export async function readCollectionUpload(directory: string, id: string): Promise<Buffer | null> {
  const entry = (await readdir(directory).catch(() => [])).find((name) =>
    name.startsWith(`${id}.`),
  );
  return entry ? readFile(join(directory, entry)) : null;
}
