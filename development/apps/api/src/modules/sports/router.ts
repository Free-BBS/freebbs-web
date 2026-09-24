import type { ApiEnvelope, ScopeRef } from '@freebbs-development/contracts';
import { Router, text } from 'express';
import { z } from 'zod';

import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { encodeDateOnly } from '../../core/database/date-codec.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { teamReadabilitySchema } from '../../core/validation/content-fields.js';
import { RosterCsvError } from './csv-roster.js';
import { RosterImportService } from './roster-import-service.js';
import { SportsService } from './service.js';
import { WuSportsService } from './wu-sports-service.js';
import { inspectSportsImage, sportsImagePath, sportsImageUpload } from './image-storage.js';

import type { Request, Response } from 'express';

type Authenticate = (headers: AuthHeaders) => Promise<AuthenticationResult>;
export interface SportsRouterOptions {
  store: DevelopmentStore;
  authenticate: Authenticate;
}
interface ErrorData {
  error: { code: string; message: string };
}

const identifier = z.string().trim().min(1).max(128);
const teamStatus = z.enum(['draft', 'active', 'archived']);
const teamQuerySchema = z
  .object({
    season: z.string().trim().min(1).max(80).optional(),
    status: teamStatus.optional(),
    scopeType: identifier.regex(/^[a-z][a-z0-9_]*$/).optional(),
    scopeId: identifier.optional(),
    query: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((value) => (value.scopeType === undefined) === (value.scopeId === undefined));
const createTeamSchema = z
  .object({
    ...teamReadabilitySchema.shape,
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(20_000),
    status: z.literal('draft').default('draft'),
  })
  .strict();
const patchTeamSchema = z
  .object({
    ...teamReadabilitySchema.partial().shape,
    id: identifier,
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).max(20_000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.season !== undefined ||
      value.trainingSchedule !== undefined,
  );
const teamRouteSchema = z.object({ teamId: identifier }).strict();
const memberRouteSchema = z.object({ teamId: identifier, memberUid: identifier }).strict();
const transitionSchema = z.object({ to: teamStatus }).strict();
const memberSchema = z.object({ memberUid: identifier }).strict();
const checkinDate = z.string().refine((value) => {
  try {
    encodeDateOnly(value);
    return true;
  } catch {
    return false;
  }
});
const createCheckinSchema = z.object({ memberUid: identifier, checkinDate }).strict();
const nullableUrl = z
  .union([z.string().trim().url().max(2000), z.literal(''), z.null()])
  .transform((value) => value || null);
const nullableCoverUrl = z
  .union([
    z.string().trim().url().max(2000),
    z.string().regex(/^\/api\/development\/v1\/sports\/media\/images\/[0-9a-f-]{36}\.image$/),
    z.literal(''),
    z.null(),
  ])
  .transform((value) => value || null);
const nullableResult = z
  .union([z.string().trim().max(200), z.null()])
  .transform((value) => value || null);
const matchFields = {
  title: z.string().trim().min(1).max(200),
  coverUrl: nullableCoverUrl.optional().default(null),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  location: z.string().trim().min(1).max(300),
  result: nullableResult.optional().default(null),
  liveUrl: nullableUrl.optional().default(null),
  replayUrl: nullableUrl.optional().default(null),
};
const createMatchSchema = z
  .object(matchFields)
  .strict()
  .refine((value) => Date.parse(value.startsAt) < Date.parse(value.endsAt));
const patchMatchSchema = z
  .object({
    ...Object.fromEntries(
      Object.entries(matchFields).map(([key, value]) => [key, value.optional()]),
    ),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
const matchRouteSchema = z.object({ matchId: identifier }).strict();
const matchQuerySchema = z
  .object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() })
  .strict();
const showcaseSchema = z.object({ markdown: z.string().max(100_000) }).strict();
const rosterOutcome = z.enum(['ready', 'already_member', 'duplicate_in_file', 'name_mismatch']);
const rosterImportSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            blocking: z.boolean().optional(),
            row: z.number().int().positive(),
            name: z.string().trim().min(1).max(200),
            studentNumber: identifier,
            outcome: rosterOutcome,
          })
          .strict(),
      )
      .min(1)
      .max(5_000),
  })
  .strict();

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'invalid_request', 'Request validation failed');
  return result.data;
}

function send<T>(response: Response, statusCode: number, data: T): void {
  const envelope: ApiEnvelope<T> = { data, requestId: response.locals.requestId as string };
  response.status(statusCode).json(envelope);
}

function sendAuthError(response: Response, result: Exclude<AuthenticationResult, { status: 200 }>) {
  send<ErrorData>(response, result.status, {
    error: { code: result.code, message: result.message },
  });
}

async function requireActor(
  options: SportsRouterOptions,
  request: Request,
  response: Response,
): Promise<AuthorizationContext | null> {
  const result = await options.authenticate(request.headers);
  if (result.status !== 200) {
    sendAuthError(response, result);
    return null;
  }
  return result.user;
}

function allowedTeam(actor: AuthorizationContext, action: string, scope?: ScopeRef): boolean {
  return authorize(actor, { action, resource: 'sports_team', scope }).allowed;
}

function forbid(response: Response): void {
  send<ErrorData>(response, 403, {
    error: { code: 'forbidden', message: 'Sports team permission is required' },
  });
}

export function createSportsRouter(options: SportsRouterOptions): Router {
  const router = Router();
  const service = new SportsService(options.store);
  const wuSports = new WuSportsService(options.store);
  const rosterImport = new RosterImportService(options.store);

  router.use(async (_request, response, next) => {
    try {
      const module = (await options.store.modules.list({ query: 'sports' })).find(
        (record) => record.moduleId === 'sports',
      );
      if (module === undefined || !module.enabled || module.status !== 'enabled') {
        send<ErrorData>(response, 503, {
          error: { code: 'module_disabled', message: 'Sports module is disabled' },
        });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get('/teams', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    send(response, 200, await service.listTeams(actor, parse(teamQuerySchema, request.query)));
  });

  router.get('/matches', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { from, to } = parse(matchQuerySchema, request.query);
    send(response, 200, await wuSports.listMatches(actor, from, to));
  });

  router.post('/media/images', async (request, response, next) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const mayUpload =
      authorize(actor, { action: 'sports.match.create', resource: 'sports_match' }).allowed ||
      actor.tags.some(({ key }) => key === 'sports.team_captain');
    if (!mayUpload) return forbid(response);
    sportsImageUpload(request, response, (error) => {
      if (error) return next(new HttpError(400, 'invalid_image', 'Image upload failed'));
      if (!request.file) return next(new HttpError(400, 'invalid_image', 'An image is required'));
      try {
        const mimeType = inspectSportsImage(request.file.path);
        send(response, 201, {
          url: `/api/development/v1/sports/media/images/${request.file.filename}`,
          mimeType,
        });
      } catch {
        next(new HttpError(400, 'invalid_image', 'Only JPEG, PNG and WebP images are accepted'));
      }
    });
  });

  router.get('/media/images/:fileId', async (request, response, next) => {
    try {
      response.setHeader('Cache-Control', 'private, max-age=3600');
      response.sendFile(sportsImagePath(String(request.params.fileId)));
    } catch {
      next(new HttpError(404, 'sports_image_not_found', 'Sports image not found'));
    }
  });

  router.post('/matches', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    send(response, 201, await wuSports.createMatch(actor, parse(createMatchSchema, request.body)));
  });

  router.patch('/matches/:matchId', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { matchId } = parse(matchRouteSchema, request.params);
    send(
      response,
      200,
      await wuSports.updateMatch(actor, matchId, parse(patchMatchSchema, request.body)),
    );
  });

  router.delete('/matches/:matchId', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { matchId } = parse(matchRouteSchema, request.params);
    await wuSports.deleteMatch(actor, matchId);
    response.status(204).send();
  });

  router.get('/teams/:teamId/showcase', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { teamId } = parse(teamRouteSchema, request.params);
    send(response, 200, await wuSports.getShowcase(actor, teamId));
  });

  router.put('/teams/:teamId/showcase', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { teamId } = parse(teamRouteSchema, request.params);
    const { markdown } = parse(showcaseSchema, request.body);
    send(response, 200, await wuSports.saveShowcase(actor, teamId, markdown));
  });

  router.post('/teams', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const input = parse(createTeamSchema, request.body);
    if (!allowedTeam(actor, 'sports.team.create')) return forbid(response);
    send(response, 201, await service.createTeam(actor, input));
  });

  router.post('/teams/:teamId/transitions', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { teamId } = parse(teamRouteSchema, request.params);
    const { to } = parse(transitionSchema, request.body);
    send(response, 200, await service.transitionTeam(actor, teamId, to));
  });

  router.patch('/teams', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const input = parse(patchTeamSchema, request.body);
    const { id, ...patch } = input;
    send(response, 200, await service.updateTeam(actor, id, patch));
  });

  router.get('/teams/:teamId/members', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { teamId } = parse(teamRouteSchema, request.params);
    send(response, 200, await service.listMembers(actor, teamId));
  });

  router.post('/teams/:teamId/members', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { teamId } = parse(teamRouteSchema, request.params);
    const { memberUid } = parse(memberSchema, request.body);
    send(response, 201, await service.addMember(actor, teamId, memberUid));
  });

  router.post(
    '/teams/:teamId/roster-import/preview',
    text({ type: 'text/csv', limit: '256kb' }),
    async (request, response) => {
      const actor = await requireActor(options, request, response);
      if (actor === null) return;
      const { teamId } = parse(teamRouteSchema, request.params);
      if (typeof request.body !== 'string') {
        throw new HttpError(400, 'invalid_roster_csv', 'A text/csv request body is required');
      }
      try {
        send(response, 200, await rosterImport.preview(actor, teamId, request.body));
      } catch (error) {
        if (error instanceof RosterCsvError) {
          throw new HttpError(400, 'invalid_roster_csv', error.message);
        }
        throw error;
      }
    },
  );

  router.post('/teams/:teamId/roster-import', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { teamId } = parse(teamRouteSchema, request.params);
    const { rows } = parse(rosterImportSchema, request.body);
    send(response, 201, await rosterImport.confirm(actor, teamId, rows));
  });

  router.delete('/teams/:teamId/members/:memberUid', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { teamId, memberUid } = parse(memberRouteSchema, request.params);
    await service.removeMember(actor, teamId, memberUid);
    response.status(204).send();
  });

  router.post('/teams/:teamId/captains', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { teamId } = parse(teamRouteSchema, request.params);
    const { memberUid } = parse(memberSchema, request.body);
    send(response, 201, await service.grantCaptain(actor, teamId, memberUid));
  });

  router.delete('/teams/:teamId/captains/:memberUid', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { teamId, memberUid } = parse(memberRouteSchema, request.params);
    send(response, 200, await service.revokeCaptain(actor, teamId, memberUid));
  });

  router.get('/teams/:teamId/checkins', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { teamId } = parse(teamRouteSchema, request.params);
    send(response, 200, await service.listCheckins(actor, teamId));
  });

  router.post('/teams/:teamId/checkins', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { teamId } = parse(teamRouteSchema, request.params);
    const input = parse(createCheckinSchema, request.body);
    const result = await service.createCheckin(actor, teamId, input);
    send(response, result.created ? 201 : 200, result.record);
  });

  return router;
}
