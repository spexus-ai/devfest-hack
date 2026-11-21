import { issue } from './reconcile.js';
import { supportedCurrency } from './currency.js';

const fiscal = /кассов[ыь][йи]\s+ч[её]к|\bfiscal receipt\b/iu;
const bill = /гостев[о0][йи]\s+сч[её]т|\bguest (?:check|bill)\b/iu;
const payment = /терминал\s*[:№]|\bterminal\s*(?:id|[:#])|\bcardholder copy\b/iu;
const currencyCodes = /\b(USD|RUB|EUR|GBP|JPY|CNY|CAD|AUD|CHF|INR)\b/gi;
const totalLabel = /^[^\p{L}\d]*(?:(?:итог[о0]?|всего)(?=\s|:|=|$)|(?:(?:grand|amount)\s+)?totale?\b|сумма(?=\s*:)|amount(?=\s*:))/iu;
const printedTotal = /(?:^|[^\p{L}])(?:итог[о0]?(?:\s+к\s+оплате)?|totale(?:\s+complessivo)?|total)\s*[:=]?\s*[$€£]?\s*(\d+(?:[., \u00a0\u202f]\d{3})*[.,]\s?\d{2})(?!\d)/giu;
const money = /\d+(?:[., \u00a0\u202f]\d{3})*[.,]\s?\d{2}(?!\d)/g;

function printedDate(text) {
  const value = text.match(/(?:^|\D)(\d{1,2})[./,](\d{1,2})[./,](\d{4}|\d{2})(?!\d)/);
  if (!value) return null;
  const [, day, month, year] = value;
  const date = `${year.length === 2 ? '20' + year : year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : null;
}

function currencyIn(text) {
  const monetaryLines = text.split('\n').filter((line) => /\d[.,]\s?\d{2}\b|currency\s*:|валюта\s*:|[€₽]\s*\d|\d\s*[€₽]/iu.test(line)).join('\n');
  return [...new Set([
    ...Array.from(monetaryLines.matchAll(currencyCodes), ([, currency]) => currency.toUpperCase()),
    ...(/₽|\d\s*руб(?:\.|\s|$)/iu.test(monetaryLines) ? ['RUB'] : []),
    ...(monetaryLines.includes('€') ? ['EUR'] : []), ...(monetaryLines.includes('£') ? ['GBP'] : []),
  ])];
}

function hasSeveralDocuments(lines) {
  const titles = lines.reduce((count, { text }) => count + Number(fiscal.test(text)) + Number(bill.test(text)), 0);
  const totals = new Set(lines.flatMap(({ text }) => Array.from(text.matchAll(printedTotal), ([, value]) => value.replace(/\D/g, ''))));
  return titles > 1 || totals.size > 1 || (titles === 1 && lines.some(({ text }) => payment.test(text)));
}

function summarize(lines) {
  const text = lines.map((line) => line.text).join('\n');
  const type = fiscal.test(text) ? 'fiscal' : bill.test(text) ? 'itemized_bill' : payment.test(text) ? 'payment' : 'receipt';
  const regionalDate = text.split('\n').filter((line) => /дат[аы]|открыт|\bdate\b/iu.test(line)).join('\n');
  const date = printedDate(regionalDate) ?? (type === 'receipt' ? null : printedDate(text));
  const orderId = text.match(/(?:заказ|\border)\s*(?:№|#|no\.?|:)?\s*(\d{2,})/iu)?.[1] ?? null;
  const totals = lines.filter(({ text }) => totalLabel.test(text)
    || (type === 'payment' && currencyIn(text).length && !text.includes('%')));
  const values = new Set(totals.flatMap(({ text }) => Array.from(text.matchAll(money), ([value]) => {
    const digits = value.replace(/\D/g, '');
    return Number(digits);
  })));
  const currency = currencyIn(text);
  const { id, left, top, width, height } = lines[0].region ?? {};
  return { id, box: id ? { left, top, width, height } : null, type, date, orderId,
    currency: currency.length === 1 ? currency[0] : null, totalCents: values.size === 1 ? [...values][0] : null };
}

export function inspectReceiptPhoto(lines, receiptId) {
  const regions = new Map();
  for (const line of lines) {
    const id = line.region?.id ?? receiptId;
    if (!regions.has(id)) regions.set(id, []);
    regions.get(id).push(line);
  }
  const documents = [...regions.values()].map(summarize);
  const distinct = (field) => [...new Set(documents.map((document) => document[field]).filter((value) => value !== null))];
  const currencies = currencyIn(lines.map(({ text }) => text).join('\n'));
  const unsupported = currencies.filter((currency) => !supportedCurrency(currency));
  const issues = [];
  let primary = documents[0];
  const multiple = documents.length > 1;
  const uncertain = lines.some(({ region }) => region?.ambiguous) || [...regions.values()].some(hasSeveralDocuments);
  if (multiple) {
    const itemized = documents.find(({ type }) => type === 'itemized_bill');
    const receipt = documents.find(({ type }) => type === 'fiscal');
    const card = documents.find(({ type }) => type === 'payment');
    const uniqueRoles = new Set(documents.map(({ type }) => type)).size === documents.length;
    const matchingOrder = !receipt || !itemized || (receipt.orderId && receipt.orderId === itemized.orderId);
    const matchingPayment = !card || (card.date && card.totalCents !== null && [receipt, itemized].some((document) =>
      document?.date === card.date && document.totalCents === card.totalCents));
    const compatible = distinct('date').length <= 1 && distinct('totalCents').length <= 1 && currencies.length <= 1;
    const itemSource = receipt?.totalCents != null ? receipt : itemized ?? receipt;
    const matched = uniqueRoles && itemSource && !documents.some(({ type }) => type === 'receipt')
      && matchingOrder && matchingPayment && compatible;
    primary = matched ? itemSource : null;
  }
  if (uncertain || !primary) {
    issues.push(issue('DOCUMENTS_UNMATCHED', 'На фото несколько документов, и их связь не подтверждена. Загрузите снимки отдельных покупок. Для каждой используйте один детализированный чек.', { receiptId }));
  } else if (primary.type === 'payment') {
    issues.push(issue('ITEMIZED_DOCUMENT_MISSING', 'Терминальный слип подтверждает оплату. Загрузите детализированный чек с позициями.', { receiptId }));
  }
  if (unsupported.length) {
    issues.push(issue('CURRENCY_UNSUPPORTED', `Для валюты ${unsupported.join(', ')} отсутствует курс. Передайте этот расход на ручную проверку.`, { receiptId }));
  } else if (currencies.length > 1) {
    issues.push(issue('CURRENCY_AMBIGUOUS', 'В документе найдены суммы в нескольких валютах. Требуется сверка валюты покупки.', { receiptId }));
  }
  return {
    lines: primary && multiple ? regions.get(primary.id) : lines,
    documents, primaryDocumentId: uncertain ? null : primary?.id ?? null,
    groupTotalCents: multiple && !uncertain && primary && distinct('totalCents').length === 1 ? distinct('totalCents')[0] : null,
    currency: currencies.length === 1 ? currencies[0] : null,
    date: distinct('date').length === 1 ? distinct('date')[0] : null,
    issues,
  };
}
