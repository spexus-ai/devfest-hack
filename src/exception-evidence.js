import { canApprove } from './auth.js';
import { requestError } from './workflow.js';

const supported = new Set(['MEAL_LIMIT_EXCEEDED', 'ALCOHOL_LIMIT_EXCEEDED']);

export function applyExceptionEvidence(findings, evidence, revision) {
  return findings.map((finding) => {
    if (!supported.has(finding.code)) return finding;
    const documented = evidence.find((entry) => entry.revision === revision && entry.code === finding.code
      && entry.funding === 'discretionary');
    return documented ? { ...finding, informational: true, evidence: documented,
      message: finding.message + ' Обоснование и решение по исключению подтверждены.' } : finding;
  });
}

export function recordException(store, id, actor, data) {
  return store.atomic(() => {
    const session = store.getSession(id);
    if (!canApprove(actor, session) || !actor.exceptionAuthority) {
      throw requestError(403, 'Для фиксации исключения нужны полномочия руководителя.');
    }
    if (session.revision !== data.revision || session.status !== 'submitted_for_review') {
      throw requestError(409, 'Исключение относится к актуальной отправленной версии.');
    }
    const check = store.latestCheck(id, session.revision);
    const draft = store.getDraft(id, session.revision);
    if (!supported.has(data.code) || !check?.findings.some((finding) => finding.code === data.code)
      || check.verdict !== 'red' || draft.payload.context.funding !== 'discretionary'
      || !draft.payload.context.excessReason || data.verifiedFunding !== true) {
      throw requestError(409, 'Нужно обоснованное превышение и подтверждённые дискреционные средства.');
    }
    if (typeof data.reference !== 'string' || !data.reference.trim() || data.reference.length > 400) {
      throw requestError(400, 'Укажите ссылку или номер документированного решения.');
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
