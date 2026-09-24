import { recordAuditEvent } from '../../core/audit/audit-service.js';
import { authorize } from '../../core/authorization/authorize.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type {
  DevelopmentStore,
  SportsTeamRecord,
  SubjectRecord,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { parseRosterCsv } from './csv-roster.js';

export type RosterImportOutcome =
  'ready' | 'already_member' | 'duplicate_in_file' | 'name_mismatch';

export interface RosterImportInputRow {
  row: number;
  name: string;
  studentNumber: string;
  outcome: RosterImportOutcome;
}

export interface RosterValidatedRow {
  row: number;
  name: string;
  studentNumber: string;
  outcome: RosterImportOutcome;
  blocking: boolean;
}

export interface RosterImportResult {
  imported: number;
  skipped: number;
  rows: RosterValidatedRow[];
}

function teamScope(teamId: string) {
  return { type: 'sports_team', id: teamId } as const;
}

function canUpdateTeam(actor: AuthorizationContext, team: SportsTeamRecord): boolean {
  return authorize(actor, {
    action: 'sports.team.update',
    resource: 'sports_team',
    scope: team.scope,
  }).allowed;
}

function validTeam(team: SportsTeamRecord | null, teamId: string): team is SportsTeamRecord {
  return (
    team !== null &&
    team.scope.type === 'sports_team' &&
    team.scope.id === teamId &&
    team.status !== 'archived'
  );
}

function teamNotFound(): HttpError {
  return new HttpError(404, 'sports_team_not_found', 'Sports team not found');
}

async function validateRows(
  store: DevelopmentStore,
  teamId: string,
  rows: readonly RosterImportInputRow[],
  locking: boolean,
): Promise<RosterValidatedRow[]> {
  const subjects = locking ? await store.subjects.listForUpdate() : await store.subjects.list();
  const members = locking
    ? await store.sportsTeamMembers.listForUpdate({
        scopeType: 'sports_team',
        scopeId: teamId,
      })
    : await store.sportsTeamMembers.list({
        scopeType: 'sports_team',
        scopeId: teamId,
      });
  const subjectsByUid = new Map(subjects.map((subject) => [subject.uid, subject]));
  const memberUids = new Set(
    members
      .filter((member) => member.teamId === teamId && member.status === 'active')
      .map((member) => member.memberUid),
  );

  const seen = new Set<string>();
  return rows.map((row) => {
    const duplicate = seen.has(row.studentNumber);
    seen.add(row.studentNumber);
    if (duplicate) {
      return { ...row, outcome: 'duplicate_in_file', blocking: true };
    }
    const subject = subjectsByUid.get(row.studentNumber);
    if (subject !== undefined && subject.displayName !== row.name) {
      return { ...row, outcome: 'name_mismatch', blocking: true };
    }
    if (memberUids.has(row.studentNumber)) {
      return { ...row, outcome: 'already_member', blocking: false };
    }
    return { ...row, outcome: 'ready', blocking: false };
  });
}

async function findSubject(
  store: DevelopmentStore,
  uid: string,
): Promise<SubjectRecord | undefined> {
  return (await store.subjects.listForUpdate({ query: uid })).find(
    (subject) => subject.uid === uid,
  );
}

export class RosterImportService {
  constructor(private readonly store: DevelopmentStore) {}

  async preview(
    actor: AuthorizationContext,
    teamId: string,
    csv: string,
  ): Promise<RosterValidatedRow[]> {
    const team = await this.store.sportsTeams.get(teamId);
    if (!validTeam(team, teamId) || !canUpdateTeam(actor, team)) throw teamNotFound();
    return validateRows(this.store, teamId, parseRosterCsv(csv), false);
  }

  async confirm(
    actor: AuthorizationContext,
    teamId: string,
    rows: readonly RosterImportInputRow[],
  ): Promise<RosterImportResult> {
    return this.store.transaction(async (store) => {
      const team = await store.sportsTeams.getForUpdate(teamId);
      const freshActor = await loadAuthorizationContext(store, actor, new Date());
      if (!validTeam(team, teamId) || !canUpdateTeam(freshActor, team)) throw teamNotFound();

      const fresh = await validateRows(store, teamId, rows, true);
      if (fresh.some(({ blocking }) => blocking)) {
        throw new HttpError(409, 'roster_preview_stale', 'Roster preview must be refreshed');
      }

      let imported = 0;
      let skipped = 0;
      for (const row of fresh) {
        if (row.outcome === 'already_member') {
          skipped += 1;
          continue;
        }
        let subject = await findSubject(store, row.studentNumber);
        if (subject === undefined) {
          subject = await store.subjects.create({
            uid: row.studentNumber,
            displayName: row.name,
            avatarUrl: null,
            status: 'pending',
            ownerUid: actor.uid,
            scope: { type: 'public', id: '*' },
          });
        }
        await store.sportsTeamMembers.create({
          teamId,
          memberUid: subject.uid,
          status: 'active',
          ownerUid: actor.uid,
          scope: teamScope(teamId),
        });
        imported += 1;
      }

      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'sports.team.roster_imported',
        resourceType: 'sports_team',
        resourceId: teamId,
        details: { imported, skipped, rows: fresh.length },
      });
      return { imported, skipped, rows: fresh };
    });
  }
}
