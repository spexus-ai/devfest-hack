import { canApprove } from './auth.js';
import { requestError } from './workflow.js';

export function approveExpense(store, id, actor, { revision, checkId }) {
  return store.atomic(() => {
    const session = store.getSession(id);
    if (!canApprove(actor, session)) throw requestError(403, 'Only the designated reviewer can approve this request.');
    if (revision !== session.revision) throw requestError(409, 'This version of the request is outdated.');
    if (session.approval?.revision === revision && session.approval.checkId === checkId) return session.approval;
    const check = store.latestCheck(id, revision);
    if (session.status !== 'submitted_for_review' || !check || check.id !== checkId || check.verdict !== 'green') {
      throw requestError(409, 'The current version must pass the policy check first.');
    }
    const draft = store.getDraft(id, revision);
    if (!draft || draft.status !== 'submitted_for_review' || draft.messageId !== check.messageId) {
      throw requestError(409, 'The check refers to a different email.');
    }
    const approval = {
      revision, checkId, approverId: actor.id, approverName: actor.name,
      occurredAt: new Date().toISOString(), messageId: draft.messageId,
    };
    store.updateDraft(id, revision, () => ({ status: 'approved', approval }));
    store.updateSession(id, () => ({ status: 'approved', approval }),
      { type: 'expense_approved', data: approval, actorId: actor.id });
    return approval;
  });
}
