import {
  DEVELOPMENT_IDENTITY_SECTIONS,
  type CollaborationKind,
  type CollaborationSpace,
} from '@freebbs-development/contracts';
export const kinds: Array<{ id: CollaborationKind; title: string; text: string }> = [
  { id: 'availability', title: '相约时间', text: '收集空闲时间，找到共同的一小时。' },
  { id: 'booking', title: '预约日历', text: '推送、视频与空间预约，自动检查冲突。' },
  {
    id: 'shared_table',
    title: '共享统计表',
    text: '自定义字段，让部门一起维护同一份记录。',
  },
  { id: 'practice', title: '志愿双选', text: '收集排序志愿，按名额生成初步安排。' },
  { id: 'attendance', title: '活动打卡', text: '提交训练与参与记录，由组织确认。' },
  { id: 'review', title: '材料审核', text: '分步收集、审核，留下清晰的处理记录。' },
  { id: 'materials', title: '材料收集', text: '按统一要求提交文字、资料与每日简报。' },
];
export const kindName = (id: CollaborationKind) => kinds.find((kind) => kind.id === id)!.title;
export const roleLabel = (key: string) =>
  DEVELOPMENT_IDENTITY_SECTIONS.flatMap((section) => section.groups)
    .flatMap((group) => group.options)
    .find((option) => option.roleKey === key)?.label ?? '审核人员';
export const localDate = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
export function iso(value: string) {
  return value ? new Date(value).toISOString() : '';
}

export const toolGroups = [
  { title: '时间安排', text: '先找到时间，再确定预约。', kinds: ['availability', 'booking'] },
  {
    title: '共同记录',
    text: '报名、打卡和部门台账，有序积累。',
    kinds: ['shared_table', 'practice', 'attendance'],
  },
  { title: '材料流程', text: '统一收集材料，跟进每一步处理。', kinds: ['review', 'materials'] },
];
export const statusName = (status: CollaborationSpace['status']) =>
  status === 'draft' ? '草稿' : status === 'closed' ? '已结束' : '开放中';
export function ToolIcon({ kind }: { kind: CollaborationKind }) {
  const paths: Record<CollaborationKind, string> = {
    availability: 'M12 8v4l3 2 M8 3h8 M12 3v2',
    booking: 'M6 3v4 M18 3v4 M4 10h16 M8 14h2 M14 14h2 M8 18h2',
    shared_table: 'M4 9h16 M4 14h16 M10 4v16',
    practice: 'M5 8h14l-3-3 M19 16H5l3 3',
    attendance: 'm7 12 3 3 7-7',
    review: 'M8 8h8 M8 12h5 m0 5 2 2 5-5',
    materials: 'M8 8h8 M8 12h8 M8 16h5',
  };
  return (
    <svg
      className="collaboration-tool-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'availability' ? (
        <circle cx="12" cy="13" r="8" />
      ) : (
        <rect x="4" y="4" width="16" height="16" rx="3" />
      )}
      <path d={paths[kind]} />
    </svg>
  );
}
