import type { ShowcaseContent } from './types.js';
import planning from './content/planning.js';
import tms from './content/tms.js';
import sports from './content/sports.js';
import freshman from './content/freshman.js';
import rights from './content/rights.js';
import newMedia from './content/new-media.js';
import volunteer from './content/volunteer.js';
import { arts } from './content/arts.js';
import { project } from './content/project.js';
import practice from './content/practice.js';
import organization from './content/organization.js';
import training from './content/training.js';

const asset = (slug: string, file: string) =>
  `/development/organization-showcase/sites/${slug}/${file}`;

function submitted(content: Omit<ShowcaseContent, 'site' | 'sections'>): ShowcaseContent {
  return {
    ...content,
    sections: [],
    site: { entry: asset(content.slug, 'index.html'), title: `${content.name}特色展区` },
  };
}

const research = submitted({
  slug: 'research',
  departmentId: 'youth_league.research',
  name: '调研组',
  englishName: 'LISTEN · ASK · UNDERSTAND',
  tagline: '让每一种声音都有回响',
  summary: '从校园里的一次交谈，到实践途中的一次追问。认真倾听，扎实求证，让思考走向行动。',
  introduction: [
    '以真实问题为起点，通过资料梳理、访谈交流和报告写作，连接同学的需求与院系的工作。',
  ],
  duties: [
    '围绕“E方水土”“E起向未来”开展品牌项目调研。',
    '学习访谈、问卷和分析方法，沉淀成果与经验。',
    '倾听同学学习、生活和成长中的真实需求，为系团委工作提供参考。',
  ],
  keywords: [
    '品牌项目',
    'E方水土',
    'E起向未来',
    '社会调研',
    '访谈',
    '问卷',
    '报告写作',
    '同学需求',
    '需求反馈',
    '研究方法',
    '研究框架',
    '南京实践',
    '释说芯语',
    '科普教育',
    '传承故事',
    '成员寄语',
  ],
  contacts: [{ name: '部门公共邮箱', email: 'ee_research2026@163.com' }],
  accent: '#408879',
  darkAccent: '#94dfc1',
  layout: 'field',
  hero: {
    src: asset('research', 'assets/硅基智能参访合影.jpg.webp'),
    alt: '调研组实践中的硅基智能参访合影',
  },
  sourceNotes: [
    '调研组/网站正文与展示说明.md',
    '调研组/网站demo；仅做展示，不沿用实践组身份或编辑权限。',
  ],
});

const creative = submitted({
  slug: 'creative',
  departmentId: 'media_center.creative',
  name: '创意设计部',
  englishName: 'INFINITE CREATIVITY',
  tagline: '把想法，画成看得见的样子',
  summary: '学生节、迎新季、实践周边与创意项目。来看看电子人的视觉表达。',
  introduction: [
    '从海报、无字衫到校园文创，创意设计部用视觉设计为电子人的校园生活留下鲜明的样子。',
  ],
  duties: [
    '为校园活动创作视觉设计。',
    '制作学生节、迎新季与实践相关作品。',
    '在创意项目与部门交流中积累设计经验。',
  ],
  keywords: [
    '视觉设计',
    '文创',
    '文化建设',
    '海报',
    '学生节',
    '迎新季',
    '无字衫',
    '实践周边',
    '创意项目',
    '作品集',
    '作品画廊',
    '明信片',
    '约稿',
    '掠影',
    '无字诗',
    '断点',
    '光刻记忆',
  ],
  contacts: [{ name: '部门公共邮箱', email: 'thuee_media@163.com' }],
  contactNote: '部门约稿请咨询各部门部长。',
  accent: '#ac63a5',
  darkAccent: '#eeb1df',
  layout: 'studio',
  hero: {
    src: asset('creative', 'assets/color-wheel.png.webp'),
    alt: '创意设计部彩色视觉作品拼贴',
    fit: 'contain',
  },
  sourceNotes: ['创意设计部/readme.md', '创意设计部/site；完整保留四类93件作品与8张合照。'],
});

const audiovisual = submitted({
  slug: 'audiovisual',
  departmentId: 'media_center.audiovisual',
  name: '影音策划部',
  englishName: 'MOVIE · MUSIC · MOMENTS',
  tagline: '把电子的故事，拍成我们的电影',
  summary: '镜头、声音与剪辑在这里相遇。看学生节 MV，听声音作品，也认识镜头背后的伙伴。',
  introduction: ['影音策划部用影像与声音记录电子人的校园生活，在创作与协作中讲述身边的故事。'],
  duties: [
    '创作学生节音乐短片，从剧本、拍摄到音乐制作与剪辑调色。',
    '开展摄影、剪辑、乐理等创作培训和经验分享。',
    '支持自由拍摄与自主影像、音乐创作。',
    '运营 EEInfinity 视频号，记录和分享视听作品。',
  ],
  keywords: [
    '摄影',
    '拍摄',
    '剪辑',
    '调色',
    '音乐',
    '作曲',
    '编曲',
    '录音',
    '混音',
    '学生节 MV',
    '学生节MV',
    'MV',
    '剧本',
    '分镜',
    'EEInfinity',
    '视频号',
    '无限电台',
    '無限电台',
    '创作培训',
    '音乐短片',
  ],
  contacts: [{ name: '部门公共邮箱', email: 'THUEEMovieAndMusic@163.com' }],
  accent: '#547dc1',
  darkAccent: '#a8caff',
  layout: 'studio',
  hero: {
    src: asset('audiovisual', 'assets/illustrations/studio.png.webp'),
    alt: '影音策划部的卡通创作工作室',
    fit: 'contain',
  },
  sourceNotes: ['影音策划部/index.html', '影音策划部/交付说明.md；音乐与视频由用户主动播放。'],
});

const sail = submitted({
  slug: 'sail',
  departmentId: 'youth_league.sail',
  name: '扬帆计划组',
  englishName: 'SET SAIL, TOGETHER',
  tagline: '和一群伙伴，一起走向更远的地方',
  summary:
    '面向电子系大一同学的学生骨干培养项目。通过社工技能培训、实践与交流，学习协作、承担责任，也认识志同道合的伙伴。',
  introduction: [
    '扬帆计划由电子系联合多个学生组织开展，是学生骨干培养项目。每期于春季招募电子系大一同学，由顾问和小导带领学员完成培养计划。',
  ],
  duties: [
    '通过例会旁听、例餐交流和系列微沙龙，帮助学员认识社工并提升技能。',
    '组织暑期集体实践、寒假带队实践与交流分享，在真实场景中锻炼组织协调和领导能力。',
    '开展扬帆+、兴趣分享与团建活动，支持学员从接受培养走向主动组织与能力输出。',
  ],
  keywords: [
    '学生骨干',
    '学生骨干培养',
    '培养计划',
    '顾问',
    '小导',
    '学员',
    '大一',
    '春季招募',
    '暑期集体实践',
    '寒假带队实践',
    '例会旁听',
    '例餐交流',
    '微沙龙',
    '扬帆+',
    '兴趣分享会',
    'E探独龙',
    '微光',
    '结业年会',
  ],
  contacts: [{ name: '部门公共邮箱', email: 'ee_yangfan@126.com' }],
  accent: '#458eac',
  darkAccent: '#9bd9ee',
  layout: 'community',
  hero: { src: asset('sail', 'assets/cover.webp'), alt: '扬帆计划同学一起参加活动' },
  sourceNotes: ['扬帆计划组/index.html；保留原站全部项目与活动展示。'],
});

const humanities = submitted({
  slug: 'humanities',
  departmentId: 'youth_league.humanities',
  name: '人文组',
  englishName: 'WORDS, PLAY & EVERYDAY LIFE',
  tagline: '给日常留一点诗意，给灵感找一张纸',
  summary:
    '清锋明辩、人文讲座与读书沙龙、社区共读和学生节舞台剧。认识工科生的人文日常，也来拼贴一首自己的诗。',
  introduction: [
    '办人文讲座，办读书沙龙，组队打辩论，也走进社区陪孩子读书；在思辨、阅读与舞台创作中，让人文关怀走进日常。',
  ],
  duties: [
    '组织电子系清锋明辩队伍备赛，开展思辨与表达训练。',
    '举办人文讲座、读书沙龙与同窗交流。',
    '组织社区共读，并参与学生节舞台剧创作、排演与舞台协作。',
  ],
  keywords: [
    '辩论',
    '清锋明辩',
    '读书',
    '阅读',
    '读书沙龙',
    '人文讲座',
    '社区共读',
    '儿童阅读',
    '学生节舞台剧',
    '舞台剧',
    '剧本',
    '表演',
    '拼贴诗',
    '剪字',
    '诗歌创作',
    '造词机',
    '拼贴工作台',
    '导出PNG',
  ],
  contacts: [{ name: '人文组副书记 肖岩钧', email: 'yj-xiao23@mails.tsinghua.edu.cn' }],
  accent: '#aa784b',
  darkAccent: '#efc496',
  layout: 'community',
  hero: { src: asset('humanities', 'assets/photos/debate.jpg.webp'), alt: '人文组活动中的同学们' },
  sourceNotes: ['人文组/人文组.html', '人文组/README.md；拼贴诗支持导出，隔离环境草稿仅临时保存。'],
});

const hardware = submitted({
  slug: 'hardware',
  departmentId: 'science_association.hardware',
  name: '硬件部',
  englishName: 'MAKE IT REAL',
  tagline: '从一颗元件，到一个亲手做出的答案',
  summary: '硬件设计大赛、安世杯、假期培训和技术分享。一起把电路与器件变成真正能工作的作品。',
  introduction: [
    '硬件部为电子系同学提供硬件开发学习资源，建立与硬件相关的科技创新和竞赛平台，与你一同开启硬核之旅。',
  ],
  duties: [
    '举办硬件设计大赛与“安世杯”挑战赛。',
    '通过项目式假期培训与 SAST Weekly 分享硬件知识。',
    '合作开展硬设民生赛道、拾光讲堂、EE黑客松、光电设计大赛等活动，参与 FREE BBS 建设。',
  ],
  keywords: [
    '硬件开发',
    '嵌入式',
    '电路焊接',
    '单片机',
    'Arduino',
    'STM32',
    '硬件设计大赛',
    '硬设',
    '安世杯',
    '无线充电',
    '智能小车',
    'PBL',
    '假期培训',
    'SAST Weekly',
    'EE黑客松',
    '光电设计大赛',
    '拾光讲堂',
    '硬设民生赛道',
  ],
  contacts: [
    { name: '硬件部部长 刘若桐', email: 'lrt24@mails.tsinghua.edu.cn' },
    { name: '硬件部部长 胡云淏', email: 'hu-yh24@mails.tsinghua.edu.cn' },
    { name: '硬件部部长 李泊衡', email: 'lbh24@mails.tsinghua.edu.cn' },
    { name: '硬件部副部长 王易科', email: 'yk-wang24@mails.tsinghua.edu.cn' },
  ],
  accent: '#3b8a9a',
  darkAccent: '#90decd',
  layout: 'lab',
  hero: {
    src: asset('hardware', 'assets/images/hardware_design_1.webp'),
    alt: '硬件设计大赛赛后大合影',
  },
  sourceNotes: [
    '硬件部/FREE-BBS-hardware-page/content/intro.md',
    '采用最终提交站，完整720p比赛视频按需播放。',
  ],
});

const software = submitted({
  slug: 'software',
  departmentId: 'science_association.software',
  name: '软件部',
  englishName: 'HELLO, WORLD. HELLO, TEAM.',
  tagline: '从第一行代码，写到一起完成的作品',
  summary:
    'THUAI、软件设计大赛、红石设计大赛，以及网站建设与寒暑期培训。编程的乐趣，和伙伴一起发现。',
  introduction: [
    '软件部负责软件技术与开发实践，面向零基础同学开展系统培训，通过项目实践、技术交流和团队协作，培养软件开发能力。',
  ],
  duties: [
    '开发维护电子系科协网站 EESAST.COM。',
    '组织 THUAI、软件设计大赛、红石设计大赛等赛事。',
    '开展软件开发培训、维护技术文档并参与 SAST Weekly 技术交流。',
  ],
  keywords: [
    '编程',
    '零基础',
    'C++',
    'Python',
    'THUAI',
    '人工智能挑战赛',
    '软件设计大赛',
    '软设',
    '红石',
    'Minecraft',
    'React',
    'Unity',
    'C#',
    'Git',
    '网站建设',
    'EESAST',
    '技术文档',
    '暑期培训',
    '寒假培训',
    '天梯对战',
  ],
  contacts: [
    { name: '软件部副主席 赵禹晋', email: '543329382@qq.com' },
    { name: '软件部部长 刘承昊', email: 'lch24@mails.tsinghua.edu.cn' },
    { name: '软件部部长 张国安', email: 'zga24@mails.tsinghua.edu.cn' },
    { name: '软件部部长 李科', email: 'like23@mails.tsinghua.edu.cn' },
  ],
  accent: '#6a67bc',
  darkAccent: '#c4baff',
  layout: 'lab',
  hero: {
    src: asset('software', '图像素材/THUAI9决赛合影.png.webp'),
    alt: 'THUAI9 人工智能挑战赛决赛合影',
  },
  sourceNotes: [
    '软件部/部门信息和展示内容.md',
    '软件部/网页示例.html；保留三大赛事、网站建设、培训与部门日常。',
  ],
});

const liaison = submitted({
  slug: 'liaison',
  departmentId: 'student_union.liaison_center',
  name: '学生联络中心',
  englishName: 'CONNECT CAMPUS AND BEYOND',
  tagline: '让联结，成为更多可能',
  summary:
    '对内协调组织、服务同学；对外联络企业、拓展合作。名企微体验、校园活动和毕业生服务，都有我们在其中牵线搭桥。',
  introduction: ['学生联络中心既是学生会内部高效协作的纽带，也是电子系与校外企业交流合作的窗口。'],
  duties: [
    '新生班级对接、跨部门协调与内部建设。',
    '组织名企微体验，联系校外企业与活动赞助。',
    '参与校园活动与路演，提供毕业生专属服务。',
  ],
  contacts: [{ name: '联络中心主任 王晨羽', email: 'chenyu-w24@mails.tsinghua.edu.cn' }],
  accent: '#8b67b2',
  darkAccent: '#d0b9f0',
  layout: 'community',
  hero: {
    src: asset('liaison', 'assets/破冰合照1.jpg'),
    alt: '学生联络中心破冰合照',
    fit: 'contain',
  },
  keywords: ['名企微体验', '企业参访', '赞助', '路演', '新生舞会', '毕业游园会', '秦皇岛', '内联'],
  sourceNotes: [
    '学生联络中心/index.html、content.js、page.js、style.css，保留六项工作弹窗与四组原生相册。工作图中的SVG为原稿示意图。',
  ],
});

export const SHOWCASES: readonly ShowcaseContent[] = [
  organization,
  training,
  arts,
  liaison,
  project,
  sports,
  rights,
  freshman,
  volunteer,
  practice,
  humanities,
  sail,
  research,
  tms,
  software,
  hardware,
  planning,
  creative,
  audiovisual,
  newMedia,
];

export function findShowcase(departmentId: string): ShowcaseContent | undefined {
  return SHOWCASES.find((content) => content.departmentId === departmentId);
}

export function showcaseRoute(content: ShowcaseContent): string {
  if (content.departmentId === 'tms.position') return '/organizations/tms';
  return `/organizations/${content.departmentId.replace('.', '/')}`;
}
