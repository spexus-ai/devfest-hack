import { issue } from './reconcile.js';
import { convertAmounts, fixedExchangeRates, receiptConversion } from './currency.js';

const groups = ['meals', 'alcohol', 'excluded'];
const minChoice = 0.7;

function itemGroup(line, judgment) {
  const choice = judgment?.category;
  const category = line.category ?? choice?.value;
  if (!line.category && (choice?.probability ?? 0) < minChoice) return null;
  if (!line.category && judgment?.alcohol !== undefined
    && ((category === 'alcohol' && judgment.alcohol < minChoice)
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

export function calculateExpense({ policy, context, receipts, judgments, exchangeRates = fixedExchangeRates }) {
  const sums = { meals: 0, alcohol: 0, excluded: 0 };
  const questions = [];
  const findings = [];
  const items = [];
  const conversions = [];
  let receiptTotalCents = 0;

  for (const receipt of receipts) {
    const receiptGroups = new Set();
    const { receiptId } = receipt;
    const currency = receipt.currency?.value ?? 'USD';
    const conversion = receiptConversion(receipt, exchangeRates);
    if (currency !== 'USD' && !conversion) throw new Error('Could not convert the receipt amount in ' + currency + '.');
    const rate = conversion?.rate;
    receiptTotalCents += conversion?.usdCents ?? receipt.total?.cents ?? 0;
    if (conversion) conversions.push(conversion);
    const receiptItems = [];
    const itemLines = receipt.lines.filter((line) => line.kind === 'item');
    for (const line of itemLines) {
      const group = itemGroup(line, judgments.byLine[line.id]);
      if (!group) {
        questions.push(issue('CATEGORY_UNCLEAR', 'Identify the category for this item: ' + line.description,
          { receiptId, lineId: line.id, lineIds: line.lineIds, field: 'category' }));
        continue;
      }
      receiptGroups.add(group);
      const reason = group === 'excluded' ? 'OUTSIDE_MEAL_POLICY'
        : group === 'alcohol' && ['sponsored', 'federal'].includes(context.funding)
          ? 'ALCOHOL_FUNDING_RESTRICTION' : null;
      receiptItems.push({ receiptId, id: line.id, description: line.description, cents: line.cents,
        lineIds: line.lineIds, group, reason, excluded: Boolean(reason) });
    }
    const allItemsClassified = itemLines.length === receiptItems.length;
    for (const line of receipt.lines.filter((entry) => entry.kind !== 'item')) {
      if (line.cents === 0) continue;
      if (!allItemsClassified) continue;
      const portions = allocation(line, judgments.byLine[line.id], receiptGroups);
      if (!portions) {
        questions.push(issue('SHARED_CHARGE_UNCLEAR', 'Allocate this charge or discount to the expenses it applies to: ' + line.description,
          { receiptId, lineId: line.id, lineIds: line.lineIds, field: 'allocation', amount: line.cents }));
        continue;
      }
      receiptItems.push({ receiptId, id: line.id, description: line.description, cents: line.cents,
        lineIds: line.lineIds, allocation: portions, group: Object.keys(portions).join(', ') });
    }
    const portions = receiptItems.flatMap((item) => {
      if (!item.allocation) return [{ item, group: item.group, source: item.cents }];
      return groups.filter((group) => Object.hasOwn(item.allocation, group))
        .map((group) => ({ item, group, source: item.allocation[group] }));
    });
    const amounts = portions.map(({ source }) => source);
    const converted = rate ? convertAmounts(amounts, rate) : amounts;
    if (rate) {
      for (const item of receiptItems) {
        item.sourceCents = item.cents;
        item.sourceCurrency = currency;
        item.cents = 0;
        if (item.allocation) item.allocation = {};
      }
    }
    for (const [index, { item, group }] of portions.entries()) {
      const cents = converted[index];
      sums[group] += cents;
      if (rate) {
        item.cents += cents;
        if (item.allocation) item.allocation[group] = cents;
      }
    }
    items.push(...receiptItems);
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
  const requestedCents = Math.max(0, total - (context.priorReimbursementCents ?? 0));
  const standardCents = Math.min(ordinary, requestedCents);
  const excessCents = requestedCents - standardCents;
  if (!questions.length) {
    if (excessMealCents) findings.push(issue('MEAL_LIMIT_EXCEEDED', 'The meal limit was exceeded.'));
    if (excessAlcoholCents) findings.push(issue('ALCOHOL_LIMIT_EXCEEDED', 'The separate alcohol limit was exceeded.'));
    if (excludedAlcohol && sums.alcohol > 0) findings.push(issue('ALCOHOL_FUNDING_RESTRICTION',
      'Alcohol and related amounts are excluded from reimbursement with federal or sponsored funding.', { informational: true }));
    if (context.funding === 'general' && sums.alcohol > 0) findings.push(issue('FUNDING_SOURCE_REVIEW_REQUIRED',
      'Confirm an eligible funding source for alcohol.'));
  }
  return {
    questions, findings, items, mealCents: sums.meals, alcoholCents: sums.alcohol,
    excludedCents: sums.excluded + (excludedAlcohol ? sums.alcohol : 0),
    mealLimit, alcoholLimit, standardCents, excessCents, excessMealCents, excessAlcoholCents, requestedCents,
    receiptTotalCents, conversions: conversions.sort((a, b) => a.receiptId.localeCompare(b.receiptId)),
  };
}
