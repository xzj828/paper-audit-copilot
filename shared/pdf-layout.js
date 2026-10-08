export const PDF_LAYOUT_VERSION = 'pdf-parallel-regions@1';
export const pdfLayoutLabels = {
  parallel_regions: '并列文字区需核对',
  interleaved_regions: '多次跨区抽取需核对',
  not_detected: '未触发布局阈值',
  unavailable: '坐标不足，无法检查布局',
  no_text: '无文字可检查布局',
};
const fields = [
  'eligibleTextItems',
  'leftTextItems',
  'rightTextItems',
  'leftRows',
  'rightRows',
  'pairedRows',
  'crossRegionTransitions',
];
const special = (status, value) => ({
  version: PDF_LAYOUT_VERSION,
  status,
  ...Object.fromEntries(fields.map((f) => [f, value])),
});
const integer = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 50000;

function rowCenters(items) {
  const centers = items.map((i) => (i.bbox[1] + i.bbox[3]) / 2).sort((a, b) => a - b);
  const rows = [];
  for (const y of centers) if (!rows.length || y - rows.at(-1) > 0.012) rows.push(y);
  return rows;
}

// Conservative horizontal geometry only. Parallel prose, lists and tables can
// all trigger this hint; no text is reordered and no semantic structure inferred.
export function inspectPdfLayout(page, coordinateStatus) {
  if (coordinateStatus === 'no_text') return special('no_text', 0);
  if (coordinateStatus !== 'available' || !Array.isArray(page.items))
    return special('unavailable', null);
  const eligible = page.items.filter((i) => {
    const b = i?.bbox;
    return (
      typeof i?.text === 'string' &&
      i.text.replace(/\s/gu, '').length >= 12 &&
      Array.isArray(b) &&
      b.length === 4 &&
      b.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) &&
      b[2] - b[0] >= 0.1 &&
      b[2] - b[0] <= 0.43 &&
      b[3] - b[1] > 0 &&
      b[3] - b[1] <= 0.035 &&
      b[1] >= 0.08 &&
      b[3] <= 0.92
    );
  });
  const side = (i) => (i.bbox[2] <= 0.49 ? 'left' : i.bbox[0] >= 0.51 ? 'right' : null);
  const left = eligible.filter((i) => side(i) === 'left');
  const right = eligible.filter((i) => side(i) === 'right');
  const leftRows = rowCenters(left);
  const rightRows = rowCenters(right);
  let pairedRows = 0;
  let a = 0;
  let b = 0;
  while (a < leftRows.length && b < rightRows.length) {
    const delta = leftRows[a] - rightRows[b];
    if (Math.abs(delta) <= 0.012) {
      pairedRows++;
      a++;
      b++;
    } else if (delta < 0) a++;
    else b++;
  }
  let previous = null;
  let crossRegionTransitions = 0;
  for (const i of eligible) {
    const current = side(i);
    if (!current) continue;
    if (previous && previous !== current) crossRegionTransitions++;
    previous = current;
  }
  const parallel =
    leftRows.length >= 4 &&
    rightRows.length >= 4 &&
    pairedRows >= 3 &&
    leftRows.at(-1) - leftRows[0] >= 0.08 &&
    rightRows.at(-1) - rightRows[0] >= 0.08;
  return {
    version: PDF_LAYOUT_VERSION,
    status: parallel
      ? crossRegionTransitions >= 3
        ? 'interleaved_regions'
        : 'parallel_regions'
      : 'not_detected',
    eligibleTextItems: eligible.length,
    leftTextItems: left.length,
    rightTextItems: right.length,
    leftRows: leftRows.length,
    rightRows: rightRows.length,
    pairedRows,
    crossRegionTransitions,
  };
}

export function pdfLayoutSnapshot(value, coordinateStatus, mappedTextItems) {
  if (
    value?.version !== PDF_LAYOUT_VERSION ||
    typeof value.status !== 'string' ||
    !Object.hasOwn(pdfLayoutLabels, value.status)
  )
    return null;
  if (value.status === 'unavailable') {
    if (
      ['available', 'no_text'].includes(coordinateStatus) ||
      fields.some((f) => value[f] !== null)
    )
      return null;
    return special('unavailable', null);
  }
  if (value.status === 'no_text') {
    if (coordinateStatus !== 'no_text' || fields.some((f) => value[f] !== 0)) return null;
    return special('no_text', 0);
  }
  if (
    coordinateStatus !== 'available' ||
    !integer(mappedTextItems) ||
    fields.some((f) => !integer(value[f])) ||
    value.eligibleTextItems > mappedTextItems ||
    value.leftTextItems + value.rightTextItems > value.eligibleTextItems ||
    value.leftRows > value.leftTextItems ||
    value.rightRows > value.rightTextItems ||
    value.pairedRows > Math.min(value.leftRows, value.rightRows) ||
    value.crossRegionTransitions > Math.max(0, value.leftTextItems + value.rightTextItems - 1)
  )
    return null;
  if (
    ['parallel_regions', 'interleaved_regions'].includes(value.status) &&
    (value.leftRows < 4 || value.rightRows < 4 || value.pairedRows < 3)
  )
    return null;
  if (
    (value.status === 'interleaved_regions' && value.crossRegionTransitions < 3) ||
    (value.status === 'parallel_regions' && value.crossRegionTransitions >= 3)
  )
    return null;
  return {
    version: PDF_LAYOUT_VERSION,
    status: value.status,
    ...Object.fromEntries(fields.map((f) => [f, value[f]])),
  };
}
