import { issue } from './reconcile.js';

const groups = ['meals', 'alcohol', 'excluded'];
const minChoice = 0.7;

function itemGroup(line, judgment) {
  const choice = judgment?.category;
  const category = line.category ?? choice?.value;
  if (!line.category && (choice?.probability ?? 0) < minChoice) return null;
  if (!line.category && judgment?.alcohol !== undefined
    && ((category === 'alcohol' && judgment.alcohol < 0.5)
      || (category === 'soft_drink' && judgment.alcohol > 0.75))) return null;
  if (category === 'food' || category === 'soft_drink') return 'meals';
  if (category === 'alcohol') return 'alcohol';
  if (category === 'other' || category === 'restricted_drink') return 'excluded';
  return null;
}

function allocation(line, judgment, receiptGroups) {
  if (line.allocation) {
    const values = groups.map((key) => line.allocation[key] ?? 0);
    if (values.every((value) => Number.isInteger(value) && (value === 0 || Math.sign(value) === Math.sign(line.cents)))
      && values.reduce((total, value) => total + value, 0) === line.cents) return line.allocation;
    return null;
  }
  const { value, probability } = judgment?.allocation ?? {};
  if (probability >= minChoice && groups.includes(value) && receiptGroups.has(value)) return { [value]: line.cents };
  if (receiptGroups.size === 1) return { [[...receiptGroups][0]]: line.cents };
  return null;
}

export function calculateExpense({ policy, context, receipts, judgments }) {
  const sums = { meals: 0, alcohol: 0, excluded: 0 };
  const questions = [];
  const findings = [];
  const items = [];

  for (const receipt of receipts) {
    const receiptGroups = new Set();
    const { receiptId } = receipt;
    const itemLines = receipt.lines.filter((line) => line.kind === 'item');
    for (const line of itemLines) {
      const group = itemGroup(line, judgments.byLine[line.id]);
      if (!group) {
        questions.push(issue('CATEGORY_UNCLEAR', 'Уточните, что это за позиция: ' + line.description,
          { receiptId, lineId: line.id, lineIds: line.lineIds, field: 'category' }));
        continue;
      }
      sums[group] += line.cents;
      receiptGroups.add(group);
      const reason = group === 'excluded' ? 'OUTSIDE_MEAL_POLICY'
        : group === 'alcohol' && ['sponsored', 'federal'].includes(context.funding)
          ? 'ALCOHOL_FUNDING_RESTRICTION' : null;
      items.push({ receiptId, id: line.id, description: line.description, cents: line.cents,
        lineIds: line.lineIds, group, reason, excluded: Boolean(reason) });
    }
    for (const line of receipt.lines.filter((entry) => entry.kind !== 'item')) {
      if (line.cents === 0) continue;
      if (itemLines.length !== receipt.lines.filter((entry) => entry.kind === 'item'
        && itemGroup(entry, judgments.byLine[entry.id])).length) continue;
      const portions = allocation(line, judgments.byLine[line.id], receiptGroups);
      if (!portions) {
        questions.push(issue('SHARED_CHARGE_UNCLEAR', 'Укажите, к каким расходам относится сбор или скидка: ' + line.description,
          { receiptId, lineId: line.id, lineIds: line.lineIds, field: 'allocation', amount: line.cents }));
        continue;
      }
      for (const group of groups) sums[group] += portions[group] ?? 0;
      items.push({ receiptId, id: line.id, description: line.description, cents: line.cents,
        lineIds: line.lineIds, allocation: portions, group: Object.keys(portions).join(', ') });
    }
  }

  const excludedAlcohol = ['sponsored', 'federal'].includes(context.funding);
  const meal = Math.max(0, sums.meals);
  const alcohol = excludedAlcohol ? 0 : Math.max(0, sums.alcohol);
  const mealLimit = (policy.limits[context.type] ?? 0) * context.attendees;
  const alcoholLimit = policy.limits.alcohol * context.attendees;
  const ordinary = Math.min(meal, mealLimit) + Math.min(alcohol, alcoholLimit);
  const excessMealCents = Math.max(0, meal - mealLimit);
  const excessAlcoholCents = Math.max(0, alcohol - alcoholLimit);
  const total = meal + alcohol;
  const requestedCents = Math.max(0, total - context.priorReimbursementCents);
  const standardCents = Math.min(ordinary, requestedCents);
  const excessCents = requestedCents - standardCents;
  if (!questions.length) {
    if (excessMealCents) findings.push(issue('MEAL_LIMIT_EXCEEDED', 'Превышен лимит питания.'));
    if (excessAlcoholCents) findings.push(issue('ALCOHOL_LIMIT_EXCEEDED', 'Превышен отдельный лимит алкоголя.'));
    if (excludedAlcohol && sums.alcohol > 0) findings.push(issue('ALCOHOL_FUNDING_RESTRICTION',
      'Алкоголь и относимые суммы исключены из федерального или спонсорского возмещения.', { informational: true }));
    if (context.funding === 'general' && sums.alcohol > 0) findings.push(issue('FUNDING_SOURCE_REVIEW_REQUIRED',
      'Для алкоголя нужно подтвердить допустимый источник финансирования.'));
  }
  return {
    questions, findings, items, mealCents: sums.meals, alcoholCents: sums.alcohol,
    excludedCents: sums.excluded + (excludedAlcohol ? sums.alcohol : 0),
    mealLimit, alcoholLimit, standardCents, excessCents, excessMealCents, excessAlcoholCents, requestedCents,
    receiptTotalCents: receipts.reduce((total, receipt) => total + (receipt.total?.cents ?? 0), 0),
  };
}
