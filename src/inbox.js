import { canApprove } from './auth.js';
import { accountingAddress } from './mail-draft.js';
import { createMailpit } from './mailpit.js';
import { requestError } from './workflow.js';

export const messageKey = (id) => String(id ?? '').replace(/^<|>$/g, '');

export function emailHeader(headers, name) {
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name.toLowerCase());
  return key ? Array.isArray(headers[key]) ? headers[key][0] : headers[key] : undefined;
}

export function createInbox({ store, mailpit = createMailpit() }) {
  async function importMessages(user) {
    const messages = await mailpit.list(accountingAddress);
    const unmatched = [];
    for (const message of messages) {
      const messageId = messageKey(message.MessageID);
      const draft = store.findDraftByMessageId(messageId);
      if (!draft) {
        if (user.id === 'reviewer') unmatched.push({
          id: 'unknown-' + message.ID, createdAt: message.Created, status: 'unknown_message',
          claimantName: message.From?.Name || message.From?.Address || 'Unknown sender',
          reason: 'This email is not linked to a confirmed version of the request.',
        });
        continue;
      }
      const session = store.getSession(draft.sessionId);
      if (!canApprove(user, session) || session.revision !== draft.revision
          || !['submitted_for_review', 'approved'].includes(draft.status)) continue;
      store.atomic(() => {
        if (store.importMail({
          sessionId: session.id, revision: draft.revision, mailpitId: message.ID,
          messageId, importedAt: new Date().toISOString(),
        })) store.record(session.id, 'mail_imported', { revision: draft.revision, messageId, mailpitId: message.ID }, user.id);
      });
    }
    return unmatched;
  }

  async function list(user) {
    const unmatched = await importMessages(user);
    const entries = store.listSessions().flatMap((session) => {
      if (!canApprove(user, session) || !['submitted_for_review', 'approved'].includes(session.status)) return [];
      const entry = store.getImport(session.id, session.revision);
      if (!entry) return [];
      const draft = store.getDraft(session.id, session.revision);
      const check = store.latestCheck(session.id, session.revision);
      return [{
        id: session.id, claimantName: session.claimantName, createdAt: entry.importedAt,
        eventDate: draft.payload.context.date, requestedCents: draft.payload.amounts.requestedCents,
        status: session.status, verdict: check?.verdict ?? null,
      }];
    });
    return [...entries, ...unmatched];
  }

  function entryFor(id, user) {
    const session = store.getSession(id);
    if (!canApprove(user, session)) throw requestError(404, 'Request for approval not found.');
    const entry = store.getImport(id, session.revision);
    if (!entry) throw requestError(404, 'The email for this version has not arrived yet.');
    return { session, entry, draft: store.getDraft(id, session.revision) };
  }

  async function open(id, user) {
    const result = entryFor(id, user);
    const [email, headers] = await Promise.all([
      mailpit.message(result.entry.mailpitId), mailpit.headers(result.entry.mailpitId),
    ]);
    return { ...result, email, headers };
  }

  return { list, entryFor, open, part: mailpit.part };
}
