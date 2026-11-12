/** Preserve fine raster strokes when the sprig is displayed at icon scale. */
export function renderBotanicalInk(source: ImageData, width: number, height: number): ImageData {
  const { width: sw, height: sh, data } = source;
  const ink = new Float32Array(sw * sh);
  for (let i = 0; i < ink.length; i++) {
    const p = i * 4;
    ink[i] = Math.max(0, Math.min(1,
      2.94 - (0.6378 * data[p] + 2.1456 * data[p + 1] + 0.2166 * data[p + 2]) / 255,
    )) * data[p + 3] / 255;
  }

  // The source's ~3px lines become less than 0.3 CSS pixels at 96px wide.
  // Expand by ~0.28 CSS pixels per side before sampling, keeping curves connected.
  const radius = Math.max(1, Math.round(sw / 96 * 0.28));
  const horizontal = new Float32Array(ink.length);
  const expanded = new Float32Array(ink.length);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let value = 0;
      for (let dx = Math.max(0, x - radius); dx <= Math.min(sw - 1, x + radius); dx++) {
        value = Math.max(value, ink[y * sw + dx]);
      }
      horizontal[y * sw + x] = value;
    }
  }
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let value = 0;
      for (let dy = Math.max(0, y - radius); dy <= Math.min(sh - 1, y + radius); dy++) {
        value = Math.max(value, horizontal[dy * sw + x]);
      }
      expanded[y * sw + x] = value;
    }
  }

  // Average every covered source pixel; point sampling can turn thin curves
  // into alternating dots even with canvas imageSmoothingQuality set to high.
  const result = new ImageData(width, height);
  const sx = sw / width, sy = sh / height;
  for (let y = 0; y < height; y++) {
    const top = y * sy, bottom = (y + 1) * sy;
    for (let x = 0; x < width; x++) {
      const left = x * sx, right = (x + 1) * sx;
      let coverage = 0;
      for (let iy = Math.floor(top); iy < Math.min(sh, Math.ceil(bottom)); iy++) {
        const overlapY = Math.min(bottom, iy + 1) - Math.max(top, iy);
        for (let ix = Math.floor(left); ix < Math.min(sw, Math.ceil(right)); ix++) {
          const overlapX = Math.min(right, ix + 1) - Math.max(left, ix);
          coverage += expanded[iy * sw + ix] * overlapX * overlapY;
        }
      }
      const p = (y * width + x) * 4;
      result.data[p] = 146;
      result.data[p + 1] = 156;
      result.data[p + 2] = 221;
      // Balance the strengthened strokes with the upper illustration's ink.
      result.data[p + 3] = Math.round(255 * 0.65 * coverage / (sx * sy));
    }
  }
  return result;
}
