import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

export const checksum = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(pngSignature)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  return null;
}

export async function saveReceipts(dataDir, sessionId, uploads) {
  const directory = join(dataDir, 'receipts', sessionId);
  const receipts = uploads.map((upload) => {
    const mime = imageMime(upload.buffer);
    if (!mime) throw Object.assign(new Error('Attach a JPEG or PNG image.'), { status: 400 });
    const id = randomUUID();
    return {
      id,
      filename: basename(upload.originalname).replace(/[\x00-\x1F\x7F]/g, '_').slice(0, 160) || 'receipt',
      path: join(directory, id + (mime === 'image/png' ? '.png' : '.jpg')),
      mime,
      sha256: checksum(upload.buffer),
      bytes: upload.buffer.length,
    };
  });

  await mkdir(directory, { recursive: true });
  try {
    for (const [index, receipt] of receipts.entries()) {
      await writeFile(receipt.path, uploads[index].buffer, { flag: 'wx' });
    }
    return receipts;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export function publicReceipt(sessionId, receipt) {
  const { id, filename, mime, sha256, bytes } = receipt;
  return { id, filename, mime, sha256, bytes, url: `/api/sessions/` + sessionId + '/receipts/' + id };
}
