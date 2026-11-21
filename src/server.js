import { access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import express from 'express';
import { openStore } from './store.js';
import { loadPolicy } from './policy-snapshot.js';
import { createAuth } from './auth.js';
import { sessionsRouter } from './routes/sessions.js';
import { createWorkflow } from './workflow.js';
import { prepareMailDraft } from './mail-draft.js';
import { createMailSender } from './mail-send.js';
import { createInbox } from './inbox.js';
import { createExpenseReviewer } from './expense-review.js';
import { applyExceptionEvidence } from './exception-evidence.js';
import { approvalsRouter, requireReviewer } from './routes/approvals.js';
import { auditRouter } from './routes/audit.js';

const dataDir = resolve(process.env.DATA_DIR ?? 'data');
const policyPath = resolve(process.env.POLICY_PATH ?? 'umich-business-hosting-policy-digest.md');
const port = Number(process.env.PORT ?? 3000);

await mkdir(dataDir, { recursive: true });
await access(policyPath);
const store = openStore(resolve(dataDir, 'app.sqlite'));
const policy = loadPolicy(policyPath);

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));
const auth = createAuth();
app.use('/api', auth.requireTrustedOrigin);
app.post('/api/login', auth.login);
app.post('/api/logout', auth.logout);
app.get('/api/me', auth.requireUser, (request, response) => response.json({ user: request.user }));
app.get('/healthz', (_request, response) => {
  response.json({ status: 'ok', policyId: policy.id, sessions: store.listSessions().length });
});
const workflow = createWorkflow({ store });
workflow.onReady((session) => prepareMailDraft(store, session));
for (const session of store.listSessions()) {
  if (['processing', 'checking_policy'].includes(session.status)
      || (session.status === 'waiting_for_input' && session.questions?.some(({ code, field }) =>
        code === 'BUSINESS_PURPOSE_MISSING_OR_VAGUE' || field === 'priorReimbursementCents'))) {
    void workflow.schedule(session.id);
  }
}
const mailSender = createMailSender({ store });
mailSender.recover();
app.use('/api/sessions', sessionsRouter({ auth, store, dataDir, policyPath, workflow, mailSender }));
const inbox = createInbox({ store });
const expenseReviewer = createExpenseReviewer({ store, inbox, dataDir, documentExceptions: applyExceptionEvidence });
app.use('/api/approvals', approvalsRouter({ auth, store, inbox, expenseReviewer }));
app.get(['/approvals', '/approvals.html'], auth.requireUser, requireReviewer,
  (_request, response) => response.sendFile(resolve('public/approvals.html')));
app.use('/api/audit', auditRouter({ auth, store }));
app.get(['/audit', '/audit.html'], auth.requireUser, requireReviewer,
  (_request, response) => response.sendFile(resolve('public/audit.html')));
app.use(express.static(resolve('public')));
app.use((error, _request, response, next) => {
  if (response.headersSent) return next(error);
  const status = error.status ?? (error.name === 'MulterError' ? 400 : 500);
  if (status >= 500) console.error(error.message);
  response.status(status).json({ message: status >= 500 ? 'Ошибка сервера.' : error.message });
});
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Expense Reports Autopilot listening on port ${port}`);
});

process.on('SIGTERM', () => server.close(() => store.close()));
