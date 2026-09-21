// Read-only tour catalogue, shared by the browser engine and contract tests.
// Actions only open existing views. Publishing, AI requests, purchases, sales,
// equipment changes, feeding and local learning-tag changes stay user-initiated.
(() => {
  const STATIONS = [
    { id: 'home', label: '出发点', title: '认识 FREE BBS', route: '/', fallbackRoute: '/' },
    {
      id: 'world',
      label: '学习世界',
      title: '从一座知识岛出发',
      route: '/world',
      fallbackRoute: '/world',
    },
    {
      id: 'course',
      label: '课程地图',
      title: '找到知识之间的联系',
      route: '/course',
      fallbackRoute: '/world',
    },
    {
      id: 'knowledge',
      label: '知识点',
      title: '从概览走进正文',
      route: '/knowledge',
      fallbackRoute: '/world',
    },
    {
      id: 'discussion',
      label: '讨论区',
      title: '让问题遇见同伴',
      route: '/discussion',
      fallbackRoute: '/discussion',
    },
    {
      id: 'max',
      label: '问问 Max',
      title: '认识你的答疑搭子',
      route: '/aichat',
      fallbackRoute: '/aichat',
    },
    {
      id: 'workbench',
      label: '工作台',
      title: '安排自己的节奏',
      route: '/workbench',
      fallbackRoute: '/workbench',
    },
    {
      id: 'shop',
      label: '商城',
      title: '先端详，再决定',
      route: '/electromagnetic',
      fallbackRoute: '/electromagnetic',
    },
    {
      id: 'inventory',
      label: '仓库与账本',
      title: '整理你的小小行囊',
      route: '/inventory',
      fallbackRoute: '/inventory',
    },
    {
      id: 'settings',
      label: '设置',
      title: '把阅读和账号调成自己的习惯',
      route: '/settings',
      fallbackRoute: '/settings',
    },
    // The engine must build /profile?uid=<current account uid>. A bare /profile
    // is not an own-profile alias; guests can use the handbook fallback.
    {
      id: 'profile',
      label: '个人主页',
      title: '这里有你的模样',
      route: '/profile',
      fallbackRoute: '/guide',
    },
    {
      id: 'handbook',
      label: '随身手册',
      title: '以后也能回来看看',
      route: '/guide',
      fallbackRoute: '/guide',
    },
    {
      id: 'development',
      label: '发展端',
      title: '发展端：认识正在建设的新空间',
      description: '了解建设状态，以及活动报名今后的整合方向。',
      route: '/development',
      fallbackRoute: '/development',
    },
    {
      id: 'activities',
      label: '活动报名',
      title: '活动报名：从浏览到回执',
      description: '认识当前独立入口、报名条件与结果查询方式。',
      route: '/surveys',
      fallbackRoute: '/surveys',
    },
  ];
  const stationById = new Map(STATIONS.map((station) => [station.id, station]));
  const click = (selector, label) => ({ selector, label, kind: 'click' });
  const link = (selector, label) => ({ selector, label, kind: 'link' });
  const ready = (selector, whenMissing) => ({ selector, whenMissing });
  const mathPlanet = '.island-orbit-item[data-world-id="mathematics"]';
  const worldReady = [
    ready('#world-modal[open] [data-close-modal]', '#world-modal:not([open])'),
    ready('#island-course-back', '#world-explorer:not([hidden])'),
  ];
  const openMath = [ready(mathPlanet, '#world-modal[open]')];
  const mathStage = [
    ready(mathPlanet, '#island-course-stage:not([hidden])'),
    ready('#world-enter-island', '#island-course-stage:not([hidden])'),
  ];
  const focusedNode = [ready('[data-reader-node-id]', '.course-reader-study-link')];
  const reading = [ready('#knowledge-start-reading', '#knowledge-reading:not(.hidden)')];
  const plan = [ready('#workbench-plan-tab', '#workbench-plan-tab[aria-current="page"]')];
  // The branches are mutually exclusive: querySelector's DOM order cannot
  // select an ordinary post ahead of a pinned one. No pin means first post.
  const preferredPost =
    '#discussion-post-list .discussion-post-card:has(.discussion-pin-badge) [data-action="open-post"], #discussion-post-list:not(:has(.discussion-pin-badge)) [data-action="open-post"]';
  const boundaries = {
    home: '当前入口以页面已开放功能为准；发展端与新增学习功能会逐步建设。',
    world: '已开放的岛可以进入课程；物理、计算机、实验岛仍在建设，不是完整课程库。',
    course: '课程地图与阅读已可用；内容覆盖以当前课程为准，不代表课程已全部建完。',
    knowledge: '正文、概览和学习标签已有；资源、笔记等工具与知识起源正文仍在建设。',
    discussion: '帖子、评论、回复与评论中的 @Max 已有；管理功能按实际权限显示，不自动授予。',
    max: '可用模型、附件能力以当前配置为准；不会承诺尚未提供的模型能力或学习评测。',
    workbench: '计划、事项和通知已有；AI与校内服务须满足实际使用条件，预览不连接它们。',
    shop: '只展示当前商品与规则；未来新增物品未上线前不视为可以购买。',
    inventory: '回收与余额快照账本已有；历史账本只展示实际记录，未记录的旧交易不会补造。',
    settings: '已有阅读样式与账号设置；实际可改范围以字段和权限为准，导览不改资料或密码。',
    profile: '已有装扮、藏品与牧场按账号状态展示；未拥有的物品不会自动发放或装备。',
    handbook: '未来计划不是上线承诺，具体开放情况会持续更新。',
    development: '发展端仍在建设；活动报名当前有独立入口，发展端上线后将整合进入发展端。',
    activities:
      '活动报名当前通过独立入口使用，发展端上线后将整合进入发展端；导览不填写或提交报名。',
  };
  const steps = [];
  function step(station, id, target, title, body, extra = {}) {
    const entry = stationById.get(station);
    steps.push({
      id,
      station,
      route: entry.route,
      target,
      label: entry.label,
      title,
      body,
      caption: boundaries[station],
      ...extra,
    });
  }

  step(
    'home',
    'home-launchpad',
    '.home-actions',
    '好奇心，今天想去哪里？',
    '我是 Max！FREE BBS 是电子系同学共同建设的学习发展平台。学习世界、讨论区、工作台和我的答疑窗口，都能从这些常用入口出发。',
    {
      focus: { fit: 'overview', radius: 24 },
      caption: '这趟旅行只认识功能，不会替你发布内容、花钱或发送 AI 问题；可以随时暂停、跳站。',
    },
  );
  step(
    'home',
    'home-handbook',
    'a[href="/guide"]',
    '怕记不住？我把地图装进口袋啦。',
    '「认识 FREE BBS」是长期保留的介绍与新手任务入口。以后想重走某一站、看看哪些功能还在建设，都可以回来找它。',
  );

  step(
    'world',
    'world-atlas',
    '.world-orbit-shell',
    '先看整片学习宇宙。',
    '一座知识岛对应一个领域。数学基础、电路架构、信号系统已有课程入口；其余岛屿按页面状态逐步建设。中央星球和两侧箭头可以帮你浏览整片轨道。',
    { prepare: worldReady, focus: { fit: 'overview', radius: 24 } },
  );
  step(
    'world',
    'world-coming-islands',
    '.island-orbit-item[data-world-id="physics"]',
    '有些星球，还在慢慢点亮。',
    '这颗物理星球标着「建设中」。计算机与实验岛也还在准备，点开能了解规划，但暂时没有开放课程轨道；不必为了完成导览寻找尚不存在的内容。',
    { prepare: worldReady, emptyTarget: '#world-explorer' },
  );
  step(
    'world',
    'world-mathematics',
    mathPlanet,
    '今天，就从数学岛落脚。',
    '先点一座岛，不会直接把你扔进公式海洋。我会先展示领域概览，帮你确认它讲什么、有哪些课程。',
    {
      prepare: worldReady,
      // The transparent island sprite overlaps the hub's label in the orbit.
      // Hide that background only while this complete island is spotlighted.
      focus: { hide: '#world-core' },
      action: click(mathPlanet, '看看数学岛'),
    },
  );
  step(
    'world',
    'world-island-overview',
    '#world-modal[open] .world-modal-intro',
    '这是登陆前的小简报。',
    '概览里有领域说明、关键词和开放状态；讨论入口可以通向相关版块。准备好后，再进入这个领域的课程轨道。',
    {
      prepare: openMath,
      action: click('#world-enter-island', '进入课程轨道'),
      emptyTarget: '#world-modal[open]',
    },
  );
  step(
    'world',
    'world-course-orbit',
    '#island-course-orbit',
    '一颗小星球，就是一门课程。',
    '数学岛的高等微积分已经有独立课程入口。点课程星球，就能打开它实际的课程知识地图；左上角随时能返回知识岛。',
    {
      prepare: mathStage,
      action: link('a.island-course-planet[data-course-slug="math"]', '进入高等微积分'),
      emptyBody:
        '这座岛暂时没有可进入的课程。可以返回学习世界，选择另一座已开放的岛，或跳到下一站。',
    },
  );

  step(
    'course',
    'course-directory',
    '#course-map-canvas',
    '课程不是一长串文件。',
    '这里按章节组织知识点，显示课程简介、知识点数量和学习标记。先选一个知识点查看关联，就能知道它和前后的内容怎样接上。',
    {
      prepare: [ready('#course-map-directory-link', '.course-map-directory-layout')],
      focus: { fit: 'overview', radius: 24 },
      action: click('[data-reader-node-id]', '查看一个知识点的关联'),
      emptyTarget: '#course-map-status',
      emptyBody:
        '这门课程暂时没有可浏览的知识点，或地图尚未加载成功。可以返回学习世界换一门课程，或先跳到下一站。',
    },
  );
  step(
    'course',
    'course-relations',
    '.course-map-focused-chapter',
    '把知识点的邻居，也认一认。',
    '选中的知识点居中，相关内容围绕它展示。关系说明会解释箭头和联系类型；点击其他知识点可以继续探索，返回按钮可以回到总览。',
    {
      prepare: focusedNode,
      action: click('[data-course-map-arrow-help-toggle]', '看看关系说明'),
      emptyTarget: '#course-map-canvas',
      emptyBody: '当前课程还没有可展开的知识关系，可以先跳过这一步。',
    },
  );
  step(
    'course',
    'course-enter-knowledge',
    '.course-reader-study-link',
    '现在，走进知识点本身。',
    '「进入学习」会打开刚才选中的真实知识点，而不是另一份示意页面。课程和知识点地址会跟着实际链接走，回来也能继续这条路线。',
    {
      prepare: focusedNode,
      action: link('.course-reader-study-link', '进入知识点'),
      emptyTarget: '#course-map-canvas',
      emptyBody: '暂时没有可进入的知识点。回到学习世界选择已有内容的课程，或跳到讨论区继续。',
    },
  );

  step(
    'knowledge',
    'knowledge-overview',
    '#knowledge-overview:not(.hidden)',
    '先认识它，再啃公式。',
    '概览会展示课程作者已经填写的基础信息和实际应用；没有填写的部分不会冒充完整资料。看过背景，再开始阅读正文。',
    {
      prepare: [ready('#knowledge-return-overview', '#knowledge-overview:not(.hidden)')],
      action: click('#knowledge-start-reading', '开始阅读正文'),
      emptyTarget: '#knowledge-workbench',
      emptyBody: '这个知识点暂时没有可阅读内容。可以通过课程入口换一个知识点，或者先跳到下一站。',
    },
  );
  step(
    'knowledge',
    'knowledge-reading',
    '#knowledge-body > :first-child',
    '正文在这里，按自己的速度读。',
    '已发布的知识正文支持段落、公式、图片与代码等内容；前后知识点入口帮助你继续探索。资料是否齐全取决于当前课程实际发布的内容。',
    {
      prepare: reading,
      emptyTarget: '#knowledge-reading',
      emptyBody: '当前知识点正文还在补充，暂时没有可读章节。可以看概览或返回课程挑选其他知识点。',
    },
  );
  step(
    'knowledge',
    'knowledge-tools-status',
    '#knowledge-tools',
    '工具箱里，也要分清“已有”和“在建”。',
    '重要、已学习、已巩固标签已经可用，仅对自己可见。学习资源、学习反馈、继续学习、个人笔记、参与共建这些工具目前只预留了入口；知识起源栏目也还在开发，不把按钮当作已经完成的功能。',
    { caption: '导览不会替你打学习标签；这里只认识入口，不虚增学习进度。' },
  );
  step(
    'knowledge',
    'knowledge-companions',
    '#knowledge-chat-toggle',
    '需要搭把手？点亮这个小按钮。',
    '点击右侧这个「AI」小按钮，就能打开课程学习面板。需要收起时，点面板右上角的「×」，小按钮就会重新出现；需要 Max 或课程讨论时，随时可以再点它打开。',
    {
      prepare: [ready('#knowledge-chat-close', '#knowledge-chat-toggle[aria-expanded="false"]')],
      action: click('#knowledge-chat-toggle', '打开学习面板'),
      caption: '这里只演示面板的打开与收起，不发送问题或发表评论。',
      // Two views of one existing step: no persisted progress indices change.
      reveal: {
        target: '#knowledge-chat-panel',
        dismissToEntry: true,
        title: 'Max 和课程讨论，都在这里。',
        body: '面板里有「Max」与「课程讨论」两个标签页：可以围绕当前知识点提问，也能查看相关版块的帖子。点面板右上角的「×」可以收起面板，回到完整的正文视野；「AI」小按钮会重新出现，方便你随时再打开。',
        action: {
          ...click('#knowledge-chat-close', '收起面板，继续导览'),
          alternateSelector: '#knowledge-chat-toggle',
        },
      },
    },
  );

  step(
    'discussion',
    'discussion-filters',
    '.discussion-feed-toolbar',
    '先找到你关心的那一小片。',
    '按版块浏览，再用最新、热门、待解答等筛选缩小范围。问题写清背景、尝试过程和卡点，会更容易遇到能一起想明白的同学。',
  );
  step(
    'discussion',
    'discussion-open-post',
    '#discussion-post-list .discussion-post-card:first-child',
    '读一篇真实帖子，看看大家怎么交流。',
    '先看看置顶帖：它通常能帮助你了解当前版块的重要信息。接下来优先打开当前列表的一篇置顶帖；没有置顶时，就读第一篇普通帖子，不点赞、不发送内容。',
    {
      action: click(preferredPost, '打开置顶或首篇帖子'),
      emptyBody: '当前筛选下还没有帖子。可以换一个版块或清除筛选，之后再来；这一步可以跳过。',
    },
  );
  step(
    'discussion',
    'discussion-detail',
    '#discussion-detail-title',
    '正文、回复和互动，都在这里。',
    '帖子正文支持 Markdown；下面可以查看回复、继续讨论。表态、发表评论和 @Max 都需要你自己决定，导览不会替你触发它们。',
    {
      prepare: [ready(preferredPost, '#discussion-detail-title')],
      emptyTarget: '#discussion-post-list',
      emptyBody: '这篇帖子暂时不可见或还未加载出来。可以返回列表换一篇，或继续下一站。',
    },
  );
  step(
    'discussion',
    'discussion-reply-max',
    '#discussion-comment-form',
    '想邀请我一起想？在评论里 @Max。',
    '发表一条包含独立「@Max」的评论或回复，就能请我结合帖文和评论上下文回应，也可以附上本站电路链接。回复仍需等待实际 AI 服务，并不保证结论正确。',
    {
      prepare: [ready(preferredPost, '#discussion-detail-title')],
      action: click('[data-action="close-detail"]', '回到帖子列表'),
      emptyTarget: '#discussion-detail',
      caption:
        '例如：@Max 请帮我检查第二步的推导。这里只展示写法，不填入编辑器、不发布、不调用 AI。',
    },
  );
  step(
    'discussion',
    'discussion-composer',
    '#discussion-create-toggle',
    '想发一个问题？从这个按钮进入。',
    '结束或暂停导览后，可以点右上角的「发帖」按钮，进入独立的编辑页面。选好版块、写标题和正文，再检查表达是否清楚；有背景、有过程的讨论更容易得到帮助。这一步先认识入口，点击「下一步」会继续参观。',
    {
      emptyTarget: '.discussion-feed-toolbar',
      emptyBody: '发帖编辑器需要登录，或当前账号暂无可发帖版块。你仍然可以阅读已开放的讨论。',
    },
  );

  step(
    'max',
    'max-conversation',
    '#aichat-thread',
    '轮到我正式上场啦。',
    '课程答疑、推导思路、代码和本站电路链接，都可以带来一起讨论。我的回答可能出错，关键步骤和结论记得回到课程资料核对。',
    { guestTarget: '.aichat-auth-required' },
  );
  step(
    'max',
    'max-composer',
    '#aichat-form',
    '一个好问题，比一个长问题更有用。',
    '在输入框说清目标、已知条件、自己的尝试和希望我怎么帮助你。附件入口允许在支持的范围内附上图片或文件，先检查内容，再由你确认发送。',
    { caption: '不会自动打开文件选择器、上传附件或发送问题；本地预览也没有连接真实 AI。' },
  );
  step(
    'max',
    'max-options',
    '.max-composer-tools[open] .max-composer-popover',
    '对话选项藏在这只小抽屉。',
    '展开后可以查看当前可用模型、推理选项和相关说明。能力与可选项由站点实际配置决定，不是所有模型都支持同一种附件。',
    {
      prepare: [ready('.max-composer-tools > summary', '.max-composer-tools[open]')],
      emptyTarget: '.aichat-options',
    },
  );
  step(
    'max',
    'max-history',
    '#aichat-dialogs',
    '想接着上次的问题聊？',
    '最近对话会保留在旁边，方便回到原来的上下文；也能自己开启新对话。这里仅展示记录入口，不替你创建、删除或发送任何对话。',
    {
      prepare: [ready('#aichat-dialog-toggle', '#aichat-dialogs')],
      emptyTarget: '#aichat-dialog-toggle',
    },
  );

  step(
    'workbench',
    'workbench-week',
    '#workbench-week-grid',
    '把一周摊开，会轻松一点。',
    '个人计划可以按周浏览、切换日期，并用列表查看安排。新增和编辑都是你自己的决定；我先帮你认清位置，不往日程里塞任务。',
    { prepare: plan, emptyTarget: '#workbench-plan-panel' },
  );
  step(
    'workbench',
    'workbench-ai-plan',
    '#workbench-agent-form',
    '想法先变成预览，再进入日程。',
    '可以请 Max 帮忙拆解安排；生成后先查看提议，再由你确认添加。这里仅介绍这个两阶段入口，不调用 AI，也不生成或保存计划。',
    { prepare: plan },
  );
  step(
    'workbench',
    'workbench-priorities',
    '#workbench-priority-list',
    '重要的事，放在不用翻找的地方。',
    '重要事项单独展示，可以记录截止时间和优先级。日程和重要事项是自己的安排，不是平台给你的成绩或排名。',
  );
  step(
    'workbench',
    'workbench-notifications',
    '#workbench-notifications-panel:not([hidden])',
    '通知和计划，各有自己的抽屉。',
    '这里可以搜索、筛选通知，查看未读或收藏。平台通知与校内连接状态以实际接口为准；本地预览只提供明确标注的演示数据，没有连接校内账号。',
    {
      prepare: [
        ready('#workbench-notifications-tab', '#workbench-notifications-tab[aria-current="page"]'),
      ],
      emptyTarget: '#workbench-notification-list',
    },
  );

  step(
    'shop',
    'shop-catalog',
    '#shop-grid .shop-item-card:first-child',
    '逛逛可以，买不买由你。',
    '商城会按类别展示物品、说明和实际价格。部分物品有阶梯价格或购买上限，先端详当前账号的详情，再决定是否兑换。',
    {
      action: click('#shop-grid [data-action="inspect-item"]', '端详一件物品'),
      emptyBody: '当前没有可展示的商品，或列表还未加载成功。可以先去仓库看看已有物品。',
    },
  );
  step(
    'shop',
    'shop-item-details',
    '#shop-inspect-modal:not(.hidden) .shop-inspect-copy',
    '价签和规则，都看清楚再说。',
    '物品详情会列出价格、用途及适用限制。电元和磁元是不同的钱包余额，有的商品需要组合支付；这里只看详情，不点击购买。',
    {
      prepare: [
        ready('#shop-grid [data-action="inspect-item"]', '#shop-inspect-modal:not(.hidden)'),
      ],
      emptyTarget: '#shop-grid',
    },
  );

  step(
    'inventory',
    'inventory-assets',
    '#inventory-list .inventory-item-row:first-child',
    '这是你已经拥有的宝物。',
    '仓库保存已获得的物品；装扮、使用和其他操作按物品支持的功能显示。普通与黄金鱼骨另有回收小站，不会混在普通物品网格里。',
  );
  step(
    'inventory',
    'inventory-recycling',
    '#bone-recycling',
    '小鱼骨，也能接着发光。',
    '普通鱼骨每根可以出售为 1 磁元，黄金鱼骨每根 10 磁元。自己选择数量并确认后才会出售；这笔收入会进账本，不增加花费热力。坚硬鱼骨是另一种物品，原有购买规则不变。',
    { caption: '导览不会自动出售、改数量或消耗任何物品；请保留你想收藏的鱼骨。' },
  );
  step(
    'inventory',
    'inventory-ledger-entry',
    '#wallet-ledger-open',
    '钱去了哪里？打开小账本。',
    '账本现在有独立窗口，不必在整页里寻找明细。我们只把它打开看看，不改变任何资产。',
    { action: click('#wallet-ledger-open', '打开钱包账本') },
  );
  step(
    'inventory',
    'inventory-ledger-filters',
    '#wallet-ledger[open] .wallet-toolbar',
    '一只小抽屉，整理所有收支。',
    '这里可以选择全部币种、仅电元或仅磁元，也能手动刷新。明细区可以滚动，底部有更多记录时还能继续加载；这些查看操作不改变余额。',
    {
      prepare: [ready('#wallet-ledger-open', '#wallet-ledger[open]')],
      emptyTarget: '#wallet-ledger-status',
    },
  );
  step(
    'inventory',
    'inventory-ledger',
    '#wallet-ledger[open] .wallet-ledger-entry:first-child',
    '每笔收支，都留下当时的余额。',
    '窗口里可以滚动查看收入或支出、原因，以及这笔交易之后的电元和磁元总额；还能筛选币种、加载更早记录。旧历史只显示实际存在的记录，不会补造。',
    {
      prepare: [ready('#wallet-ledger-open', '#wallet-ledger[open]')],
      emptyTarget: '#wallet-ledger-status',
      emptyBody:
        '当前筛选下还没有账本记录。之后有实际收支时，这里才会逐笔出现原因和交易后余额，不会为了展示而补造历史。',
      caption: '本地预置记录会明确写“演示”；新产生的模拟交易会追加真实变化的余额快照。',
    },
  );

  step(
    'settings',
    'settings-reading',
    '.settings-typography-form',
    '先把阅读调到舒服的样子。',
    '这里可以选择字体与字号，并查看文字预览；明暗主题由全局主题开关切换。阅读习惯可以自己慢慢调，导览不会替你切换或保存偏好。',
  );
  step(
    'settings',
    'settings-security',
    '#settings-password-form',
    '个人资料和账号安全，分开处理。',
    '设置里已有头像、个人网页和简介编辑，以及昵称和密码修改。姓名字段由管理员维护；改昵称的免费周期或磁元费用以页面实际提示为准。改密码需填写当前密码并确认新密码，导览不会读取、填入或提交这些字段。',
  );
  step(
    'settings',
    'settings-profile-entry',
    '#settings-profile-link',
    '设置完成，去看看自己的主页。',
    '这个入口会打开当前账号的公开个人主页。资料编辑留在设置里，装扮、藏品和牧场去主页看，不必在两边重复找同一份信息。',
    {
      action: link('#settings-profile-link', '前往我的主页'),
      emptyTarget: '.settings-header',
      emptyBody: '请先登录，账号确认后会出现自己的主页入口；没有登录也可以跳过个人主页这一站。',
    },
  );

  step(
    'profile',
    'profile-identity',
    '.public-profile-header',
    '社区里，也有你的名片。',
    '个人主页集中展示公开身份、简介和社区参与信息。公开展示哪些内容，以你自己的设置和页面实际可见信息为准。',
    {
      emptyTarget: '#public-profile-name',
      emptyBody: '请先登录并打开自己的个人主页；不必为了导览修改公开资料。也可以跳过这站。',
    },
  );
  step(
    'profile',
    'profile-wardrobe',
    '#public-profile-wardrobe:not([hidden])',
    '把喜欢的风格穿在身上。',
    '自己主页的装扮区可以管理已有头像框、铭牌和资料卡等物品；藏品会在对应区域展示。这里只看当前样子，不替你装备或卸下物品。',
    {
      emptyTarget: '#public-profile-collectibles',
      emptyBody:
        '只有自己的主页才会出现装扮管理，尚未拥有装扮也没关系。可以先认识公开藏品区域，之后再慢慢收集。',
    },
  );
  step(
    'profile',
    'profile-ranch',
    '#public-profile-ranch .ranch-scene',
    '我的小牧场，也在这里。',
    '领养后的 Max 会出现在牧场；喂养与鱼骨产出以页面列出的实际规则和状态为准。先认识它住在哪里，是否领养、喂食或使用物品都由你决定。',
    {
      emptyTarget: '#public-profile-ranch',
      caption: '不会自动消耗小鱼、收取物品或改变任何牧场状态。',
    },
  );

  step(
    'profile',
    'profile-wool',
    '.ranch-wool-stages',
    '把蓬松的羊毛，变成一点小小的电。',
    '有了 Max 后，每累计5次成功喂养、消耗5条小鱼，就会长出1份待剪羊毛。按北京时间每天最多剪1份，其余待剪量继续保留。剪下后用商城7磁元购买的永久橡胶棒摩擦，棒带上负电，每份羊毛换2电元；棒可重复使用，羊毛只在牧场保存，不进入仓库。',
    {
      emptyTarget: '#public-profile-ranch',
      emptyBody:
        '羊毛玩法需要先拥有 Max。之后每5次有效喂养长出1份羊毛；按北京时间每天最多剪1份，剩余待剪量保留。剪下后用7磁元购买的永久橡胶棒摩擦，每份换2电元；导览不会替你购买或喂养。',
      caption:
        '当天再剪会提示「Max 被薅秃了，明天再来吧。」这里只讲解，不喂鱼、不剪毛、不摩擦，也不购买。',
    },
  );

  step(
    'handbook',
    'handbook-missions',
    '#guide-missions',
    '走过的入口，留下一枚小脚印。',
    '五个新手任务记录你是否探索过学习、讨论、Max、工作台和仓库。它们是熟悉平台的提醒，不是成绩证明，也不会凭空奖励货币。',
  );
  step(
    'handbook',
    'handbook-future',
    '#guide-horizon',
    '未来的地图，我们一起慢慢画。',
    '这里区分当前已开放的功能与未来计划。发展端、新领域课程和知识工具会逐步建设；深入评测等 V2 想法仍需后续论证，不在这趟导览里冒充已经上线。',
    { caption: '以后有新版导览，可以从固定入口主动打开；走过的任务仍然属于你。' },
  );

  // max-v2 already shipped with 43 steps. Append only: numeric saved progress
  // must keep identifying the same feature for returning users.
  step(
    'development',
    'development-status',
    '.development-release',
    '课表之外，也在建设新的空间。',
    '发展端面向电子系同学与团学组织，目前仍在开发与联调。这里展示的是建设状态与目标版本，具体开放时间和范围以实际发布为准；可以从全站导航的「发展端」随时回来查看。',
  );
  step(
    'development',
    'development-activities-plan',
    '.development-card-student .development-card-heading',
    '活动报名，今后会在这里相遇。',
    '发展端规划连接通知与活动、资源开放、意见反馈、个人活动记录和组织协作。活动报名目前已通过全站导航的「活动报名」独立入口开放；发展端上线后，这项功能将整合进入发展端，目前尚未完成整合。',
  );
  step(
    'activities',
    'activities-entry',
    '.activity-hero-links',
    '想参与什么？先来这里看看。',
    '这里是当前独立的活动报名入口。活动可以公开浏览，是否需要登录报名由主办方设置；今后发展端上线后，活动报名将整合进入发展端。现在可以从全站导航直接找到「活动报名」。',
  );
  step(
    'activities',
    'activities-browse',
    '.activity-filters',
    '先看报名状态，再安排自己的时间。',
    '列表可以按全部、报名中、即将开放或已结束筛选。每张活动卡会说明开放与截止时间、名额和抽签方式；具体是否可以报名，以活动当前状态与要求为准。',
    {
      emptyTarget: '.activity-hero-links',
      emptyBody:
        '活动列表暂时未显示，或你正在查看某项活动。可在结束导览后用「浏览全部活动」返回列表，按报名状态查找；不必为完成导览报名。',
    },
  );
  step(
    'activities',
    'activities-receipt',
    '.activity-grid .card:first-child .activity-meta',
    '看清要求，把自己的回执收好。',
    '打开具体活动后，可以查看详情与报名要求。决定参与时，由你填写并提交；报名成功后请下载、妥善保存个人回执，用它在该活动的「查看我的抽签结果」入口查询结果。名额与抽签安排以主办方设置为准，回执不要分享给他人。',
    {
      emptyTarget: '.activity-hero-links',
      emptyBody:
        '当前没有可展示的活动卡片。活动发布后，可以查看时间、名额与报名条件；自行提交成功后，记得下载并保管个人回执，再到该活动查询抽签结果。导览不会生成报名或回执。',
      caption: '这里只认识报名与查签流程，不填写邮箱、读取回执或提交任何表单。',
    },
  );

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }
  // Independent short replay: no course/node ids or paid/write actions required.
  const RELEASE_STEP_IDS = [
    'development-status',
    'development-activities-plan',
    'activities-entry',
    'activities-browse',
    'activities-receipt',
  ];
  const catalogue = freeze({ STATIONS, STEPS: steps, RELEASE_STEP_IDS });
  if (typeof module !== 'undefined' && module.exports) module.exports = catalogue;
  if (typeof window !== 'undefined') window.FreeBbsGuideStations = catalogue;
})();
