import { createHash, randomUUID } from 'node:crypto';
import { recognizeReceipt } from './ocr.js';
import { extractReceipt } from './qwen.js';
import { checkPolicy } from './jev.js';
import { issue, reconcileReceipt, withEvidence } from './reconcile.js';
import { calculateExpense } from './calculate.js';
import { eventFields, mealTypes, policyFindings } from './policy-findings.js';
import { fixedExchangeRates, supportedCurrency } from './currency.js';
import { mealTypeAt, validDate, validTime } from './receipt-fields.js';

const kinds = ['item', 'discount', 'tax', 'fee', 'tip'];
const categories = ['food', 'soft_drink', 'alcohol', 'restricted_drink', 'other'];
const allocationGroups = ['meals', 'alcohol', 'excluded'];
const closedStates = new Set(['send_confirmed', 'sending', 'submitted_for_review', 'approved', 'delivery_unknown', 'manual_review_required']);

export function requestError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function extractionKey(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function applyCorrections(receipts, edits = []) {
  return receipts.map((original) => {
    const receipt = structuredClone(original);
    const issues = [];
    for (const edit of edits.filter((entry) => entry.receiptId === receipt.receiptId)) {
      const sources = (edit.lineIds ?? []).slice().sort().join(',');
      const line = receipt.lines.find((entry) => entry.kind === edit.kind
        && (sources ? entry.lineIds.slice().sort().join(',') === sources : entry.id === edit.lineId));
      if (edit.field === 'currency') {
        if (receipt.currency?.detected && receipt.currency.value !== edit.value) {
          issues.push(issue('CURRENCY_SOURCE_MISMATCH', 'Валюта в правке расходится с валютой на оригинале.',
            { receiptId: receipt.receiptId }));
        } else receipt.currency = { ...receipt.currency, value: edit.value, corrected: true };
      } else if (edit.field === 'total') receipt.total = { ...receipt.total, cents: edit.value, corrected: true };
      else if (edit.field === 'add' && !line) receipt.lines.push({
        id: edit.lineId, kind: edit.kind, description: edit.description, cents: edit.value,
        lineIds: edit.lineIds, corrected: true,
      });
      else if (line) {
        if (edit.field === 'amount' || edit.field === 'add') {
          line.cents = edit.value;
          line.corrected = true;
        } else {
          line[edit.field] = edit.value;
        }
      } else {
        issues.push(issue('CORRECTION_SOURCE_MISSING', 'Ручную правку не удалось сопоставить со строкой оригинала.',
          { receiptId: receipt.receiptId, lineId: edit.lineId, lineIds: edit.lineIds }));
      }
    }
    const reconciled = reconcileReceipt(receipt);
    return { ...reconciled, issues: [...reconciled.issues, ...issues] };
  });
}

export async function analyzeExpense({ receipts, policy, context, exchangeRates, priorJudgment, classify = checkPolicy }) {
  const issues = receipts.flatMap((receipt) => receipt.issues);
  if (issues.length) return { questions: issues, calculation: null, findings: [] };

  const key = extractionKey({
    type: context.type, funding: context.funding,
    policy: policy.sha256,
    lines: receipts.flatMap(({ lines }) => lines.map(({ id, description, kind, lineIds }) => [id, description, kind, lineIds])),
  });
  const judgment = priorJudgment?.key === key
    ? priorJudgment
    : { key, ...(await classify({ policy, receipts, context })) };
  const calculation = calculateExpense({ receipts, policy, context, judgments: judgment, exchangeRates });
  const questions = [...calculation.questions];
  const findings = [...calculation.findings, ...policyFindings({ receipts, policy, context, calculation })];
  if (calculation.excessCents > 0 && !context.excessReason) {
    questions.push(issue('EXCESS_REASON_REQUIRED',
      'Кратко объясните, почему расходы превысили лимит.', { field: 'excessReason', input: 'text' }));
  }
  return { questions, calculation, judgment, findings };
}

function unanswered(context) {
  return eventFields.filter(({ field }) => context[field] === undefined)
    .map((value) => ({ ...value, code: 'EVENT_DETAILS_REQUIRED', message: value.text }));
}

function receiptContext(session, receipts) {
  const context = { priorReimbursementCents: 0, ...session.context };
  const contextSources = { ...session.contextSources };
  const populated = {};
  for (const field of ['date', 'time']) {
    const evidence = receipts.filter((receipt) => receipt[field]?.value && receipt[field].lineIds.length)
      .map((receipt) => ({ receiptId: receipt.receiptId, ...receipt[field] }));
    if (context[field] === undefined && new Set(evidence.map(({ value }) => value)).size === 1) {
      context[field] = evidence[0].value;
      contextSources[field] = { source: 'receipt', evidence };
      populated[field] = contextSources[field];
    }
  }
  const suggestion = mealTypeAt(context.time);
  if (suggestion && (context.type === undefined || contextSources.type?.source === 'time')) {
    context.type = suggestion;
    const source = { source: 'time', time: context.time, type: suggestion };
    if (contextSources.type?.time !== context.time) populated.type = source;
    contextSources.type = source;
  } else if (!suggestion && contextSources.type?.source === 'time') {
    delete context.type;
    delete contextSources.type;
  }
  return { context, contextSources, populated };
}

function mealConfirmation(session) {
  const { context, contextSources } = session;
  const suggestion = mealTypeAt(context.time);
  if (!suggestion || !context.type || context.type === 'other' || context.type === suggestion
      || (contextSources?.type?.time === context.time && contextSources.type.type === context.type)) return null;
  return issue('MEAL_TIME_MISMATCH', `Время ${context.time} обычно соответствует типу «${mealTypes[suggestion].toLowerCase()}». Подтвердите фактический тип мероприятия.`,
    { field: 'type', options: mealTypes, value: context.type });
}

function parseContext(field, value) {
  const definition = eventFields.find((entry) => entry.field === field);
  if (definition?.options && typeof value === 'string' && Object.hasOwn(definition.options, value)) return value;
  if (field === 'date' && validDate(value)) return value;
  if (field === 'time' && (value === null || validTime(value))) return value;
  if (field === 'attendees' && Number.isSafeInteger(value) && value > 0 && value <= 10000) return value;
  if (field === 'priorReimbursementCents' && Number.isSafeInteger(value) && value >= 0 && value <= 100000000) return value;
  if (['purpose', 'excessReason'].includes(field) && typeof value === 'string' && value.trim()
      && value.length <= 800) return value.trim();
  throw requestError(400, 'Неверное значение для поля.');
}

function parseEdit(body, session) {
  const receipt = session.reviewReceipts?.find(({ receiptId }) => receiptId === body.receiptId);
  if (!receipt) throw requestError(400, 'Чек для исправления не найден.');
  const { field, value } = body;
  const line = receipt.lines.find(({ id }) => id === body.lineId);
  const edit = { field, receiptId: receipt.receiptId, lineId: body.lineId, value,
    lineIds: line?.lineIds, kind: line?.kind };
  if (field === 'currency' && supportedCurrency(value) && !receipt.currency?.detected) {
    return { ...edit, before: receipt.currency?.value };
  }
  if (field === 'total' && Number.isSafeInteger(value) && value >= 0) {
    return { ...edit, before: receipt.total.cents };
  }
  if (field === 'amount' && line && Number.isSafeInteger(value) && Math.abs(value) <= 100000000
      && (value >= 0 || line.kind === 'discount')) return { ...edit, before: line.cents };
  if (field === 'category' && line?.kind === 'item' && categories.includes(value)) {
    return { ...edit, before: line.category ?? null };
  }
  if (field === 'allocation' && line && line.kind !== 'item' && value && typeof value === 'object'
      && Object.keys(value).every((key) => allocationGroups.includes(key))
      && Object.values(value).every(Number.isSafeInteger)
      && Object.values(value).reduce((sum, cents) => sum + cents, 0) === line.cents) {
    return { ...edit, before: line.allocation ?? null };
  }
  if (field === 'add' && kinds.includes(body.kind) && typeof body.description === 'string'
      && body.description.trim() && body.description.length <= 180 && Number.isSafeInteger(value)
      && receipt.sourceLines.some(({ id }) => id === body.sourceLineId)) {
    return { ...edit, lineId: 'manual-' + randomUUID(), kind: body.kind,
      description: body.description.trim(), lineIds: [body.sourceLineId] };
  }
  throw requestError(400, 'Не удалось применить правку.');
}

export function createWorkflow({ store, ocr = recognizeReceipt, extract = extractReceipt, classify = checkPolicy }) {
  const running = new Map();
  const dirty = new Set();
  const completions = new Set();

  function onReady(listener) {
    completions.add(listener);
  }

  async function step(sessionId) {
    let session = store.getSession(sessionId);
    if (!session || closedStates.has(session.status)) return;
    if (!session.exchangeRates) {
      session = store.updateSession(sessionId, () => ({ exchangeRates: fixedExchangeRates }));
    }
    const files = store.listReceipts(sessionId);
    for (const receipt of files) {
      session = store.getSession(sessionId);
      if (!session.ocr?.[receipt.id]) {
        const lines = await ocr(receipt);
        store.updateSession(sessionId, (current) => ({ ocr: { ...current.ocr, [receipt.id]: lines } }),
          { type: 'ocr_completed', data: { receiptId: receipt.id, lineCount: lines.length, sha256: receipt.sha256 } });
      }
      session = store.getSession(sessionId);
      if (!session.extracted?.[receipt.id]) {
        const data = await extract({ receiptId: receipt.id, lines: session.ocr[receipt.id] });
        store.updateSession(sessionId, (current) => ({ extracted: { ...current.extracted, [receipt.id]: data } }),
          { type: 'receipt_extracted', data: { receiptId: receipt.id, model: data.model, usage: data.usage,
            documents: data.documents, primaryDocumentId: data.primaryDocumentId, groupTotalCents: data.groupTotalCents,
            date: data.date, time: data.time, total: data.total,
            findings: data.documentIssues,
            rows: data.lines.map(({ id, kind, description, cents, lineIds }) => ({ id, kind, description, cents, lineIds })) } });
      }
    }
    session = store.getSession(sessionId);
    const receipts = applyCorrections(files.map(({ id }) =>
      withEvidence(session.extracted[id], session.ocr[id])), session.corrections);
    const documentIssues = receipts.flatMap(({ documentIssues }) => documentIssues ?? []);
    if (documentIssues.length) {
      store.updateSession(sessionId, () => ({ status: 'manual_review_required', reviewReceipts: receipts,
        questions: documentIssues, calculation: null, failure: null }),
      { type: 'document_review_required', data: { findings: documentIssues } });
      return;
    }
    const { context, contextSources, populated } = receiptContext(session, receipts);
    session = store.updateSession(sessionId, () => ({ context, contextSources }), Object.keys(populated).length
      ? { type: 'receipt_context_filled', data: { fields: populated } } : undefined);
    const missing = unanswered(context);
    const confirmation = mealConfirmation(session);
    if (confirmation) missing.unshift(confirmation);
    if (missing.length) {
      store.updateSession(sessionId, () => ({ status: 'waiting_for_input', reviewReceipts: receipts, questions: missing }),
        { type: 'waiting_for_input', data: { fields: missing.map(({ field }) => field) } });
      return;
    }
    store.updateSession(sessionId, () => ({ status: 'checking_policy', reviewReceipts: receipts, questions: [] }),
      { type: 'policy_check_started' });
    const result = await analyzeExpense({
      receipts, context: session.context, policy: session.policy, exchangeRates: session.exchangeRates,
      priorJudgment: session.judgment, classify,
    });
    if (dirty.has(sessionId)) return;
    const status = result.questions.length ? 'waiting_for_input'
      : result.calculation.requestedCents === 0 && !result.findings.some((x) => !x.informational)
        ? 'no_reimbursement' : 'waiting_for_send_confirmation';
    const updated = store.updateSession(sessionId, () => ({ status, ...result, reviewReceipts: receipts, failure: null }),
      { type: 'policy_check_completed', data: {
        model: result.judgment?.model, policyId: session.policy.id, policyHash: session.policy.sha256,
        verdicts: result.judgment?.byLine, usage: result.judgment?.usage,
        findings: result.findings, calculation: result.calculation, questions: result.questions,
      } });
    if (status === 'waiting_for_send_confirmation') for (const listener of completions) listener(updated);
  }

  function schedule(id) {
    if (running.has(id)) {
      dirty.add(id);
      return running.get(id);
    }
    const work = (async () => {
      do {
        dirty.delete(id);
        try {
          await step(id);
        } catch (error) {
          store.updateSession(id, () => ({ status: 'processing_failed', failure: error.message }),
            { type: 'processing_failed', data: { message: error.message } });
        }
      } while (dirty.has(id));
    })().finally(() => running.delete(id));
    running.set(id, work);
    return work;
  }

  function answer(session, user, body) {
    if (user.id !== session.claimantId) throw requestError(403, 'Редактировать может заявитель.');
    if (session.status === 'manual_review_required') throw requestError(409, 'Для этого комплекта документов требуется ручная проверка.');
    if (closedStates.has(session.status)) throw requestError(409, 'Версия уже передана на отправку или проверку.');
    if (body?.receiptId) {
      const edit = parseEdit(body, session);
      store.updateSession(session.id, (current) => ({
        status: 'processing', corrections: [...(current.corrections ?? []), edit], questions: [],
      }), { type: 'receipt_corrected', data: edit, actorId: user.id });
    } else {
      const value = parseContext(body?.field, body?.value);
      store.updateSession(session.id, (current) => {
        const context = { ...current.context, [body.field]: value };
        const contextSources = { ...current.contextSources, [body.field]: { source: 'employee' } };
        if (body.field === 'type' && current.questions?.some(({ code }) => code === 'MEAL_TIME_MISMATCH')) {
          contextSources.type = { source: 'employee', time: context.time, type: value };
        }
        return { status: 'processing', context, contextSources, questions: [] };
      }, { type: 'context_answered', data: { field: body.field, beforeValue: session.context[body.field], value }, actorId: user.id });
    }
    void schedule(session.id);
  }

  return { schedule, answer, onReady };
}
