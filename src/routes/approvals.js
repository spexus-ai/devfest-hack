import { Router } from 'express';
import { imageMime } from '../receipts.js';
import { requestError } from '../workflow.js';
import { recordException } from '../exception-evidence.js';
import { approveExpense } from '../approval.js';

export function requireReviewer(request, response, next) {
  if (request.user?.role !== 'reviewer') return response.status(403).json({ message: 'Требуется роль согласующего.' });
  next();
}

export function approvalsRouter({ auth, store, inbox, expenseReviewer }) {
  const router = Router();
  router.use(auth.requireUser, requireReviewer);

  router.get('/', async (request, response) => response.json({ requests: await inbox.list(request.user) }));

  router.get('/:id', async (request, response) => {
    const { email, session, entry, draft } = await inbox.open(request.params.id, request.user);
    const detail = {
      id: session.id, revision: session.revision, status: session.status, claimantName: session.claimantName,
      eventDate: draft.payload.context.date, requestedCents: draft.payload.amounts.requestedCents,
      messageId: entry.messageId, funding: draft.payload.context.funding, from: email.From?.Address, subject: email.Subject,
      text: String(email.Text ?? '').split('\nBEGIN EXPENSE DATA')[0],
      check: store.latestCheck(session.id, session.revision), approval: session.approval ?? null,
      attachments: (email.Attachments ?? []).map(({ PartID, FileName }) => ({
        partId: PartID, filename: FileName || 'Чек', url: '/api/approvals/' + session.id + '/attachments/' + encodeURIComponent(PartID),
      })),
    };
    response.json(detail);
  });

  router.post('/:id/check', async (request, response) => {
    response.json(await expenseReviewer.check(request.params.id, request.user, request.body?.revision));
  });

  router.post('/:id/exception-evidence', (request, response) => {
    recordException(store, request.params.id, request.user, request.body ?? {});
    response.sendStatus(204);
  });

  router.post('/:id/approve', (request, response) => {
    response.json(approveExpense(store, request.params.id, request.user, request.body ?? {}));
  });

  router.get('/:id/attachments/:partId', async (request, response) => {
    const { email, entry } = await inbox.open(request.params.id, request.user);
    if (!(email.Attachments ?? []).some(({ PartID }) => PartID === request.params.partId)) {
      throw requestError(404, 'Вложение не найдено.');
    }
    const bytes = await inbox.part(entry.mailpitId, request.params.partId);
    const mime = imageMime(bytes);
    if (!mime) throw requestError(400, 'Вложение не является фотографией JPEG или PNG.');
    response.type(mime).send(bytes);
  });

  return router;
}
