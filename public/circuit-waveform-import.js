/* eslint-disable no-bitwise -- MAT binary flags */
/* Data-only waveform imports. MAT Level 5 numeric arrays; never execute .m files. */
(function waveformImport(root) {
  const MAX_BYTES = 4 * 1024 * 1024;
  const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/;
  function numeric(text) {
    if (!number.test(text)) throw new Error(`不是有效数值：${text.slice(0, 30)}`);
    const value = Number(text.replace(/[dD]/, 'e'));
    if (!Number.isFinite(value)) throw new Error('波形包含非有限数值。');
    return value;
  }
  function matrix(text) {
    const rows = text
      .trim()
      .split(/[;\r\n]+/)
      .filter((v) => v.trim())
      .map((line) =>
        line
          .trim()
          .split(/[,\s]+/)
          .map(numeric),
      );
    if (!rows.length || rows.some((r) => r.length !== rows[0].length))
      throw new Error('数据矩阵每行的列数必须相同。');
    return rows;
  }
  function textArrays(text, matlab) {
    if (text.length > MAX_BYTES) throw new Error('波形文件不能超过 4 MB。');
    const clean = text.replace(/^\uFEFF/, '').replace(/%[^\r\n]*/g, '');
    if (matlab) {
      const arrays = [];
      const pattern = /([A-Za-z]\w*)\s*=\s*\[([^\]]*)\]\s*('?)[ \t]*;?/g;
      for (const match of clean.matchAll(pattern)) {
        const rows = matrix(match[2]);
        arrays.push({
          name: match[1],
          rows: match[3] ? rows[0].map((_, i) => rows.map((r) => r[i])) : rows,
        });
      }
      if (!arrays.length)
        throw new Error(
          '.m 文件请使用数值数组，如 t=[0 0.001 0.002]; y=[0 1 0];，不执行脚本或函数。',
        );
      return arrays;
    }
    const lines = clean
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.trim());
    let labels = [];
    const tokens = lines[0]?.split(/[,;\t]/).map((v) => v.trim().replace(/^"|"$/g, '')) || [];
    if (tokens.some((v) => !number.test(v)))
      labels = lines
        .shift()
        .split(/[,;\t]/)
        .map((v) => v.trim().replace(/^"|"$/g, ''));
    return [{ name: 'CSV', rows: matrix(lines.join('\n').replace(/;/g, ',')), labels }];
  }
  async function matArrays(buffer) {
    if (buffer.byteLength < 128 || buffer.byteLength > MAX_BYTES)
      throw new Error('MAT 文件无效或超过 4 MB。');
    const header = new TextDecoder().decode(new Uint8Array(buffer, 0, 116));
    if (header.includes('7.3'))
      throw new Error('请在 MATLAB 使用 save(..., "-v7") 保存为 MAT v7；暂不支持 HDF5 / v7.3。');
    const marker = new TextDecoder().decode(new Uint8Array(buffer, 126, 2));
    if (!['IM', 'MI'].includes(marker))
      throw new Error('仅支持 MAT Level 5（MATLAB v6 / v7）的实数矩阵。');
    const little = marker === 'IM';
    const arrays = [];
    let expanded = 0;
    function elements(bytes) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const out = [];
      for (let pos = 0; pos + 8 <= bytes.length;) {
        const smallType = view.getUint16(pos, little);
        const smallSize = view.getUint16(pos + 2, little);
        const small = smallType > 0 && smallSize > 0 && smallSize <= 4;
        const type = small ? smallType : view.getUint32(pos, little);
        const size = small ? smallSize : view.getUint32(pos + 4, little);
        const start = pos + (small ? 4 : 8);
        if (!type || size > MAX_BYTES || start + size > bytes.length)
          throw new Error('MAT 数据长度无效。');
        out.push({ type, bytes: bytes.subarray(start, start + size) });
        pos += small ? 8 : 8 + (type === 15 ? size : Math.ceil(size / 8) * 8);
      }
      return out;
    }
    function numbers(element) {
      const methods = {
        1: ['getInt8', 1],
        2: ['getUint8', 1],
        3: ['getInt16', 2],
        4: ['getUint16', 2],
        5: ['getInt32', 4],
        6: ['getUint32', 4],
        7: ['getFloat32', 4],
        9: ['getFloat64', 8],
      };
      const spec = methods[element?.type];
      if (!spec || element.bytes.length % spec[1])
        throw new Error('MAT 波形必须为普通实数数值矩阵。');
      const view = new DataView(
        element.bytes.buffer,
        element.bytes.byteOffset,
        element.bytes.length,
      );
      return Array.from({ length: element.bytes.length / spec[1] }, (_, i) =>
        view[spec[0]](i * spec[1], little),
      );
    }
    async function scan(bytes, depth = 0) {
      if (depth > 1) throw new Error('MAT 压缩嵌套无效。');
      for (const el of elements(bytes)) {
        if (el.type === 15) {
          const stream = new Blob([el.bytes])
            .stream()
            .pipeThrough(new DecompressionStream('deflate'));
          const reader = stream.getReader();
          const chunks = [];
          let length = 0;
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              expanded += value.length;
              length += value.length;
              if (expanded > MAX_BYTES) throw new Error('MAT 解压数据超过 4 MB。');
              chunks.push(value);
            }
          } finally {
            await reader.cancel().catch(() => {});
          }
          const data = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
          }
          await scan(data, depth + 1);
        } else if (el.type === 14) {
          const parts = elements(el.bytes);
          if (parts.length < 4) continue;
          const flags = numbers(parts[0])[0];
          if (flags & 0x800 || (flags & 0xff) < 6 || (flags & 0xff) > 15) continue;
          const dims = numbers(parts[1]);
          if (dims.length !== 2 || dims.some((d) => d < 1) || dims[0] * dims[1] > 100000) continue;
          const name = new TextDecoder().decode(parts[2].bytes);
          const values = numbers(parts[3]);
          if (values.length !== dims[0] * dims[1]) throw new Error('MAT 数组大小不匹配。');
          arrays.push({
            name,
            rows: Array.from({ length: dims[0] }, (_, i) =>
              Array.from({ length: dims[1] }, (unused, j) => values[j * dims[0] + i]),
            ),
          });
        }
      }
    }
    await scan(new Uint8Array(buffer, 128));
    if (!arrays.length) throw new Error('MAT 中没有可用的二维实数矩阵。');
    return arrays;
  }
  function columns(arrays) {
    const out = [];
    for (const a of arrays) {
      if (a.rows.length === 1) out.push({ name: a.name, values: a.rows[0] });
      else
        for (let i = 0; i < a.rows[0].length; i += 1)
          out.push({
            name: a.labels?.[i] || `${a.name}${a.rows[0].length > 1 ? ` 第 ${i + 1} 列` : ''}`,
            values: a.rows.map((row) => row[i]),
          });
    }
    return out;
  }
  function pair(time, values) {
    if (time.length !== values.length || time.length < 2 || time.length > 4096)
      throw new Error('时间与波形列必须等长，包含 2–4096 个采样点。');
    const pairs = time.map((t, i) => [t, values[i]]);
    if (
      pairs.some(
        ([t, v], i) =>
          !Number.isFinite(t) || !Number.isFinite(v) || t < 0 || (i && t <= time[i - 1]),
      )
    )
      throw new Error('时间必须为非负、严格递增的秒数，波形值必须有限。');
    const text = JSON.stringify(pairs);
    if (text.length > 180000) throw new Error('波形数据超过 180 KB，请减少采样点。');
    return text;
  }
  const api = { textArrays, matArrays, columns, pair };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsWaveformImport = api;
})(globalThis);
