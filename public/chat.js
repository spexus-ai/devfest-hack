import { api, conversionText, dateTime, eventLabels, money, node, post, setNav, showError, statusLabels } from './ui.js';

const id = new URLSearchParams(location.search).get('id');
const endpoint = '/api/sessions/' + encodeURIComponent(id ?? '');
const elements = Object.fromEntries(['status', 'question', 'summary', 'draft', 'receipt-tabs',
  'photo-frame', 'receipt-photo', 'receipt-items', 'highlight', 'timeline']
  .map((name) => [name, document.getElementById(name)]));
let session;
let selectedReceipt;
let selectedDocument;
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
  const box = receipt?.documents?.find(({ id }) => id === selectedDocument)?.box
    ?? receipt?.sourceLines.find((line) => target?.lineIds?.includes(line.id))?.box;
  const image = elements['receipt-photo'];
  elements.highlight.hidden = !box || !image.naturalWidth || !image.naturalHeight;
  if (elements.highlight.hidden) return;
  Object.assign(elements.highlight.style, {
    left: (box.left / image.naturalWidth * 100) + '%',
    top: (box.top / image.naturalHeight * 100) + '%',
    width: (box.width / image.naturalWidth * 100) + '%',
    height: (box.height / image.naturalHeight * 100) + '%',
  });
}
elements['receipt-photo'].addEventListener('load', displayBox);

function openQuestion(question) {
  activeQuestion = question;
  selectedDocument = null;
  selectedReceipt = question.receiptId ?? selectedReceipt;
  renderQuestion();
  renderReceipts();
}

function retryButton(label) {
  const retry = node('button', label, 'secondary');
  retry.addEventListener('click', async () => {
    retry.disabled = true;
    try { await post(endpoint + '/retry', {}); await refresh(); }
    catch (error) { showError(error); retry.disabled = false; }
  });
  return retry;
}

function renderQuestion() {
  const question = activeQuestion ?? session.questions?.[0];
  const key = JSON.stringify(question ?? null) + session.status;
  if (questionKey === key) return;
  questionKey = key;
  elements.question.replaceChildren();
  if (session.status === 'manual_review_required') {
    elements.question.append(...session.questions.map(({ message }) => node('p', message, 'notice')));
    if (session.canReprocessCurrency) elements.question.append(retryButton('Пересчитать в USD'));
    if (session.questions.some(({ code }) => code === 'DOCUMENTS_UNMATCHED' || code === 'ITEMIZED_DOCUMENT_MISSING')) {
      const upload = node('a', 'Загрузить снимки', 'button');
      upload.href = '/';
      elements.question.append(upload);
    }
    return;
  }
  if (session.failure) {
    elements.question.append(node('p', session.failure, 'error'), retryButton('Повторить проверку'));
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
  const currency = details?.currency?.value ?? (question.receiptId ? null : 'USD');
  const amountLabel = currency ? 'Сумма, ' + currency : 'Сумма по оригиналу';
  if (question.field === 'add') {
    form.append(field('Название', input('description', 'text')));
    form.append(field('Тип строки', select('kind', { item: 'Товар', discount: 'Скидка', tax: 'Налог', fee: 'Сбор', tip: 'Чаевые' })));
    form.append(field('Строка OCR', select('sourceLineId', Object.fromEntries(details.sourceLines.map(({ id, text }) => [id, text])))));
    form.append(field(amountLabel, input('value', 'number')));
  } else if (question.field === 'allocation') {
    form.append(node('p', 'Разложите ' + money(question.amount, currency) + ' по группам.'));
    for (const [key, label] of Object.entries({ meals: 'Питание', alcohol: 'Алкоголь', excluded: 'Исключённые расходы' })) {
      form.append(field(label + (currency ? ', ' + currency : ''), input(key, 'number', '0')));
    }
  } else if (question.field === 'category') {
    form.append(field('Категория', select('value', {
      food: 'Еда', soft_drink: 'Безалкогольный напиток', alcohol: 'Алкоголь',
      restricted_drink: 'Запрещённый напиток', other: 'Прочее',
    })));
  } else if (question.field === 'currency') {
    const choice = select('value', { '': 'Выберите валюту', USD: 'USD', RUB: 'RUB', EUR: 'EUR' });
    choice.required = true;
    form.append(field('Валюта на чеке', choice));
  } else if (question.field === 'purpose') {
    const answer = node('textarea');
    Object.assign(answer, { name: 'value', rows: 4, required: true, maxLength: 800, value: session.context.purpose ?? '' });
    form.append(node('p', 'Укажите роли или команды и тему. Например: «С командой разработки обсудили сроки интеграции и распределили задачи на релиз».', 'muted'));
    form.append(field('Деловая цель', answer));
  } else if (question.options) {
    form.append(field('Ответ', select('value', question.options, question.value)));
  } else {
    const type = ['amount', 'total'].includes(question.field) || ['integer', 'money'].includes(question.input)
      ? 'number' : ['date', 'time'].includes(question.input) ? question.input : 'text';
    const control = input('value', type, question.value);
    if (question.input === 'integer') {
      control.step = '1';
      control.min = '1';
    }
    form.append(field(type === 'number' && question.input !== 'integer' ? amountLabel : 'Ответ', control));
  }
  const actions = node('div', undefined, 'actions');
  const button = node('button', 'Сохранить ответ');
  actions.append(button);
  if (question.field === 'time' && session.contextSources?.time?.source !== 'receipt') {
    const skip = node('button', 'Время неизвестно', 'secondary');
    skip.type = 'button';
    skip.onclick = async () => {
      skip.disabled = true;
      try { await post(endpoint + '/messages', { field: 'time', value: null }); await refresh(); }
      catch (error) { showError(error); skip.disabled = false; }
    };
    actions.append(skip);
  }
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
    const button = node('button', 'Фото ' + (index + 1), 'tab');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(receipt.id === selectedReceipt));
    button.onclick = () => { selectedReceipt = receipt.id; selectedDocument = null; renderReceipts(); };
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
  const locked = ['send_confirmed', 'sending', 'approved', 'delivery_unknown', 'submitted_for_review', 'manual_review_required'].includes(session.status);
  const currency = details.currency?.value ?? null;
  const conversion = session.receiptConversions?.find(({ receiptId }) => receiptId === receipt.id);
  const when = [details.date?.value, details.time?.value].filter(Boolean).join(' · ');
  if (when) elements['receipt-items'].append(node('p', 'На чеке · ' + when, 'muted'));
  if (conversion) {
    elements['receipt-items'].append(node('p', (details.documents?.length > 1 ? 'Одна покупка · ' : '') + conversionText(conversion)));
  }
  if (details.documents?.length > 1) {
    if (!conversion && details.groupTotalCents != null) {
      elements['receipt-items'].append(node('p', 'Одна покупка · ' + money(details.groupTotalCents, currency)));
    }
    const titles = { fiscal: 'Кассовый чек', itemized_bill: 'Гостевой счёт', payment: 'Терминальный слип', receipt: 'Чек' };
    for (const document of details.documents) {
      const button = node('button', titles[document.type] + (document.date ? ' · ' + document.date : ''), 'quiet');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(document.id === selectedDocument));
      button.onclick = () => {
        selectedDocument = selectedDocument === document.id ? null : document.id;
        renderReceipts();
      };
      elements['receipt-items'].append(button);
    }
  }
  if (!conversion && details.documents?.length <= 1 && details.total?.cents != null) {
    elements['receipt-items'].append(node('p', 'Итого · ' + money(details.total.cents, currency)));
  }
  for (const line of details.lines) {
    const row = node('div', undefined, 'receipt-row');
    row.append(node('span', line.description), node('strong', money(line.cents, currency)));
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
  if (session.canReprocessOcr) {
    const reprocess = node('button', 'Распознать чек заново', 'secondary');
    reprocess.onclick = async () => {
      if (session.corrections?.length && !window.confirm('Повторное распознавание заменит ручные правки строк чека. Продолжить?')) return;
      reprocess.disabled = true;
      try { await post(endpoint + '/retry', { reprocessOcr: true }); await refresh(); }
      catch (error) { showError(error); reprocess.disabled = false; }
    };
    elements.draft.append(reprocess);
  }
  if (session.status === 'submitted_for_review' && session.latestCheck?.verdict === 'red') {
    const editVersion = node('button', 'Вернуть заявку на правку', 'secondary');
    editVersion.onclick = async () => {
      try { await post(endpoint + '/reopen', {}); await refresh(); }
      catch (error) { showError(error); }
    };
    elements.draft.append(editVersion);
  }
  if (session.status === 'waiting_for_send_confirmation'
      || (session.status === 'waiting_for_input' && session.revision && !session.questions?.length)) {
    const editContext = node('button', 'Изменить сведения мероприятия', 'quiet');
    editContext.onclick = () => {
      const fields = {
        type: { options: { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', other: 'Другое' } },
        date: { input: 'date' }, time: { input: 'time' }, attendees: { input: 'integer' }, purpose: { input: 'text' },
        funding: { options: { sponsored: 'Спонсорские', federal: 'Федеральные', discretionary: 'Дискреционные',
          general: 'Общие', unknown: 'Неизвестно' } },
        paidByClaimant: { options: { yes: 'Да', no: 'Нет' } },
        excessReason: { input: 'text' },
      };
      const form = node('div', undefined, 'actions');
      for (const [name, label] of Object.entries({ type:'Тип', date:'Дата', time:'Время', attendees:'Участники', purpose:'Цель',
        funding:'Финансирование', paidByClaimant:'Оплата заявителем',
        excessReason:'Обоснование превышения' })) {
        const button = node('button', label, 'quiet');
        button.onclick = () => openQuestion({ field: name, message: label, ...fields[name],
          value: session.context[name] ?? undefined });
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
