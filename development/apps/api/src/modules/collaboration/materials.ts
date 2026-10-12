import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { CollaborationSpace, UserContext } from '@freebbs-development/contracts';
import { featureStorage } from '../../core/database/feature-storage.js';
import { HttpError } from '../../core/errors/http-error.js';
import { canReviewEntry, manages, type CollaborationOptions } from './router.js';

export function safeArchiveName(value: string): string {
  const normalized = value.normalize('NFC').trim();
  if (
    !normalized ||
    [...normalized].some((character) => character.charCodeAt(0) < 32) ||
    normalized.length > 180 ||
    /[/\\<>:"|?*]/u.test(normalized) ||
    normalized === '.' ||
    normalized === '..' ||
    /[. ]$/.test(normalized) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(normalized)
  )
    throw new HttpError(400, 'invalid_filename', '文件名包含不支持的字符');
  return normalized;
}
export function createMaterialsRouter(options: CollaborationOptions) {
  const router = Router();
  const directory = options.uploadDirectory ?? resolve('.data/collection-uploads');
  const storage = featureStorage<CollaborationSpace>(directory, 'collaboration');
  const fileDir = join(directory, 'collaboration-assets');
  const upload = multer({
    storage: multer.memoryStorage(),
    defParamCharset: 'utf8',
    limits: { fileSize: 25 * 1024 * 1024, files: 4, fields: 1, parts: 5, fieldSize: 32 },
  }).array('files', 4);
  async function actor(headers: Parameters<CollaborationOptions['authenticate']>[0]) {
    const identity = await options.authenticate(headers);
    if (identity.status !== 200)
      throw new HttpError(identity.status, identity.code, identity.message);
    if (
      options.nodeEnvironment === 'production' &&
      (!options.uploadDirectory || !isAbsolute(options.uploadDirectory))
    )
      throw new HttpError(503, 'storage_not_configured', '材料存储尚未配置');
    return identity.user;
  }
  function revision(value: unknown) {
    const result = z.coerce.number().int().min(1).safeParse(value);
    if (!result.success) throw new HttpError(400, 'invalid_revision', '请提供有效版本');
    return result.data;
  }
  async function access(id: string, user: UserContext, entryId?: string) {
    const space = await storage.get(id);
    if (!space) throw new HttpError(404, 'not_found', '未找到空间');
    const entry = entryId ? space.entries.find((value) => value.id === entryId) : undefined;
    if (entryId && !entry) throw new HttpError(404, 'not_found', '未找到记录');
    if (
      !manages(space, user) &&
      (!entry || (entry.uid !== user.uid && !canReviewEntry(space, entry, user)))
    )
      throw new HttpError(403, 'forbidden', '无法访问这份材料');
    return { space, entry };
  }
  router.post(
    '/:id/entries/:entryId/files',
    async (request, response, next) => {
      response.locals.user = await actor(request.headers);
      await access(String(request.params.id), response.locals.user, String(request.params.entryId));
      next();
    },
    (request, response, next) =>
      upload(request, response, (error: unknown) =>
        next(
          error
            ? new HttpError(
                error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
                'upload_error',
                '一次最多4个文件，每个文件不超过25 MiB',
              )
            : undefined,
        ),
      ),
    async (request, response) => {
      const user = response.locals.user as UserContext;
      const currentRevision = revision(request.body.revision);
      const files = request.files as Express.Multer.File[];
      if (!files?.length) throw new HttpError(400, 'missing_files', '请选择文件');
      const added = files.map((file) => ({
        id: randomUUID(),
        name: safeArchiveName(file.originalname),
        bytes: file.size,
        buffer: file.buffer,
      }));
      const written: string[] = [];
      try {
        const result = await storage.change(String(request.params.id), async (space) => {
          if (!space) throw new HttpError(404, 'not_found', '未找到空间');
          const entry = space.entries.find((value) => value.id === request.params.entryId);
          if (!entry || (entry.uid !== user.uid && !manages(space, user)))
            throw new HttpError(403, 'forbidden', '不能上传到此记录');
          if (space.revision !== currentRevision)
            throw new HttpError(409, 'revision_conflict', '记录已更新，请刷新后上传');
          if (
            space.status !== 'published' ||
            entry.reviewStatus === 'approved' ||
            (space.kind === 'review' && entry.reviewStatus === 'pending' && entry.stage > 0)
          )
            throw new HttpError(409, 'record_locked', '此记录已锁定');
          if (entry.files.length + added.length > 20)
            throw new HttpError(400, 'file_limit', '每条记录最多20个附件');
          await mkdir(fileDir, { recursive: true });
          for (const file of added) {
            const target = join(fileDir, file.id);
            await writeFile(target, file.buffer, { flag: 'wx' });
            written.push(target);
            entry.files.push({ id: file.id, name: file.name, bytes: file.bytes });
          }
          const at = new Date().toISOString();
          entry.updatedAt = at;
          space.updatedAt = at;
          space.revision++;
          space.history.push({ uid: user.uid, at, action: 'files_uploaded', entryId: entry.id });
          space.history = space.history.slice(-500);
          return { record: space, result: { revision: space.revision, files: entry.files } };
        });
        response.json({ data: result, requestId: response.locals.requestId });
      } catch (error) {
        await Promise.all(written.map((path) => rm(path, { force: true })));
        throw error;
      }
    },
  );
  router.get('/:id/entries/:entryId/files/:fileId', async (request, response) => {
    const user = await actor(request.headers);
    const { entry } = await access(String(request.params.id), user, String(request.params.entryId));
    const file = entry!.files.find((value) => value.id === request.params.fileId);
    if (!file) throw new HttpError(404, 'not_found', '未找到附件');
    const content = await readFile(join(fileDir, file.id));
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    response.send(content);
  });
  router.get('/:id/export', async (request, response) => {
    const user = await actor(request.headers);
    const { space } = await access(String(request.params.id), user);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('记录');
    sheet.addRow([
      '姓名',
      '用户标识',
      '提交时间',
      ...space.columns.map((c) => c.label),
      '内容',
      '志愿',
      '分配',
      '审核状态',
    ]);
    for (const entry of space.entries)
      sheet.addRow([
        entry.displayName,
        entry.uid,
        entry.createdAt,
        ...space.columns.map((c) => entry.values[c.id] ?? ''),
        entry.text,
        entry.choices.map((id) => space.slots.find((s) => s.id === id)?.title ?? id).join(' → '),
        space.slots.find((s) => s.id === entry.assignedSlot)?.title ?? '',
        entry.reviewStatus,
      ]);
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.columns.forEach((c) => {
      c.width = 24;
    });
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(space.title.slice(0, 80) + '.xlsx')}`,
    );
    response.send(Buffer.from(await workbook.xlsx.writeBuffer()));
  });
  router.post('/:id/materials/archive', async (request, response) => {
    const user = await actor(request.headers);
    const { space } = await access(String(request.params.id), user);
    const input = z
      .object({
        pattern: z.string().min(1).max(120).default('{name}'),
        folders: z.boolean().default(true),
      })
      .strict()
      .safeParse(request.body);
    if (!input.success) throw new HttpError(400, 'invalid_request', '请检查命名规则');
    const archive = new JSZip();
    const seen = new Set<string>();
    let bytes = 0;
    let index = 0;
    for (const entry of space.entries)
      for (const file of entry.files) {
        bytes += file.bytes;
        if (bytes > 150 * 1024 * 1024)
          throw new HttpError(413, 'archive_too_large', '材料超过150 MiB，请按记录分别下载');
        index++;
        const dot = file.name.lastIndexOf('.');
        const basename = dot > 0 ? file.name.slice(0, dot) : file.name;
        const extension = dot > 0 ? file.name.slice(dot) : '';
        let name = safeArchiveName(
          input.data.pattern
            .replaceAll('{name}', basename)
            .replaceAll('{index}', String(index).padStart(3, '0'))
            .replaceAll('{uid}', entry.uid)
            .replaceAll('{date}', entry.createdAt.slice(0, 10)) + extension,
        );
        const folder = input.data.folders
          ? `${entry.uid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}-${entry.id.slice(0, 8)}/`
          : '';
        const originalName = name;
        let suffix = 1;
        while (seen.has(folder + name)) {
          name = safeArchiveName(`${index}-${suffix}-${originalName}`);
          suffix++;
        }
        seen.add(folder + name);
        archive.file(folder + name, await readFile(join(fileDir, file.id)));
      }
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(space.title.slice(0, 80) + '-materials.zip')}`,
    );
    response.send(
      await archive.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 3 },
      }),
    );
  });
  return router;
}
