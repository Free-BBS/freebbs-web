const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const frameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/** Walk complete chunks to IEND; image decoders ignore padding after the image stream. */
function completePng(bytes: Buffer) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(pngSignature)) return false;
  let offset = 8;
  let imageData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[a-zA-Z]{4}$/.test(type)) return false;
    if (
      offset === 8 &&
      (type !== 'IHDR' ||
        length !== 13 ||
        bytes.readUInt32BE(offset + 8) < 1 ||
        bytes.readUInt32BE(offset + 12) < 1)
    )
      return false;
    if (type === 'IDAT' && length > 0) imageData = true;
    if (type === 'IEND') return length === 0 && imageData;
    offset += length + 12;
  }
  return false;
}

/** Follow JPEG segments and entropy markers instead of requiring EOI at the absolute file end. */
function completeJpeg(bytes: Buffer) {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2;
  let frame = false;
  let scan = false;
  let inScan = false;
  let scanData = false;
  while (offset < bytes.length) {
    if (inScan) {
      const markerStart = bytes.indexOf(0xff, offset);
      if (markerStart < 0) return false;
      if (markerStart > offset) scanData = true;
      let next = markerStart + 1;
      while (bytes[next] === 0xff) next++;
      const marker = bytes[next];
      if (marker === 0 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)) {
        scanData = true;
        offset = next + 1;
        continue;
      }
      offset = markerStart;
      inScan = false;
    }
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) return frame && scan && scanData;
    if (marker === undefined || marker === 0 || marker === 0xd8) return false;
    if (marker === 1) continue;
    if (offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if (frameMarkers.has(marker)) {
      if (length < 8 || bytes.readUInt16BE(offset + 3) < 1 || bytes.readUInt16BE(offset + 5) < 1)
        return false;
      frame = true;
    }
    if (marker === 0xda) {
      if (!frame || length < 6) return false;
      scan = true;
      inScan = true;
    }
    offset += length;
  }
  return false;
}

export function recognizedImageMime(
  bytes: Buffer,
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (completePng(bytes)) return 'image/png';
  if (completeJpeg(bytes)) return 'image/jpeg';
  if (
    bytes.length >= 20 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP' &&
    bytes.readUInt32LE(4) + 8 === bytes.length &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))
  )
    return 'image/webp';
  return null;
}
