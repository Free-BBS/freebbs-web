import type { ScopeRef } from '@freebbs-development/contracts';

export type KnowledgeType = 'workflow' | 'faq' | 'contact' | 'retrospective' | 'notice';
export type KnowledgeStatus = 'draft' | 'published' | 'archived';
export type KnowledgeAudience = 'general' | 'social_org';

export interface KnowledgeEntry {
  id: string;
  category?: string;
  tags?: string[];
  summary?: string;
  maintainedAt?: string | null;
  maintainerUid?: string | null;
  type: KnowledgeType;
  title: string;
  body: string;
  audience?: KnowledgeAudience;
  organizationId?: string | null;
  status: KnowledgeStatus;
  ownerUid: string;
  scope: ScopeRef;
}

export const typeLabels: Record<KnowledgeType, string> = {
  workflow: '工作流程',
  faq: '常见问题',
  contact: '联系人',
  retrospective: '活动复盘',
  notice: '注意事项',
};
export const statusLabels: Record<KnowledgeStatus, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
};
export const tone = (status: KnowledgeStatus): 'success' | 'warning' | 'neutral' =>
  status === 'published' ? 'success' : status === 'draft' ? 'warning' : 'neutral';

export function knowledgeListPath(audience: KnowledgeAudience): string {
  return audience === 'social_org' ? '/knowledge?audience=social_org' : '/knowledge';
}

export function knowledgeEntryPath(id: string, audience: KnowledgeAudience): string {
  return `/knowledge/${encodeURIComponent(id)}${audience === 'social_org' ? '?audience=social_org' : ''}`;
}

export function knowledgePreview(entry: KnowledgeEntry): string {
  const text = (entry.summary?.trim() || entry.body).replace(/\s+/g, ' ').trim();
  const characters = Array.from(text);
  return characters.length > 100 ? `${characters.slice(0, 100).join('')}…` : text;
}
