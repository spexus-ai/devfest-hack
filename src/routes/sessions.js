import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { canReadSession } from '../auth.js';
import { loadPolicy } from '../policy-snapshot.js';
import { publicReceipt, saveReceipts } from '../receipts.js';
import { requestError } from '../workflow.js';
import { visibleDraft } from '../mail-draft.js';

const uploads = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 8, fields: 1 },
});

export function sessionSnapshot(store, session) {
  const { policy, ...publicSession } = session;
  return {
    ...publicSession,
    policy: { id: policy.id, sha256: policy.sha256, limits: policy.limits },
    latestCheck: session.revision ? store.latestCheck(session.id, session.revision) : null,
    draft: session.revision ? visibleDraft(store.getDraft(session.id, session.revision)) : null,
    receipts: store.listReceipts(session.id).map((receipt) => publicReceipt(session.id, receipt)),
  };
}

export function sessionsRouter({ auth, store, dataDir, policyPath, workflow, mailSender }) {
  const router = Router();
  router.use(auth.requireUser);

  router.post('/', uploads.array('receipts'), async (request, response) => {
    if (request.user.role !== 'claimant') return response.status(403).json({ message: 'Заявку создаёт заявитель.' });
    if (!request.files.length) return response.status(400).json({ message: 'Добавьте хотя бы один чек.' });
    const policy = loadPolicy(policyPath);
    const id = randomUUID();
    const receipts = await saveReceipts(dataDir, id, request.files);
    let session;
    try {
      session = store.atomic(() => {
        const created = store.createSession({
          id, status: 'processing', claimantId: request.user.id, claimantName: request.user.name,
          claimantEmail: request.user.email, approverId: request.user.managerId, policy, context: {}, revision: 0, questions: workflow.initialQuestions(),
        });
        for (const receipt of receipts) {
          store.addReceipt(id, receipt);
          store.record(id, 'receipt_uploaded', { receiptId: receipt.id, filename: receipt.filename, sha256: receipt.sha256 },
            request.user.id);
        }
        return created;
      });
    } catch (error) {
      await rm(join(dataDir, 'receipts', id), { recursive: true, force: true });
      throw error;
    }
    response.status(201).json({ sessionId: id, session: sessionSnapshot(store, session) });
    void workflow.schedule(id);
  });

  router.use('/:id', (request, response, next) => {
    const session = store.getSession(request.params.id);
    if (!canReadSession(request.user, session)) return response.status(404).json({ message: 'Сессия не найдена.' });
    request.expense = session;
    next();
  });

  router.get('/:id', (request, response) => response.json(sessionSnapshot(store, request.expense)));

  router.get('/:id/receipts/:receiptId', (request, response) => {
    const receipt = store.listReceipts(request.expense.id).find(({ id }) => id === request.params.receiptId);
    if (!receipt) return response.status(404).json({ message: 'Чек не найден.' });
    response.type(receipt.mime).sendFile(receipt.path);
  });

  router.post('/:id/messages', (request, response) => {
    workflow.answer(request.expense, request.user, request.body);
    response.status(202).json(sessionSnapshot(store, store.getSession(request.expense.id)));
  });

  router.post('/:id/reopen', (request, response) => {
    const session = request.expense;
    if (request.user.id !== session.claimantId) throw requestError(403, 'Исправление вносит заявитель.');
    if (session.status !== 'submitted_for_review' || store.latestCheck(session.id, session.revision)?.verdict !== 'red') {
      throw requestError(409, 'Версию можно вернуть на правку после красного вердикта.');
    }
    store.updateSession(session.id, () => ({ status: 'waiting_for_input', questions: [] }),
      { type: 'revision_reopened', data: { revision: session.revision }, actorId: request.user.id });
    response.sendStatus(204);
  });

  router.post('/:id/confirm-send', async (request, response) => {
    const result = await mailSender.confirm(request.expense.id, request.body?.revision, request.user.id);
    response.status(result.status === 'sending' ? 202 : 200).json(result);
  });

  router.post('/:id/retry', (request, response) => {
    if (request.user.id !== request.expense.claimantId) throw requestError(403, 'Повторить проверку может заявитель.');
    if (request.expense.status !== 'processing_failed') throw requestError(409, 'Повтор доступен после ошибки.');
    store.updateSession(request.expense.id, () => ({ status: 'processing', failure: null }),
      { type: 'processing_retried', actorId: request.user.id });
    void workflow.schedule(request.expense.id);
    response.sendStatus(202);
  });

  router.get('/:id/events', (request, response) => {
    let last = Math.max(0, Number(request.get('Last-Event-ID')) || 0);
    response.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    response.flushHeaders();
    function flush() {
      const events = store.events(request.expense.id, last);
      for (const event of events) {
        last = event.id;
        response.write('id: ' + last + '\\n' + 'data: ' + JSON.stringify(event) + '\\n\\n');
      }
    }
    flush();
    const timer = setInterval(flush, 450);
    response.on('close', () => clearInterval(timer));
  });

  return router;
}
