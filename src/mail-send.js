import { readFile } from 'node:fs/promises';
import nodemailer from 'nodemailer';
import { checksum } from './receipts.js';
import { createMailpit } from './mailpit.js';

const conflict = (message) => Object.assign(new Error(message), { status: 409 });

function definitiveFailure(error) {
  return Boolean(error.definite || (error.responseCode >= 400 && error.responseCode <= 599)
    || ['CONN', 'AUTH', 'EHLO', 'HELO', 'MAIL FROM', 'RCPT TO'].includes(error.command));
}

export function createMailSender({ store, mailpit = createMailpit(), transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? 'mailpit',
  port: Number(process.env.SMTP_PORT ?? 1025),
  connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 15000,
}) }) {
  function transition(draft, status, type, extra = {}) {
    return store.atomic(() => {
      store.updateDraft(draft.sessionId, draft.revision, () => ({ status, ...extra }));
      store.updateSession(draft.sessionId, () => ({ status }),
        { type, data: { revision: draft.revision, messageId: draft.messageId, ...extra } });
      return { status, revision: draft.revision, messageId: draft.messageId };
    });
  }

  async function confirm(sessionId, revision, userId) {
    const reservation = store.atomic(() => {
      const session = store.getSession(sessionId);
      if (session?.claimantId !== userId) {
        throw Object.assign(new Error('Отправку подтверждает заявитель.'), { status: 403 });
      }
      if (!Number.isInteger(revision) || revision !== session.revision || !revision) {
        throw conflict('Подтвердите актуальную версию письма.');
      }
      const draft = store.getDraft(sessionId, revision);
      if (['approved', 'sending', 'submitted_for_review', 'delivery_unknown'].includes(draft.status)) {
        return { draft, acquired: false };
      }
      if (!['waiting_for_send_confirmation', 'send_failed'].includes(session.status)
        || !['draft', 'send_failed'].includes(draft.status)) throw conflict('Письмо пока нельзя отправить.');

      const confirmation = { actorId: userId, occurredAt: new Date().toISOString() };
      store.updateDraft(sessionId, revision, () => ({ status: 'send_confirmed', confirmation }));
      store.updateSession(sessionId, () => ({ status: 'send_confirmed' }),
        { type: 'send_confirmed', actorId: userId, data: { revision, messageId: draft.messageId, confirmation } });
      transition(draft, 'sending', 'mail_sending');
      return { draft, acquired: true };
    });

    const { draft, acquired } = reservation;
    if (!acquired) {
      if (draft.status === 'delivery_unknown') {
        const known = await mailpit.findByMessageId(draft.to, draft.messageId);
        if (known) return transition(draft, 'submitted_for_review', 'mail_sent', { mailpitId: known.ID, reconciled: true });
      }
      return { status: draft.status, revision, messageId: draft.messageId };
    }
    try {
      const attachments = [];
      for (const receipt of draft.attachments) {
        const bytes = await readFile(receipt.path).catch(() => null);
        if (!bytes || checksum(bytes) !== receipt.sha256) {
          throw Object.assign(new Error('Исходное вложение недоступно или изменилось.'), { definite: true });
        }
        attachments.push({ filename: receipt.filename, contentType: receipt.mime, content: bytes });
      }
      const result = await transport.sendMail({
        from: draft.from, to: draft.to, subject: draft.subject, text: draft.text, attachments,
        messageId: '<' + draft.messageId + '>',
        headers: { 'X-Expense-Session': draft.sessionId, 'X-Expense-Revision': String(draft.revision) },
      });
      if (!result.accepted?.map(String).includes(draft.to)) {
        throw Object.assign(new Error('SMTP не принял адресата.'), { definite: true });
      }
      return transition(draft, 'submitted_for_review', 'mail_sent', { smtpResponse: result.response });
    } catch (error) {
      const definite = definitiveFailure(error);
      return transition(draft, definite ? 'send_failed' : 'delivery_unknown',
        definite ? 'mail_send_failed' : 'delivery_unknown',
        { error: definite ? 'SMTP отклонил отправку или оригинал недоступен.' : 'Не удалось подтвердить исход доставки.' });
    }
  }

  function recover() {
    for (const session of store.listSessions().filter(({ status }) => status === 'sending')) {
      const draft = store.getDraft(session.id, session.revision);
      if (draft) transition(draft, 'delivery_unknown', 'delivery_unknown', { recovered: true });
    }
  }
  return { confirm, recover };
}
