import { issue } from './reconcile.js';

export const mealTypes = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', other: 'Другое' };
export const fundingTypes = {
  sponsored: 'Спонсорские средства', federal: 'Федеральные средства', discretionary: 'Дискреционные средства',
  general: 'Общие средства', unknown: 'Неизвестно',
};
export const eventFields = [
  { field: 'type', text: 'Какой это был тип делового мероприятия?', options: mealTypes },
  { field: 'date', text: 'Когда состоялось мероприятие?', input: 'date' },
  { field: 'time', text: 'Во сколько состоялось мероприятие? Время не удалось подтвердить по чеку.', input: 'time' },
  { field: 'attendees', text: 'Сколько человек участвовало?', input: 'integer' },
  { field: 'purpose', text: 'Какова конкретная деловая цель мероприятия?', input: 'text' },
  { field: 'funding', text: 'Из какого источника запрашивается возмещение?', options: fundingTypes },
  { field: 'paidByClaimant', text: 'Вы лично оплатили расходы?', options: { yes: 'Да', no: 'Нет' } },
];

function day(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return Number.NaN;
  const result = Date.parse(date + 'T00:00:00.000Z');
  return Number.isFinite(result) && new Date(result).toISOString().slice(0, 10) === date ? result : Number.NaN;
}

export function policyFindings({ policy, context, receipts, calculation, now = new Date() }) {
  const findings = [];
  const elapsed = (day(now.toISOString().slice(0, 10)) - day(context.date)) / 86400000;
  if (!Number.isFinite(elapsed) || elapsed < 0 || context.date < policy.effectiveDate) {
    findings.push(issue('EVENT_DATE_REVIEW_REQUIRED', 'Дата мероприятия требует проверки применимости политики.'));
  } else if (elapsed > 60) {
    findings.push(issue('SUBMISSION_OR_APPROVAL_AFTER_60_DAYS', 'С даты мероприятия прошло больше 60 дней.'));
  }
  if (!Object.hasOwn(policy.limits, context.type) || context.type === 'alcohol') {
    findings.push(issue('EVENT_TYPE_REVIEW_REQUIRED', 'Для этого типа мероприятия нужна отдельная проверка.'));
  }
  if (context.paidByClaimant !== 'yes') {
    findings.push(issue('CLAIMANT_NOT_PAYER', 'Заявитель не подтвердил оплату расходов собой.'));
  }
  if (context.funding === 'unknown') {
    findings.push(issue('FUNDING_SOURCE_REVIEW_REQUIRED', 'Источник возмещения пока не подтверждён.'));
  }
  if (context.priorReimbursementCents > 0) {
    findings.push(issue('DUPLICATE_OR_THIRD_PARTY_REIMBURSEMENT',
      'Проверьте подтверждение выплаченной суммы и остаток к возмещению.'));
  }
  for (const receipt of receipts) {
    if (receipt.itemized) continue;
    const conversion = calculation.conversions?.find(({ receiptId }) => receiptId === receipt.receiptId);
    if ((conversion?.usdCents ?? receipt.total?.cents) >= 7500) {
      findings.push(issue('RECEIPT_NOT_ITEMIZED', 'Для этой суммы нужен детализированный чек.',
        { receiptId: receipt.receiptId }));
    }
    if (receipt.sourceLines?.some(({ text }) => /\b(?:alcohol|wine|beer|liquor)\b/i.test(text))) {
      findings.push(issue('ICRX_REVIEW_REQUIRED', 'Весь недетализированный чек с алкоголем требует проверки ICRX.',
        { receiptId: receipt.receiptId }));
    }
    if (!calculation.items.some(({ receiptId }) => receiptId === receipt.receiptId)) {
      findings.push(issue('RECEIPT_CONTENT_REVIEW_REQUIRED', 'Не удалось установить состав чека.',
        { receiptId: receipt.receiptId }));
    }
  }
  return findings;
}
