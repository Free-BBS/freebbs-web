// Read-only tour catalogue, shared by the browser engine and contract tests.
// Actions only open existing views. Publishing, AI requests, purchases, sales,
// equipment changes, feeding and local learning-tag changes stay user-initiated.
(() => {
  const STATIONS = [
    { id: 'home', label: '首页', title: '认识 FREE BBS', route: '/', fallbackRoute: '/' },
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
      title: '平台寻址，思路引导和解释',
      route: '/aichat',
      fallbackRoute: '/aichat',
    },
    {
      id: 'workbench',
      label: '我的工作台',
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
      label: '活动报名（试用）',
      title: '活动报名：从浏览到回执',
      description: '认识当前独立入口、报名条件与结果查询方式。',
      route: '/surveys',
      fallbackRoute: '/surveys',
    },
  ];
  STATIONS.push(
    { id: 'shell', label: '全站入口', title: '先认识顶栏与导航', route: '/', fallbackRoute: '/' },
    {
      id: 'laboratory',
      label: '实验室',
      title: '选择实验与制作工具',
      route: '/laboratory',
      fallbackRoute: '/laboratory',
    },
    {
      id: 'creative',
      label: '创意工坊',
      title: '认识未来的插件空间',
      route: '/creative-workshop',
      fallbackRoute: '/creative-workshop',
    },
    {
      id: 'pbl',
      label: 'PBL 计划',
      title: '了解项目式学习规划',
      route: '/pbl',
      fallbackRoute: '/pbl',
    },
    { id: 'assets', label: '资产入口', title: '找到资产与发展端', route: '/', fallbackRoute: '/' },
  );
  const stationById = new Map(STATIONS.map((station) => [station.id, station]));
  const click = (selector, label) => ({ selector, label, kind: 'click' });
  const link = (selector, label) => ({ selector, label, kind: 'link' });
  const ready = (selector, whenMissing) => ({ selector, whenMissing });
  const mathPlanet = '.island-orbit-item[data-world-id="mathematics"]';
  const physicsPlanet = '.island-orbit-item[data-world-id="physics"]';
  // A closed dialog has no visible box. Readiness is checked through a visible
  // body sentinel rather than waiting for the hidden dialog itself to appear.
  const worldModalClosed = 'body:not(:has(#world-modal[open]))';
  const worldReady = [
    ready('#world-modal[open] [data-close-modal]', worldModalClosed),
    ready('#island-course-back', '#world-explorer:not([hidden])'),
    {
      ...ready(
        '#world-orbit',
        `#world-orbit:has(${mathPlanet}:not([aria-hidden="true"])):has(${physicsPlanet}:not([aria-hidden="true"]))`,
      ),
      key: 'Home',
    },
  ];
  // Resuming the overview may find another island's modal or course stage.
  // Close only view UI, restore visible orbit targets, then open mathematics.
  const openMath = [...worldReady, ready(mathPlanet, '#world-modal[open]')];
  const mathCourseOrbit = '#island-course-orbit[data-world-id="mathematics"]';
  const mathStage = [
    // A resumed tour may find a different island's courses already open.
    // Return using view controls, then select mathematics explicitly. An
    // existing mathematics course stage is left untouched.
    ready('#island-course-back', `#world-explorer:not([hidden]), ${mathCourseOrbit}`),
    ready('#world-modal[open] [data-close-modal]', `${worldModalClosed}, ${mathCourseOrbit}`),
    {
      ...ready('#world-orbit', `${mathPlanet}:not([aria-hidden="true"]), ${mathCourseOrbit}`),
      key: 'Home',
    },
    ready(mathPlanet, `#world-modal[open], ${mathCourseOrbit}`),
    ready('#world-enter-island', mathCourseOrbit),
  ];
  const focusedCourse =
    'body:not(:has(#course-knowledge-overview[open])) .course-structure-details:has(.course-structure-relations), body:not(:has(#course-knowledge-overview[open])) .course-map-focused-chapter';
  const selectCoursePoint =
    '.course-structure-picker [data-course-point-id], [data-reader-node-id]';
  const openCourseOverview =
    '.course-structure-details .course-structure-primary, .course-map-focus-center [data-reader-node-id]';
  const overviewStudy = '#course-knowledge-overview[open] .knowledge-overview-study';
  const focusedNode = [
    ready(selectCoursePoint, `${focusedCourse}, #course-knowledge-overview[open]`),
    ready(
      '#course-knowledge-overview[open] .knowledge-overview-drawer-footer > button',
      focusedCourse,
    ),
  ];
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
    '我是 Max，你在 FREE BBS 的学习与探索向导。这里是由学生主导、师生共同建设的电子系学习发展共同体，从首页和导航进入学习、讨论、个人计划与实验工具；规划中的能力会单独标明。',
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
    '「Max 探索手册」是长期保留的导引入口。以后想重走某一站、看看哪些功能还在建设，都可以从首页或浮动按钮回来；平台介绍和工作人员名单另有独立页面。',
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
    physicsPlanet,
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
    mathCourseOrbit,
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
    '.course-structure-picker, .course-map-directory-layout:has(.course-map-directory-panel)',
    '课程不是一长串文件。',
    '这里按章节组织知识点，显示课程简介、知识点数量和学习标记。先选一个知识点查看关联，就能知道它和前后的内容怎样接上。',
    {
      // The back link points to /world until a knowledge node is focused, and
      // its handler is installed only after the asynchronous map fetch. Never
      // auto-click that link while loading. This button cannot navigate away;
      // the directory-only panel also distinguishes it from the focused view.
      prepare: [
        ready('#course-map-reset-view', '.course-structure-picker, .course-map-directory-panel'),
      ],
      focus: { fit: 'overview', radius: 24 },
      action: click(selectCoursePoint, '查看一个知识点的关联'),
      emptyTarget: '#course-map-status',
      emptyBody:
        '这门课程暂时没有可浏览的知识点，或地图尚未加载成功。可以返回学习世界换一门课程，或先跳到下一站。',
    },
  );
  step(
    'course',
    'course-relations',
    focusedCourse,
    '把知识点的邻居，也认一认。',
    '选中知识点后，只显示它的直接联系，也可以连接到其他章节。右侧列出学习顺序与补充关联；先看看学习概览，再决定是否进入正文。',
    {
      prepare: focusedNode,
      action: click(
        '.course-structure-details .course-structure-primary, [data-course-map-arrow-help-toggle]',
        '看看学习概览',
      ),
      emptyTarget: '#course-map-canvas',
      emptyBody: '当前课程还没有可展开的知识关系，可以先跳过这一步。',
    },
  );
  step(
    'course',
    'course-enter-knowledge',
    overviewStudy,
    '现在，走进知识点本身。',
    '「进入学习」会打开刚才选中的真实知识点，而不是另一份示意页面。课程和知识点地址会跟着实际链接走，回来也能继续这条路线。',
    {
      prepare: [...focusedNode, ready(openCourseOverview, overviewStudy)],
      action: link(overviewStudy, '进入知识点'),
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
    '点击右侧这个「AI」小按钮，就能打开课程学习面板，查看课程 RAG 问答与课程讨论。需要收起时，点面板右上角的「×」，小按钮就会重新出现；切换知识点时会保留上次的开合状态。',
    {
      prepare: [ready('#knowledge-chat-close', '#knowledge-chat-toggle[aria-expanded="false"]')],
      action: click('#knowledge-chat-toggle', '打开学习面板'),
      caption: '这里只演示面板的打开与收起，不发送问题或发表评论。',
      // Two views of one existing step: no persisted progress indices change.
      reveal: {
        target: '#knowledge-chat-panel',
        dismissToEntry: true,
        title: '课程问答与课程讨论，都在这里',
        body: '课程 RAG 面向当前知识点提供课程语境下的解释与自测入口；课程讨论用于查看相关版块的公开帖子，私人问答不会写入讨论区。点右上角的「×」可以收起面板，「AI」小按钮会重新出现。',
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
    '.post-write-comment',
    '想邀请我一起想？在评论里 @Max。',
    '从「写评论…」进入编辑器，发表一条包含独立「@Max」的评论或回复，就能请我结合帖文和评论上下文回应，也可以附上本站电路链接。回复仍需等待实际 AI 服务，并不保证结论正确。',
    {
      // Mobile readers move the hidden inline form into a sheet only after a
      // user chooses to comment. Highlight its shared entry without opening a
      // keyboard or redirecting guests to login during a read-only tour.
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
    '#discussion-create-toggle, .mobile-publish',
    '想发一个问题？从这个按钮进入。',
    '结束或暂停导览后，电脑上点右上角的「发帖」；手机上先点底部「＋」，再选「发帖」，就能进入独立的编辑页面。选好版块、写标题和正文，再检查表达是否清楚；有背景、有过程的讨论更容易得到帮助。这一步先认识入口，点击「下一步」会继续参观。',
    {
      prepare: [
        ready('#discussion-detail [data-action="close-detail"]', 'body:not(.post-reading)'),
      ],
      emptyTarget: '.discussion-feed-toolbar',
      emptyBody: '发帖编辑器需要登录，或当前账号暂无可发帖版块。你仍然可以阅读已开放的讨论。',
    },
  );

  step(
    'max',
    'max-conversation',
    '#aichat-thread',
    '轮到我正式上场啦。',
    '带着目标、已知条件和自己的尝试来提问。Max 帮你定位问题、理解原理和寻找下一步，不代替你思考或直接交付作业答案；关键结论仍要回到课程资料核对。',
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
    '#workbench-week-grid, #workbench-schedule-list',
    '把一周摊开，会轻松一点。',
    '个人计划可以按周浏览、切换日期。手机默认显示列表，点「七天视图」可切回时间图。新增和编辑都是你自己的决定；我先帮你认清位置，不往日程里塞任务。',
    { prepare: plan, emptyTarget: '#workbench-plan-panel' },
  );
  step(
    'workbench',
    'workbench-ai-plan',
    '#workbench-agent-form',
    '想法先变成预览，再进入日程。',
    'Max 可从一段话中自动识别最多 5 个事件，可混合普通安排与 DDL，写清时间、事项和地点/备注。预览可逐项修改、分别确认，也可全部确认；导览不会调用 AI、生成或保存计划。',
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
    '账本有独立窗口，可以查看每笔收支。电脑端的电元、磁元和热力在左下角，点击整个资产区域可打开规则说明；手机保留原有位置。这一步只打开账本，不改变任何资产。',
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
    '这里可以选择字体与字号，并查看文字预览。电脑端的设置与明暗切换已移到右上角通知旁的小图标；手机仍沿用原有入口。阅读习惯可以自己慢慢调，导览不会替你切换或保存偏好。',
  );
  step(
    'settings',
    'settings-security',
    '#settings-password-form',
    '个人资料和账号安全，分开处理。',
    '设置可编辑头像、个人网页和简介，姓名由管理员维护，昵称规则以页面提示为准。宽屏下，修改密码与邮件通知左右并排，窄屏上下排列。邮件开关绿色表示开启，灰色表示关闭，点击「保存更改」才生效；导览不读取、填入或提交账号字段。',
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
    '从主页的小风景，走进电子牧场。',
    '点击主页小风景进入独立牧场，可切换草甸、湖畔、庭院和长城；季节按北京月份变化，明暗对应昼夜。还可去染坊、羊群广场，电脑端可打开学习背景。染色与专注不消耗羊毛，喂养等操作由你决定。',
    {
      emptyTarget: '#public-profile-ranch',
      action: link('.ranch-preview-link', '走进电子牧场'),
      caption: '不会自动消耗小鱼、收取物品或改变任何牧场状态。',
    },
  );

  step(
    'profile',
    'profile-wool',
    '#ranch-wool-dialog[open] .ranch-wool-stages',
    '把蓬松的羊毛，变成一点小小的电。',
    '有了 Max 后，每次成功喂养会按泊松过程随机长毛，长期平均每5条鱼约1份，并非第5次必得。按北京时间每天最多剪1份，其余待剪量继续保留。剪下后用商城7磁元购买的永久橡胶棒摩擦，棒带上负电，每份羊毛换2电元；棒可重复使用，羊毛只在牧场保存，不进入仓库。',
    {
      // The full ranch lives on its own page, reached from the profile preview.
      route: '/ranch',
      prepare: [ready('[data-ranch-open="ranch-wool-dialog"]', '#ranch-wool-dialog[open]')],
      emptyTarget: '#public-profile-ranch',
      emptyBody:
        '羊毛玩法需要先拥有 Max。成功喂养后随机长毛，长期平均每5条鱼约1份，不保证固定次数产出；按北京时间每天最多剪1份，剩余待剪量保留。剪下后用7磁元购买的永久橡胶棒摩擦，每份换2电元；导览不会替你购买或喂养。',
      caption:
        '当天再剪会提示「Max 被薅秃了，明天再来吧。」这里只讲解，不喂鱼、不剪毛、不摩擦，也不购买。',
    },
  );

  step(
    'handbook',
    'handbook-missions',
    '#guide-missions',
    '走过的入口，留下一枚小脚印。',
    '五个新手任务记录你是否探索过学习、讨论、Max、工作台和仓库，不是成绩证明。单纯访问页面不发奖；完成完整新手导引可领取 10 电元和 10 磁元，每个账号一次，新老用户同享。',
  );
  step(
    'handbook',
    'handbook-future',
    '#guide-horizon',
    '未来的地图，我们一起慢慢画。',
    '这里区分当前已开放的功能与未来计划。发展端、新领域课程和知识工具会逐步建设；深入评测等 V2 想法仍需后续论证，不在这趟导览里冒充已经上线。',
    { caption: '以后有新版导览，可以从固定入口主动打开；走过的任务仍然属于你。' },
  );

  step(
    'development',
    'development-status',
    '.development-release',
    '课表之外，也在建设新的空间。',
    '发展端面向电子系同学与团学组织，目前仍在开发与联调。这里展示建设状态与目标版本，开放时间和范围以实际发布为准。电脑端从左下角「前往发展端」进入，手机保留原有「发展端」入口。',
  );
  step(
    'development',
    'development-activities-plan',
    '.development-card-student .development-card-heading',
    '活动报名，今后会在这里相遇。',
    '发展端规划连接通知与活动、资源开放、意见反馈、个人活动记录和组织协作。活动报名目前已通过「活动报名（试用）」独立入口开放，手机端可在底部「工具」中找到；发展端上线后，这项功能将整合进入发展端，目前尚未完成整合。',
  );
  step(
    'activities',
    'activities-entry',
    '.activity-hero-links',
    '想参与什么？先来这里看看。',
    '这里是当前独立的活动报名入口。活动可以公开浏览，是否需要登录报名由主办方设置；今后发展端上线后，活动报名将整合进入发展端。电脑端可从左侧找到「活动报名（试用）」，手机端可在底部「工具」中找到。',
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
      emptyReady: '.activity-grid .activity-empty',
      emptyTarget: '.activity-hero-links',
      emptyBody:
        '当前没有可展示的活动卡片。活动发布后，可以查看时间、名额与报名条件；自行提交成功后，记得下载并保管个人回执，再到该活动查询抽签结果。导览不会生成报名或回执。',
      caption: '这里只认识报名与查签流程，不填写邮箱、读取回执或提交任何表单。',
    },
  );

  step(
    'shell',
    'shell-search',
    '.site-search-trigger',
    '从最上方，找到全站搜索',
    '搜索入口固定在顶栏，可以查找课程、讨论和站内内容。输入关键词后再选择结果；导览只介绍入口，不读取或提交你的搜索',
    { caption: '顶栏靠右排列；手机保留顶部搜索，不改变你当前页面的内容' },
  );
  step(
    'shell',
    'shell-checkin',
    '.economy-shortcut-checkin',
    '签到与月历，都从这里打开',
    '点顶栏的签到可以查看今日状态与月历。真正签到需要你自己再点面板里的签到按钮，导览不会代签',
    {
      action: click('.economy-shortcut-checkin', '查看签到月历'),
      guest: {
        action: null,
        reveal: null,
        body: '登录后，这里可以查看签到状态与数字月历。真正签到仍需你自己确认；现在可以先继续了解其他入口',
        caption: '游客导览不会打开登录窗口，也不会代为签到',
      },
      reveal: {
        target: '#fortune-records .checkin-calendar',
        prepare: [ready('.economy-shortcut-checkin', '#fortune-records .checkin-calendar')],
        title: '数字月历，记录自己的节奏',
        body: '日期按北京时间记录，已签到日期按当日运势着色，灰色表示未签到。可以切换月份、点击日期看详情；重新打开面板不会重复领取奖励',
        action: click('#fortune-modal .fortune-close', '收起月历，继续'),
        dismissToEntry: true,
      },
      caption: '只读取签到状态，不点击面板内的签到按钮，不修改任何余额',
    },
  );
  step(
    'shell',
    'shell-account',
    '.desktop-header-tools, .topbar .user-summary',
    '账号工具，在顶栏右侧',
    '电脑端把设置、明暗切换与通知集中在头像旁，昵称不再占用顶栏。手机保持原有头像与账号菜单；字体、字号在设置里调整',
    { caption: '只认识入口，不切换主题、不打开账号菜单或修改资料' },
  );
  step(
    'shell',
    'shell-navigation',
    '.topbar .nav-actions > .nav-link[href="/"], .mobile-nav .nav-link[href="/"]',
    '接下来，沿导航从上往下走',
    '电脑侧栏依次是首页、学习世界、讨论区、我的工作台、实验室、创意工坊、PBL 计划和问问 Max，活动报名保留试用入口。手机把实验室、工坊和 PBL 收在底部工具中',
    { caption: '每一章都能暂停或跳过，目录支持直接选择；管理员入口仅对有权限的账号显示' },
  );
  step(
    'laboratory',
    'laboratory-circuit',
    '.laboratory-circuit',
    '实验室先选环境，再开始动手',
    '电路实验室已经开放，可以搭建电路、运行仿真和观察波形。导览先停在入口，不替你创建电路或发起实验',
    { caption: '教学仿真不代替真实测量，模型与分析结果需要验证' },
  );
  step(
    'laboratory',
    'laboratory-tools',
    '.laboratory-card:has(a[href="/tool-workshop"])',
    '制作自己的小工具',
    '原小工具工坊已移到实验室，名称是「制作我的工具」。可以编写、编辑和预览 HTML 工具；生成与发布仍需自己确认',
    { caption: '此处只介绍入口，不发送 AI 请求、不运行或发布工具' },
  );
  step(
    'laboratory',
    'laboratory-planned',
    '.laboratory-card:has(.laboratory-symbol)',
    '从代码到结果，再带回讨论',
    '代码实验室使用 GCC 运行 C/C++ 并生成多架构汇编、CPython 逐行观察变量、GNU Octave 运行 MATLAB 兼容代码、Icarus Verilog 仿真波形；各引擎有兼容范围与资源限制，请先阅读运行环境说明，结果可保存为实验快照并分享到讨论区',
    { caption: '原 Max 对话中的沙盒入口不在此次独立运行环境开放范围内' },
  );
  step(
    'creative',
    'creative-workshop-plan',
    '.development-release',
    '创意工坊：未来的插件入口',
    '计划与 IBBB 协同，提供可以选择安装的插件，让工具和 Skill 成为可直接使用的能力。当前目标是 2026 年 10 月、V1.2，具体开放时间以公告为准',
    { caption: '目前是规划介绍页，尚不能安装或发布插件' },
  );
  step(
    'pbl',
    'pbl-plan',
    '.development-release',
    'PBL 计划：把学习带进项目',
    '这里介绍项目式学习的建设方向，目标为 2027 年 3 月、V2.0。当前还未开放项目报名、组队或成果提交，不必为导览寻找尚不存在的功能',
    { caption: '规划日期不是上线承诺，实际能力以正式发布为准' },
  );
  step(
    'assets',
    'shell-assets',
    '#user-status, .economy-shortcut-inventory',
    '最后看看导航底部的小小积累',
    '电脑端资产位于左下角「前往发展端」下方，点击区域可查看电元、磁元和热力的说明。手机可从顶部仓库入口查看资产，接下来再逛商城与仓库',
    { caption: '查看说明不等于兑换；收支以钱包账本中的实际记录为准' },
  );
  const stationOrder = [
    'shell',
    'home',
    'world',
    'course',
    'knowledge',
    'discussion',
    'workbench',
    'laboratory',
    'creative',
    'pbl',
    'max',
    'activities',
    'development',
    'assets',
    'shop',
    'inventory',
    'settings',
    'profile',
    'handbook',
  ];
  STATIONS.sort((a, b) => stationOrder.indexOf(a.id) - stationOrder.indexOf(b.id));
  const currentSteps = stationOrder.flatMap((station) =>
    steps.filter((entry) => entry.station === station),
  );
  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }
  // Independent short replay: no course/node ids or paid/write actions required.
  const RELEASE_STEP_IDS = [
    'shell-search',
    'shell-checkin',
    'shell-account',
    'shell-navigation',
    'laboratory-circuit',
    'laboratory-tools',
    'laboratory-planned',
    'creative-workshop-plan',
    'pbl-plan',
    'shell-assets',
    'profile-ranch',
    'profile-wool',
  ];
  // Published tours retain their original order for saved progress. Only the
  // essentials below are offered to new users; archived tours are never promoted.
  const CORE_STEP_IDS = [
    'home-launchpad',
    'world-atlas',
    'world-course-orbit',
    'course-directory',
    'course-relations',
    'course-enter-knowledge',
    'knowledge-overview',
    'knowledge-reading',
    'discussion-filters',
    'discussion-open-post',
    'discussion-detail',
    'discussion-composer',
    'workbench-week',
    'workbench-ai-plan',
    'workbench-priorities',
  ];
  const legacyV4Steps = CORE_STEP_IDS.map((id) => {
    const entry = currentSteps.find((item) => item.id === id);
    return ['course', 'knowledge'].includes(entry.station)
      ? { ...entry, station: 'world', label: '学习' }
      : { ...entry };
  });
  legacyV4Steps.push({
    id: 'handbook-other-features',
    station: 'handbook',
    label: '其他功能',
    route: '/guide',
    fallbackRoute: '/guide',
    target: '#guide-other-features',
    title: '还有其他功能，按需要探索',
    body: '站内还有 Max 问答、实验与工具、活动报名和个人设置等入口。需要时从导航进入，建设中的功能会标明状态；不必逐一体验才能开始学习。',
    caption: '以后可以随时从首页打开导引，重看学习、讨论或计划这一章。',
  });
  // Each non-learning page gets one introduction, without opening a form,
  // changing the user's view, or waiting for optional API data to exist.
  const pageIntroductions = [
    {
      id: 'discussion-overview-202610',
      station: 'discussion',
      target: '.discussion-feed-toolbar',
      title: '讨论区：让问题遇见同伴',
      body: '按分区和排序查找讨论，点帖子阅读正文与回复。想提问时再点「发帖」，写清背景、尝试和卡点；也可以在评论中 @Max 邀请它一起思考。',
      caption: '导引不会打开编辑器、发表内容、点赞或请求 AI；关键结论需要核对。',
    },
    {
      id: 'workbench-overview-202610',
      station: 'workbench',
      target: '.workbench-navigation',
      title: '工作台：安排自己的节奏',
      body: '在个人计划中管理日程、重复安排和重要事项，在通知中查看消息。也可以请 Max 帮你整理安排或规划空余时间，先检查预览，再由自己确认添加。',
      caption: '计划和课程都可按自己的需要编辑；导引不会同步账号、保存安排或标记通知已读。',
    },
    {
      id: 'laboratory-overview-202610',
      station: 'laboratory',
      target: '.laboratory-intro',
      title: '实验室：在尝试中理解原理',
      body: '搭建与仿真电路，制作 HTML 小工具，或在 C / C++、Python、Octave、Verilog 环境中观察代码、变量和波形。选择一个环境，再带着自己的问题开始实验。',
      caption: '各引擎的兼容范围与资源限制以页面说明为准；导引不运行代码、生成或发布作品。',
    },
    {
      id: 'creative-overview-202610',
      station: 'creative',
      target: '.development-release',
      title: '创意工坊：让想法成为实用工具',
      body: '这里正在建设可安装的插件空间，计划让工具与 Skill 成为随手可用的能力。目前可以先去实验室的「制作我的工具」实践自己的想法。',
      caption: '插件安装与发布尚未开放，具体开放时间以正式公告为准。',
    },
    {
      id: 'pbl-overview-202610',
      station: 'pbl',
      target: '.development-release',
      title: 'PBL 计划：从疑问走向真实项目',
      body: '从课程中的问题出发，寻找同伴，把知识用于项目实践。这里目前介绍项目式学习的建设方向，之后再逐步开放组队、项目与成果协作。',
      caption: '当前尚未开放项目报名、组队或成果提交，不必为完成导引寻找未开放的功能。',
    },
    {
      id: 'max-overview-202610',
      station: 'max',
      target: '#aichat-form',
      guestTarget: '.aichat-auth-required',
      title: '问问 Max：多一个辅助思考的伙伴',
      body: '说清目标、已知条件和自己的尝试，请 Max 解释原理、梳理思路或寻找下一步。学习页面右侧也有结合当前课程的 Max，不必离开正文来回切换。',
      caption: '重要结论仍需核对；导引不会自动发送问题、选择文件或上传附件。',
    },
    {
      id: 'development-overview-202610',
      station: 'development',
      target: '.development-release',
      title: '发展端：连接学习之外的成长',
      body: '这里正在建设面向同学与团学组织的发展空间，连接通知、活动、资源与组织协作。活动报名目前保留独立的试用入口，之后再整合到发展端。',
      caption: '以页面显示的建设状态为准；导引不会报名、提交信息或授予任何权限。',
    },
    {
      id: 'shop-overview-202610',
      station: 'shop',
      target: '.shop-category-nav',
      title: '电磁场商城：先端详，再决定',
      body: '按类别浏览装扮、收藏、消耗品和伙伴，端详物品的用途、当前价格与购买限制。已获得的物品在仓库中查看，电元和磁元的收支可以查钱包账本。',
      caption: '价格与限制以当前账号显示为准；导引不会购买、兑换或消耗任何物品。',
    },
  ].map((entry) => ({
    route: stationById.get(entry.station).route,
    label: stationById.get(entry.station).label,
    ...entry,
  }));
  const essentialSteps = [
    ...legacyV4Steps
      .filter((entry) => ['home', 'world'].includes(entry.station))
      .map((entry) => ({ ...entry })),
    ...pageIntroductions,
    { ...legacyV4Steps.at(-1) },
  ];
  // Only current copy reflects the new learning tools. Published tours retain
  // their original indices and text; their receipts are not interpreted as v5.
  const currentReading = essentialSteps.find((entry) => entry.id === 'knowledge-reading');
  currentReading.body =
    '正文支持公式、图片与代码，也可以直接在原文上高亮、划线和写评注；批注仅自己可见。读完后按需要做练习、自测，或从「继续学习」选择下一步，不必逐一完成才能查阅内容。';
  currentReading.caption =
    'Max 是辅助老师，星标不替代掌握程度；导引不会写批注、作答或增加学习进度。';
  const currentOverview = essentialSteps.find((entry) => entry.id === 'knowledge-overview');
  currentOverview.caption =
    '先了解知识背景，再按自己的需要阅读、自测或探索；不会自动替你选择学习起点。';
  const essentialStationOrder = [
    'home',
    'world',
    ...pageIntroductions.map((entry) => entry.station),
    'handbook',
  ];
  const essentialStations = essentialStationOrder.map((id) => {
    const entry = STATIONS.find((item) => item.id === id);
    const labels = {
      home: '开始',
      world: '学习',
      discussion: '讨论区',
      workbench: '工作台',
      shop: '电磁场商城',
      handbook: '其他功能',
    };
    const descriptions = {
      home: '三个主要入口，随时可以跳过',
      world: '找课程、看知识地图、阅读知识点',
      discussion: '浏览问题、交流思路、发布讨论',
      workbench: '管理日程、重复安排和重要事项',
      handbook: '按需要发现更多工具',
    };
    return {
      ...entry,
      label: labels[id] || entry.label,
      title: descriptions[id] || entry.title,
    };
  });
  const catalogue = freeze({
    STATIONS: essentialStations,
    STEPS: essentialSteps,
    ARCHIVED_STATIONS: STATIONS,
    ARCHIVED_STEPS: currentSteps,
    LEGACY_V4_STEPS: legacyV4Steps,
    RELEASE_STEP_IDS,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = catalogue;
  if (typeof window !== 'undefined') window.FreeBbsGuideStations = catalogue;
})();
