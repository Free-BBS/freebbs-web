import type { ApiEnvelope } from '@freebbs-development/contracts';
import { FINANCE_PORTS } from '@freebbs-development/contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import { HttpError } from '../../core/errors/http-error.js';
import { FinanceTrackingService, type FinanceTrackingServiceOptions } from './tracking-service.js';
import { createFinanceImportTemplate, FINANCE_IMPORT_MAX_BYTES } from './import-parser.js';

export interface FinanceTrackingRouterOptions extends FinanceTrackingServiceOptions {
  authenticate: (headers: AuthHeaders) => Promise<AuthenticationResult>;
}
const identifier = z.string().trim().min(1).max(128);
const revision = z.number().int().safe().min(1);
const portId = z.enum(
  FINANCE_PORTS.map(({ id }) => id) as [
    (typeof FINANCE_PORTS)[number]['id'],
    ...(typeof FINANCE_PORTS)[number]['id'][],
  ],
);
const cents = z.number().int().safe().nonnegative();
const budget = z
  .object({
    year: z.string().trim().min(1).max(40),
    departmentId: identifier,
    code: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(200),
    reimbursementCents: cents,
    directPaymentCents: cents,
    notes: z.string().trim().max(4000),
  })
  .strict();
const externalDate = z
  .string()
  .max(40)
  .refine((value) => {
    if (value === '') return true;
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)) return false;
    const parsed = new Date(value);
    return (
      Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value.slice(0, 10)
    );
  });
const claim = z
  .object({
    projectId: identifier,
    kind: z.enum(['reimbursement', 'direct_payment']),
    items: z
      .array(
        z
          .object({
            description: z.string().trim().min(1).max(500),
            quantity: z.string().trim().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    amountCents: cents.positive(),
    payeeName: z.string().trim().min(1).max(100),
    payeeStudentId: z.string().trim().min(1).max(80),
    materials: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
    externalReference: z.string().trim().max(300),
    externalSubmittedAt: externalDate,
    notes: z.string().trim().max(4000),
  })
  .strict();
const createClaim = z.object({ requestId: identifier, input: claim }).strict();
const settings = z
  .object({
    revision,
    departments: z
      .array(
        z
          .object({
            id: identifier,
            name: z.string().trim().min(1).max(100),
            portId,
            teamId: identifier.optional(),
          })
          .strict(),
      )
      .max(500),
    grants: z
      .array(
        z
          .object({
            uid: identifier,
            displayName: z.string().trim().min(1).max(100),
            role: z.enum([
              'department',
              'organization_viewer',
              'finance_officer',
              'counselor',
              'teacher',
            ]),
            departmentIds: z.array(identifier).max(500),
            portIds: z.array(portId).max(FINANCE_PORTS.length),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
const action = z
  .object({
    revision,
    action: z.enum([
      'submit',
      'approve',
      'return',
      'withdraw',
      'record_school_submission',
      'record_teacher_approval',
      'confirm_received',
    ]),
    note: z.string().trim().max(4000).default(''),
  })
  .strict();

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new HttpError(400, 'invalid_request', '财务信息格式有误，请检查必填项、金额和日期');
  return result.data;
}
function send<T>(response: Response, status: number, data: T): void {
  const envelope: ApiEnvelope<T> = { data, requestId: response.locals.requestId as string };
  response.status(status).json(envelope);
}

export function createFinanceTrackingRouter(options: FinanceTrackingRouterOptions): Router {
  const router = Router();
  const service = new FinanceTrackingService(options);
  router.use(async (request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store');
    try {
      const result = await options.authenticate(request.headers);
      if (result.status !== 200) {
        send(response, result.status, { error: { code: result.code, message: result.message } });
        return;
      }
      response.locals.financeActor = result.user;
      next();
    } catch (error) {
      next(error);
    }
  });
  router.get('/access', async (_request, response) => {
    send(response, 200, await service.access(response.locals.financeActor));
  });
  router.get('/', async (_request, response) => {
    send(response, 200, await service.read(response.locals.financeActor));
  });
  router.get('/imports/template', async (_request, response) => {
    service.assertCanImport(response.locals.financeActor);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="finance-budget-template.xlsx"',
    );
    response.send(await createFinanceImportTemplate());
  });
  const uploadImport = multer({
    storage: multer.memoryStorage(),
    defParamCharset: 'utf8',
    limits: {
      fileSize: FINANCE_IMPORT_MAX_BYTES,
      files: 1,
      fields: 3,
      parts: 4,
      fieldSize: 100000,
    },
  }).single('file');
  router.post(
    '/imports/preview',
    (request, response, next) => {
      try {
        service.assertCanImport(response.locals.financeActor);
      } catch (error) {
        next(error);
        return;
      }
      uploadImport(request, response, (error) => {
        if (error) {
          next(
            new HttpError(
              error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
              'finance_import_upload_failed',
              '文件超过 8 MB 或上传表单无效',
            ),
          );
          return;
        }
        next();
      });
    },
    async (request, response) => {
      const fields = parse(
        z
          .object({
            year: z.string().trim().min(1).max(40),
            organizationId: portId.optional(),
            mappings: z.string().max(100000).optional(),
          })
          .strict(),
        request.body,
      );
      let mappingValue: unknown;
      try {
        mappingValue = fields.mappings ? JSON.parse(fields.mappings) : [];
      } catch {
        throw new HttpError(400, 'finance_import_mapping_invalid', '部门映射格式无效');
      }
      const mappings = parse(
        z
          .array(
            z
              .object({
                organization: z.string().trim().max(200),
                department: z.string().trim().min(1).max(200),
                departmentId: identifier,
              })
              .strict(),
          )
          .max(500),
        mappingValue,
      );
      if (!request.file || !/\.xlsx$/i.test(request.file.originalname))
        throw new HttpError(400, 'finance_import_file_required', '请选择 .xlsx 格式的预算表');
      send(
        response,
        200,
        await service.previewImport(
          response.locals.financeActor,
          request.file.buffer,
          request.file.originalname,
          {
            year: fields.year,
            organizationId: fields.organizationId,
            mappings,
          },
        ),
      );
    },
  );
  router.post('/imports/commit', async (request, response) => {
    const { previewId } = parse(z.object({ previewId: z.string().uuid() }).strict(), request.body);
    send(response, 200, await service.commitImport(response.locals.financeActor, previewId));
  });
  router.put('/settings', async (request, response) => {
    send(
      response,
      200,
      await service.updateSettings(response.locals.financeActor, parse(settings, request.body)),
    );
  });
  router.post('/projects', async (request, response) => {
    const { requestId, ...input } = parse(budget.extend({ requestId: identifier }), request.body);
    send(
      response,
      201,
      await service.createProject(response.locals.financeActor, requestId, input),
    );
  });
  router.put('/projects/:id', async (request, response) => {
    const id = parse(identifier, request.params.id);
    const { revision: expected, ...input } = parse(budget.extend({ revision }), request.body);
    send(
      response,
      200,
      await service.updateProject(response.locals.financeActor, id, expected, input),
    );
  });
  router.post('/claims', async (request, response) => {
    const body = request.body as Record<string, unknown> | undefined;
    const { requestId, input } = parse(createClaim, {
      requestId: body?.requestId,
      input:
        body && Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'requestId')),
    });
    send(response, 201, await service.createClaim(response.locals.financeActor, requestId, input));
  });
  router.put('/claims/:id', async (request, response) => {
    const id = parse(identifier, request.params.id);
    const body = request.body as Record<string, unknown> | undefined;
    const expected = parse(revision, body?.revision);
    const input = parse(
      claim,
      body && Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'revision')),
    );
    send(
      response,
      200,
      await service.updateClaim(response.locals.financeActor, id, expected, input),
    );
  });
  router.post('/claims/:id/actions', async (request, response) => {
    const id = parse(identifier, request.params.id);
    const input = parse(action, request.body);
    send(
      response,
      200,
      await service.act(response.locals.financeActor, id, input.revision, input.action, input.note),
    );
  });
  return router;
}
