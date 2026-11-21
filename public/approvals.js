import { api, dateTime, money, node, post, setNav, showError, statusLabels } from './ui.js';

const requests = document.querySelector('#requests');
const detailPanel = document.querySelector('#open-request');
const controls = document.querySelector('#review-controls');
let active;

function renderList(entries) {
  requests.replaceChildren();
  if (!entries.length) return requests.append(node('p', 'Поступивших заявок пока нет.', 'muted'));
  const wrapper = node('div', undefined, 'table-scroll');
  const table = node('table');
  const head = node('tr');
  for (const label of ['Сотрудник', 'Дата', 'Сумма', 'Статус', '']) head.append(node('th', label));
  table.append(head);
  for (const row of entries) {
    const tr = node('tr');
    tr.append(node('td', row.claimantName), node('td', row.eventDate ?? dateTime(row.createdAt)),
      node('td', money(row.requestedCents)), node('td', row.status === 'approved' ? statusLabels.approved : row.verdict === 'green' ? 'Зелёный'
        : row.verdict === 'red' ? 'Красный' : statusLabels[row.status] ?? row.reason ?? row.status));
    const cell = node('td');
    if (row.status !== 'unknown_message') {
      const button = node('button', 'Открыть', 'secondary');
      button.onclick = () => open(row.id).catch(showError);
      cell.append(button);
    }
    tr.append(cell);
    table.append(tr);
  }
  wrapper.append(table);
  requests.append(wrapper);
}

function renderReview(detail) {
  controls.replaceChildren();
  const check = node('button', 'Проверить расход');
  if (detail.status !== 'approved') controls.append(check);
  check.onclick = async () => {
    check.disabled = true;
    check.textContent = 'Проверяется…';
    showError(null);
    try {
      await post('/api/approvals/' + detail.id + '/check', { revision: detail.revision });
      await open(detail.id);
      await reload();
    } catch (error) {
      showError(error);
      if (active === detail.id) renderReview(detail);
    }
  };
  const target = document.querySelector('#verdict');
  target.replaceChildren();
  if (detail.check) {
    const color = detail.check.verdict;
    target.append(node('p', color === 'green' ? 'Зелёный · соответствует политике' : 'Красный · требуется проверка',
      'badge ' + color));
    for (const finding of detail.check.findings ?? []) {
      const findingRow = node('p', finding.message + ' [' + finding.code + ']', finding.informational ? 'muted' : 'notice');
      if (finding.receiptId) findingRow.append(node('small', ' · чек ' + finding.receiptId.slice(0, 8)));
      target.append(findingRow);
    }
  }
  if (detail.check?.verdict === 'red' && detail.funding === 'discretionary' && detail.status !== 'approved') {
    for (const finding of detail.check.findings.filter(({ code }) =>
      ['MEAL_LIMIT_EXCEEDED', 'ALCOHOL_LIMIT_EXCEEDED'].includes(code))) {
      const exception = node('button', 'Зафиксировать подтверждение превышения', 'secondary');
      exception.onclick = async () => {
        const reference = window.prompt('Номер или ссылка на решение руководителя с подтверждёнными дискреционными средствами');
        if (!reference) return;
        try {
          await post('/api/approvals/' + detail.id + '/exception-evidence', {
            revision: detail.revision, code: finding.code, reference, verifiedFunding: true,
          });
          showError(null);
          target.append(node('p', 'Подтверждение записано. Запустите повторную проверку.', 'notice'));
        } catch (error) { showError(error); }
      };
      controls.append(exception);
    }
  }
  if (detail.check?.verdict === 'green' && detail.status === 'submitted_for_review') {
    const approve = node('button', 'Approve');
    approve.onclick = async () => {
      approve.disabled = true;
      showError(null);
      try {
        await post('/api/approvals/' + detail.id + '/approve',
          { revision: detail.revision, checkId: detail.check.id });
        await open(detail.id);
        await reload();
      } catch (error) {
        showError(error);
        approve.disabled = false;
      }
    };
    controls.append(approve);
  }
  if (detail.approval) {
    target.append(node('p', 'Утверждено: ' + detail.approval.approverName + ' · ' + dateTime(detail.approval.occurredAt)));
  }
}

async function open(id) {
  active = id;
  const detail = await api('/api/approvals/' + encodeURIComponent(id));
  if (active !== id) return;
  detailPanel.hidden = false;
  document.querySelector('#claim-title').textContent = detail.claimantName + ' · ' + money(detail.requestedCents);
  document.querySelector('#claim-summary').textContent = detail.eventDate + ' · версия ' + detail.revision + ' · ' + (statusLabels[detail.status] ?? detail.status);
  document.querySelector('#mail').textContent = [detail.from, detail.subject, '', detail.text].join('\n');
  const attachments = document.querySelector('#attachments');
  attachments.replaceChildren();
  for (const attachment of detail.attachments) {
    const example = node('figure');
    const img = node('img');
    img.src = attachment.url;
    img.alt = attachment.filename;
    example.append(img, node('figcaption', attachment.filename));
    attachments.append(example);
  }
  renderReview(detail);
  detailPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
