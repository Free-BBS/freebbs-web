import { useEffect, useState, type FormEvent } from 'react';

import { EditorDrawer } from '../../components/EditorDrawer.js';
import type { LiaisonProblem } from './model.js';

export interface ProblemInput {
  title: string;
  summary: string;
  background: string;
  sourceType: LiaisonProblem['sourceType'];
  sourceName: string;
  tags: string[];
  expectedOutcome: string;
  constraints: string;
  startsAt: string | null;
  deadline: string | null;
  publicContact: string;
  internalContactNote: string;
}

interface ProblemDraft extends Omit<ProblemInput, 'tags' | 'startsAt' | 'deadline'> {
  tags: string;
  startsAt: string;
  deadline: string;
}

export interface ProblemEditorDrawerProps {
  open: boolean;
  problem?: LiaisonProblem | null;
  pending: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (input: ProblemInput) => Promise<void> | void;
}

const emptyDraft: ProblemDraft = {
  title: '',
  summary: '',
  background: '',
  sourceType: 'lab',
  sourceName: '',
  tags: '',
  expectedOutcome: '',
  constraints: '',
  startsAt: '',
  deadline: '',
  publicContact: '',
  internalContactNote: '',
};

function toLocalInput(value: string | null): string {
  if (value === null) return '';
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromProblem(problem?: LiaisonProblem | null): ProblemDraft {
  if (!problem) return emptyDraft;
  return {
    title: problem.title,
    summary: problem.summary,
    background: problem.background,
    sourceType: problem.sourceType,
    sourceName: problem.sourceName,
    tags: problem.tags.join('，'),
    expectedOutcome: problem.expectedOutcome,
    constraints: problem.constraints,
    startsAt: toLocalInput(problem.startsAt),
    deadline: toLocalInput(problem.deadline),
    publicContact: problem.publicContact,
    internalContactNote: problem.internalContactNote ?? '',
  };
}

function toInstant(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function ProblemEditorDrawer({
  open,
  problem,
  pending,
  error,
  onClose,
  onSubmit,
}: ProblemEditorDrawerProps) {
  const [draft, setDraft] = useState<ProblemDraft>(emptyDraft);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(fromProblem(problem));
    setValidationError(null);
  }, [open, problem]);

  function update<K extends keyof ProblemDraft>(key: K, value: ProblemDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const required: Array<[string, string]> = [
      [draft.title, '请填写问题标题'],
      [draft.summary, '请填写简短摘要'],
      [draft.background, '请填写背景说明'],
      [draft.sourceName, '请填写来源名称'],
      [draft.expectedOutcome, '请填写预期成果'],
      [draft.publicContact, '请填写公开对接方式'],
    ];
    const missing = required.find(([value]) => !value.trim());
    if (missing) {
      setValidationError(missing[1]);
      return;
    }
    const startsAt = toInstant(draft.startsAt);
    const deadline = toInstant(draft.deadline);
    if ((draft.startsAt && startsAt === null) || (draft.deadline && deadline === null)) {
      setValidationError('请填写有效的开始或截止时间');
      return;
    }
    if (startsAt !== null && deadline !== null && Date.parse(startsAt) > Date.parse(deadline)) {
      setValidationError('开始时间不得晚于截止时间');
      return;
    }
    const tags = draft.tags
      .split(/[，,]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (tags.length > 20) {
      setValidationError('最多填写 20 个标签');
      return;
    }
    if (tags.some((tag) => tag.length > 64)) {
      setValidationError('每个标签最多 64 个字符');
      return;
    }
    setValidationError(null);
    void onSubmit({
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      background: draft.background.trim(),
      sourceType: draft.sourceType,
      sourceName: draft.sourceName.trim(),
      tags,
      expectedOutcome: draft.expectedOutcome.trim(),
      constraints: draft.constraints.trim(),
      startsAt,
      deadline,
      publicContact: draft.publicContact.trim(),
      internalContactNote: draft.internalContactNote.trim(),
    });
  }

  return (
    <EditorDrawer
      open={open}
      title={problem ? '编辑课题' : '代录真实问题'}
      description="联络中心代课题组或企业录入；内部对接说明不会向普通同学公开。"
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <label>
          问题标题
          <input
            value={draft.title}
            maxLength={255}
            onChange={(e) => update('title', e.target.value)}
          />
        </label>
        <label>
          简短摘要
          <textarea
            value={draft.summary}
            maxLength={500}
            onChange={(e) => update('summary', e.target.value)}
          />
        </label>
        <label>
          背景说明
          <textarea
            value={draft.background}
            maxLength={20000}
            onChange={(e) => update('background', e.target.value)}
          />
        </label>
        <label>
          来源类型
          <select
            value={draft.sourceType}
            onChange={(e) => update('sourceType', e.target.value as LiaisonProblem['sourceType'])}
          >
            <option value="lab">课题组</option>
            <option value="company">企业</option>
            <option value="campus">校内单位</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label>
          来源名称
          <input
            value={draft.sourceName}
            maxLength={255}
            onChange={(e) => update('sourceName', e.target.value)}
          />
        </label>
        <label>
          领域标签（用逗号分隔）
          <input value={draft.tags} onChange={(e) => update('tags', e.target.value)} />
        </label>
        <label>
          预期成果
          <textarea
            value={draft.expectedOutcome}
            maxLength={20000}
            onChange={(e) => update('expectedOutcome', e.target.value)}
          />
        </label>
        <label>
          限制条件
          <textarea
            value={draft.constraints}
            maxLength={20000}
            onChange={(e) => update('constraints', e.target.value)}
          />
        </label>
        <label>
          开始时间（可选）
          <input
            type="datetime-local"
            value={draft.startsAt}
            onChange={(e) => update('startsAt', e.target.value)}
          />
        </label>
        <label>
          截止时间（可选）
          <input
            type="datetime-local"
            value={draft.deadline}
            onChange={(e) => update('deadline', e.target.value)}
          />
        </label>
        <label>
          公开对接方式
          <input
            value={draft.publicContact}
            maxLength={500}
            onChange={(e) => update('publicContact', e.target.value)}
          />
        </label>
        <label>
          内部对接说明
          <textarea
            value={draft.internalContactNote}
            maxLength={20000}
            onChange={(e) => update('internalContactNote', e.target.value)}
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? '正在保存…' : problem ? '保存课题修改' : '保存课题草稿'}
        </button>
        {validationError ? <p role="alert">{validationError}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </EditorDrawer>
  );
}
