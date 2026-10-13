import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DEPARTMENT_DIRECTORY,
  DEVELOPMENT_IDENTITY_SECTIONS,
  departmentsForRoles,
  isDevelopmentBusinessAdmin,
  type CollaborationSpace,
  type CollaborationKind,
  type CollaborationColumn,
  type CollaborationSlot,
} from '@freebbs-development/contracts';
import { useAuth } from '../../core/auth/AuthProvider.js';
import { kinds, iso, roleLabel, ToolIcon } from './collaborationTools.js';
export function SpaceEditor({
  existing,
  initialKind,
  busy,
  onSave,
  onCancel,
}: {
  existing?: CollaborationSpace;
  initialKind?: CollaborationKind;
  busy: boolean;
  onSave: (value: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const auth = useAuth();
  const [search] = useSearchParams();
  const departments = isDevelopmentBusinessAdmin(auth.user?.roles ?? [])
    ? DEPARTMENT_DIRECTORY
    : departmentsForRoles(auth.user?.roles ?? []);
  const [step, setStep] = useState(0);
  const showChoice = Boolean(existing) || step === 0;
  const showBasic = Boolean(existing) || step === 1;
  const showConfig = Boolean(existing) || step === 2;
  const [kind, setKind] = useState<CollaborationKind>(
    existing?.kind ?? initialKind ?? (search.get('team') ? 'attendance' : 'availability'),
  );
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [departmentId, setDepartment] = useState(
    existing?.departmentId ??
      departments.find((item) => item.id === search.get('department'))?.id ??
      departments[0]?.id ??
      '',
  );
  const [audience, setAudience] = useState(existing?.audience ?? 'all');
  const [columns, setColumns] = useState<CollaborationColumn[]>(existing?.columns ?? []);
  const [slots, setSlots] = useState<CollaborationSlot[]>(existing?.slots ?? []);
  const [stages, setStages] = useState(existing?.stages ?? []);
  const [localError, setLocalError] = useState('');
  const [expectedReporters, setExpectedReporters] = useState(
    existing?.expectedReporterUids?.join(',') ?? '',
  );
  const locked = Boolean(existing?.entries.length);
  const dept = DEPARTMENT_DIRECTORY.find((item) => item.id === departmentId);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!existing && step < 2) {
      advance();
      return;
    }
    setLocalError('');
    try {
      await onSave({
        kind,
        title,
        description,
        departmentId: search.get('team') ? null : departmentId || null,
        teamId: existing?.teamId ?? search.get('team') ?? null,
        audience: kind === 'shared_table' ? 'department' : audience,
        status: existing?.status ?? 'draft',
        expectedReporterUids: expectedReporters
          .split(/[,，\n]/)
          .map((uid) => uid.trim())
          .filter(Boolean),
        ...(!existing || JSON.stringify(columns) !== JSON.stringify(existing.columns)
          ? { columns }
          : {}),
        ...(!existing || JSON.stringify(slots) !== JSON.stringify(existing.slots) ? { slots } : {}),
        ...(!existing || JSON.stringify(stages) !== JSON.stringify(existing.stages)
          ? { stages }
          : {}),
      });
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : '请检查输入');
    }
  }
  function advance() {
    setLocalError('');
    if (step === 1 && !title.trim()) {
      setLocalError('请填写空间名称');
      return;
    }
    if (step === 1 && kind === 'shared_table' && !departmentId) {
      setLocalError('共享统计表需要选择所属部门');
      return;
    }
    setStep(Math.min(2, step + 1));
  }
  return (
    <form className="collaboration-editor" onSubmit={(e) => void save(e)}>
      <header>
        <h2>{existing ? '编辑协作空间' : ['选择用途', '基础信息', '工具配置'][step]}</h2>
        <button type="button" onClick={onCancel}>
          收起
        </button>
      </header>
      {!existing && (
        <ol className="collaboration-steps" aria-label="创建步骤">
          {['选择用途', '基础信息', '工具配置'].map((label, index) => (
            <li key={label} aria-current={step === index ? 'step' : undefined}>
              <span>{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      )}
      {showChoice && (
        <div className="collaboration-kind-picker">
          {kinds.map((item) => (
            <button
              type="button"
              disabled={locked}
              key={item.id}
              aria-pressed={kind === item.id}
              onClick={() => setKind(item.id)}
            >
              <ToolIcon kind={item.id} />
              <strong>{item.title}</strong>
              <small>{item.text}</small>
            </button>
          ))}
        </div>
      )}
      {!existing && showChoice && (
        <div className="collaboration-toolbar">
          <button
            type="button"
            onClick={() => {
              setKind('materials');
              setTitle('实践每日安全报告');
              setDescription('每天按报告日期提交，说明所在地、人员安全与紧急联络情况。');
              setColumns([
                { id: 'report_date', label: '报告日期', kind: 'date', required: true },
                { id: 'team', label: '支队', kind: 'text', required: true },
                {
                  id: 'safety',
                  label: '安全状态',
                  kind: 'choice',
                  options: ['全员安全', '需要协调帮助'],
                  required: true,
                },
              ]);
            }}
          >
            使用每日安全报告模板
          </button>
          <button
            type="button"
            onClick={() => {
              setKind('practice');
              setTitle('TMS 实践支队双选');
              setDescription('按点击顺序填写志愿；组织安排后请本人确认。');
            }}
          >
            使用 TMS 双选模板
          </button>
          <button
            type="button"
            onClick={() => {
              setKind('attendance');
              setTitle('训练参与记录');
              setDescription('填写训练日期与参与说明，由组织确认。');
              setColumns([]);
              setSlots([]);
              setStages([]);
            }}
          >
            使用训练打卡模板
          </button>
          <button
            type="button"
            onClick={() => {
              setKind('review');
              setTitle('推送发布审核');
              setDescription('提交文章链接与发布说明，按指定顺序完成审核。');
              setColumns([]);
              setSlots([]);
              setStages([
                {
                  title: '发布审核',
                  roleKeys: [...(dept?.roleKeys.slice(0, 1) ?? ['counselor.practice'])],
                },
              ]);
            }}
          >
            使用推送审核模板
          </button>
        </div>
      )}
      {showBasic && (
        <div className="collaboration-form-grid">
          <label>
            名称
            <input
              required
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：秋季例会时间收集"
            />
          </label>
          <label>
            所属部门
            <select value={departmentId} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">个人发起</option>
              {departments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.organizationName} · {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            谁可以参与
            <select
              value={kind === 'shared_table' ? 'department' : audience}
              disabled={kind === 'shared_table'}
              onChange={(e) => setAudience(e.target.value as 'all' | 'department')}
            >
              <option value="all">发展端同学</option>
              <option value="department">仅本部门</option>
            </select>
          </label>
          <label className="wide">
            说明
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4000}
            />
          </label>
        </div>
      )}
      {showConfig && (
        <div className="collaboration-config">
          <p className="collaboration-help">
            {kinds.find((item) => item.id === kind)?.text} 可先保存草稿，再在管理设置中开放。
          </p>
          {['availability', 'practice'].includes(kind) && (
            <fieldset disabled={locked}>
              <legend>{kind === 'practice' ? '支队与可选时段' : '候选时间段'}</legend>
              {slots.map((slot, index) => (
                <div className="collaboration-slot-editor" key={slot.id}>
                  <input
                    aria-label={`选项${index + 1}名称`}
                    required
                    placeholder={kind === 'practice' ? '支队名称' : '时间段名称'}
                    value={slot.title}
                    onChange={(e) =>
                      setSlots(
                        slots.map((s) => (s.id === slot.id ? { ...s, title: e.target.value } : s)),
                      )
                    }
                  />
                  <input
                    aria-label={`选项${index + 1}开始`}
                    required
                    type="datetime-local"
                    defaultValue={
                      slot.startsAt
                        ? new Date(
                            Date.parse(slot.startsAt) -
                              new Date(slot.startsAt).getTimezoneOffset() * 60000,
                          )
                            .toISOString()
                            .slice(0, 16)
                        : ''
                    }
                    onChange={(e) =>
                      setSlots(
                        slots.map((s) =>
                          s.id === slot.id ? { ...s, startsAt: iso(e.target.value) } : s,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label={`选项${index + 1}结束`}
                    required
                    type="datetime-local"
                    defaultValue={
                      slot.endsAt
                        ? new Date(
                            Date.parse(slot.endsAt) -
                              new Date(slot.endsAt).getTimezoneOffset() * 60000,
                          )
                            .toISOString()
                            .slice(0, 16)
                        : ''
                    }
                    onChange={(e) =>
                      setSlots(
                        slots.map((s) =>
                          s.id === slot.id ? { ...s, endsAt: iso(e.target.value) } : s,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label={`选项${index + 1}名额`}
                    type="number"
                    min={1}
                    max={10000}
                    value={slot.capacity}
                    onChange={(e) =>
                      setSlots(
                        slots.map((s) =>
                          s.id === slot.id ? { ...s, capacity: Number(e.target.value) } : s,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setSlots(slots.filter((s) => s.id !== slot.id))}
                  >
                    移除
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setSlots([
                    ...slots,
                    { id: crypto.randomUUID(), title: '', startsAt: '', endsAt: '', capacity: 20 },
                  ])
                }
              >
                ＋ 添加选项
              </button>
            </fieldset>
          )}
          {kind === 'materials' && (
            <label>
              应报告用户编号（逗号分隔）
              <textarea
                value={expectedReporters}
                onChange={(event) => setExpectedReporters(event.target.value)}
              />
            </label>
          )}
          {['shared_table', 'materials'].includes(kind) && (
            <fieldset disabled={locked}>
              <legend>表格字段</legend>
              {columns.map((column) => (
                <div className="collaboration-column-editor" key={column.id}>
                  <input
                    required
                    aria-label="字段名称"
                    placeholder="字段名称"
                    value={column.label}
                    onChange={(e) =>
                      setColumns(
                        columns.map((c) =>
                          c.id === column.id ? { ...c, label: e.target.value } : c,
                        ),
                      )
                    }
                  />
                  <select
                    value={column.kind}
                    onChange={(e) =>
                      setColumns(
                        columns.map((c) =>
                          c.id === column.id
                            ? { ...c, kind: e.target.value as CollaborationColumn['kind'] }
                            : c,
                        ),
                      )
                    }
                  >
                    <option value="text">文字</option>
                    <option value="number">数字</option>
                    <option value="date">日期</option>
                    <option value="choice">选择</option>
                  </select>
                  <input
                    aria-label="允许编辑的角色"
                    placeholder="可编辑角色编号，逗号分隔；留空为全员"
                    value={column.editRoleKeys?.join(',') ?? ''}
                    onChange={(e) =>
                      setColumns(
                        columns.map((c) =>
                          c.id === column.id
                            ? {
                                ...c,
                                editRoleKeys: e.target.value
                                  .split(',')
                                  .map((v) => v.trim())
                                  .filter(Boolean),
                              }
                            : c,
                        ),
                      )
                    }
                  />
                  {column.kind === 'choice' && (
                    <input
                      aria-label="字段选项"
                      placeholder="选项用逗号分隔"
                      value={column.options?.join(',') ?? ''}
                      onChange={(e) =>
                        setColumns(
                          columns.map((c) =>
                            c.id === column.id
                              ? {
                                  ...c,
                                  options: e.target.value
                                    .split(/[,，]/)
                                    .map((v) => v.trim())
                                    .filter(Boolean),
                                }
                              : c,
                          ),
                        )
                      }
                    />
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={column.required}
                      onChange={(e) =>
                        setColumns(
                          columns.map((c) =>
                            c.id === column.id ? { ...c, required: e.target.checked } : c,
                          ),
                        )
                      }
                    />
                    必填
                  </label>
                  <button
                    type="button"
                    onClick={() => setColumns(columns.filter((c) => c.id !== column.id))}
                  >
                    移除
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setColumns([
                    ...columns,
                    { id: crypto.randomUUID(), label: '', kind: 'text', required: false },
                  ])
                }
              >
                ＋ 添加字段
              </button>
            </fieldset>
          )}
          {kind === 'review' && (
            <fieldset disabled={locked}>
              <legend>审核顺序</legend>
              {stages.map((stage, index) => (
                <div className="collaboration-column-editor" key={index}>
                  <input
                    required
                    value={stage.title}
                    placeholder="步骤名称"
                    onChange={(e) =>
                      setStages(
                        stages.map((s, i) => (i === index ? { ...s, title: e.target.value } : s)),
                      )
                    }
                  />
                  <select
                    multiple
                    aria-label={`步骤${index + 1}审核角色`}
                    value={stage.roleKeys}
                    onChange={(e) =>
                      setStages(
                        stages.map((s, i) =>
                          i === index
                            ? { ...s, roleKeys: [...e.target.selectedOptions].map((o) => o.value) }
                            : s,
                        ),
                      )
                    }
                  >
                    {[
                      ...(dept?.roleKeys ?? []),
                      ...DEVELOPMENT_IDENTITY_SECTIONS.flatMap((section) => section.groups)
                        .flatMap((group) => group.options)
                        .map((option) => option.roleKey)
                        .filter((role) => role.startsWith('counselor.')),
                    ].map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setStages(stages.filter((_, i) => i !== index))}
                  >
                    移除
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={!dept}
                onClick={() =>
                  setStages([
                    ...stages,
                    { title: '审核材料', roleKeys: [...(dept?.roleKeys.slice(0, 1) ?? [])] },
                  ])
                }
              >
                ＋ 添加审核步骤
              </button>
            </fieldset>
          )}
        </div>
      )}
      {locked && <p>已有提交记录，字段结构保持不变；名称、说明与开放状态可以继续修改。</p>}
      {localError && <p role="alert">{localError}</p>}
      <div className="collaboration-editor-actions">
        {!existing && step > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setLocalError('');
              setStep(step - 1);
            }}
          >
            上一步
          </button>
        )}
        {!existing && step < 2 ? (
          <button
            key="next-step"
            type="button"
            className="collaboration-primary"
            onClick={(event) => {
              event.preventDefault();
              advance();
            }}
          >
            下一步
          </button>
        ) : (
          <button key="save-space" type="submit" className="collaboration-primary" disabled={busy}>
            {busy ? '保存中…' : existing ? '保存协作空间' : '创建草稿'}
          </button>
        )}
      </div>
      <small>新空间默认保存为草稿，确认后再开放收集。</small>
    </form>
  );
}
