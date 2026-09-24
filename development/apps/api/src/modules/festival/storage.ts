import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, unlink } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import multer from 'multer';
import { HttpError } from '../../core/errors/http-error.js';

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export function festivalStorage(options: { uploadDirectory?: string; maxUploadBytes?: number }) {
  const configured = options.uploadDirectory ?? process.env.FESTIVAL_UPLOAD_DIR;
  const directory = resolve(configured || '.data/student-festival');
  const maxUploadBytes = options.maxUploadBytes ?? MAX_VIDEO_BYTES;
  if (
    !Number.isSafeInteger(maxUploadBytes) ||
    maxUploadBytes < 1 ||
    maxUploadBytes > MAX_VIDEO_BYTES
  )
    throw new Error('Festival upload limit must be between 1 and 104857600 bytes');
  const ensure = async () => {
    if (process.env.NODE_ENV === 'production' && (!configured || !isAbsolute(configured)))
      throw new HttpError(503, 'upload_not_configured', '投稿存储尚未配置，请联系管理员。');
    await mkdir(directory, { recursive: true, mode: 0o700 });
  };
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => {
        void ensure().then(
          () => callback(null, directory),
          (error) => callback(error, directory),
        );
      },
      filename: (_req, _file, callback) => callback(null, `${randomUUID()}.video`),
    }),
    limits: { fileSize: maxUploadBytes, files: 1, fields: 3, fieldSize: 8192, parts: 4 },
    fileFilter: (_req, file, callback) => {
      // Some browsers omit File.type; inspectVideo still validates the uploaded bytes.
      if (
        !['video/mp4', 'video/webm', 'video/quicktime', 'application/octet-stream'].includes(
          file.mimetype,
        )
      )
        return callback(new HttpError(415, 'unsupported_video', '请上传 MP4、WebM 或 MOV 视频。'));
      callback(null, true);
    },
  }).single('video');
  return { directory, maxUploadBytes, upload };
}

export function storedVideoPath(directory: string, storageKey: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.video$/.test(storageKey))
    throw new HttpError(404, 'video_not_found', '视频不存在或暂不可查看。');
  return resolve(directory, storageKey);
}
export async function removeUpload(path: string | undefined): Promise<void> {
  if (!path) return;
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
export async function inspectVideo(file: Express.Multer.File): Promise<string> {
  const handle = await open(file.path, 'r');
  let header: Buffer;
  try {
    const buffer = Buffer.alloc(Math.min(file.size, 4096));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    header = buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
  let mime: string | null = null;
  if (header.length >= 16 && header.toString('ascii', 4, 8) === 'ftyp') {
    const brand = header.toString('ascii', 8, 12);
    if (brand === 'qt  ') mime = 'video/quicktime';
    else if (/^(isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash)$/.test(brand)) mime = 'video/mp4';
  } else if (
    header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
    header.includes(Buffer.from('webm'))
  )
    mime = 'video/webm';
  if (!mime)
    throw new HttpError(
      415,
      'invalid_video',
      '文件内容不是支持的视频格式，请尝试导出为 MP4 后重新上传。',
    );
  await chmod(file.path, 0o600);
  return mime;
}
