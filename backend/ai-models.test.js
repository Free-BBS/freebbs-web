const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { modelCatalog, selectModel, resolveModelOptions } = require('./ai-models');
const settings = { model: 'glm-5.2', baseUrl: 'https://cloud.infini-ai.com/maas/v1' };
test('users select only supported models and actual effort levels without changing defaults', () => {
  assert.equal(modelCatalog(settings).models.length, 14);
  assert.equal(selectModel({}, settings).reasoning_effort, 'high');
  assert.equal(
    selectModel({ model: 'kimi-k2.6', reasoning_effort: 'off' }, settings).profile.vision,
    true,
  );
  assert.throws(() => selectModel({ model: 'unlisted' }, settings));
  assert.throws(() => selectModel({ reasoning_effort: 'low' }, settings));
  assert.equal(settings.model, 'glm-5.2');
  assert.equal(modelCatalog({ ...settings, baseUrl: 'https://elsewhere.test' }).models.length, 1);
});
test('image inputs are validated and sent only to vision models', async () => {
  const png = await sharp({ create: { width: 128, height: 96, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();
  const image = { label: '当前电路图', dataUrl: `data:image/png;base64,${png.toString('base64')}` };
  const options = await resolveModelOptions(
    { model: 'kimi-k2.6', vision_images: [image] },
    settings,
  );
  assert.deepEqual(options.vision_images, [image]);
  await assert.rejects(resolveModelOptions({ vision_images: [image] }, settings), /不支持视觉/);
  await assert.rejects(
    resolveModelOptions(
      { model: 'kimi-k2.6', vision_images: [{ ...image, dataUrl: 'https://private.test/image' }] },
      settings,
    ),
  );
  await assert.rejects(
    resolveModelOptions(
      { model: 'kimi-k2.6', vision_images: [{ ...image, dataUrl: 'data:image/png;base64,YmFk' }] },
      settings,
    ),
  );
});

test('large raster data does not hit the text-only circuit context limit', () => {
  const {
    validateCircuitAssistantInput,
    buildCircuitAssistantPayload,
  } = require('./circuit-assistant');
  const image = { label: '电路图', dataUrl: 'data:image/jpeg;base64,' + 'YWFh'.repeat(40000) };
  const input = validateCircuitAssistantInput({
    question: '读取电路',
    model: 'kimi-k2.6',
    reasoning_effort: 'off',
    vision_images: [image],
    document: { version: 1, components: [], wires: [], analysis: { type: 'dc' } },
    agent: { step: 100, canEdit: true, observations: [] },
  });
  const payload = buildCircuitAssistantPayload(input);
  assert.equal(payload.model, 'kimi-k2.6');
  assert.equal(payload.reasoning_effort, 'off');
  assert.deepEqual(payload.vision_images, [image]);
  assert.equal(payload.context.circuitEditor.agent.step, 100);
});
