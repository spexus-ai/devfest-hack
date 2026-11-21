const dates = /(?<![\d.])(?:(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|(\d{1,2})([-/.,])(\d{1,2})\5(\d{4}|\d{2}))(?!\d)/g;
const times = /(?<![\d:])(\d{1,2}):(\d{2})(?::[0-5]\d)?(?![:\d])(?:\s*([ap])\.?m\.?(?!\p{L}))?/giu;
const dateLabel = /\b(?:date|data)\b|дата|открыт/iu;
const timeLabel = /\b(?:time|hora|ora|horário)\b|время|открыт/iu;
const grandTotal = /(?:^|[^\p{L}])(?:grand total|amount due|total(?:\s+a\s+pagar)?|totale(?:\s+complessivo)?|valor (?:total|a pagar)|итог[о0]?(?:\s+к\s+оплате)?)\s*[:=]?\s*(?:[$€£₽]|USD\b|EUR\b|RUB\b)?\s*(\d+(?:[., \u00a0\u202f]\d{3})*[.,]\s?\d{2})(?!\d)/giu;
const totalHeading = /^[^\p{L}\d]*(?:grand total|amount due|total(?:\s+a\s+pagar)?|totale(?:\s+complessivo)?|valor (?:total|a pagar)|итог[о0]?(?:\s+к\s+оплате)?)\b[^\d]*$/iu;
const amountsIn = (text) => Array.from(text.matchAll(/\d+(?:[., \u00a0\u202f]\d{3})*[.,]\s?\d{2}(?!\d)/g), ([amount]) => Number(amount.replace(/\D/g, '')));

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export const validTime = (value) => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

function datesIn(text) {
  return Array.from(text.matchAll(dates)).flatMap(([, isoYear, isoMonth, isoDay, first, delimiter, second, year]) => {
    const iso = (y, m, d) => `${y.length === 2 ? '20' + y : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (isoYear) return [iso(isoYear, isoMonth, isoDay)].filter(validDate);
    return [...new Set([iso(year, second, first), ...(['/','-'].includes(delimiter) ? [iso(year, first, second)] : [])])].filter(validDate);
  });
}

function timesIn(text) {
  return Array.from(text.matchAll(times), ([, raw, minute, period]) => {
    const hour = Number(raw);
    if (period && (hour < 1 || hour > 12)) return null;
    return `${String(period ? hour % 12 + (period.toLowerCase() === 'p' ? 12 : 0) : hour).padStart(2, '0')}:${minute}`;
  }).filter(validTime);
}

function verifiedField(proposed, lines, values, label) {
  const evidence = lines.filter((line) => {
    const tokens = values(line.text);
    return tokens.length > 0 && (label(line.text) || (proposed?.value != null && proposed.lineIds.includes(line.id)));
  });
  const candidates = [...new Set(evidence.flatMap(({ text }) => values(text)))];
  if (candidates.length !== 1 || (proposed?.value != null && proposed.value !== candidates[0])) return { value: null, lineIds: [] };
  return { value: candidates[0], lineIds: evidence.map(({ id }) => id) };
}

export function verifiedReceiptFields(model, lines, groupTotalCents) {
  const date = verifiedField(model.date, lines, datesIn, (text) => dateLabel.test(text) || timesIn(text).length > 0);
  const time = verifiedField(model.time, lines, timesIn, (text) => timeLabel.test(text)
    || /:\d{2}\s*[ap]\.?m\b/iu.test(text) || datesIn(text).length > 0);
  const totals = lines.flatMap(({ id, text }) => Array.from(text.matchAll(grandTotal), ([, amount]) =>
    ({ id, cents: Number(amount.replace(/\D/g, '')) })));
  const fiscal = lines.find(({ fiscalTotalCents }) => fiscalTotalCents != null);
  if (!groupTotalCents && fiscal) return { date, time, total: { cents: fiscal.fiscalTotalCents, lineIds: [fiscal.id] } };
  if (!totals.length) {
    for (const [index, line] of lines.entries()) {
      const adjacent = lines[index + 1];
      if (!adjacent || !totalHeading.test(line.text)) continue;
      const values = amountsIn(adjacent.text);
      if (values.length === 1 && (model.total?.cents == null || (model.total.cents === values[0]
          && model.total.lineIds.some((id) => id === line.id || id === adjacent.id)))) {
        totals.push({ id: line.id, cents: values[0] }, { id: adjacent.id, cents: values[0] });
      }
    }
  }
  const amounts = [...new Set(totals.map(({ cents }) => cents))];
  const cents = groupTotalCents ?? (amounts.length === 1 ? amounts[0] : null);
  return { date, time, total: { cents, lineIds: totals.filter((total) => total.cents === cents).map(({ id }) => id) } };
}

// Time ranges are a rule of thumb for suggesting a meal type in the demo.
export function mealTypeAt(time) {
  if (!validTime(time)) return null;
  const hour = Number(time.slice(0, 2));
  if (hour < 5) return null;
  return hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : 'dinner';
}
