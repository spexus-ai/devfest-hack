import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

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

export async function recognizeReceipt(receipt, options = {}) {
  const { stdout } = await (options.run ?? run)('tesseract', [
    receipt.path, 'stdout', '-l', 'eng', '--psm', '6', 'tsv',
  ], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  const lines = parseTsv(stdout, receipt.id);
  if (!lines.length) throw new Error('Tesseract не нашёл читаемых строк.');
  return lines;
}
