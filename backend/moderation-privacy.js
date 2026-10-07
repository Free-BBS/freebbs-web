const cheerio = require('cheerio');

const MAX_CONTENT_BYTES = 128 * 1024;
const MAX_MATCHES = 20000;
// eslint-disable-next-line no-misleading-character-class -- Each listed control/combining code point is intentionally removed individually.
const ZERO_WIDTH = /[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
const LABELS = Object.freeze({
  name: '姓名',
  studentId: '学号',
  phone: '电话',
  email: '邮箱',
  nationalId: '身份证号',
  identifier: '编号',
  custom: '补充隐私',
  url: '链接',
});
const LIMITATIONS = Object.freeze([
  '此结果仅供本地检查，不能作为允许向外部模型发送内容的依据。',
  '目录和规则可能漏掉未知姓名、昵称、地址及变形身份信息，也可能误替换普通文字。',
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
    redactorVersion: 'local-preview-v1',
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
