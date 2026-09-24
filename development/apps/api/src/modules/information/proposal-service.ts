import type { ScopeRef } from '@freebbs-development/contracts';

import { recordAuditEvent } from '../../core/audit/audit-service.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type { DevelopmentStore, ListFilters, ProposalRecord } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { canTransition, type TransitionGraph } from '../../core/workflow/state-machine.js';

export const PROPOSAL_STATUSES = [
  'submitted',
  'reviewing',
  'researching',
  'advancing',
  'resolved',
  'closed',
] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface ProposalInput {
  dueAt?: string | null;
  title: string;
  problemDescription: string;
  proposedSolution: string;
  category: string;
}

export interface ProposalMaintenancePatch {
  dueAt?: string | null;
  category?: string;
  status?: ProposalStatus;
  assigneeUid?: string | null;
  publicProgress?: string;
  internalNote?: string;
}

export interface PublicProposal {
  dueAt: string | null;
  id: string;
  title: string;
  problemDescription: string;
  proposedSolution: string;
  category: string;
  submitterUid: string;
  assigneeUid: string | null;
  publicProgress: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceProposal extends PublicProposal {
  internalNote: string;
}

export type ProposalView = PublicProposal | MaintenanceProposal;

const publicScope: ScopeRef = { type: 'public', id: '*' };

const PROPOSAL_TRANSITIONS: TransitionGraph<ProposalStatus> = {
  submitted: ['reviewing', 'closed'],
  reviewing: ['researching', 'advancing', 'resolved', 'closed'],
  researching: ['reviewing', 'advancing', 'resolved', 'closed'],
  advancing: ['researching', 'resolved', 'closed'],
  resolved: ['advancing', 'closed'],
  closed: [],
};

function managesProposals(actor: AuthorizationContext): boolean {
  return authorize(actor, {
    action: 'information.proposal.manage',
    resource: 'proposal',
    scope: publicScope,
  }).allowed;
}

export function toPublicProposal(record: ProposalRecord): PublicProposal {
  return {
    dueAt: record.dueAt,
    id: record.id,
    title: record.title,
    problemDescription: record.problemDescription,
    proposedSolution: record.proposedSolution,
    category: record.category,
    submitterUid: record.submitterUid,
    assigneeUid: record.assigneeUid,
    publicProgress: record.publicProgress,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toMaintenanceProposal(record: ProposalRecord): MaintenanceProposal {
  return {
    ...toPublicProposal(record),
    internalNote: record.internalNote,
  };
}

function proposalView(record: ProposalRecord, actor: AuthorizationContext): ProposalView {
  return managesProposals(actor) ? toMaintenanceProposal(record) : toPublicProposal(record);
}

function proposalStatus(value: string): ProposalStatus | null {
  return PROPOSAL_STATUSES.includes(value as ProposalStatus) ? (value as ProposalStatus) : null;
}

export class ProposalService {
  constructor(private readonly store: DevelopmentStore) {}

  canManage(actor: AuthorizationContext): boolean {
    return managesProposals(actor);
  }

  async list(filters: ListFilters, actor: AuthorizationContext): Promise<ProposalView[]> {
    const records = await this.store.proposals.list(filters);
    return records.map((record) => proposalView(record, actor));
  }

  async get(id: string, actor: AuthorizationContext): Promise<ProposalView | null> {
    const record = await this.store.proposals.get(id);
    return record === null ? null : proposalView(record, actor);
  }

  async create(actor: AuthorizationContext, input: ProposalInput): Promise<PublicProposal> {
    const allowed = authorize(actor, {
      action: 'information.proposal.create',
      resource: 'proposal',
      scope: publicScope,
    }).allowed;
    if (!allowed)
      throw new HttpError(403, 'forbidden', 'Proposal submission permission is required');
    const created = await this.store.proposals.create({
      ...input,
      submitterUid: actor.uid,
      assigneeUid: null,
      publicProgress: '已提交',
      internalNote: '',
      status: 'submitted',
      ownerUid: actor.uid,
      scope: publicScope,
    });
    return toPublicProposal(created);
  }

  async maintain(
    actor: AuthorizationContext,
    id: string,
    patch: ProposalMaintenancePatch,
  ): Promise<MaintenanceProposal | null> {
    if (!managesProposals(actor)) {
      throw new HttpError(403, 'forbidden', 'Proposal maintenance permission is required');
    }
    return this.store.transaction(async (transactionStore) => {
      const current = await transactionStore.proposals.getForUpdate(id);
      if (current === null) return null;

      if (patch.assigneeUid !== undefined && patch.assigneeUid !== null) {
        const subjects = await transactionStore.subjects.list({ query: patch.assigneeUid });
        if (!subjects.some(({ uid, status }) => uid === patch.assigneeUid && status === 'active')) {
          throw new HttpError(400, 'invalid_assignee', 'Assignee does not exist');
        }
      }

      if (patch.status !== undefined && patch.status !== current.status) {
        const from = proposalStatus(current.status);
        if (from === null || !canTransition(PROPOSAL_TRANSITIONS, from, patch.status)) {
          throw new HttpError(409, 'invalid_state_transition', 'Invalid proposal state transition');
        }
      }

      const updated = await transactionStore.proposals.update(id, patch);
      if (updated === null) return null;
      await recordAuditEvent(transactionStore, {
        actorUid: actor.uid,
        action: 'information.proposal.maintained',
        resourceType: 'proposal',
        resourceId: id,
        details: {
          fields: Object.keys(patch).sort(),
          fromStatus: current.status,
          toStatus: updated.status,
          scope: current.scope,
        },
      });
      return toMaintenanceProposal(updated);
    });
  }
}
