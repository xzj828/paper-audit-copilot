import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';

async function render() {
  const buffer = await readFile(workerData.file);
  if (createHash('sha256').update(buffer).digest('hex') !== workerData.sourceHash)
    throw new Error('原文件哈希不匹配，不能进行图像审查');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  const doc = await task.promise;
  const images = [];
  let bytes = 0;
  const selected =
    workerData.pages ||
    (workerData.regions.length
      ? [...new Set(workerData.regions.map((r) => r.page))]
      : Array.from({ length: doc.numPages }, (_, i) => i + 1));
  if (
    !selected.length ||
    selected.some((p) => !Number.isInteger(p) || p < 1 || p > doc.numPages) ||
    new Set(selected).size !== selected.length
  )
    throw new Error('图像页码无效');
  let renderedPages = 0;
  try {
    for (const p of selected) {
      const regions = workerData.regions.filter((r) => r.page === p);
      if (workerData.regions.length && !regions.length) continue;
      const page = await doc.getPage(p);
      const size = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(2, 1800 / Math.max(size.width, size.height)),
      });
      const add = (target, meta) => {
        const data = target.toBuffer('image/jpeg', 88);
        bytes += data.length;
        if (bytes > 12 * 1024 * 1024) throw new Error('图像请求超出12MB预算，请缩小论文后重试');
        images.push({
          ...meta,
          width: target.width,
          height: target.height,
          sha256: createHash('sha256').update(data).digest('hex'),
          url: `data:image/jpeg;base64,${data.toString('base64')}`,
        });
      };
      if (!workerData.regions.length) {
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        add(canvas, { id: `page-image-${p}`, page: p });
      }
      for (const region of regions) {
        const [x1, y1, x2, y2] = region.bbox;
        if (
          ![x1, y1, x2, y2].every((n) => Number.isFinite(n) && n >= 0 && n <= 1) ||
          x2 <= x1 ||
          y2 <= y1
        )
          throw new Error('图表裁剪坐标无效');
        const scale = Math.min(6, 1800 / Math.max((x2 - x1) * size.width, (y2 - y1) * size.height));
        const detail = page.getViewport({ scale });
        const crop = createCanvas(
          Math.max(1, Math.ceil((x2 - x1) * detail.width)),
          Math.max(1, Math.ceil((y2 - y1) * detail.height)),
        );
        await page.render({
          canvasContext: crop.getContext('2d'),
          viewport: detail,
          transform: [1, 0, 0, 1, -x1 * detail.width, -y1 * detail.height],
        }).promise;
        add(crop, region);
      }
      renderedPages++;
      page.cleanup();
    }
    return {
      images,
      pageCount: doc.numPages,
      renderedPages,
      pageNumbers: selected,
      complete: renderedPages === doc.numPages,
      bytes,
    };
  } finally {
    await task.destroy();
  }
}
render()
  .then((result) => parentPort.postMessage({ result }))
  .catch((error) => parentPort.postMessage({ error: error.message }));
