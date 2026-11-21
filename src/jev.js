import { requestModel } from './model-http.js';

const categories = {
  food: 'Food for an ordinary business meal.',
  soft_drink: 'A nonalcoholic drink without prohibited substances.',
  alcohol: 'An alcoholic beverage, including beer, wine and spirits.',
  restricted_drink: 'A beverage with a prohibited substance such as cannabis, THC or psilocybin.',
  other: 'An expense outside food and drink, including venue or equipment.',
  unknown: 'Unreadable, ambiguous or insufficient evidence.',
};
const allocations = {
  meals: 'Clearly applies only to food or nonalcoholic meal items.',
  alcohol: 'Clearly applies only to alcohol.',
  excluded: 'Clearly applies only to expenses outside reimbursement.',
  mixed: 'Shared charge applies to more than one category.',
  unknown: 'The charge cannot reliably be attributed from the supplied evidence.',
};
const policyOptions = {
  eligible_category: 'An ordinary meal, soft drink or alcohol that is eligible when funding permits.',
  excluded_category: 'Item category excluded regardless of funding under this meal policy.',
  insufficient: 'Insufficient evidence or a separate expense type.',
};
const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
const noul = (instructions) => ({ type: 'noul', instructions });

function probability(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Jev returned an invalid probability.');
  return value;
}

export async function checkPolicy({ policy, receipts, context }, options = {}) {
  const questions = {};
  const rows = receipts.flatMap((receipt) => receipt.lines.map((line) => ({
    id: line.id, kind: line.kind, description: line.description,
    evidence: (line.lineIds ?? []).map((id) => receipt.sourceLines?.find((source) => source.id === id)?.text).filter(Boolean),
  })));
  for (const [index, row] of rows.entries()) {
    const subject = 'Use only evidence for receipt line ' + row.id + '.';
    if (row.kind === 'item') {
      questions['category_' + index] = choice(subject + ' Which category describes this line?', categories);
      if (/beer|wine|cider|ale\b|ipa\b|drink|bev\b|lager|merlot|spirit|whisk/i.test(row.description)) {
        questions['alcohol_' + index] = noul(subject + ' Is this beverage alcoholic? Ambiguous labels are uncertain.');
      }
      questions['rule_' + index] = choice(subject + ' What decision applies to this category under the meal policy?', policyOptions);
    } else {
      questions['allocation_' + index] = choice(subject + ' Which items do these charges apply to?', allocations);
    }
  }
  if (!rows.length) return { byLine: {}, usage: {} };
  const response = await requestModel('https://api.typesafe.ai/v1/systemone',
    options.key ?? process.env.TYPESAFE_API_KEY, {
      model: options.model ?? process.env.TYPESAFE_MODEL ?? 'jev-latest',
      state: {
        policy: policy.content.split('## Decision rules for an expense-processing agent')[0],
        event: { type: context.type, funding: context.funding },
        rows,
      },
      questions,
    }, { fetcher: options.fetcher, provider: 'TypeSafe' });

  function selected(name, allowed) {
    const answer = response.answers?.[name];
    if (answer?.type !== 'choice' || !Object.hasOwn(allowed, answer.choice)) {
      throw new Error('Jev did not return the expected answer for ' + name + '.');
    }
    return {
      value: answer.choice, probability: probability(answer.probabilities[answer.choice]),
      probabilities: answer.probabilities,
    };
  }

  function boolean(name) {
    const answer = response.answers?.[name];
    if (answer?.type !== 'noul') throw new Error('Jev did not return the expected answer for ' + name + '.');
    return probability(answer.noul);
  }

  const byLine = {};
  for (const [index, row] of rows.entries()) {
    if (row.kind !== 'item') {
      byLine[row.id] = { allocation: selected('allocation_' + index, allocations) };
      continue;
    }
    byLine[row.id] = {
      category: selected('category_' + index, categories),
      rule: selected('rule_' + index, policyOptions),
      ...(questions['alcohol_' + index] && { alcohol: boolean('alcohol_' + index) }),
    };
  }
  return { model: response.model, byLine, usage: response.usage ?? {} };
}
