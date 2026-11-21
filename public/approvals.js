import { api, conversionText, dateTime, money, node, post, setNav, showError, statusLabels } from './ui.js';
import { legacyMessage } from './legacy-messages.js';

const requests = document.querySelector('#requests');
const dialog = document.querySelector('#open-request');
const closeButton = document.querySelector('#close-request');
const title = document.querySelector('#claim-title');
const summary = document.querySelector('#claim-summary');
const loading = document.querySelector('#request-loading');
const dialogError = document.querySelector('#request-error');
const content = document.querySelector('#claim-details');
const email = document.querySelector('#request-email');
const attachments = document.querySelector('#attachments');
const controls = document.querySelector('#review-controls');
const verdict = document.querySelector('#verdict');
let active;

closeButton.onclick = () => dialog.close();
dialog.addEventListener('close', () => {
  if (dialog.open) return;
  const request = active;
  active = null;
  if (request) focusRequest(request.id);
});

function focusRequest(id) {
  const button = requests.querySelector(`button[data-request-id="${CSS.escape(id)}"]`);
  (button ?? document.querySelector('#page-title')).focus({ preventScroll: true });
}

function renderList(entries) {
  const focusedId = document.activeElement?.dataset.requestId;
  requests.replaceChildren();
  if (!entries.length) {
    requests.append(node('p', 'No incoming requests yet.', 'muted'));
    if (focusedId) focusRequest(focusedId);
    return;
  }
  const wrapper = node('div', undefined, 'table-scroll');
  const table = node('table');
  const head = node('tr');
  for (const label of ['Employee', 'Date', 'Requested (USD)', 'Status', '']) head.append(node('th', label));
  table.append(head);
  for (const row of entries) {
    const tr = node('tr');
    tr.append(node('td', row.claimantName), node('td', row.eventDate ?? dateTime(row.createdAt)),
      node('td', money(row.requestedCents)), node('td', row.status === 'approved' ? statusLabels.approved : row.verdict === 'green' ? 'Green'
        : row.verdict === 'red' ? 'Red' : statusLabels[row.status] ?? row.reason ?? row.status));
    const cell = node('td');
    if (row.status !== 'unknown_message') {
      const button = node('button', 'Open', 'secondary');
      button.dataset.requestId = row.id;
      button.setAttribute('aria-haspopup', 'dialog');
      button.onclick = () => open(row.id);
      cell.append(button);
    }
    tr.append(cell);
    table.append(tr);
  }
  wrapper.append(table);
  requests.append(wrapper);
  if (focusedId) focusRequest(focusedId);
}

function isOpen(request) {
  return dialog.open && active === request;
}

function showRequestError(request, error) {
  if (!isOpen(request)) return;
  loading.hidden = true;
  showError(error, dialogError);
}

function reviewAction(request, button, pendingLabel, run) {
  button.onclick = async () => {
    showError(null, dialogError);
    const buttons = controls.querySelectorAll('button');
    const label = button.textContent;
    buttons.forEach((item) => { item.disabled = true; });
    button.textContent = pendingLabel;
    try {
      await run();
    } catch (error) {
      showRequestError(request, error);
    } finally {
      if (isOpen(request) && button.isConnected) {
        buttons.forEach((item) => { item.disabled = false; });
        button.textContent = label;
      }
    }
  };
}

async function refreshAfterAction(id) {
  const request = active;
  await Promise.all([
    reload().catch(showError),
    request?.id === id && isOpen(request) ? loadDetail(request).catch((error) => showRequestError(request, error)) : null,
  ]);
}

function renderReview(request, detail) {
  controls.replaceChildren();
  verdict.replaceChildren();
  if (detail.status !== 'approved') {
    const check = node('button', 'Check expense');
    reviewAction(request, check, 'Checking…', async () => {
      await post(request.path + '/check', { revision: detail.revision });
      await refreshAfterAction(request.id);
    });
    controls.append(check);
  }
  if (detail.check) {
    const color = detail.check.verdict;
    verdict.append(node('p', color === 'green' ? 'Green · Compliant with policy' : 'Red · Needs review',
      'badge ' + color));
    for (const conversion of detail.check.calculation?.conversions ?? []) {
      const submitted = detail.conversions.find(({ receiptId }) => receiptId === conversion.receiptId);
      const text = conversionText(conversion);
      if (!submitted || conversionText(submitted) !== text) verdict.append(node('p', 'On review · ' + text));
    }
    for (const item of detail.check.calculation?.items?.filter(({ excluded }) => excluded) ?? []) {
      const amount = item.sourceCurrency ? money(item.sourceCents, item.sourceCurrency) : money(item.cents);
      verdict.append(node('p', 'Excluded item: ' + item.description + ' · ' + amount, 'muted'));
    }
    for (const finding of detail.check.findings ?? []) {
      const findingRow = node('p', legacyMessage(finding.message) + ' [' + finding.code + ']', finding.informational ? 'muted' : 'notice');
      if (finding.receiptId) findingRow.append(node('small', ' · receipt ' + finding.receiptId.slice(0, 8)));
      verdict.append(findingRow);
    }
  }
  if (detail.check?.verdict === 'red' && detail.funding === 'discretionary' && detail.status !== 'approved') {
    for (const finding of detail.check.findings.filter(({ code }) =>
      ['MEAL_LIMIT_EXCEEDED', 'ALCOHOL_LIMIT_EXCEEDED'].includes(code))) {
      const exception = node('button', 'Record approval for excess expenses', 'secondary');
      reviewAction(request, exception, 'Recording…', async () => {
        const reference = window.prompt('Enter the reference or link to the manager approval confirming discretionary funding.');
        if (!reference) return;
        await post(request.path + '/exception-evidence', {
          revision: detail.revision, code: finding.code, reference, verifiedFunding: true,
        });
        if (isOpen(request)) verdict.append(node('p', 'Approval recorded. Run the check again.', 'notice'));
      });
      controls.append(exception);
    }
  }
  if (detail.check?.verdict === 'green' && detail.status === 'submitted_for_review') {
    const approve = node('button', 'Approve');
    reviewAction(request, approve, 'Approving…', async () => {
      await post(request.path + '/approve', { revision: detail.revision, checkId: detail.check.id });
      await refreshAfterAction(request.id);
    });
    controls.append(approve);
  }
  if (detail.approval) {
    verdict.append(node('p', 'Approved by ' + detail.approval.approverName + ' · ' + dateTime(detail.approval.occurredAt)));
  }
}

function open(id) {
  const request = { id, path: '/api/approvals/' + encodeURIComponent(id) };
  active = request;
  title.textContent = 'Expense request';
  summary.hidden = true;
  content.hidden = true;
  loading.hidden = false;
  email.open = false;
  showError(null, dialogError);
  dialog.showModal();
  loading.parentElement.scrollTop = 0;
  void loadDetail(request).catch((error) => showRequestError(request, error));
}

async function loadDetail(request) {
  const detail = await api(request.path);
  if (!isOpen(request)) return;
  title.textContent = detail.claimantName;
  summary.textContent = detail.eventDate + ' · version ' + detail.revision + ' · ' + (statusLabels[detail.status] ?? detail.status);
  const amounts = document.querySelector('#claim-amounts');
  amounts.replaceChildren();
  for (const [label, value] of [
    ['Receipt total for policy (USD)', detail.amounts.receiptTotalCents],
    ['Excluded (USD)', detail.amounts.excludedCents],
    ['Requested (USD)', detail.amounts.requestedCents],
  ]) {
    const metric = node('div');
    metric.append(node('dt', label), node('dd', money(value)));
    amounts.append(metric);
  }
  document.querySelector('#claim-conversions').replaceChildren(
    ...detail.conversions.map((conversion) => node('p', conversionText(conversion), 'muted')));
  document.querySelector('#mail').textContent = [detail.from, detail.subject, '', detail.text].join('\n');
  attachments.replaceChildren();
  for (const attachment of detail.attachments) {
    const example = node('figure');
    const img = node('img');
    img.src = attachment.url;
    img.alt = attachment.filename;
    example.append(img, node('figcaption', attachment.filename));
    attachments.append(example);
  }
  renderReview(request, detail);
  summary.hidden = false;
  content.hidden = false;
  loading.hidden = true;
  if (!dialog.contains(document.activeElement)) closeButton.focus({ preventScroll: true });
}

async function reload() {
  renderList((await api('/api/approvals')).requests);
}

try {
  setNav((await api('/api/me')).user);
  await reload();
} catch (error) {
  showError(error);
}
