import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const prepare = fileURLToPath(new URL('../scripts/prepare-receipt.py', import.meta.url));
const languages = 'eng+rus+ita+por';
const tesseractOptions = {
  timeout: 18000, maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, OMP_THREAD_LIMIT: process.env.OMP_THREAD_LIMIT ?? '1' },
};

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

function projectBox(box, layout) {
  const radians = layout.angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners = [box.left, box.left + box.width].flatMap((x) => [box.top, box.top + box.height].map((y) => {
    const dx = x / layout.scale - layout.ocrWidth / 2;
    const dy = y / layout.scale - layout.ocrHeight / 2;
    return [dx * cos - dy * sin + layout.width / 2, dx * sin + dy * cos + layout.height / 2];
  }));
  const left = Math.max(0, Math.floor(Math.min(...corners.map(([x]) => x))));
  const top = Math.max(0, Math.floor(Math.min(...corners.map(([, y]) => y))));
  const right = Math.min(layout.width, Math.ceil(Math.max(...corners.map(([x]) => x))));
  const bottom = Math.min(layout.height, Math.ceil(Math.max(...corners.map(([, y]) => y))));
  Object.assign(box, { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) });
}

export async function recognizeReceipt(receipt, options = {}) {
  const execute = options.run ?? run;
  const temporary = await mkdtemp(join(tmpdir(), 'receipt-ocr-'));
  try {
    const prepared = join(temporary, 'receipt.png');
    const { stdout: metadata } = await execute('python3', [prepare, receipt.path, prepared], { timeout: 12000 });
    const layout = JSON.parse(metadata);
    const { stdout } = await execute('tesseract', [prepared, 'stdout', '-l', languages, '--psm', '6', 'tsv'], tesseractOptions);
    const lines = parseTsv(stdout, receipt.id);
    for (const line of lines) for (const box of [line.box, ...line.words]) projectBox(box, layout);
    return lines;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
