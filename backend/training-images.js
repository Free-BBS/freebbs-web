const path = require('node:path');
const sharp = require('sharp');

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
let watermarkFontRegistered = false;

async function normalizeTrainingImage(content, { qr = false } = {}) {
  const invalid = () =>
    Object.assign(new Error('请选择 3 MB 以内的 JPG 或 PNG 图片'), { status: 400 });
  if (
    typeof content !== 'string' ||
    content.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    content.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(content)
  )
    throw invalid();
  const source = Buffer.from(content, 'base64');
  if (source.length > MAX_IMAGE_BYTES) throw invalid();

  try {
    const image = sharp(source, { limitInputPixels: 16000000 });
    const { format } = await image.metadata();
    if (format !== 'jpeg' && format !== 'png') throw invalid();
    image
      .autoOrient()
      .resize({
        width: qr ? 1000 : 1200,
        height: qr ? 1000 : 800,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' });
    return await (qr ? image.png() : image.jpeg({ quality: 88 })).toBuffer();
  } catch {
    throw invalid();
  }
}

async function watermarkGroupQr(image, user) {
  const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
  if (!watermarkFontRegistered) {
    watermarkFontRegistered = Boolean(
      GlobalFonts.registerFromPath(
        path.join(
          __dirname,
          '../public/assets/fonts/source-han-serif-sc/SourceHanSerifCN-Regular.otf',
        ),
        'TrainingQrWatermark',
      ),
    );
    if (!watermarkFontRegistered) throw new Error('Training QR watermark font unavailable');
  }
  const qr = await loadImage(image);
  const padding = 22;
  const width = Math.max(280, qr.width + padding * 2);
  const height = qr.height + padding * 2 + 30;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const identity = `${user.full_name || user.username || '用户'} · ${user.student_id || user.id}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(qr, (width - qr.width) / 2, padding);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '16px TrainingQrWatermark';
  ctx.fillStyle = 'rgba(22, 65, 77, 0.15)';
  for (const y of [0.28, 0.5, 0.72]) {
    ctx.save();
    ctx.translate(width / 2, padding + qr.height * y);
    ctx.rotate(-Math.PI / 9);
    ctx.fillText(identity, 0, 0, qr.width * 0.88);
    ctx.restore();
  }
  ctx.fillStyle = '#16414d';
  ctx.fillText(identity, width / 2, height - 18, width - 2 * padding);
  return canvas.encode('png');
}

module.exports = { normalizeTrainingImage, watermarkGroupQr };
