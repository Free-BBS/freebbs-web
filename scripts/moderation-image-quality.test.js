const test = require('node:test');
const assert = require('node:assert/strict');
const {
  institutionConsentClaim,
  isUnreadableNotice,
  isReadabilityUncertainty,
  checkReasonQuality,
} = require('./moderation-image-quality');

const fixture = {
  expected: {
    readability: 'readable',
    quality: {
      sensitiveValues: ['2099010048', '栖云七号楼512B'],
      forbidInstitutionConsent: true,
      privacySubject: 'self',
    },
  },
};
const result = () => ({
  assessment: {
    reason: '图片含完整学号及具体宿舍位置，应人工核查。',
    uncertainties: ['需确认公开范围和风险。'],
    supportReason: '',
    ruleMatches: [
      {
        ruleId: '隐私-003',
        explanation: '作者声称是本人信息，按本站安全复核规则处理。',
        evidence: { field: 'image_1', quote: '完整学号2099010048' },
      },
    ],
  },
  imageObservations: [
    {
      imageIndex: 1,
      text: '完整学号2099010048，住栖云七号楼512B。',
      description: '包含个人身份和定位信息的文字卡片。',
    },
  ],
});

test('school consent requests are flagged without interpreting inability as negation', () => {
  for (const text of [
    '无法判断该信息公开是否经过学校或相关管理方的知情同意。',
    '需要学校批准才能发。',
    '请负责人确认是否获得学校知情同意。',
    '该信息未经校方许可，必须复核。',
  ])
    assert.equal(institutionConsentClaim(text), true, text);
});
test('explicitly rejecting an invented school requirement does not flag it', () => {
  for (const text of [
    '无需学校同意。',
    '未要求学校同意。',
    '不能凭空要求学校批准。',
    '学校同意不能替代本人授权。',
    '不能因为缺少学校批准就认定违规。',
    '本规则不要求校方许可，需确认公开必要性。',
    '应核对公开必要性，学校许可不是核查前提。',
  ])
    assert.equal(institutionConsentClaim(text), false, text);
});
test('normal platform moderator approval is distinct from school permission', () => {
  for (const text of [
    '需管理员同意发布。',
    '需本站管理方复核同意发布。',
    '请平台审核人员批准后发布。',
  ])
    assert.equal(institutionConsentClaim(text), false);
});
test('privacy values in OCR and dedicated evidence do not count as prose leakage', () => {
  assert.deepEqual(checkReasonQuality(fixture, result()).issues, []);
});
test('known full values in reason, uncertainty, explanation or description are independently flagged', () => {
  const input = result();
  input.assessment.reason = '学号２０９９０１００４８';
  input.assessment.uncertainties.push('地址 栖云七号楼５１２Ｂ 是否公开？');
  input.assessment.ruleMatches[0].explanation = '学号2099 010048';
  input.imageObservations[0].description = '栖云七号楼512B';
  const issues = checkReasonQuality(fixture, input).issues;
  assert.equal(issues.filter((x) => x.code === 'privacy_value_repeated_in_reason').length, 4);
  assert.equal(JSON.stringify(issues).includes('2099010048'), false);
});
test('last report failure has three distinct reasons and is not silently repaired', () => {
  const input = result();
  input.assessment.reason = '完整学号2099010048';
  input.assessment.ruleMatches.push({ ruleId: '隐私-001', explanation: '属于他人的信息。' });
  input.assessment.uncertainties.push('无法判断该信息公开是否经过学校或相关管理方的知情同意。');
  const original = structuredClone(input);
  const codes = checkReasonQuality(fixture, input).issues.map((x) => x.code);
  for (const code of [
    'privacy_value_repeated_in_reason',
    'unsupported_institution_consent',
    'self_information_treated_as_other',
  ])
    assert.ok(codes.includes(code));
  assert.deepEqual(input, original);
});
test('explicit third-party and mixed-party fixtures retain their own rule boundaries', () => {
  const input = result();
  assert.ok(
    checkReasonQuality({ expected: { quality: { privacySubject: 'other' } } }, input).issues.some(
      (x) => x.code === 'other_information_treated_as_self',
    ),
  );
  input.assessment.ruleMatches.push({ ruleId: '隐私-001', explanation: '另一位同学资料。' });
  assert.deepEqual(
    checkReasonQuality({ expected: { quality: { privacySubject: 'both' } } }, input).issues,
    [],
  );
});
test('severe blur requires a readability uncertainty; clear privacy or school words alone do not suffice', () => {
  const input = result();
  input.assessment.uncertainties = ['无法确认学号是否属于作者本人'];
  assert.ok(
    checkReasonQuality({ expected: { readability: 'unreadable' } }, input).issues.some(
      (x) => x.code === 'missing_readability_uncertainty',
    ),
  );
  input.assessment.uncertainties = ['图片过于模糊，无法读取关键文字，需人工核查更清晰的原图。'];
  assert.deepEqual(
    checkReasonQuality({ expected: { readability: 'unreadable' } }, input).issues,
    [],
  );
  input.assessment.uncertainties = ['第1张图片的文字无法可靠读取，需要查看原图。'];
  assert.deepEqual(
    checkReasonQuality({ expected: { readability: 'unreadable' } }, input).issues,
    [],
  );
  input.assessment.uncertainties = ['图片不模糊，分辨率足够但无法确认是谁。'];
  assert.ok(
    checkReasonQuality({ expected: { readability: 'unreadable' } }, input).issues.some(
      (x) => x.code === 'missing_readability_uncertainty',
    ),
  );
});

test('limitation-only OCR placeholders accept modifiers but not an invented transcript', () => {
  for (const value of [
    '图片模糊，无法辨认具体内容。',
    '图片模糊，无法辨认任何文字。',
    '图片过于模糊，无法识别文字。',
    '第1张图片的文字无法可靠读取，需要查看原图。',
    '【图片字迹无法清楚识别】',
    '图片为空白背景，无任何可见文字或图形。',
  ])
    assert.equal(isUnreadableNotice(value), true, value);
  for (const value of [
    '学号123456，图片过于模糊。',
    '图片无法可靠读取，但可以看出他在威胁同学。',
    '无法确认学号是否属于本人',
  ])
    assert.equal(isUnreadableNotice(value), false, value);
});

test('blank-looking damaged images count as uncertainty only when content cannot be verified', () => {
  const accepted = [
    '图片1为几乎全白的空白图像，无法判断是上传失败、压缩损坏还是故意隐藏内容，需确认原图是否包含有效信息。',
    '用户提示需结合附图阅读，但图片无可见文字或图形，无法核实帖子实际意图及是否存在潜在风险。',
    '图片为空白背景，无法辨识实际内容。',
  ];
  for (const value of accepted) assert.equal(isReadabilityUncertainty(value), true, value);
  for (const value of [
    '图片为空白背景，没有文字，这是测试背景图。',
    '图片很清晰，但无法确认作者身份。',
    '作者身份模糊，无法确认是否本人。',
    '图片空白，无法确认学号是否属于本人。',
    '图片清晰，无法辨认身份。',
  ])
    assert.equal(isReadabilityUncertainty(value), false, value);
});
