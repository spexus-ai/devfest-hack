import { api, conversionText, dateTime, eventLabels, money, node, setNav, showError, statusLabels } from './ui.js';
import { legacyMessage } from './legacy-messages.js';

const actorName = { employee: 'Jamie Chen', reviewer: 'Taylor Morgan', authority: 'Casey Rivera', system: 'System' };
const submitTypes = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', other: 'Other' };
let active;

async function open(id) {
  active = id;
  const result = await api('/api/audit/sessions/' + encodeURIComponent(id));
  if (active !== id) return;
  const { session, policy, receipts, events } = result;
  const panel = document.querySelector('#session-audit');
  document.querySelector('#session-title').textContent = session.claimantName + ' · ' + (statusLabels[session.status] ?? session.status);
  document.querySelector('#policy').textContent = 'Policy ' + policy.id + ' · SHA-256 ' + policy.sha256;
  document.querySelector('#source-files').replaceChildren(
    ...receipts.map((receipt) => node('li', receipt.filename + ' · SHA-256 ' + receipt.sha256)));
  document.querySelector('#events').replaceChildren(...events.map((event) => {
    const item = node('li');
    const title = eventLabels[event.type] ?? event.type;
    const meta = dateTime(event.occurredAt) + ' · ' + (event.data?.approverName ?? actorName[event.actorId] ?? event.actorId);
    item.append(node('strong', title), node('p', meta, 'muted'));
    if (event.data?.calculation) item.append(node('p', 'Amount: ' + money(event.data.calculation.requestedCents)));
    for (const conversion of event.data?.calculation?.conversions ?? event.data?.conversions ?? []) {
      item.append(node('p', conversionText(conversion)));
    }
    for (const finding of event.data?.findings ?? []) item.append(node('p', legacyMessage(finding.message) + ' [' + finding.code + ']'));
    if (event.data?.verdict) item.append(node('span', event.data.verdict === 'green' ? 'Green' : 'Red', 'badge ' + event.data.verdict));
    const detail = node('details');
    detail.append(node('summary', 'Event data'), node('pre', JSON.stringify(event.data, null, 2)));
    item.append(detail);
    return item;
  }));
  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function render(sessions) {
  const root = document.querySelector('#sessions');
  if (!sessions.length) return root.append(node('p', 'No sessions yet.', 'muted'));
  const wrapper = node('div', undefined, 'table-scroll');
  const table = node('table');
  const head = node('tr');
  for (const label of ['Created', 'Employee', 'Event', 'Status', '']) head.append(node('th', label));
  table.append(head);
  for (const session of sessions) {
    const row = node('tr');
    row.append(node('td', dateTime(session.createdAt)), node('td', session.claimantName),
      node('td', submitTypes[session.eventType] ?? '—'), node('td', statusLabels[session.status] ?? session.status));
    const cell = node('td');
    const button = node('button', 'View audit log', 'secondary');
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
