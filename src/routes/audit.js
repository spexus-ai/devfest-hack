import { Router } from 'express';
import { requireReviewer } from './approvals.js';
import { requestError } from '../workflow.js';

function summary(session) {
  return {
    id: session.id, claimantName: session.claimantName, createdAt: session.createdAt,
    eventType: session.context?.type ?? null, status: session.status, revision: session.revision,
    requestedCents: session.calculation?.requestedCents ?? null,
  };
}

export function auditRouter({ auth, store }) {
  const router = Router();
  router.use(auth.requireUser, requireReviewer);
  router.get('/sessions', (_request, response) => response.json({ sessions: store.listSessions().map(summary) }));
  router.get('/sessions/:id', (request, response) => {
    const session = store.getSession(request.params.id);
    if (!session) throw requestError(404, 'Сессия не найдена.');
    const receipts = store.listReceipts(session.id).map(({ id, filename, sha256 }) => ({ id, filename, sha256 }));
    response.json({
      session: summary(session), receipts,
      policy: { id: session.policy.id, sha256: session.policy.sha256 },
      events: store.events(session.id),
    });
  });
  return router;
}
