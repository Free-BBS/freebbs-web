const sharp = require('sharp');

// Native capability contracts: docs.infini-ai.com/gen-studio/api/text-generation/tutorial-reasoning/
const PROFILES = require('./ai-model-catalog.json');

function modelCatalog(settings) {
  const supported = new URL(settings.baseUrl).hostname === 'cloud.infini-ai.com' ? PROFILES : [];
  const models = supported.map((profile) => ({ ...profile }));
  if (!models.some((profile) => profile.id === settings.model))
    models.unshift({
      id: settings.model,
      label: settings.model,
      vision: false,
      efforts: ['auto'],
      defaultEffort: 'auto',
    });
  return { defaultModel: settings.model, models };
}
function selectModel(body, settings) {
  const catalog = modelCatalog(settings);
  const model = body.model === undefined || body.model === '' ? catalog.defaultModel : body.model;
  const profile = catalog.models.find((item) => item.id === model);
  if (!profile) throw new Error('所选模型当前不可用，请重新选择。');
  const effort = body.reasoning_effort ?? profile.defaultEffort;
  if (!profile.efforts.includes(effort)) throw new Error('所选模型不支持此思考强度。');
  return { model, reasoning_effort: effort, profile };
}
function validateVisionImages(images = []) {
  if (!Array.isArray(images) || images.length > 13) throw new Error('单次最多附带 13 张图片。');
  return images.map((image) => {
    if (
      !image ||
      typeof image.label !== 'string' ||
      image.label.length > 120 ||
      typeof image.dataUrl !== 'string' ||
      image.dataUrl.length > 1400000 ||
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl)
    )
      throw new Error('图片格式无效，单图须小于 1 MiB。');
    return { label: image.label, dataUrl: image.dataUrl };
  });
}
async function validateImageContents(images) {
  for (const image of images) {
    const buffer = Buffer.from(image.dataUrl.split(',')[1], 'base64');
    const meta = await sharp(buffer, { limitInputPixels: 8000000 }).metadata();
    if (
      !['png', 'jpeg', 'webp'].includes(meta.format) ||
      meta.width < 32 ||
      meta.height < 32 ||
      meta.width > 4096 ||
      meta.height > 4096 ||
      meta.width * meta.height > 8000000 ||
      (meta.pages || 1) !== 1
    )
      throw new Error('图片尺寸无效。');
  }
}
async function resolveModelOptions(body, settings) {
  const { profile, ...options } = selectModel(body, settings);
  const images = validateVisionImages(body.vision_images);
  if (images.length && !profile.vision) throw new Error('所选模型不支持视觉输入，请切换视觉模型。');
  await validateImageContents(images);
  return { ...options, ...(images.length ? { vision_images: images } : {}) };
}
module.exports = {
  modelCatalog,
  selectModel,
  resolveModelOptions,
  validateVisionImages,
  validateImageContents,
};
