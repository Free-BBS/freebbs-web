import type {
  OrganizationGroupAnswer,
  OrganizationGroupFile,
  OrganizationGroupMember,
  OrganizationGroupClass,
  OrganizationGroupVersionInput,
  OrganizationGroupWorkspace,
} from '@freebbs-development/contracts';
export interface EntryDraft {
  classId: string;
  participantCount: string;
  activityTypeId: string;
  activityDate: string;
  summary: string;
  difficulties: string;
  photos: OrganizationGroupFile[];
  extraAnswers: Record<string, OrganizationGroupAnswer>;
}
export function emptyDraft(classId = ''): EntryDraft {
  return {
    classId,
    participantCount: '',
    activityTypeId: '',
    activityDate: '',
    summary: '',
    difficulties: '',
    photos: [],
    extraAnswers: {},
  };
}
export function pointCount(value: string) {
  return Array.from(value).length;
}
export function validateEntry(
  draft: EntryDraft,
  version: OrganizationGroupVersionInput,
  workspace: OrganizationGroupWorkspace,
): string | null {
  if (!draft.classId) return '请选择班级。';
  if (
    !/^\d+$/.test(draft.participantCount) ||
    !Number.isSafeInteger(Number(draft.participantCount)) ||
    Number(draft.participantCount) < 1
  )
    return '参与人数必须为正整数。';
  if (!version.activityTypes.some((type) => type.id === draft.activityTypeId))
    return '请选择活动类型。';
  if (!draft.summary.trim()) return '请填写活动概要。';
  if (pointCount(draft.summary) > 200) return '活动概要最多 200 字（包含空白）。';
  if (pointCount(draft.difficulties) > 2000) return '困难反馈最多 2000 字。';
  if (!draft.photos.length) return '请至少上传一张活动照片。';
  if (draft.photos.length > workspace.maxPhotos) return `活动照片最多 ${workspace.maxPhotos} 张。`;
  for (const field of version.fields) {
    const value = draft.extraAnswers[field.id];
    if (
      field.required &&
      (value === undefined || value === '' || (Array.isArray(value) && !value.length))
    )
      return `请填写${field.label}。`;
    if (value === undefined || value === '') continue;
    if (
      field.kind === 'integer' &&
      (!Number.isSafeInteger(Number(value)) ||
        (field.min !== undefined && Number(value) < field.min) ||
        (field.max !== undefined && Number(value) > field.max))
    )
      return `${field.label}需要填写有效整数。`;
    if (
      typeof value === 'string' &&
      field.maxLength !== undefined &&
      pointCount(value) > field.maxLength
    )
      return `${field.label}最多 ${field.maxLength} 字。`;
  }
  return null;
}
export function parseClasses(text: string): OrganizationGroupClass[] {
  const rows = text.split(/\r?\n/).filter((row) => row.trim());
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const [id, label, ...rest] = row.split(/[,\t]/).map((item) => item.trim());
    if (!id || !label || rest.length || seen.has(id))
      throw new Error(`第 ${index + 1} 行班级格式或编号重复；请填写 编号,名称。`);
    seen.add(id);
    return { id, label };
  });
}
function csvCells(row: string): string[] {
  const result: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < row.length; index++) {
    const char = row[index];
    if (char === '"') {
      if (quoted && row[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
    } else if ((char === ',' || char === '\t') && !quoted) {
      result.push(cell.trim());
      cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('引号未闭合');
  result.push(cell.trim());
  return result;
}
export function parseRoster(
  text: string,
  classes: OrganizationGroupClass[],
): OrganizationGroupMember[] {
  const known = new Set(classes.map((item) => item.id));
  const uids = new Set<string>();
  const students = new Set<string>();
  const rows = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((row) => row.trim());
  if (rows[0] && /^uid[,\t]/i.test(rows[0])) rows.shift();
  return rows.map((row, index) => {
    let cells: string[];
    try {
      cells = csvCells(row);
    } catch {
      throw new Error(`第 ${index + 1} 行 CSV 引号未闭合。`);
    }
    const [uid, studentId, classId, allowed] = cells;
    const submitClassIds = (allowed ?? '')
      .split(/[|;；]/)
      .map((id) => id.trim())
      .filter(Boolean);
    if (
      cells.length !== 4 ||
      !uid ||
      !studentId ||
      !classId ||
      !known.has(classId) ||
      !submitClassIds.length ||
      submitClassIds.some((id) => !known.has(id))
    )
      throw new Error(
        `第 ${index + 1} 行无效；UID、学号、所属班级和可填报班级均必填，班级编号须在目录中。`,
      );
    if (
      uids.has(uid) ||
      students.has(studentId) ||
      new Set(submitClassIds).size !== submitClassIds.length
    )
      throw new Error(`第 ${index + 1} 行 UID、学号或可填报班级重复。`);
    uids.add(uid);
    students.add(studentId);
    return { uid, studentId, classId, submitClassIds };
  });
}
export function shanghaiInput(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 16);
}
export function shanghaiTimestamp(input: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) throw new Error('请选择完整截止日期和时间。');
  return `${input}:00+08:00`;
}
export function displayShanghai(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
}
export const coreLabels = {
  classId: '班级',
  participantCount: '参与人数',
  activityTypeId: '活动类型',
  activityDate: '活动日期',
  summary: '活动概要',
  photos: '活动照片',
  difficulties: '困难反馈',
};
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作未完成，请稍后重试。';
}
export function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}
