import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function loadPolicy(path) {
  const content = readFileSync(path, 'utf8');
  const id = content.match(/^policy_id:\s*([A-Z0-9-]+)\s*$/m)?.[1];
  const currency = content.match(/^currency:\s*([A-Z]{3})\s*$/m)?.[1];
  const effectiveDate = content.match(/^source_last_updated:\s*(\d{4}-\d{2}-\d{2})\s*$/m)?.[1];
  const limits = {};
  for (const [, name, amount] of content.matchAll(/^\|\s*(Breakfast|Lunch|Dinner|Alcohol)\s*\|\s*(\d+)\s*\|/gm)) {
    limits[name.toLowerCase()] = Number(amount) * 100;
  }
  if (!id || currency !== 'USD' || !effectiveDate || Object.keys(limits).length !== 4) {
    throw new Error('The active policy lacks ID, currency, effective date or required limits.');
  }
  return {
    id, currency, effectiveDate, limits, content,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}
