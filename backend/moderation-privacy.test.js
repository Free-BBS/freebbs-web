const assert = require('node:assert/strict');
const test = require('node:test');
const { Worker } = require('node:worker_threads');
const { normalizePrivacyText, buildPrivacyPreview } = require('./moderation-privacy');

async function boundedPreview(input) {
  const worker = new Worker(
    `const { parentPort, workerData } = require('node:worker_threads');
     const { buildPrivacyPreview } = require(workerData.modulePath);
     try {
       parentPort.postMessage({ result: buildPrivacyPreview(workerData.input) });
     } catch (error) {
       parentPort.postMessage({ error: { status: error.status, message: error.message } });
     }`,
    { eval: true, workerData: { modulePath: require.resolve('./moderation-privacy'), input } },
  );
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Privacy preview exceeded the worker deadline')),
        3000,
      );
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', (code) => {
        if (code !== 0) reject(new Error('Privacy preview worker failed'));
      });
    });
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}

const identities = [
  { full_name: '张三', student_id: '2026123456', email: 'zhang.san@example.edu.cn' },
  { full_name: '欧阳小明', student_id: null, email: null },
];

test('normalizes full width, common invisible controls and character references without interpreting tags', () => {
  assert.equal(normalizePrivacyText('张&#x4E09;\u200b Ａ１２３\u2060'), '张三 A123');
  assert.equal(normalizePrivacyText('<b>姓名</b> &lt;学生&gt;'), '<b>姓名</b> <学生>');
  assert.equal(normalizePrivacyText('a  b\n c'), 'a  b\n c');
});

test('same directory name and student number have consistent placeholders across fields', () => {
  const preview = buildPrivacyPreview({
    title: '投诉张三（2026123456）',
    content: '张三收取额外费用。学号：2026123456，邮箱：ZHANG.SAN@example.edu.cn。',
    identities,
  });
  assert.match(preview.title, /投诉【姓名_1】/);
  assert.match(preview.content, /【姓名_1】收取额外费用/);
  assert.ok(preview.title.includes('【学号_1】'));
  assert.ok(preview.content.includes('【学号_1】'));
  for (const secret of ['张三', '2026123456', 'zhang.san', 'example.edu.cn']) {
    assert.ok(!JSON.stringify(preview).toLowerCase().includes(secret.toLowerCase()), secret);
  }
});

test('full width and invisible variants are redacted and do not mutate source objects', () => {
  const input = {
    title: '张\u200b三的材料',
    content: '学号：２０２６１２３４５６；张&#x4e09;仍未答复。',
    identities,
    extraTerms: ['材料编号XYZ'],
  };
  const before = structuredClone(input);
  const result = buildPrivacyPreview(input);
  assert.deepEqual(input, before);
  assert.ok(!result.content.includes('2026123456'));
  assert.ok(!result.content.includes('张三'));
  assert.match(result.content, /仍未答复/);
});

test('phone separators and country prefix yield one identity placeholder', () => {
  const result = buildPrivacyPreview({
    title: '电话 13800138000',
    content: '联系方式：+86 138-0013-8000、１３８ ００１３ ８０００、138\u200b00138000。',
  });
  assert.match(result.title, /【电话_1】/);
  assert.equal((result.content.match(/【电话_1】/g) || []).length, 3);
  assert.ok(!result.content.includes('0013'));
  assert.equal(result.counts.phone, 4);
});

test('explicit unfamiliar names, labelled alphanumeric IDs and long numbers are local candidates', () => {
  const result = buildPrivacyPreview({
    content:
      '姓名：赵陌生，学号：AB20261234；身份证110101199001010011；工单987654321012，投诉重复收费。',
  });
  for (const value of ['赵陌生', 'AB20261234', '110101199001010011', '987654321012']) {
    assert.ok(!result.content.includes(value), value);
  }
  assert.match(result.content, /投诉重复收费/);
  assert.ok(result.counts.nationalId > 0);
});

test('overlapping private terms mask the full range and do not leave the tail of a longer name', () => {
  const result = buildPrivacyPreview({
    title: '欧阳小明投诉',
    content: '欧阳小明的宿舍记录需要处理。',
    identities: [{ full_name: '欧阳小明' }, { full_name: '小明' }],
    extraTerms: ['小明的宿舍记录'],
  });
  assert.ok(!result.title.includes('欧阳'));
  for (const value of ['欧阳', '小明', '宿舍记录']) assert.ok(!result.content.includes(value));
  assert.match(result.content, /需要处理/);
});

test('extra terms are literal and the same value is stable across title and body', () => {
  const term = 'A[12].*+寝室';
  const result = buildPrivacyPreview({
    title: `${term}故障`,
    content: `住址：${term}；普通批评和投诉保留。`,
    extraTerms: [term],
  });
  assert.match(result.title, /【补充隐私_1】故障/);
  assert.match(result.content, /【补充隐私_1】/);
  assert.match(result.content, /普通批评和投诉保留/);
});

test('inline and reference images expose no destination, preserve redacted alt and warn about pixels', () => {
  const url = '/api/moderation/attachments/12345678-1234-4234-8234-123456789abc';
  const result = buildPrivacyPreview({
    content: `![张三的成绩](${url} "电话13800138000")\n\n![欧阳小明][private]\n\n[private]: /private/姓名张三.webp "学号2026123456"`,
    identities,
    attachmentCount: 2,
  });
  for (const value of [
    url,
    '/private/',
    '123456789abc',
    '张三',
    '欧阳小明',
    '13800138000',
    '2026123456',
  ]) {
    assert.ok(!result.content.includes(value), value);
  }
  assert.match(result.content, /成绩/);
  assert.equal(result.imageCount, 2);
  assert.equal(result.imagesProcessed, false);
  assert.equal(result.externalReady, false);
  assert.match(result.limitations.join(''), /图片/);
});

test('link destinations, queries, fragments, autolinks and URLs in code are removed without fetching', () => {
  const result = buildPrivacyPreview({
    content:
      '[投诉证据](https://example.com/user/UnknownName?token=top-secret#secret)\n\n[资料][ref]\n\n[ref]: /students/UnknownName "待处理"\n\n<https://private.test/raw-name>\n\n`https://secret.test?student=ABC987`\n\nwww.hidden.com/thirdparty\n\n![图片](data:image/png;base64,SECRETIMAGE)',
  });
  for (const value of [
    'UnknownName',
    'top-secret',
    'raw-name',
    'ABC987',
    'thirdparty',
    'SECRETIMAGE',
  ]) {
    assert.ok(!result.content.includes(value), value);
  }
  assert.match(result.content, /投诉证据/);
  assert.match(result.content, /待处理/);
});

test('code samples, quotations and tables are also inspected for private text', () => {
  const result = buildPrivacyPreview({
    content:
      '> 张三说需要改进\n\n```text\n张三 2026123456\n```\n\n| 姓名 | 建议 |\n|---|---|\n| 欧阳小明 | 收费不合理 |',
    identities,
  });
  for (const value of ['张三', '2026123456', '欧阳小明'])
    assert.ok(!result.content.includes(value));
  assert.match(result.content, /需要改进/);
  assert.match(result.content, /收费不合理/);
});

test('returns only allowlisted preview fields and never includes directory details or mappings', () => {
  const result = buildPrivacyPreview({
    content: '普通建议',
    identities: [
      {
        full_name: '没有出现的姓名',
        student_id: '2026999999',
        email: 'private@example.com',
        password_hash: 'NEVER_SEND',
        username: 'private-user',
      },
    ],
  });
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      'mode',
      'redactorVersion',
      'title',
      'content',
      'counts',
      'imageCount',
      'imagesProcessed',
      'externalReady',
      'limitations',
    ].sort(),
  );
  for (const value of [
    '没有出现的姓名',
    '2026999999',
    'private@example.com',
    'NEVER_SEND',
    'private-user',
  ]) {
    assert.ok(!JSON.stringify(result).includes(value));
  }
  assert.equal(result.externalReady, false);
});

test('unknown names and harmless text are not falsely certified as ready for external transmission', () => {
  const result = buildPrivacyPreview({ content: '葛陌生认为教学安排不合理，希望公开说明原因。' });
  assert.equal(result.content, '葛陌生认为教学安排不合理,希望公开说明原因。');
  assert.equal(result.externalReady, false);
  assert.match(result.limitations.join(''), /未知姓名/);
  assert.match(result.limitations.join(''), /不能作为/);
});

test('all images remain unprocessed even when markdown has no visible private text', () => {
  const result = buildPrivacyPreview({ content: '请查看附件', attachmentCount: 2 });
  assert.equal(result.imageCount, 2);
  assert.equal(result.imagesProcessed, false);
  assert.equal(result.externalReady, false);
});

test('invalid types and limits produce fixed errors that contain no user input', () => {
  const cases = [
    [{ content: 123 }, 400],
    [{ content: 'ok', title: null }, 400],
    [{ content: 'ok', extraTerms: 'SECRET' }, 400],
    [{ content: 'ok', extraTerms: [null] }, 400],
    [{ content: 'ok', extraTerms: ['\u200b  '] }, 400],
    [{ content: 'ok', extraTerms: ['S'.repeat(129)] }, 413],
    [{ content: 'ok', extraTerms: Array(51).fill('SECRET') }, 413],
    [{ content: 'ok', title: 'T'.repeat(121) }, 413],
    [{ content: '隐'.repeat(45000) }, 413],
    [{ content: 'ok', identities: [null] }, 400],
    [{ content: 'ok', attachmentCount: -1 }, 400],
    [{ content: 'ok', attachmentCount: '1' }, 400],
  ];
  for (const [input, status] of cases) {
    assert.throws(
      () => buildPrivacyPreview(input),
      (error) => error.status === status && !error.message.includes('SECRET'),
    );
  }
});

test('bounded maximal plain text is supported without fabricating identities', () => {
  const result = buildPrivacyPreview({ content: 'a'.repeat(128 * 1024) });
  assert.equal(result.content.length, 128 * 1024);
  assert.equal(result.externalReady, false);
});

test('placeholder allocation is per preview and avoids collision with user supplied labels', () => {
  const result = buildPrivacyPreview({ content: '【姓名_1】张三', identities });
  assert.match(result.content, /【姓名_1】【姓名_2】/);
  const other = buildPrivacyPreview({ content: '张三', identities });
  assert.equal(other.content, '【姓名_1】');
});

test('duplicate directory values and extra terms do not multiply candidate matches', () => {
  const result = buildPrivacyPreview({
    content: `${'张三，'.repeat(1000)}\n${'寝室，'.repeat(1000)}`,
    identities: Array.from({ length: 500 }, () => ({ full_name: '张三' })),
    extraTerms: Array(50).fill('寝室'),
  });
  assert.equal(result.counts.name, 1000);
  assert.equal(result.counts.custom, 1000);
});

test('extreme repeated private input fails with a fixed error rather than returning a truncated preview', () => {
  const start = performance.now();
  for (const input of [
    {
      content: 'a'.repeat(128 * 1024),
      identities: Array.from({ length: 500 }, () => ({ full_name: 'a' })),
    },
    { content: 'private '.repeat(16000), extraTerms: ['private', 'riv'] },
  ]) {
    assert.throws(
      () => buildPrivacyPreview(input),
      (error) => error.status === 413 && error.message === '脱敏预览内容或补充词过长。',
    );
  }
  assert.ok(performance.now() - start < 5000, 'bounded matches must fail promptly');
});

test('relative paths and URLs inside literal code are hidden while explicit name labels remain readable', () => {
  const result = buildPrivacyPreview({
    content:
      '姓名是钱未知，投诉待回复。\n\n`src="/private/UnknownPerson?token=SECRET"`\n\n./files/UnknownPerson',
  });
  assert.match(result.content, /姓名是【姓名_1】,投诉待回复/);
  assert.ok(!result.content.includes('UnknownPerson'));
  assert.ok(!result.content.includes('SECRET'));
});

test('nested Markdown is preserved as plain source while matched private text is replaced', async () => {
  const content = `${'> '.repeat(10000)}姓名：赵陌生`;
  const { result, error } = await boundedPreview({ content });
  assert.equal(error, undefined);
  assert.equal(result.externalReady, false);
  assert.equal(result.content, `${'> '.repeat(10000)}姓名:【姓名_1】`);
});

test('Unicode before a case insensitive email match does not shift the replacement span', () => {
  const result = buildPrivacyPreview({
    title: 'İ 请联系 ALICE@EXAMPLE.EDU，投诉仍待答复',
    content: 'alice@example.edu',
    identities: [{ email: 'alice@example.edu' }],
  });
  assert.equal(result.title, 'İ 请联系 【邮箱_1】,投诉仍待答复');
  assert.ok(!result.content.includes('alice'));
});

test('literal and entity encoded unfinished Markdown links complete within a worker deadline', async () => {
  for (const content of [`${'[x]('.repeat(5000)}a`, `${'&#91;x&#93;&#40;'.repeat(1000)}a`]) {
    const { result, error } = await boundedPreview({ content });
    assert.equal(error, undefined);
    assert.equal(result.content, normalizePrivacyText(content));
    assert.equal(result.externalReady, false);
  }
});

test('formatting inside unfamiliar names is not silently joined after directory lookup', () => {
  const content = '张**三**、**张**三、张`三`、<script>字面示例</script>';
  const result = buildPrivacyPreview({ content, identities: [] });
  assert.equal(result.content, content);
  assert.ok(!result.content.includes('张三'));
  assert.equal(result.externalReady, false);
});

test('hiding URL destinations preserves criticism immediately following Markdown delimiters', () => {
  const result = buildPrivacyPreview({
    content:
      '[证据](https://example.test/a)请改善教学；`www.example.com/a`请答复；![说明](/api/moderation/attachments/private)收费不合理。',
    attachmentCount: 1,
  });
  assert.match(result.content, /\)请改善教学/);
  assert.match(result.content, /`请答复/);
  assert.match(result.content, /\)收费不合理/);
  assert.ok(!result.content.includes('example'));
  assert.ok(!result.content.includes('/api/'));
  assert.equal(result.imageCount, 1);
  assert.equal(result.imagesProcessed, false);
});

test('long URL-like failures and nested punctuation remain bounded without a Markdown parser', async () => {
  for (const content of [
    `${'a.'.repeat(60000)}invalidsuffix`,
    `${'a'.repeat(120000)}@`,
    `${'https://'.repeat(2500)}[x](`,
    `${'('.repeat(20000)}./private/secret${')'.repeat(20000)}`,
  ]) {
    const { result, error } = await boundedPreview({ content });
    assert.equal(error, undefined);
    assert.equal(result.externalReady, false);
  }
});
