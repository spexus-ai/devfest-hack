import { legacyMessage } from './legacy-messages.js';

export async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (response.status === 401 && location.pathname !== '/') location.assign('/');
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || 'Request failed (' + response.status + ').');
  return data;
}

export const post = (path, value) => api(path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
});

export function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

export function showError(error) {
  const target = document.querySelector('#error');
  target.textContent = legacyMessage(error?.message) ?? '';
  target.hidden = !error;
}

export function setNav(user) {
  const nav = document.querySelector('#nav');
  nav.replaceChildren();
  if (!user) return;
  const name = node('span', user.name, 'nav-name');
  nav.append(name);
  if (user.role === 'reviewer') {
    const approvals = node('a', 'Approvals');
    approvals.href = '/approvals';
    const audit = node('a', 'Audit log');
    audit.href = '/audit';
    nav.append(approvals, audit);
  }
  const logout = node('button', 'Sign out', 'quiet');
  logout.addEventListener('click', async () => {
    await post('/api/logout', {});
    location.assign('/');
  });
  nav.append(logout);
}

export const money = (cents, currency = 'USD') => Number.isInteger(cents)
  ? new Intl.NumberFormat('en-US', /^[A-Z]{3}$/.test(currency ?? '')
    ? { style: 'currency', currency } : { minimumFractionDigits: 2 }).format(cents / 100)
  : '—';

export function conversionText({ currency, sourceCents, usdCents, rate }) {
  const value = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(rate.numerator / rate.denominator);
  return `${money(sourceCents, currency)} → ${money(usdCents)} · 1 ${currency} = ${value} USD`;
}

export const statusLabels = {
  processing: 'Processing receipts', waiting_for_input: 'More information needed', checking_policy: 'Checking policy',
  waiting_for_send_confirmation: 'Ready to send', send_confirmed: 'Send confirmed',
  sending: 'Sending email', submitted_for_review: 'Pending approval', approved: 'Expense approved',
  no_reimbursement: 'No reimbursable amount', processing_failed: 'Processing error',
  manual_review_required: 'Manual review required',
  send_failed: 'Email not sent', delivery_unknown: 'Delivery status pending',
};

export const eventLabels = {
  session_created: 'Session created', receipt_uploaded: 'Receipt uploaded', ocr_completed: 'Receipt text extracted',
  receipt_extracted: 'Line items extracted', context_answered: 'Answer received', receipt_corrected: 'Data corrected',
  waiting_for_input: 'More information requested', policy_check_started: 'Policy check started',
  policy_check_completed: 'Policy check completed', processing_failed: 'Processing error',
  processing_retried: 'Processing retried', draft_created: 'Email draft version created', send_confirmed: 'Sending confirmed',
  document_review_required: 'Recognized documents require manual review',
  receipt_context_filled: 'Event details filled from receipt',
  mail_sent: 'Email accepted by Mailpit', mail_imported: 'Email opened for approval',
  review_started: 'Review started', review_completed: 'Review verdict received',
  expense_approved: 'Expense approved', mail_send_failed: 'Delivery error', delivery_unknown: 'Delivery outcome unknown',
  revision_reopened: 'Request reopened for editing', exception_documented: 'Exception documented',
  purpose_review_requested: 'Business purpose sent for manual review',
};

export const dateTime = (value) => value ? new Date(value).toLocaleString('en-US') : '—';
