export async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (response.status === 401 && location.pathname !== '/') location.assign('/');
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || 'Запрос не выполнен (' + response.status + ').');
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
  target.textContent = error?.message ?? '';
  target.hidden = !error;
}

export function setNav(user) {
  const nav = document.querySelector('#nav');
  nav.replaceChildren();
  if (!user) return;
  const name = node('span', user.name, 'nav-name');
  nav.append(name);
  if (user.role === 'reviewer') {
    const approvals = node('a', 'Согласование');
    approvals.href = '/approvals';
    const audit = node('a', 'Журнал');
    audit.href = '/audit';
    nav.append(approvals, audit);
  }
  const logout = node('button', 'Выйти', 'quiet');
  logout.addEventListener('click', async () => {
    await post('/api/logout', {});
    location.assign('/');
  });
  nav.append(logout);
}

export const money = (cents) => Number.isInteger(cents)
  ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'USD' }).format(cents / 100)
  : '—';

export const statusLabels = {
  processing: 'Чеки обрабатываются', waiting_for_input: 'Нужно уточнение', checking_policy: 'Проверяем политику',
  waiting_for_send_confirmation: 'Готово к отправке', send_confirmed: 'Отправка подтверждена',
  sending: 'Отправляем письмо', submitted_for_review: 'На утверждении', approved: 'Расход утверждён',
  no_reimbursement: 'Нет суммы к возмещению', processing_failed: 'Ошибка обработки',
  send_failed: 'Письмо не отправлено', delivery_unknown: 'Статус доставки уточняется',
};

export const eventLabels = {
  session_created: 'Сессия создана', receipt_uploaded: 'Чек загружен', ocr_completed: 'Распознан текст чека',
  receipt_extracted: 'Выделены позиции', context_answered: 'Получен ответ', receipt_corrected: 'Данные исправлены',
  waiting_for_input: 'Нужны сведения', policy_check_started: 'Начата проверка политики',
  policy_check_completed: 'Проверка политики завершена', processing_failed: 'Ошибка обработки',
  processing_retried: 'Повтор этапа', draft_created: 'Создана версия письма', send_confirmed: 'Подтверждена отправка',
  mail_sent: 'Письмо принято Mailpit', mail_imported: 'Письмо открыто для согласования',
  review_started: 'Начата повторная проверка', review_completed: 'Получен вердикт',
  expense_approved: 'Расход утверждён', mail_send_failed: 'Ошибка доставки', delivery_unknown: 'Исход доставки неизвестен',
};

export const dateTime = (value) => value ? new Date(value).toLocaleString('ru-RU') : '—';
