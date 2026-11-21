import { canApprove } from './auth.js';
import { requestError } from './workflow.js';

export function approveExpense(store, id, actor, { revision, checkId }) {
  return store.atomic(() => {
    const session = store.getSession(id);
    if (!canApprove(actor, session)) throw requestError(403, 'Утверждение доступно назначенному согласующему.');
    if (revision !== session.revision) throw requestError(409, 'Передана устаревшая версия заявки.');
    if (session.approval?.revision === revision && session.approval.checkId === checkId) return session.approval;
    const check = store.latestCheck(id, revision);
    if (session.status !== 'submitted_for_review' || !check || check.id !== checkId || check.verdict !== 'green') {
      throw requestError(409, 'Требуется зелёный вердикт по актуальной версии.');
    }
    const draft = store.getDraft(id, revision);
    if (!draft || draft.status !== 'submitted_for_review' || draft.messageId !== check.messageId) {
      throw requestError(409, 'Проверка относится к другому письму.');
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
