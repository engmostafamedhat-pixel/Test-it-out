// Client-side image processing: correct orientation, downscale, and burn an
// evidence stamp (timestamp, site, GPS) into the image. A 12 MP phone photo
// (~4-8 MB) becomes ~300-600 KB, which is what makes uploads viable on 3G/4G.

const MAX_EDGE = 1920;
const QUALITY = 0.82;
const THUMB_EDGE = 320;

async function decode(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall through to <img> decode */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = QUALITY) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed'))), type, quality),
  );
}

function drawStamp(ctx, w, h, lines) {
  const size = Math.max(14, Math.round(w / 55));
  ctx.font = `600 ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  const pad = Math.round(size * 0.6);
  const lineH = Math.round(size * 1.3);
  const boxH = pad * 2 + lineH * lines.length;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, h - boxH, w, boxH);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, pad, h - boxH + pad + i * lineH, w - pad * 2));
}

/**
 * @param {File} file
 * @param {{stamp?: string[]}} opts
 * @returns {Promise<{blob: Blob, thumb: Blob, width: number, height: number}>}
 */
export async function processPhoto(file, { stamp } = {}) {
  const src = await decode(file);
  const sw = src.width;
  const sh = src.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(src, 0, 0, w, h);
  if (stamp?.length) drawStamp(ctx, w, h, stamp);
  const blob = await canvasToBlob(canvas);

  const ts = Math.min(1, THUMB_EDGE / Math.max(w, h));
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = Math.round(w * ts);
  thumbCanvas.height = Math.round(h * ts);
  thumbCanvas.getContext('2d').drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  const thumb = await canvasToBlob(thumbCanvas, 'image/jpeg', 0.7);

  if (src.close) src.close();
  return { blob, thumb, width: w, height: h };
}
