import { Worker } from 'node:worker_threads';

// Rendering runs off the request thread, with bounded memory, pages and deadline.
export function renderVisuals(file, sourceHash, signal, regions = [], pages) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('图像渲染已取消'));
    const worker = new Worker(new URL('./visual-worker.js', import.meta.url), {
      workerData: { file, sourceHash, regions, pages },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    let done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(new Error('图像渲染已取消'));
    const timer = setTimeout(() => finish(new Error('图像渲染超时，可重试')), 120000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', (data) => finish(data.error ? new Error(data.error) : null, data.result));
    worker.on('error', (error) => finish(error));
    worker.on('exit', () => {
      if (!done) finish(new Error('图像渲染中断，可重试'));
    });
  });
}

export function visualMessage(data, images) {
  return [
    { type: 'text', text: JSON.stringify(data) },
    ...images.flatMap((image) => [
      {
        type: 'text',
        text: `图像 ${image.id}，源文件第 ${image.page} 页${image.label ? '，' + image.label : ''}。`,
      },
      { type: 'image_url', image_url: { url: image.url, detail: 'high' } },
    ]),
  ];
}

export function validateRegions(raw, rendered) {
  if (
    !raw ||
    !Array.isArray(raw.regions) ||
    raw.regions.length > 40 ||
    typeof raw.readable !== 'boolean'
  )
    throw new Error('模型图表定位格式无效，可重试');
  return raw.regions.map((r, i) => {
    if (
      !r ||
      !rendered.images.some((p) => p.page === r.page) ||
      !['figure', 'table'].includes(r.kind) ||
      typeof r.label !== 'string' ||
      !r.label.trim() ||
      r.label.length > 120 ||
      !Array.isArray(r.bbox) ||
      r.bbox.length !== 4 ||
      !r.bbox.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1) ||
      r.bbox[2] <= r.bbox[0] ||
      r.bbox[3] <= r.bbox[1]
    )
      throw new Error('模型图表坐标无效，可重试');
    return {
      id: `visual-${i + 1}`,
      page: r.page,
      kind: r.kind,
      label: r.label.trim(),
      bbox: r.bbox,
      quality: 'model-located',
    };
  });
}
