import { api, dateTime, eventLabels, money, node, setNav, showError, statusLabels } from './ui.js';

const actorName = { employee: 'Jamie Chen', reviewer: 'Taylor Morgan', authority: 'Casey Rivera', system: 'Система' };
const submitTypes = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', other: 'Другое' };
let active;

async function open(id) {
  active = id;
  const result = await api('/api/audit/sessions/' + encodeURIComponent(id));
  if (active !== id) return;
  const { session, policy, receipts, events } = result;
  const panel = document.querySelector('#session-audit');
  document.querySelector('#session-title').textContent = session.claimantName + ' · ' + (statusLabels[session.status] ?? session.status);
  document.querySelector('#policy').textContent = 'Политика ' + policy.id + ' · SHA-256 ' + policy.sha256;
  document.querySelector('#source-files').replaceChildren(
    ...receipts.map((receipt) => node('li', receipt.filename + ' · SHA-256 ' + receipt.sha256)));
  document.querySelector('#events').replaceChildren(...events.map((event) => {
    const item = node('li');
    const title = eventLabels[event.type] ?? event.type;
    const meta = dateTime(event.occurredAt) + ' · ' + (event.data?.approverName ?? actorName[event.actorId] ?? event.actorId);
    item.append(node('strong', title), node('p', meta, 'muted'));
    if (event.data?.calculation) item.append(node('p', 'Сумма: ' + money(event.data.calculation.requestedCents)));
    for (const finding of event.data?.findings ?? []) item.append(node('p', finding.message + ' [' + finding.code + ']'));
    if (event.data?.verdict) item.append(node('span', event.data.verdict === 'green' ? 'Зелёный' : 'Красный', 'badge ' + event.data.verdict));
    const detail = node('details');
    detail.append(node('summary', 'Данные события'), node('pre', JSON.stringify(event.data, null, 2)));
    item.append(detail);
    return item;
  }));
  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function render(sessions) {
  const root = document.querySelector('#sessions');
  if (!sessions.length) return root.append(node('p', 'Сессий пока нет.', 'muted'));
  const wrapper = node('div', undefined, 'table-scroll');
  const table = node('table');
  const head = node('tr');
  for (const label of ['Создана', 'Сотрудник', 'Мероприятие', 'Статус', '']) head.append(node('th', label));
  table.append(head);
  for (const session of sessions) {
    const row = node('tr');
    row.append(node('td', dateTime(session.createdAt)), node('td', session.claimantName),
      node('td', submitTypes[session.eventType] ?? '—'), node('td', statusLabels[session.status] ?? session.status));
    const cell = node('td');
    const button = node('button', 'Открыть журнал', 'secondary');
    button.onclick = () => open(session.id).catch(showError);
    cell.append(button);
    row.append(cell);
    table.append(row);
  }
  wrapper.append(table);
  root.append(wrapper);
}

try {
  setNav((await api('/api/me')).user);
  render((await api('/api/audit/sessions')).sessions);
} catch (error) { showError(error); }
