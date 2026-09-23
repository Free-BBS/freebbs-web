const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MAX_GENERATED_IMAGES = 1;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 30 * 1024 * 1024;
const PLACEHOLDER_PATTERN = /^\[\[MAX_IMAGE_\d+\]\]$/;

function safeAlt(value) {
  return String(value || 'Max 生成的图片')
    .replace(/[[\]\\\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function decodeImageDataUrl(value) {
  if (typeof value !== 'string' || value.length > Math.ceil((MAX_SOURCE_BYTES * 4) / 3) + 128)
    throw new Error('生成图片数据过大');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error('生成图片格式无效');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_SOURCE_BYTES) throw new Error('生成图片数据无效');
  return buffer;
}

function createGeneratedImageFileName(ownerId) {
  const safeOwner = Number.isSafeInteger(Number(ownerId)) ? Number(ownerId) : 0;
  return `max-image-${safeOwner}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.webp`;
}

async function persistOneImage(image, { ownerId, uploadDir }) {
  if (
    !image ||
    typeof image !== 'object' ||
    !PLACEHOLDER_PATTERN.test(String(image.placeholder || ''))
  )
    throw new Error('生成图片描述无效');
  const source = decodeImageDataUrl(image.dataUrl);
  const metadata = await sharp(source, { limitInputPixels: 20_000_000 }).metadata();
  if (
    !['png', 'jpeg', 'webp'].includes(metadata.format) ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > 8192 ||
    metadata.height > 8192 ||
    metadata.width * metadata.height > 20_000_000 ||
    (metadata.pages || 1) !== 1
  )
    throw new Error('生成图片尺寸无效');

  const output = await sharp(source, { limitInputPixels: 20_000_000 })
    .rotate()
    .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();
  if (!output.length || output.length > 6 * 1024 * 1024) throw new Error('生成图片转换后过大');

  // Do not publish a file merely because the encoder returned bytes. Re-opening
  // the final WebP catches malformed output before the client receives its URL.
  const outputMetadata = await sharp(output, { limitInputPixels: 20_000_000 }).metadata();
  if (
    outputMetadata.format !== 'webp' ||
    !outputMetadata.width ||
    !outputMetadata.height ||
    outputMetadata.width > 2560 ||
    outputMetadata.height > 2560
  )
    throw new Error('生成图片转换结果无效');

  await fs.promises.mkdir(uploadDir, { recursive: true });
  const fileName = createGeneratedImageFileName(ownerId);
  const destination = path.join(uploadDir, fileName);
  const temporary = `${destination}.uploading`;
  try {
    await fs.promises.writeFile(temporary, output, { flag: 'wx' });
    await fs.promises.rename(temporary, destination);
  } catch (error) {
    await fs.promises.unlink(temporary).catch(() => {});
    throw error;
  }
  return {
    placeholder: image.placeholder,
    markdown: `![${safeAlt(image.alt)}](/uploads/${fileName})`,
    fileName,
  };
}

function replacePlaceholder(value, replacements) {
  let result = String(value || '');
  for (const replacement of replacements)
    result = result.split(replacement.placeholder).join(replacement.markdown);
  return result;
}

function stripGeneratedImages(payload, message = '> 图片生成结果暂时无法保存，请稍后再试。') {
  const next = payload && typeof payload === 'object' ? { ...payload } : {};
  delete next.generated_images;
  for (const key of ['answer', 'content', 'chat_answer']) {
    if (typeof next[key] === 'string') {
      next[key] = next[key].replace(/\[\[MAX_IMAGE_\d+\]\]/g, message);
    }
  }
  return next;
}

async function persistGeneratedImages(payload, { ownerId, uploadDir }) {
  const images = payload?.generated_images;
  if (!Array.isArray(images) || !images.length) return { payload, generatedCount: 0, files: [] };
  if (images.length > MAX_GENERATED_IMAGES) throw new Error('单次回答最多生成一张图片');

  const replacements = [];
  try {
    for (const image of images)
      replacements.push(await persistOneImage(image, { ownerId, uploadDir }));
  } catch (error) {
    await Promise.all(
      replacements.map((item) =>
        fs.promises.unlink(path.join(uploadDir, item.fileName)).catch(() => {}),
      ),
    );
    throw error;
  }

  const next = { ...payload };
  delete next.generated_images;
  for (const key of ['answer', 'content', 'chat_answer']) {
    if (typeof next[key] === 'string') next[key] = replacePlaceholder(next[key], replacements);
  }
  return {
    payload: next,
    generatedCount: replacements.length,
    files: replacements.map((item) => item.fileName),
  };
}

async function persistGeneratedSsePayload(event, imageContext) {
  if (!event || event.done !== true || !event.result || typeof event.result !== 'object') {
    return { event, generatedCount: 0 };
  }
  try {
    const persisted = await persistGeneratedImages(event.result, imageContext);
    return {
      event: { ...event, result: persisted.payload },
      generatedCount: persisted.generatedCount,
    };
  } catch (error) {
    return {
      event: { ...event, result: stripGeneratedImages(event.result) },
      generatedCount: 0,
      error,
    };
  }
}

function createImageGenerationGate({ cooldownMs = 60_000 } = {}) {
  const state = new Map();
  function acquire(key) {
    const normalized = String(key || 'anonymous');
    const current = state.get(normalized);
    const now = Date.now();
    if (current?.pending || (current?.generatedAt && now - current.generatedAt < cooldownMs))
      return { allowed: false, release() {} };
    state.set(normalized, { pending: true, generatedAt: current?.generatedAt || 0 });
    let released = false;
    return {
      allowed: true,
      release(generated = false) {
        if (released) return;
        released = true;
        const latest = state.get(normalized);
        if (!latest?.pending) return;
        if (generated) state.set(normalized, { pending: false, generatedAt: Date.now() });
        else if (latest.generatedAt) state.set(normalized, { ...latest, pending: false });
        else state.delete(normalized);
      },
    };
  }
  return { acquire };
}

module.exports = {
  MAX_RESPONSE_BYTES,
  createImageGenerationGate,
  decodeImageDataUrl,
  persistGeneratedImages,
  persistGeneratedSsePayload,
  safeAlt,
  stripGeneratedImages,
};
