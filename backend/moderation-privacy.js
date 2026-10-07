const cheerio = require('cheerio');

const MAX_CONTENT_BYTES = 128 * 1024;
const MAX_MATCHES = 20000;
const MAX_DISCOVERED_NAMES = 500;
const SINGLE_SURNAMES = new Set(
  '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林钟徐邱骆高夏蔡田樊胡霍万柯卢莫房裘缪解应宗丁宣邓单杭洪包诸左石崔吉龚程邢裴陆荣翁荀羊惠甄曲封芮储靳焦牧隗山谷车侯宓蓬宫宁仇栾暴甘祖武符刘景詹龙叶司白蒲台鄂索赖卓屠蒙池乔阴郁胥能苍双闻党翟谭贡劳逄姬申扶堵冉宰郦雍桑桂濮牛寿通边扈燕冀尚农温庄晏柴瞿阎连习艾容向古易廖曾廖聂晁冷辛简饶鞠文沙关巩游岳帅缑况郈有琴商牟佘佟言福'.split(
    '',
  ),
);
const COMPOUND_SURNAMES = new Set([
  '欧阳',
  '司马',
  '上官',
  '诸葛',
  '东方',
  '皇甫',
  '尉迟',
  '公孙',
  '慕容',
  '令狐',
  '司徒',
  '司空',
  '夏侯',
  '南宫',
  '长孙',
  '宇文',
  '轩辕',
  '端木',
  '独孤',
  '闻人',
]);
const NON_NAME_WORDS =
  /(?:年级|同学|老师|学生|教师|教授|博士|硕士|学院|大学|学校|专业|队员|选手|党员|团员|班长|干部|会长|管理员|朋友|家长|父亲|母亲|大家|你们|他们|我们|自己|普通|任意|许多)|[的了吗吧呢呀啊]$/;
const NON_NAME_PHRASES = new Set([
  '高兴',
  '高手',
  '高材生',
  '高一',
  '高二',
  '高三',
  '高中生',
  '何人',
  '单身',
  '文科生',
  '金牌',
  '向前看',
]);
const BUILDING_NUMBER = String.raw`(?:[1-9]\d{0,2}|[一二三四五六七八九十百零〇两]{1,5})`;
const BUILDING = String.raw`(?:第)?${BUILDING_NUMBER}(?:号楼|号?栋|号?幢|楼)`;
const DORM_BUILDING = String.raw`(?:第)?${BUILDING_NUMBER}号?(?:宿舍楼|寝室楼|学生公寓)`;
const ROOM = String.raw`[ \t]{0,8}(?:[的,:：#-][ \t]{0,4})?(?:(?:房间|房号|宿舍|寝室)[ \t]{0,4})?[1-9]\d{1,3}[A-Za-z]?(?:室|号房|寝室|宿舍)?(?![A-Za-z\d])`;
const DORM_ADDRESS_PATTERNS = [
  new RegExp(String.raw`(紫荆(?:学生公寓|公寓|宿舍)?[ \t]{0,4}${BUILDING}${ROOM})`, 'gu'),
  new RegExp(String.raw`(${DORM_BUILDING}${ROOM})`, 'gu'),
  new RegExp(
    String.raw`(?:宿舍|寝室|学生公寓|住址|住在|住处)[ \t]{0,4}(?:在|是|为|:)?[ \t]{0,4}(${BUILDING}${ROOM})`,
    'gu',
  ),
];
// eslint-disable-next-line no-misleading-character-class -- Each listed control/combining code point is intentionally removed individually.
const ZERO_WIDTH = /[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
const LABELS = Object.freeze({
  name: '姓名',
  studentId: '学号',
  phone: '电话',
  email: '邮箱',
  nationalId: '身份证号',
  identifier: '编号',
  address: '地址',
  custom: '补充隐私',
  url: '链接',
});
const LIMITATIONS = Object.freeze([
  '此结果仅供本地检查，不能作为允许向外部模型发送内容的依据。',
  '目录和规则可能漏掉未知姓名、昵称、地址及变形身份信息，也可能误替换普通文字。',
  '自然介绍姓名仅使用有限姓氏和语境规则，宿舍地址仅覆盖部分明确楼栋与房号组合，并非完整姓名或地址识别。',
  '未进行图片识别或像素遮挡，图片中的姓名、证件、人脸、二维码等隐私仍需人工检查。',
  '预览以纯文本保留 Markdown 标记并遮挡已识别地址，不会访问链接或读取图片；复杂变形链接仍可能遗漏。',
]);

function invalid(status = 400) {
  return Object.assign(
    new Error(status === 413 ? '脱敏预览内容或补充词过长。' : '脱敏预览参数无效。'),
    { status },
  );
}

function normalizePrivacyText(input) {
  if (typeof input !== 'string') throw invalid();
  // Decode character references without interpreting literal HTML as markup.
  const decoded = input.includes('&')
    ? cheerio.load(input.replace(/</g, '&lt;').replace(/>/g, '&gt;'), null, false).text()
    : input;
  return decoded.normalize('NFKC').replace(ZERO_WIDTH, '');
}

function readInputs({ title, content, identities, extraTerms, attachmentCount }) {
  if (typeof title !== 'string' || typeof content !== 'string') throw invalid();
  if (title.length > 120 || Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
    throw invalid(413);
  }
  if (!Array.isArray(identities) || identities.length > 500 || !Array.isArray(extraTerms)) {
    throw invalid();
  }
  if (extraTerms.length > 50) throw invalid(413);
  if (!Number.isInteger(attachmentCount) || attachmentCount < 0 || attachmentCount > 12) {
    throw invalid();
  }
  const terms = extraTerms.map((value) => {
    if (typeof value !== 'string') throw invalid();
    if (value.length > 128) throw invalid(413);
    const normalized = normalizePrivacyText(value).trim();
    if (!normalized) throw invalid();
    if (normalized.length > 128) throw invalid(413);
    return normalized;
  });
  const directory = new Map();
  for (const identity of identities) {
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) throw invalid();
    for (const [field, kind] of [
      ['full_name', 'name'],
      ['student_id', 'studentId'],
      ['email', 'email'],
    ]) {
      const value = identity[field];
      if (value == null || value === '') continue;
      if (typeof value !== 'string' || value.length > 128) throw invalid();
      const normalized = normalizePrivacyText(value).trim();
      if (normalized) {
        directory.set(`${kind}:${canonicalValue(kind, normalized)}`, { value: normalized, kind });
      }
    }
  }
  return {
    title: normalizePrivacyText(title),
    content: normalizePrivacyText(content),
    terms: [...new Set(terms)],
    directory: [...directory.values()],
  };
}

function literalMatches(text, value, kind, add) {
  if (kind === 'email') {
    // Case-folding the entire string can change Unicode length and shift spans.
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    patternMatches(text, new RegExp(escaped, 'giu'), kind, add);
    return;
  }
  const haystack = text;
  const needle = value;
  for (
    let start = haystack.indexOf(needle);
    start !== -1;
    start = haystack.indexOf(needle, start + 1)
  ) {
    add({ start, end: start + needle.length, kind });
  }
}

function patternMatches(text, pattern, kind, add, group = 0) {
  for (const match of text.matchAll(pattern)) {
    const value = match[group];
    const start = match.index + (group ? match[0].lastIndexOf(value) : 0);
    add({ start, end: start + value.length, kind });
  }
}

function discoverIntroducedNames(text, names) {
  const introduction =
    /(?:本人(?:叫|是)|我(?:叫|是))[ \t]{0,8}[:：]?[ \t]{0,8}([\p{Script=Han}]{2,4})(?=$|[\s,，。;；!?！？、:：)\]】”」])/gu;
  for (const match of text.matchAll(introduction)) {
    const name = match[1];
    const compound = COMPOUND_SURNAMES.has(name.slice(0, 2));
    const hasSurname = compound
      ? name.length >= 3
      : SINGLE_SURNAMES.has(name[0]) && name.length <= 3;
    if (!hasSurname || NON_NAME_WORDS.test(name) || NON_NAME_PHRASES.has(name)) continue;
    names.add(name);
    if (names.size > MAX_DISCOVERED_NAMES) throw invalid(413);
  }
}

function dormitoryMatches(text, add) {
  for (const pattern of DORM_ADDRESS_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1];
      const start = match.index + match[0].lastIndexOf(value);
      const end = start + value.length;
      // A room in a classroom, laboratory or public office is not a dorm address.
      if (
        /^[ \t]{0,4}(?:是|为)?(?:教室|实验室|自习室|会议室|办公室|活动室|阅览室)/u.test(
          text.slice(end, end + 16),
        )
      )
        continue;
      add({ start, end, kind: 'address' });
    }
  }
}

function mergedMatches(matches) {
  const ordered = matches.sort((left, right) => left.start - right.start || right.end - left.end);
  const result = [];
  for (const match of ordered) {
    const previous = result.at(-1);
    if (previous && match.start < previous.end) {
      // Cover the full union so overlapping matches cannot expose a suffix.
      if (match.end - match.start > previous.longest) {
        previous.kind = match.kind;
        previous.longest = match.end - match.start;
      }
      previous.end = Math.max(previous.end, match.end);
    } else {
      result.push({ ...match, longest: match.end - match.start });
    }
  }
  return result;
}

function canonicalValue(kind, value) {
  if (kind === 'email') return value.toLowerCase();
  if (kind === 'address') return value.replace(/[ \t]/g, '').toUpperCase();
  if (['phone', 'studentId', 'nationalId', 'identifier'].includes(kind)) {
    const compact = value.replace(/[\s()+\-‐‑–—]/g, '').toUpperCase();
    return kind === 'phone' ? compact.replace(/^(?:0086|86)(?=1\d{10}$)/, '') : compact;
  }
  return value;
}

function buildPrivacyPreview(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const { title = '', content, identities = [], extraTerms = [], attachmentCount = 0 } = input;
  const inputs = readInputs({ title, content, identities, extraTerms, attachmentCount });
  const introducedNames = new Set();
  discoverIntroducedNames(inputs.title, introducedNames);
  discoverIntroducedNames(inputs.content, introducedNames);
  const directoryNames = new Set(
    inputs.directory.filter(({ kind }) => kind === 'name').map(({ value }) => value),
  );
  for (const value of introducedNames) {
    if (!directoryNames.has(value)) inputs.directory.push({ value, kind: 'name' });
  }
  const counts = Object.fromEntries(Object.keys(LABELS).map((kind) => [kind, 0]));
  const mappings = new Map();
  const counters = new Map();
  let matchCount = 0;
  const original = `${inputs.title}\n${inputs.content}`;
  function placeholder(kind, value) {
    const key = `${kind}:${canonicalValue(kind, value)}`;
    counts[kind] += 1;
    if (!mappings.has(key)) {
      let number = counters.get(kind) || 0;
      let label;
      do {
        number += 1;
        label = `【${LABELS[kind]}_${number}】`;
      } while (original.includes(label));
      counters.set(kind, number);
      mappings.set(key, label);
    }
    return mappings.get(key);
  }

  function redact(text) {
    const matches = [];
    const add = (match) => {
      matchCount += 1;
      if (matchCount > MAX_MATCHES) throw invalid(413);
      matches.push(match);
    };
    for (const { value, kind } of inputs.directory) literalMatches(text, value, kind, add);
    for (const value of inputs.terms) literalMatches(text, value, 'custom', add);
    dormitoryMatches(text, add);
    const patterns = [
      [
        /(?<![a-z\d+.-])(?:[a-z][a-z\d+.-]{1,31}:\/\/|www\.|mailto:|tel:|data:|\/\/)[^\s<>【】"'`()[\]，。；！？]+/gi,
        'url',
      ],
      [
        /(?<![a-z\d.-])(?:[a-z\d-]{1,63}\.)+(?:com|cn|org|net|edu|gov|io)(?:[/?#][^\s<>【】"'`()[\]，。；！？]*)?/gi,
        'url',
      ],
      [/(?<![^\s("'`=])(?:\/(?!\/)|\.\.?\/)[^\s<>【】"'`()[\]，。；！？]+/g, 'url'],
      [
        /(?<![\p{L}\d.!#$%&'*+/=?^_`{|}~-])[\p{L}\d.!#$%&'*+/=?^_`{|}~-]{1,256}@[\p{L}\d](?:[\p{L}\d.-]{0,253}[\p{L}\d])?\.[\p{L}]{2,63}/gu,
        'email',
      ],
      [/(?<!\d)(?:\+?86[ \t-]?)?1[3-9](?:[ \t()‐‑–—-]?\d){9}(?!\d)/g, 'phone'],
      [/(?<!\d)\d{17}[\dXx](?!\d)/g, 'nationalId'],
      [/(?<!\d)20\d{8}(?!\d)/g, 'studentId'],
      [/(?<![\da-z])\d{7,}(?![\da-z])/gi, 'identifier'],
      [
        /(?:姓名|实名|名字)[ \t]*(?:[:：=]|是|为)[ \t]*([\p{Script=Han}·]{2,8})(?=$|[\s,，。;；!?！？、])/gu,
        'name',
        1,
      ],
      [
        /(?:姓名|实名|名字)[ \t]*(?:[:：=]|是|为)[ \t]*([A-Za-z][A-Za-z .'-]{1,63})(?=$|[\n,，。;；!?！？])/g,
        'name',
        1,
      ],
      [
        /(?:学号|学生编号|工号)[ \t]*[:：=]?[ \t]*([A-Za-z\d][A-Za-z\d ‐‑–—-]{4,31})(?=$|[\s,，。;；!?！？、])/g,
        'studentId',
        1,
      ],
    ];
    for (const [pattern, kind, group] of patterns) patternMatches(text, pattern, kind, add, group);
    let cursor = 0;
    let output = '';
    for (const match of mergedMatches(matches)) {
      output += text.slice(cursor, match.start);
      output += placeholder(match.kind, text.slice(match.start, match.end));
      cursor = match.end;
    }
    return output + text.slice(cursor);
  }

  // Keep the same normalized source used by directory lookup. Parsing Markdown
  // here can join previously separated identity characters and block on hostile
  // syntax before any token budget can run. The UI displays this as plain text.
  return {
    mode: 'local_preview',
    redactorVersion: 'local-preview-v2',
    title: redact(inputs.title),
    content: redact(inputs.content),
    counts,
    imageCount: attachmentCount,
    imagesProcessed: false,
    externalReady: false,
    limitations: [...LIMITATIONS],
  };
}

module.exports = { normalizePrivacyText, buildPrivacyPreview };
