import { api, conversionText, dateTime, eventLabels, money, node, post, setNav, showError, statusLabels } from './ui.js';
import { legacyMessage } from './legacy-messages.js';

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
  const box = receipt?.sourceLines.find((line) => target?.lineIds?.includes(line.id))?.box;
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
    elements.question.append(...session.questions.map(({ message }) => node('p', legacyMessage(message), 'notice')));
    if (session.canReprocessCurrency) elements.question.append(retryButton('Recalculate in USD'));
    if (session.questions.some(({ code }) => ['DOCUMENTS_UNMATCHED', 'ITEMIZED_DOCUMENT_MISSING', 'RECEIPT_UNREADABLE'].includes(code))) {
      const upload = node('a', 'Upload photos', 'button');
      upload.href = '/';
      elements.question.append(upload);
    }
    return;
  }
  if (session.failure) {
    elements.question.append(node('p', legacyMessage(session.failure), 'error'), retryButton('Retry check'));
    return;
  }
  if (!question || question.field === 'reconcile') {
    if (question) elements.question.append(node('p', legacyMessage(question.message), 'question-text'));
    return;
  }
  const form = node('form', undefined, 'question-form');
  const title = legacyMessage(question.message ?? question.text) ?? 'Please provide more details.';
  form.append(node('h2', title));
  const details = session.reviewReceipts?.find(({ receiptId }) => receiptId === question.receiptId);
  const currency = details?.currency?.value ?? (question.receiptId ? null : 'USD');
  const amountLabel = currency ? 'Amount in ' + currency : 'Amount on the receipt';
  if (question.field === 'add') {
    form.append(field('Description', input('description', 'text')));
    form.append(field('Line type', select('kind', { item: 'Item', discount: 'Discount',
      ...(!details.tax && { tax: 'Tax' }), fee: 'Fee', tip: 'Tip' })));
    form.append(field('OCR line', select('sourceLineId', Object.fromEntries(details.sourceLines.map(({ id, text }) => [id, text])))));
    form.append(field(amountLabel, input('value', 'number')));
  } else if (question.field === 'allocation') {
    form.append(node('p', 'Split ' + money(question.amount, currency) + ' across the categories below.'));
    for (const [key, label] of Object.entries({ meals: 'Meals', alcohol: 'Alcohol', excluded: 'Excluded expenses' })) {
      form.append(field(label + (currency ? ', ' + currency : ''), input(key, 'number', '0')));
    }
  } else if (question.field === 'category') {
    form.append(field('Category', select('value', {
      food: 'Food', soft_drink: 'Non-alcoholic drink', alcohol: 'Alcohol',
      restricted_drink: 'Prohibited drink', other: 'Other',
    })));
  } else if (question.field === 'currency') {
    const choice = select('value', { '': 'Select a currency', USD: 'USD', RUB: 'RUB', EUR: 'EUR' });
    choice.required = true;
    form.append(field('Receipt currency', choice));
  } else if (question.field === 'purpose') {
    const answer = node('textarea');
    Object.assign(answer, { name: 'value', rows: 4, required: true, maxLength: 800, value: session.context.purpose ?? '' });
    form.append(node('p', 'Include the teams or roles involved and the topic. For example, “Discussed the integration timeline and assigned release tasks with the development team.”', 'muted'));
    form.append(field('Business purpose', answer));
  } else if (question.options) {
    const options = Object.fromEntries(Object.entries(question.options).map(([value, label]) => [value, legacyMessage(label)]));
    form.append(field('Answer', select('value', options, question.value)));
  } else {
    const type = ['amount', 'total', 'taxAmount'].includes(question.field) || ['integer', 'money'].includes(question.input)
      ? 'number' : ['date', 'time'].includes(question.input) ? question.input : 'text';
    const control = input('value', type, question.value);
    if (question.input === 'integer') {
      control.step = '1';
      control.min = '1';
    }
    form.append(field(type === 'number' && question.input !== 'integer' ? amountLabel : 'Answer', control));
  }
  const actions = node('div', undefined, 'actions');
  const button = node('button', 'Save answer');
  actions.append(button);
  if (question.field === 'time' && session.contextSources?.time?.source !== 'receipt') {
    const skip = node('button', 'Time unknown', 'secondary');
    skip.type = 'button';
    skip.onclick = async () => {
      skip.disabled = true;
      try { await post(endpoint + '/messages', { field: 'time', value: null }); await refresh(); }
      catch (error) { showError(error); skip.disabled = false; }
    };
    actions.append(skip);
  }
  if (activeQuestion) {
    const cancel = node('button', 'Cancel', 'quiet');
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
    if (['add', 'amount', 'total', 'taxAmount'].includes(question.field) || question.input === 'money') value = Math.round(Number(value) * 100);
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
    const button = node('button', 'Photo ' + (index + 1), 'tab');
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
  const locked = ['send_confirmed', 'sending', 'approved', 'delivery_unknown', 'submitted_for_review', 'manual_review_required'].includes(session.status);
  const currency = details.currency?.value ?? null;
  if (details.merchant?.value) elements['receipt-items'].append(node('p', details.merchant.value));
  const conversion = session.receiptConversions?.find(({ receiptId }) => receiptId === receipt.id);
  const when = [details.date?.value, details.time?.value].filter(Boolean).join(' · ');
  if (when) elements['receipt-items'].append(node('p', 'On the receipt · ' + when, 'muted'));
  if (conversion) {
    elements['receipt-items'].append(node('p', conversionText(conversion)));
  }
  if (!conversion && details.total?.cents != null) {
    elements['receipt-items'].append(node('p', 'Total · ' + money(details.total.cents, currency)));
  }
  const hasTax = details.tax?.cents != null || Boolean(details.tax?.treatment);
  if (details.tax && (hasTax || !locked)) {
    const options = { included: 'Included in prices', added: 'Added to prices' };
    const tax = node('div', undefined, 'receipt-row');
    if (hasTax) {
      tax.append(node('span', ['Tax', options[details.tax.treatment]].filter(Boolean).join(' · ')),
        node('strong', money(details.tax.cents, currency)));
    }
    if (!locked) {
      const editAmount = node('button', hasTax ? 'Correct tax' : 'Add tax', 'quiet');
      editAmount.onclick = () => openQuestion({ field: 'taxAmount', message: 'Tax amount on the receipt', receiptId: receipt.id,
        lineIds: details.tax.lineIds, value: details.tax.cents == null ? undefined : details.tax.cents / 100 });
      tax.append(editAmount);
      if (hasTax) {
        const editTreatment = node('button', 'Tax treatment', 'quiet');
        editTreatment.onclick = () => openQuestion({ field: 'taxTreatment', message: 'Is the tax already included in the item prices?',
          receiptId: receipt.id, lineIds: details.tax.lineIds, options, value: details.tax.treatment ?? undefined });
        tax.append(editTreatment);
      }
    }
    elements['receipt-items'].append(tax);
  }
  for (const line of details.lines) {
    if (line.id === receipt.id + '-tax') continue;
    const row = node('div', undefined, 'receipt-row');
    row.append(node('span', line.description), node('strong', money(line.cents, currency)));
    if (!locked) {
      const edit = node('button', 'Edit', 'quiet');
      edit.onclick = () => openQuestion({ field: 'amount', message: 'Price for ' + line.description,
        receiptId: receipt.id, lineId: line.id, lineIds: line.lineIds, value: line.cents === null ? undefined : line.cents / 100 });
      row.append(edit);
    }
    elements['receipt-items'].append(row);
  }
  if (!locked && details.sourceLines.length) {
    const add = node('button', 'Add line', 'quiet');
    add.onclick = () => openQuestion({ field: 'add', message: 'Add a line from the original receipt', receiptId: receipt.id });
    const total = node('button', 'Correct total', 'quiet');
    total.onclick = () => openQuestion({ field: 'total', message: 'Total on the original receipt', receiptId: receipt.id });
    elements['receipt-items'].append(add, total);
  }
}

function renderSummary() {
  elements.summary.replaceChildren();
  const result = session.calculation;
  if (!result) return;
  elements.summary.append(node('h2', 'Reimbursement breakdown'));
  const grid = node('dl', undefined, 'metrics');
  for (const [label, value] of [
    ['Receipt total', result.receiptTotalCents], ['Excluded', result.excludedCents],
    ['Meal limit', result.mealLimit], ['Within limit', result.standardCents],
    ['Over limit', result.excessCents], ['Requested', result.requestedCents],
  ]) {
    const metric = node('div');
    metric.append(node('dt', label), node('dd', money(value)));
    grid.append(metric);
  }
  elements.summary.append(grid);
  const reasons = {
    OUTSIDE_MEAL_POLICY: 'Outside the meal policy',
    ALCOHOL_FUNDING_RESTRICTION: 'Alcohol is ineligible with federal or sponsored funding',
  };
  for (const item of result.items.filter((entry) => entry.reason)) {
    elements.summary.append(node('p', item.description + ' · ' + (reasons[item.reason] ?? item.reason), 'muted'));
  }
  for (const finding of session.findings ?? []) {
    elements.summary.append(node('p', legacyMessage(finding.message), finding.informational ? 'muted' : 'notice'));
  }
}

function renderDraft() {
  elements.draft.replaceChildren();
  if (!session.draft) return;
  const draft = session.draft;
  const details = node('details');
  details.append(node('summary', 'Email · version ' + draft.revision),
    node('p', 'To · ' + draft.to), node('p', 'Subject · ' + draft.subject),
    node('pre', draft.preview ?? draft.text));
  const list = node('ul');
  for (const attachment of draft.attachments) list.append(node('li', attachment.filename));
  details.append(list);
  if (['waiting_for_send_confirmation', 'send_failed', 'delivery_unknown'].includes(session.status)) {
    details.open = true;
    const label = {
      waiting_for_send_confirmation: 'Confirm and send',
      send_failed: 'Confirm retry',
      delivery_unknown: 'Check delivery',
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
    const reprocess = node('button', 'Run OCR again', 'secondary');
    reprocess.onclick = async () => {
      if (session.corrections?.length && !window.confirm('Running OCR again will replace manual edits to receipt fields. Continue?')) return;
      reprocess.disabled = true;
      try { await post(endpoint + '/retry', { reprocessOcr: true }); await refresh(); }
      catch (error) { showError(error); reprocess.disabled = false; }
    };
    elements.draft.append(reprocess);
  }
  if (session.status === 'submitted_for_review' && session.latestCheck?.verdict === 'red') {
    const editVersion = node('button', 'Return request for editing', 'secondary');
    editVersion.onclick = async () => {
      try { await post(endpoint + '/reopen', {}); await refresh(); }
      catch (error) { showError(error); }
    };
    elements.draft.append(editVersion);
  }
  if (session.status === 'waiting_for_send_confirmation'
      || (session.status === 'waiting_for_input' && session.revision && !session.questions?.length)) {
    const editContext = node('button', 'Edit event details', 'quiet');
    editContext.onclick = () => {
      const fields = {
        type: { options: { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', other: 'Other' } },
        date: { input: 'date' }, time: { input: 'time' }, attendees: { input: 'integer' }, purpose: { input: 'text' },
        funding: { options: { sponsored: 'Sponsored funds', federal: 'Federal funds', discretionary: 'Discretionary funds',
          general: 'General funds', unknown: 'Unknown' } },
        paidByClaimant: { options: { yes: 'Yes', no: 'No' } },
        excessReason: { input: 'text' },
      };
      const form = node('div', undefined, 'actions');
      for (const [name, label] of Object.entries({ type:'Type', date:'Date', time:'Time', attendees:'Attendees', purpose:'Purpose',
        funding:'Funding', paidByClaimant:'Paid by claimant',
        excessReason:'Reason for exceeding the limit' })) {
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
