import type {
  CollectionFieldKind,
  CollectionOutputKind,
  CollectionRuleKind,
} from '@freebbs-development/contracts';

export const fieldCatalog: ReadonlyArray<{
  kind: CollectionFieldKind;
  label: string;
  description: string;
  symbol: string;
}> = [
  { kind: 'instructions', label: '说明文字', description: '标题、提示和分节说明', symbol: 'Aa' },
  { kind: 'identity', label: '基本信息', description: '自动带入姓名与学号', symbol: 'ID' },
  { kind: 'short_text', label: '单行文字', description: '姓名、标题或简短回答', symbol: '一' },
  { kind: 'long_text', label: '多行文字', description: '经历、建议或详细说明', symbol: '≡' },
  { kind: 'single_choice', label: '单项选择', description: '从多个选项中选择一个', symbol: '◉' },
  { kind: 'multiple_choice', label: '多项选择', description: '允许同时选择多个选项', symbol: '☑' },
  { kind: 'datetime', label: '日期时间', description: '收集可用时间或预约时间', symbol: '◷' },
  { kind: 'file', label: '文件上传', description: '文档、压缩包或其他材料', symbol: '↥' },
  { kind: 'image', label: '图片上传', description: '照片、海报与截图', symbol: '▧' },
  { kind: 'video', label: '视频上传', description: '作品与活动视频', symbol: '▶' },
  { kind: 'audio', label: '音频上传', description: '录音与声音作品', symbol: '◖' },
];

export const ruleCatalog: ReadonlyArray<{
  kind: CollectionRuleKind;
  label: string;
  description: string;
  symbol: string;
}> = [
  { kind: 'audience', label: '可见范围', description: '控制谁能看到表单', symbol: '◎' },
  { kind: 'required', label: '必填', description: '提交前必须完成', symbol: '!' },
  { kind: 'attempt_limit', label: '提交次数', description: '限制每人提交次数', symbol: '#' },
  { kind: 'upload_count', label: '文件数量', description: '限制一次上传数量', symbol: '×' },
  { kind: 'file_types', label: '文件格式', description: '允许特定文件类型', symbol: '◇' },
  { kind: 'file_size', label: '文件大小', description: '设置单个文件上限', symbol: 'MB' },
  {
    kind: 'title_pattern',
    label: '标题审核',
    description: '检查文字标题与上传文件名',
    symbol: '✓',
  },
  { kind: 'schedule', label: '开放时间', description: '定时开放和截止', symbol: '◴' },
  { kind: 'capacity', label: '名额上限', description: '达到人数后自动截止', symbol: '∑' },
];

export const outputCatalog: ReadonlyArray<{
  kind: CollectionOutputKind;
  label: string;
  description: string;
  symbol: string;
}> = [
  {
    kind: 'excel',
    label: 'Excel 表格',
    description: '整理为 Excel 可直接打开的表格',
    symbol: 'XLS',
  },
  { kind: 'csv', label: 'CSV 数据', description: '用于统计软件和批量处理', symbol: 'CSV' },
  { kind: 'json', label: '原始数据', description: '保留完整字段结构和附件信息', symbol: '{ }' },
  { kind: 'summary', label: '汇总报告', description: '统计提交量与选择题分布', symbol: 'Σ' },
];
