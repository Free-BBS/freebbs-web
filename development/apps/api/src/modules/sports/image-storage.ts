import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import multer from 'multer';

export function createSportsImageStorage(uploadDirectory?: string) {
  const directory = resolve(
    uploadDirectory ??
      process.env.SPORTS_UPLOAD_DIRECTORY ??
      join(process.cwd(), 'var', 'sports-images'),
  );
  mkdirSync(directory, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: directory,
      filename: (_request, _file, callback) => callback(null, `${randomUUID()}.image`),
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  }).single('image');

  return {
    directory,
    upload,
    imagePath(fileId: string): string {
      if (!/^[0-9a-f-]{36}\.image$/.test(fileId)) throw new Error('invalid_image');
      return join(directory, fileId);
    },
  };
}

export function inspectSportsImage(path: string): string {
  const bytes = readFileSync(path).subarray(0, 12);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp';
  unlinkSync(path);
  throw new Error('unsupported_image');
}
