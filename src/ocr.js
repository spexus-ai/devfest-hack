import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { verifiedReceiptFields } from './receipt-fields.js';
import { fiscalReceiptLines } from './fiscal-receipt.js';

const run = promisify(execFile);
const prepare = fileURLToPath(new URL('../scripts/prepare-receipt.py', import.meta.url));
const languages = 'eng+rus+ita+por';
const tesseractOptions = { timeout: 18000, maxBuffer: 4 * 1024 * 1024 };

export function parseTsv(tsv, receiptId) {
  const lines = new Map();
  for (const row of tsv.split(/\r?\n/).slice(1)) {
    const cells = row.split('\t');
    if (cells[0] !== '5' || !cells[11]?.trim()) continue;
    const key = cells.slice(1, 5).join(':');
    const [left, top, width, height, confidence] = cells.slice(6, 11).map(Number);
    const word = { text: cells.slice(11).join(' ').trim(), left, top, width, height, confidence };
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(word);
  }
  return Array.from(lines.values(), (words, index) => {
    const left = Math.min(...words.map((word) => word.left));
    const top = Math.min(...words.map((word) => word.top));
    const right = Math.max(...words.map((word) => word.left + word.width));
    const bottom = Math.max(...words.map((word) => word.top + word.height));
    return {
      id: receiptId + '-L' + (index + 1), text: words.map((word) => word.text).join(' '),
      box: { left, top, width: right - left, height: bottom - top },
      confidence: words.reduce((total, word) => total + word.confidence, 0) / words.length,
      words,
    };
  });
}

function projectBox(box, candidate, region) {
  const radians = candidate.angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners = [box.left, box.left + box.width].flatMap((x) => [box.top, box.top + box.height].map((y) => {
    const dx = x / candidate.scale + candidate.x - candidate.width / 2;
    const dy = y / candidate.scale + candidate.y - candidate.height / 2;
    return [dx * cos - dy * sin + region.width / 2, dx * sin + dy * cos + region.height / 2];
  }));
  const left = Math.max(0, Math.floor(Math.min(...corners.map(([x]) => x))));
  const top = Math.max(0, Math.floor(Math.min(...corners.map(([, y]) => y))));
  const right = Math.min(region.width, Math.ceil(Math.max(...corners.map(([x]) => x))));
  const bottom = Math.min(region.height, Math.ceil(Math.max(...corners.map(([, y]) => y))));
  Object.assign(box, { left: region.left + left, top: region.top + top,
    width: Math.max(0, right - left), height: Math.max(0, bottom - top) });
}

async function readFiscalColumns(execute, directory, candidate, receiptId) {
  // A Russian fiscal receipt can print the item name and unit price × quantity on separate columns.
  try {
    const { stdout: left } = await execute('python3', [prepare, '--fiscal-columns',
      join(directory, candidate.filename), directory], { timeout: 12000 });
    const [names, prices] = await Promise.all([
      execute('tesseract', [join(directory, 'fiscal-labels.png'), 'stdout', '-l', 'rus+eng', '--psm', '11', 'tsv'], tesseractOptions),
      execute('tesseract', [join(directory, 'fiscal-amounts.png'), 'stdout', '-l', 'eng', '--psm', '6',
        '-c', 'tessedit_char_whitelist=0123456789.,=xX*+-', 'tsv'], tesseractOptions),
    ]);
    const byRow = (a, b) => a.box.top - b.box.top;
    const labels = parseTsv(names.stdout, receiptId).sort(byRow);
    const amounts = parseTsv(prices.stdout, receiptId).sort(byRow);
    for (const row of amounts) for (const box of [row.box, ...row.words]) box.left += Number(left);
    return fiscalReceiptLines(labels, amounts, receiptId);
  } catch {
    return [];
  }
}

export async function recognizeReceipt(receipt, options = {}) {
  const execute = options.run ?? run;
  const temporary = await mkdtemp(join(tmpdir(), 'receipt-ocr-'));
  try {
    const { stdout: layout } = await execute('python3', [prepare, receipt.path, temporary], { timeout: 12000 });
    const { regions, candidates, ambiguous } = JSON.parse(layout);
    const lines = [];
    for (const [index, [left, top, right, bottom]] of regions.entries()) {
      const regionId = receipt.id + '-D' + (index + 1);
      let evidence = [];
      let selected;
      let best = -1;
      for (const candidate of candidates[index]) {
        const { stdout } = await execute('tesseract', [
          join(temporary, candidate.filename), 'stdout', '-l', languages, '--psm', '6', 'tsv',
        ], tesseractOptions);
        const rows = parseTsv(stdout, regions.length === 1 ? receipt.id : regionId);
        if (!rows.length) continue;
        const fields = verifiedReceiptFields({}, rows);
        const score = 2 * Number(fields.total.cents != null) + Number(fields.date.value != null) + Number(fields.time.value != null);
        if (score <= best) continue;
        evidence = rows;
        selected = candidate;
        best = score;
        if (best === 4) break;
      }
      if (!evidence.length) throw new Error('На фотографии есть нечитаемая область. Загрузите более чёткий снимок.');
      if (regions.length === 1 && !selected.angle && evidence.some(({ text }) => /кассов[ыь][йи]\s+ч[её]к/iu.test(text))) {
        evidence.push(...await readFiscalColumns(execute, temporary, selected, receipt.id));
      }
      const region = { id: regionId, left, top, width: right - left, height: bottom - top, ambiguous };
      for (const line of evidence) {
        line.region = region;
        for (const box of [line.box, ...line.words]) projectBox(box, selected, region);
        lines.push(line);
      }
    }
    return lines;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
