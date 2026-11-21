import { canApprove } from './auth.js';
import { requestError } from './workflow.js';

const supported = new Set(['MEAL_LIMIT_EXCEEDED', 'ALCOHOL_LIMIT_EXCEEDED']);

export function applyExceptionEvidence(findings, evidence, revision) {
  return findings.map((finding) => {
    if (!supported.has(finding.code)) return finding;
    const documented = evidence.find((entry) => entry.revision === revision && entry.code === finding.code
      && entry.funding === 'discretionary');
    return documented ? { ...finding, informational: true, evidence: documented,
      message: finding.message + ' The justification and exception approval have been verified.' } : finding;
  });
}

export function recordException(store, id, actor, data) {
  return store.atomic(() => {
    const session = store.getSession(id);
    if (!canApprove(actor, session) || !actor.exceptionAuthority) {
      throw requestError(403, 'Only a manager with approval authority can record an exception.');
    }
    if (session.revision !== data.revision || session.status !== 'submitted_for_review') {
      throw requestError(409, 'The exception must apply to the latest submitted version.');
    }
    const check = store.latestCheck(id, session.revision);
    const draft = store.getDraft(id, session.revision);
    if (!supported.has(data.code) || !check?.findings.some((finding) => finding.code === data.code)
      || check.verdict !== 'red' || draft.payload.context.funding !== 'discretionary'
      || !draft.payload.context.excessReason || data.verifiedFunding !== true) {
      throw requestError(409, 'An over-limit expense requires a justification and confirmed discretionary funding.');
    }
    if (typeof data.reference !== 'string' || !data.reference.trim() || data.reference.length > 400) {
      throw requestError(400, 'Enter a link or reference number for the documented approval.');
    }
    const evidence = {
      revision: data.revision, code: data.code, reference: data.reference.trim(),
      justification: draft.payload.context.excessReason, funding: 'discretionary', actorId: actor.id,
      occurredAt: new Date().toISOString(),
    };
    return store.updateSession(id, (current) => ({
      exceptionEvidence: [
        ...(current.exceptionEvidence ?? []).filter((entry) => entry.revision !== evidence.revision || entry.code !== evidence.code),
        evidence,
      ],
    }), { type: 'exception_documented', data: evidence, actorId: actor.id });
  });
}
