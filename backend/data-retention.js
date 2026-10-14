const { MODERATION_RETENTION_DAYS } = require('./moderation-retention');

// Inspection only: this module never initializes schemas or changes records.
// Sources are an explicit allowlist, not client-supplied table/column names.
const fiveYears = {
  retention: '拟定保存 5 年；目的已结束或应提前删除的情形另行处理',
  startPoint: '各条记录创建时间；编辑、浏览或备份恢复不重新起算',
  executionStatus: '仅检查，新增清理未启用',
  proposed: true,
};
const definitions = [
  {
    id: 'accounts',
    label: '账号资料',
    purpose: '提供账号、身份和个人设置服务',
    retention: '提供账号服务所必需期间保存；毕业暂时保留账号',
    startPoint: '账号服务与实际使用需要；不按注册满 5 年认定到期',
    executionStatus: '按服务需要核查',
    proposed: false,
    notes: '长期不活跃和账号终止后的具体处置仍需确定，不能用账号更新时间代替最后使用时间。',
    sources: [{ table: 'users', date: 'created_at', rule: 'none' }],
  },
  {
    id: 'registration',
    label: '注册资格核对资料',
    purpose: '核验院系提供的注册资格',
    retention: '限院系授权用途所需期间，不因尚未注册而无限保存',
    startPoint: '授权用途结束或核对资料不再必要时进行人工核查',
    executionStatus: '需人工确认用途是否结束',
    proposed: false,
    notes: '仅涉及本站持有的核对副本；停用不等于删除，当前没有可自动判定用途结束的时间字段。',
    sources: [{ table: 'registration_whitelist', date: 'created_at', rule: 'none' }],
  },
  {
    id: 'ai_history',
    label: '私人 AI 会话',
    purpose: '供本人查看历史和继续对话',
    retention: '账号正常使用期间持续保存；毕业暂不终止账号',
    startPoint: '随账号服务与会话使用需要，不设会话创建后 5 年到期',
    executionStatus: '不纳入按年到期检查',
    proposed: false,
    notes: '用户主动删除、注销请求及目的不再必要的情形另行处理；调查下载副本不适用本安排。',
    sources: [{ table: 'ai_dialogs', date: 'created_at', rule: 'none' }],
  },
  {
    ...fiveYears,
    id: 'discussion_posts',
    label: '讨论区帖子',
    purpose: '历史内容查询与交流回溯',
    notes: '当前仅统计帖子记录；清理前需处理较新的评论、图片及引用关系，不能直接级联删除。',
    sources: [{ table: 'discussion_posts', date: 'created_at', rule: 'years' }],
  },
  {
    ...fiveYears,
    id: 'discussion_comments',
    label: '讨论区评论',
    purpose: '讨论历史查询与上下文回溯',
    notes: '包括现存已隐藏或软删除的记录；删除父评论会影响较新回复，需另行制定处置方式。',
    sources: [{ table: 'discussion_comments', date: 'created_at', rule: 'years' }],
  },
  {
    ...fiveYears,
    id: 'learning_records',
    label: '学习记录与作答记录',
    purpose: '个人学习历史查询与课程回顾',
    notes: '统计学习条目和作答记录；不包含课程资料、课程快照及其他尚未逐项映射的业务数据。',
    sources: [
      { table: 'learning_entries', date: 'created_at', rule: 'years' },
      { table: 'learning_assessment_attempts', date: 'created_at', rule: 'years' },
    ],
  },
  {
    id: 'notifications',
    label: '站内通知',
    purpose: '通知查阅与相关事项回溯',
    retention: '按提醒与处理结果查看需要核定，不统一保存 5 年',
    startPoint: '按通知用途与相关事项处理需要确定',
    executionStatus: '具体期限待核定',
    proposed: true,
    notes: '仅统计通知本身；已读、收藏状态及关联待办须一并核查，当前不按 5 年标记通知到期。',
    sources: [{ table: 'notifications', date: 'created_at', rule: 'none' }],
  },
  {
    ...fiveYears,
    id: 'activity_entries',
    label: '活动报名记录',
    purpose: '报名处理与活动记录查询',
    notes: '仅统计报名记录；不同活动的必要期限可能更短，联系方式等字段不必一律保留满 5 年。',
    sources: [{ table: 'survey_entries', date: 'created_at', rule: 'years' }],
  },
  {
    ...fiveYears,
    id: 'ai_export_audit',
    label: 'AI 对话导出操作记录',
    purpose: '核查管理员导出的范围、事由与结果',
    notes: '只统计操作记录，不读取或保留导出的对话副本。实际下载副本仍需保管人按事项需要处理。',
    sources: [{ table: 'ai_dialog_export_audit', date: 'created_at', rule: 'years' }],
  },
  {
    ...fiveYears,
    id: 'moderation_metadata',
    label: '内容处理关联状态',
    purpose: '保留必要的处理状态与操作关联',
    notes: '这是关联记录的拟定期限，不延长原稿、模型理由、话题标签等证据的 90 天期限。',
    sources: [{ table: 'moderation_submissions', date: 'created_at', rule: 'years' }],
  },
  {
    id: 'moderation_evidence',
    label: '内容检查原稿与证据',
    purpose: '内容处理、负责人复核与申诉核对',
    retention: `保持 ${MODERATION_RETENTION_DAYS} 天`,
    startPoint: '提交创建时间；按已有证据到期时间检查',
    executionStatus: `沿用现有 ${MODERATION_RETENTION_DAYS} 天清理`,
    proposed: false,
    notes:
      '统计尚未标记清理的提交证据；到期数量只表示待核对，不证明后台任务已运行。图片文件与派生模型记录的完整性仍需另查。',
    sources: [
      {
        table: 'moderation_submissions',
        date: 'created_at',
        expiry: 'expires_at',
        remaining: 'evidence_purged_at',
        rule: 'expiry',
      },
    ],
  },
  {
    id: 'learning_analytics',
    label: '学习分析事件',
    purpose: '提供近期学习分析',
    retention: '保持 180 天',
    startPoint: '事件创建时间',
    executionStatus: '沿用现有请求触发清理',
    proposed: false,
    notes: '现有清理由相关请求触发；本页仅检查，不主动触发该清理。此期限不用于学习笔记或作答记录。',
    sources: [{ table: 'learning_analytics_events', date: 'created_at', rule: 'days' }],
  },
  {
    id: 'attachments',
    label: '上传文件及生成文件',
    purpose: '展示关联内容及继续使用 AI 历史',
    retention: '必要附件随关联记录；独立文件拟定 5 年；未完成 Max 上传分片保持 10 分钟超时',
    startPoint: '关联内容的期限，或独立文件上传、生成时间；不按磁盘修改时间判断',
    executionStatus: '文件引用与时间映射待完善',
    proposed: true,
    notes: '普通上传缺统一资产登记，不能用数据库记录数量推断文件已覆盖；本次不遍历或删除文件。',
    sources: [],
  },
  {
    id: 'other_business',
    label: '其他业务记录',
    purpose: '课程、日程和其他功能的历史服务',
    retention: '按用途逐类核定；课程与日程历史拟定 5 年，互动等不统一套用',
    startPoint: '各类业务的原始创建或发生时间，具体映射待完善',
    executionStatus: '未完整覆盖，需逐类核对',
    proposed: true,
    notes:
      '课程与日程快照、互动、账户资产、工具作品等尚未完成逐项映射；本页的其他统计不能代表全站已完成检查。',
    sources: [],
  },
  {
    id: 'case_copies',
    label: '事项核查副本与隐私请求资料',
    purpose: '处理具体事项、必要复核和隐私请求',
    retention: '正文副本按事项需要；最小化请求摘要拟从结案起保存 5 年',
    startPoint: '事项需要结束或请求结案；不将全部正文统一延长至 5 年',
    executionStatus: '由负责人登记与核查',
    proposed: true,
    notes: '站外下载副本和邮箱附件无法通过本站数据库判定或清理，需另行登记保管人及处置结果。',
    sources: [],
  },
  {
    id: 'operations',
    label: '日志、邮件、备份与供应商记录',
    purpose: '安全运维、通信和外部服务',
    retention: '具体周期及适用要求待逐项核实，不统一延长为 5 年',
    startPoint: '按实际类别和服务安排确定',
    executionStatus: '尚未纳入本站到期统计',
    proposed: false,
    notes: '数据库检查不能证明备份、邮件或供应商副本已删除，也不能控制用户下载文件和离线缓存。',
    sources: [],
  },
];

const unknownStats = (message) => ({
  status: 'unavailable',
  totalCount: null,
  overdueCount: null,
  oldestCreatedAt: null,
  missingDateCount: null,
  message,
});

function sourceColumns(source) {
  return [source.date, source.expiry, source.remaining].filter(Boolean);
}

function buildAggregateQuery(source) {
  // DATE_ADD uses calendar years (including MySQL's February-end adjustment),
  // not 5 * 365 days. No cutoff is derived from an edited/updated timestamp.
  const validDate = (column) => `\`${column}\` IS NOT NULL AND \`${column}\` >= '1000-01-01'`;
  const basis = source.expiry || source.date;
  let overdue = 'NULL';
  if (source.rule === 'years') overdue = `DATE_ADD(\`${basis}\`, INTERVAL 5 YEAR) <= ?`;
  if (source.rule === 'days') overdue = `\`${basis}\` < DATE_SUB(?, INTERVAL 180 DAY)`;
  if (source.rule === 'expiry') overdue = `\`${basis}\` <= ?`;
  return `SELECT /*+ MAX_EXECUTION_TIME(3000) */ COUNT(*) AS total_count,
    ${source.rule === 'none' ? 'NULL' : `COALESCE(SUM(CASE WHEN ${validDate(basis)} AND ${overdue} THEN 1 ELSE 0 END), 0)`} AS overdue_count,
    DATE_FORMAT(MIN(CASE WHEN ${validDate(source.date)} THEN \`${source.date}\` END), '%Y-%m-%d %H:%i:%s.%f') AS oldest_created_at,
    COALESCE(SUM(CASE WHEN ${validDate(basis)} THEN 0 ELSE 1 END), 0) AS missing_date_count
    FROM \`${source.table}\`${source.remaining ? ` WHERE \`${source.remaining}\` IS NULL` : ''}`;
}

function safeCount(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || value === null || value === undefined)
    throw new Error('Invalid retention aggregate');
  return parsed;
}

async function inspectCategory(pool, definition, schema, asOf) {
  const { sources, ...category } = definition;
  category.coverage = sources.length ? `${sources.length} 项已映射数据来源` : '尚无完整可执行映射';
  if (!sources.length) return { ...category, stats: unknownStats('尚未覆盖；不是零条到期数据。') };
  const results = await Promise.all(
    sources.map(async (source) => {
      if (!sourceColumns(source).every((column) => schema.get(source.table)?.has(column)))
        return null;
      try {
        const [[row]] = await pool.execute(
          buildAggregateQuery(source),
          source.rule === 'none' ? [] : [asOf],
        );
        if (!row) return null;
        const oldest = row.oldest_created_at;
        if (oldest !== null && !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{6}$/.test(oldest)) return null;
        return {
          totalCount: safeCount(row.total_count),
          overdueCount: source.rule === 'none' ? null : safeCount(row.overdue_count),
          oldestCreatedAt: oldest,
          missingDateCount: safeCount(row.missing_date_count),
        };
      } catch {
        // Missing tables, permission errors and timeouts must not look like zero.
        return null;
      }
    }),
  );
  const available = results.filter(Boolean);
  if (!available.length)
    return { ...category, stats: unknownStats('数据来源、时间字段或查询暂不可用，请核查后重试。') };
  const timed = sources.some((source) => source.rule !== 'none');
  const stats = {
    status: available.length < sources.length ? 'partial' : timed ? 'available' : 'not_applicable',
    totalCount: available.reduce((sum, result) => sum + result.totalCount, 0),
    overdueCount: timed ? available.reduce((sum, result) => sum + result.overdueCount, 0) : null,
    oldestCreatedAt:
      available
        .map((result) => result.oldestCreatedAt)
        .filter(Boolean)
        .sort()[0] || null,
    missingDateCount: available.reduce((sum, result) => sum + result.missingDateCount, 0),
    message: timed
      ? '只读统计，未执行任何新增清理。'
      : '没有可自动计算的到期日，不把较早创建记录视为到期。',
  };
  if (stats.status === 'partial')
    stats.message = '部分数据来源不可用；数字只覆盖查询成功的来源，不能视作完整统计。';
  if (stats.missingDateCount) {
    if (timed) stats.status = 'partial';
    stats.message += ` ${stats.missingDateCount} 条记录缺少有效起算时间，未擅自判定到期。`;
  }
  return { ...category, stats };
}

async function inspectDataRetention(pool, { now = () => new Date() } = {}) {
  // Use one database-local wall time for all DATETIME comparisons, independent
  // of the app host's time zone. It is a time reference, not a locked snapshot.
  const [[clock]] = await pool.execute(
    "SELECT DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s.%f') AS as_of",
  );
  if (!clock || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{6}$/.test(clock.as_of))
    throw new Error('Database time unavailable');
  const tables = [
    ...new Set(definitions.flatMap((category) => category.sources.map((source) => source.table))),
  ];
  const [columns] = await pool.execute(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tables.map(() => '?').join(',')})`,
    tables,
  );
  const schema = new Map();
  for (const column of columns) {
    if (!schema.has(column.table_name)) schema.set(column.table_name, new Set());
    schema.get(column.table_name).add(column.column_name);
  }
  const categories = [];
  // Bound concurrent aggregate work; no user-selected queries or full records.
  for (let index = 0; index < definitions.length; index += 3) {
    categories.push(
      ...(await Promise.all(
        definitions
          .slice(index, index + 3)
          .map((definition) => inspectCategory(pool, definition, schema, clock.as_of)),
      )),
    );
  }
  return {
    ok: true,
    checkedAt: now().toISOString(),
    asOfDatabaseTime: clock.as_of,
    mode: 'read_only',
    newCleanupEnabled: false,
    categories,
  };
}

function mountDataRetentionRoutes(app, { pool, requireAdmin }) {
  app.get('/api/admin/data-retention', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    try {
      const admin = await requireAdmin(request, response);
      if (!admin) return;
      response.json(await inspectDataRetention(pool));
    } catch {
      response.status(503).json({
        code: 'retention_inspection_unavailable',
        message: '暂时无法检查保存情况，请稍后重试；本次未执行数据清理。',
      });
    }
  });
}

module.exports = { inspectDataRetention, mountDataRetentionRoutes };
