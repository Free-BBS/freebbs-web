const path = require('node:path');
const { workerData, parentPort } = require('node:worker_threads');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

const MAX_PAGES = 100;
const MAX_PAGE_EDGE = 3200;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

async function imageToPdf(source) {
  const image = sharp(source, { limitInputPixels: 20000000 });
  const { format } = await image.metadata();
  if (format !== 'jpeg' && format !== 'png') throw new Error('Unsupported image');
  const jpeg = await image
    .autoOrient()
    .resize({
      width: MAX_PAGE_EDGE,
      height: MAX_PAGE_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 94 })
    .toBuffer();
  const pdf = await PDFDocument.create();
  const embedded = await pdf.embedJpg(jpeg);
  const scale = 842 / Math.max(embedded.width, embedded.height);
  const page = pdf.addPage([embedded.width * scale, embedded.height * scale]);
  page.drawImage(embedded, { width: page.getWidth(), height: page.getHeight() });
  return pdf.save();
}

function stamp(canvas, context, { fullName, studentId }) {
  const { width, height } = canvas;
  const text = `${fullName} · ${studentId}`;
  const fontSize = Math.max(8, Math.min(width, height) * 0.028);
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `${fontSize}px TrainingWatermark`;
  context.fillStyle = 'rgba(38, 69, 80, 0.16)';
  for (const position of [0.25, 0.5, 0.75]) {
    context.save();
    context.translate(width / 2, height * position);
    context.rotate(-Math.PI / 8);
    context.fillText(text, 0, 0, width * 0.8);
    context.restore();
  }
  context.restore();
}

async function renderPdf(source, identity) {
  // PDF.js exposes its Node-compatible build as an explicit .mjs entry point.
  // eslint-disable-next-line import/extensions
  const { getDocument, AnnotationMode } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const assetRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const assetUrl = (directory) => path.join(assetRoot, directory) + path.sep;
  const loading = getDocument({
    data: new Uint8Array(source),
    cMapUrl: assetUrl('cmaps'),
    standardFontDataUrl: assetUrl('standard_fonts'),
    wasmUrl: assetUrl('wasm'),
    iccUrl: assetUrl('iccs'),
    cMapPacked: true,
    enableXfa: false,
    useSystemFonts: false,
    isEvalSupported: false,
    canvasMaxAreaInBytes: 32 * 1024 * 1024,
  });

  try {
    const document = await loading.promise;
    if (!document.numPages || document.numPages > MAX_PAGES)
      throw new Error('Unsupported page count');
    const output = identity ? await PDFDocument.create() : null;
    if (
      output &&
      !GlobalFonts.registerFromPath(
        path.join(
          __dirname,
          '../public/assets/fonts/source-han-serif-sc/SourceHanSerifCN-Regular.otf',
        ),
        'TrainingWatermark',
      )
    )
      throw new Error('Watermark font unavailable');

    let encodedSize = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const size = page.getViewport({ scale: 1 });
      if (![size.width, size.height].every((edge) => Number.isFinite(edge) && edge >= 1)) {
        throw new Error('Unsupported page dimensions');
      }
      if (!output) {
        page.cleanup();
        continue;
      }
      const viewport = page.getViewport({
        scale: Math.min(2.5, MAX_PAGE_EDGE / Math.max(size.width, size.height)),
      });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      await page.render({
        canvas,
        canvasContext: context,
        viewport,
        background: '#ffffff',
        annotationMode: AnnotationMode.ENABLE,
      }).promise;
      stamp(canvas, context, identity);
      const jpeg = await canvas.encode('jpeg', 94);
      canvas.width = 1;
      canvas.height = 1;
      page.cleanup();
      encodedSize += jpeg.length;
      if (encodedSize > MAX_OUTPUT_BYTES) throw new Error('Output too large');
      const image = await output.embedJpg(jpeg);
      const flattened = output.addPage([size.width, size.height]);
      flattened.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
    }
    return output ? await output.save() : null;
  } finally {
    await loading.destroy();
  }
}

async function processHandout({ source, identity, format }) {
  return format === 'image' ? imageToPdf(source) : renderPdf(source, identity);
}

processHandout(workerData).then(
  (bytes) => parentPort.postMessage({ bytes }),
  () => parentPort.postMessage({ invalid: true }),
);
