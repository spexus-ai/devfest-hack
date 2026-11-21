import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { emailHeader, messageKey } from './inbox.js';
import { readExpensePayload } from './mail-draft.js';
import { checksum, imageMime } from './receipts.js';
import { recognizeReceipt } from './ocr.js';
import { extractReceipt } from './qwen.js';
import { checkPolicy } from './jev.js';
import { analyzeExpense, applyCorrections, requestError } from './workflow.js';
import { issue, withEvidence } from './reconcile.js';

const totals = ['receiptTotalCents', 'standardCents', 'excessCents', 'excludedCents', 'requestedCents'];

function validateEnvelope({ session, draft, email, headers }) {
  if (messageKey(email.MessageID ?? emailHeader(headers, 'Message-ID')) !== draft.messageId
    || emailHeader(headers, 'X-Expense-Session') !== session.id
    || emailHeader(headers, 'X-Expense-Revision') !== String(draft.revision)
    || email.From?.Address?.toLowerCase() !== draft.from.toLowerCase()
    || !(email.To ?? []).some((receiver) => receiver.Address?.toLowerCase() === draft.to.toLowerCase())) {
    return issue('MAIL_ENVELOPE_MISMATCH', 'The email headers do not match the confirmed version.');
  }
  return null;
}

export function createExpenseReviewer({ store, inbox, dataDir, ocr = recognizeReceipt,
  extract = extractReceipt, classify = checkPolicy, documentExceptions = () => [] }) {
  const pending = new Map();

  async function analyze(id, user, record) {
    const { session, draft, entry } = record;
    const result = {
      id: randomUUID(), sessionId: id, revision: draft.revision, mailpitId: entry.mailpitId,
      messageId: draft.messageId, policyId: session.policy.id, policyHash: session.policy.sha256,
      occurredAt: new Date().toISOString(), reviewerId: user.id, findings: [], attachments: [],
    };
    let temporary;
    try {
      const opened = await inbox.open(id, user);
      const envelopeIssue = validateEnvelope(opened);
      if (envelopeIssue) {
        result.findings.push(envelopeIssue);
        return result;
      }
      let payload;
      try {
        payload = readExpensePayload(opened.email.Text);
      } catch {
        result.findings.push(issue('MAIL_PAYLOAD_INVALID', 'The request data could not be extracted from the email.'));
        return result;
      }
      if (!isDeepStrictEqual(payload, draft.payload)) {
        result.findings.push(issue('MAIL_PAYLOAD_MISMATCH', 'The email data differs from the confirmed version.'));
        return result;
      }
      const parts = opened.email.Attachments ?? [];
      if (parts.length !== draft.attachments.length) {
        result.findings.push(issue('ATTACHMENT_COUNT_MISMATCH', 'The email has a missing or unexpected attachment.'));
        return result;
      }
      temporary = await mkdtemp(join(dataDir, 'review-'));
      const remaining = [...draft.attachments];
      const receiptInputs = [];
      for (const part of parts) {
        const bytes = await inbox.part(entry.mailpitId, part.PartID);
        const sha256 = checksum(bytes);
        const matched = remaining.findIndex((expected) => expected.sha256 === sha256);
        if (matched < 0 || !imageMime(bytes)) {
          result.findings.push(issue('ATTACHMENT_HASH_MISMATCH', 'The attachment differs from the original file.',
            { partId: part.PartID, sha256 }));
          return result;
        }
        const [receipt] = remaining.splice(matched, 1);
        const path = join(temporary, receipt.id + (receipt.mime === 'image/png' ? '.png' : '.jpg'));
        await writeFile(path, bytes, { flag: 'wx' });
        result.attachments.push({ id: receipt.id, partId: part.PartID, filename: receipt.filename, sha256 });
        receiptInputs.push({ ...receipt, path });
      }
      const extracted = [];
      for (const receipt of receiptInputs) {
        const lines = await ocr(receipt);
        const extraction = await extract({ receiptId: receipt.id, lines });
        extracted.push(withEvidence(extraction, lines));
      }
      const receipts = applyCorrections(extracted, payload.corrections);
      for (const [field, evidence] of Object.entries(payload.receiptContext ?? {})) {
        if (!evidence.some(({ receiptId }) => receipts.some((receipt) =>
          receipt.receiptId === receiptId && receipt[field]?.value === payload.context[field]))) {
          result.findings.push(issue('RECEIPT_EVENT_DETAILS_MISMATCH', 'The second check could not confirm the event ' +
            (field === 'date' ? 'date' : 'time') + ' from the receipt.', { field }));
        }
      }
      const analysis = await analyzeExpense({
        receipts, policy: session.policy, context: payload.context, exchangeRates: session.exchangeRates, classify,
      });
      result.calculation = analysis.calculation;
      result.models = { qwen: extracted.map(({ receiptId, model, usage, attempts }) => ({ receiptId, model, usage, attempts })),
        jev: analysis.judgment?.model, jevTokens: analysis.judgment?.usage };
      result.findings.push(...documentExceptions(analysis.findings,
        session.exceptionEvidence ?? [], draft.revision), ...analysis.questions);
      if (analysis.calculation && totals.some((key) => analysis.calculation[key] !== payload.amounts[key])) {
        result.findings.push(issue('CLAIM_AMOUNT_MISMATCH', 'The recalculated amount differs from the amount in the email.',
          { expected: payload.amounts.requestedCents, actual: analysis.calculation.requestedCents }));
      }
      if (analysis.calculation && !isDeepStrictEqual(analysis.calculation.conversions, payload.conversions ?? [])) {
        result.findings.push(issue('CURRENCY_CONVERSION_MISMATCH', 'The currency, exchange rate, or converted amounts differ from those in the email.',
          { expected: payload.conversions ?? [], actual: analysis.calculation.conversions }));
      }
      if (!analysis.calculation && !result.findings.length) {
        result.findings.push(issue('REVIEW_CALCULATION_MISSING', 'The expense could not be recalculated.'));
      }
      return result;
    } catch (error) {
      result.findings.push(issue('REVIEW_FAILED', 'The review could not be completed: ' + error.message));
      return result;
    } finally {
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  }

  async function check(id, user, revision) {
    const record = inbox.entryFor(id, user);
    if (revision !== record.session.revision) throw requestError(409, 'Open the current version of the request.');
    if (record.session.status === 'approved') return store.latestCheck(id, revision);
    if (record.session.status !== 'submitted_for_review') throw requestError(409, 'This version is not available for review yet.');
    const key = id + ':' + revision;
    if (pending.has(key)) return pending.get(key);
    store.record(id, 'review_started', { revision, messageId: record.draft.messageId }, user.id);
    const work = analyze(id, user, record).then((result) => store.atomic(() => {
      const current = store.getSession(id);
      if (current.revision !== revision || current.status !== 'submitted_for_review'
        || !isDeepStrictEqual(current.exceptionEvidence, record.session.exceptionEvidence)) {
        throw requestError(409, 'The request changed during review. Run the check again.');
      }
      result.verdict = result.findings.some((finding) => !finding.informational) ? 'red' : 'green';
      store.putCheck(result);
      store.record(id, 'review_completed', result, user.id);
      return result;
    })).finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  }

  return { check };
}
