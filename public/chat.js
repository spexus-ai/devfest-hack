import { api, dateTime, eventLabels, money, node, post, setNav, showError, statusLabels } from './ui.js';

const id = new URLSearchParams(location.search).get('id');
const endpoint = '/api/sessions/' + encodeURIComponent(id ?? '');
const elements = Object.fromEntries(['status', 'question', 'summary', 'draft', 'receipt-tabs',
  'photo-frame', 'receipt-photo', 'receipt-items', 'highlight', 'timeline']
  .map((name) => [name, document.getElementById(name)]));
let session;
let selectedReceipt;
let activeQuestion;
let questionKey;
let refreshQueued;
let refreshing;
let refreshAgain;

function field(label, input) {
  const wrapper = node('label', label);
  wrapper.append(input);
  return wrapper;
}

function input(name, type, value) {
  const element = node('input');
  Object.assign(element, { name, type, required: true });
  if (value !== undefined) element.value = value;
  if (type === 'number') element.step = '0.01';
  return element;
}

function select(name, options, value) {
  const element = node('select');
  element.name = name;
  for (const [key, label] of Object.entries(options)) {
    const option = node('option', label);
    option.value = key;
    element.append(option);
  }
  if (value !== undefined) element.value = value;
  return element;
}

function displayBox() {
  const target = activeQuestion ?? session?.questions?.[0];
  const receipt = session?.reviewReceipts?.find(({ receiptId }) => receiptId === selectedReceipt);
  const row = receipt?.sourceLines.find((line) => target?.lineIds?.includes(line.id));
  const image = elements['receipt-photo'];
  elements.highlight.hidden = !row || !image.naturalWidth || !image.naturalHeight;
  if (elements.highlight.hidden) return;
  Object.assign(elements.highlight.style, {
    left: (row.box.left / image.naturalWidth * 100) + '%',
    top: (row.box.top / image.naturalHeight * 100) + '%',
    width: (row.box.width / image.naturalWidth * 100) + '%',
    height: (row.box.height / image.naturalHeight * 100) + '%',
  });
}
elements['receipt-photo'].addEventListener('load', displayBox);

function openQuestion(question) {
  activeQuestion = question;
  selectedReceipt = question.receiptId ?? selectedReceipt;
  renderQuestion();
  renderReceipts();
}

function renderQuestion() {
  const question = activeQuestion ?? session.questions?.[0];
  const key = JSON.stringify(question ?? null) + session.status;
  if (questionKey === key) return;
  questionKey = key;
  elements.question.replaceChildren();
  if (session.failure) {
    const retry = node('button', 'Повторить проверку', 'secondary');
    retry.addEventListener('click', async () => {
      try { await post(endpoint + '/retry', {}); await refresh(); } catch (error) { showError(error); }
    });
    elements.question.append(node('p', session.failure, 'error'), retry);
    return;
  }
  if (!question || question.field === 'reconcile') {
    if (question) elements.question.append(node('p', question.message, 'question-text'));
    return;
  }
  const form = node('form', undefined, 'question-form');
  const title = question.message ?? question.text ?? 'Уточните данные.';
  form.append(node('h2', title));
  const details = session.reviewReceipts?.find(({ receiptId }) => receiptId === question.receiptId);
  if (question.field === 'add') {
    form.append(field('Название', input('description', 'text')));
    form.append(field('Тип строки', select('kind', { item: 'Товар', discount: 'Скидка', tax: 'Налог', fee: 'Сбор', tip: 'Чаевые' })));
    form.append(field('Строка OCR', select('sourceLineId', Object.fromEntries(details.sourceLines.map(({ id, text }) => [id, text])))));
    form.append(field('Сумма, USD', input('value', 'number')));
  } else if (question.field === 'allocation') {
    form.append(node('p', 'Разложите ' + money(question.amount) + ' по группам.'));
    for (const [key, label] of Object.entries({ meals: 'Питание', alcohol: 'Алкоголь', excluded: 'Исключённые расходы' })) {
      form.append(field(label + ', USD', input(key, 'number', '0')));
    }
  } else if (question.field === 'category') {
    form.append(field('Категория', select('value', {
      food: 'Еда', soft_drink: 'Безалкогольный напиток', alcohol: 'Алкоголь',
      restricted_drink: 'Запрещённый напиток', other: 'Прочее',
    })));
  } else if (question.field === 'currency') {
    form.append(field('Валюта на чеке', select('value', { USD: 'USD' })));
  } else if (question.options) {
    form.append(field('Ответ', select('value', question.options, question.value)));
  } else {
    const type = ['amount', 'total'].includes(question.field) || ['integer', 'money'].includes(question.input)
      ? 'number' : question.input === 'date' ? 'date' : 'text';
    const control = input('value', type, question.value);
    if (question.input === 'integer') {
      control.step = '1';
      control.min = '1';
    }
    form.append(field(type === 'number' && question.input !== 'integer' ? 'Сумма, USD' : 'Ответ', control));
  }
  const actions = node('div', undefined, 'actions');
  const button = node('button', 'Сохранить ответ');
  actions.append(button);
  if (activeQuestion) {
    const cancel = node('button', 'Отмена', 'quiet');
    cancel.type = 'button';
    cancel.onclick = () => { activeQuestion = null; renderQuestion(); displayBox(); };
    actions.append(cancel);
  }
  form.append(actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    showError(null);
    const values = Object.fromEntries(new FormData(form));
    let value = values.value;
    if (['add', 'amount', 'total'].includes(question.field) || question.input === 'money') value = Math.round(Number(value) * 100);
    if (question.input === 'integer') value = Number(value);
    if (question.field === 'allocation') value = Object.fromEntries(
      ['meals', 'alcohol', 'excluded'].map((group) => [group, Math.round(Number(values[group]) * 100)]));
    try {
      await post(endpoint + '/messages', { ...values, value, field: question.field,
        receiptId: question.receiptId, lineId: question.lineId });
      activeQuestion = null;
      questionKey = null;
      await refresh();
    } catch (error) {
      showError(error);
      button.disabled = false;
    }
  });
  elements.question.append(form);
}

function renderReceipts() {
  selectedReceipt ??= session.receipts[0]?.id;
  elements['receipt-tabs'].replaceChildren(...session.receipts.map((receipt, index) => {
    const button = node('button', 'Чек ' + (index + 1), 'tab');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(receipt.id === selectedReceipt));
    button.onclick = () => { selectedReceipt = receipt.id; renderReceipts(); };
    return button;
  }));
  const receipt = session.receipts.find(({ id }) => id === selectedReceipt);
  if (!receipt) return;
  elements['photo-frame'].hidden = false;
  if (elements['receipt-photo'].getAttribute('src') !== receipt.url) elements['receipt-photo'].src = receipt.url;
  displayBox();
  const details = session.reviewReceipts?.find(({ receiptId }) => receiptId === receipt.id);
  elements['receipt-items'].replaceChildren(node('p', receipt.filename, 'muted'));
  if (!details) return;
  const locked = ['send_confirmed', 'sending', 'approved', 'delivery_unknown', 'submitted_for_review'].includes(session.status);
  for (const line of details.lines) {
    const row = node('div', undefined, 'receipt-row');
    row.append(node('span', line.description), node('strong', money(line.cents)));
    if (!locked) {
      const edit = node('button', 'Правка', 'quiet');
      edit.onclick = () => openQuestion({ field: 'amount', message: 'Цена: ' + line.description,
        receiptId: receipt.id, lineId: line.id, lineIds: line.lineIds, value: line.cents === null ? undefined : line.cents / 100 });
      row.append(edit);
    }
    elements['receipt-items'].append(row);
  }
  if (!locked && details.sourceLines.length) {
    const add = node('button', 'Добавить строку', 'quiet');
    add.onclick = () => openQuestion({ field: 'add', message: 'Добавить позицию по оригиналу', receiptId: receipt.id });
    const total = node('button', 'Исправить итог', 'quiet');
    total.onclick = () => openQuestion({ field: 'total', message: 'Итог по оригиналу', receiptId: receipt.id });
    elements['receipt-items'].append(add, total);
  }
}

function renderSummary() {
  elements.summary.replaceChildren();
  const result = session.calculation;
  if (!result) return;
  elements.summary.append(node('h2', 'Расчёт'));
  const grid = node('dl', undefined, 'metrics');
  for (const [label, value] of [
    ['Сумма чеков', result.receiptTotalCents], ['Исключено', result.excludedCents],
    ['Лимит питания', result.mealLimit], ['В пределах лимита', result.standardCents],
    ['Превышение', result.excessCents], ['Заявлено', result.requestedCents],
  ]) {
    const metric = node('div');
    metric.append(node('dt', label), node('dd', money(value)));
    grid.append(metric);
  }
  elements.summary.append(grid);
  for (const item of result.items.filter((entry) => entry.reason)) {
    elements.summary.append(node('p', item.description + ': ' + item.reason, 'muted'));
  }
  for (const finding of session.findings ?? []) {
    elements.summary.append(node('p', finding.message, finding.informational ? 'muted' : 'notice'));
  }
}

function renderDraft() {
  elements.draft.replaceChildren();
  if (!session.draft) return;
  const draft = session.draft;
  const details = node('details');
  details.append(node('summary', 'Письмо · версия ' + draft.revision),
    node('p', 'Кому: ' + draft.to), node('p', 'Тема: ' + draft.subject),
    node('pre', draft.preview ?? draft.text));
  const list = node('ul');
  for (const attachment of draft.attachments) list.append(node('li', attachment.filename));
  details.append(list);
  if (['waiting_for_send_confirmation', 'send_failed', 'delivery_unknown'].includes(session.status)) {
    details.open = true;
    const label = {
      waiting_for_send_confirmation: 'Подтвердить и отправить',
      send_failed: 'Подтвердить повторную попытку',
      delivery_unknown: 'Проверить доставку',
    }[session.status];
    const button = node('button', label);
    button.onclick = async () => {
      button.disabled = true;
      showError(null);
      try {
        const result = await post(endpoint + '/confirm-send', { revision: draft.revision });
        if (result.error) showError(new Error(result.error));
        await refresh();
      } catch (error) {
        showError(error);
        button.disabled = false;
      }
    };
    details.append(button);
  }
  elements.draft.append(details);
}

function render() {
  elements.status.textContent = statusLabels[session.status] ?? session.status;
  renderQuestion();
  renderSummary();
  renderReceipts();
  renderDraft();
  if (session.status === 'submitted_for_review' && session.latestCheck?.verdict === 'red') {
    const editVersion = node('button', 'Вернуть заявку на правку', 'secondary');
    editVersion.onclick = async () => {
      try { await post(endpoint + '/reopen', {}); await refresh(); }
      catch (error) { showError(error); }
    };
    elements.draft.append(editVersion);
  }
  if (session.status === 'waiting_for_input' && session.revision && !session.questions?.length) {
    const editContext = node('button', 'Изменить сведения мероприятия', 'quiet');
    editContext.onclick = () => {
      const fields = {
        type: { options: { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', other: 'Другое' } },
        date: { input: 'date' }, attendees: { input: 'integer' }, purpose: { input: 'text' },
        funding: { options: { sponsored: 'Спонсорские', federal: 'Федеральные', discretionary: 'Дискреционные',
          general: 'Общие', unknown: 'Неизвестно' } },
        paidByClaimant: { options: { yes: 'Да', no: 'Нет' } },
        priorReimbursementCents: { input: 'money' }, excessReason: { input: 'text' },
      };
      const form = node('div', undefined, 'actions');
      for (const [name, label] of Object.entries({ type:'Тип', date:'Дата', attendees:'Участники', purpose:'Цель',
        funding:'Финансирование', paidByClaimant:'Оплата заявителем', priorReimbursementCents:'Предыдущее возмещение',
        excessReason:'Обоснование превышения' })) {
        const button = node('button', label, 'quiet');
        button.onclick = () => openQuestion({ field: name, message: label, ...fields[name],
          value: name === 'priorReimbursementCents' ? session.context[name] / 100 : session.context[name] });
        form.append(button);
      }
      editContext.replaceWith(form);
    };
    elements.draft.append(editContext);
  }
}

async function refresh() {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  try {
    do {
      refreshAgain = false;
      session = await api(endpoint);
      render();
    } while (refreshAgain);
  } finally {
    refreshing = false;
  }
}

function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = setTimeout(() => {
    refreshQueued = null;
    refresh().catch(showError);
  }, 50);
}

try {
  setNav((await api('/api/me')).user);
  await refresh();
  const events = new EventSource(endpoint + '/events');
  events.onmessage = (message) => {
    const event = JSON.parse(message.data);
    elements.timeline.append(node('li', dateTime(event.occurredAt) + ' · ' + (eventLabels[event.type] ?? event.type)));
    queueRefresh();
  };
} catch (error) {
  showError(error);
}
