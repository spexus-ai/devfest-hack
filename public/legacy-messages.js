// Translate generated text saved by earlier versions without changing the underlying records.
const savedMessages = {
  "Сумма после конвертации слишком велика.": "The converted amount is too large.",
  "На фотографии есть нечитаемая область. Загрузите более чёткий снимок.": "Part of the photo is unreadable. Upload a clearer photo.",
  "Укажите валюту, напечатанную на оригинале чека.": "Enter the currency printed on the original receipt.",
  "Укажите итог по оригиналу чека.": "Enter the total shown on the original receipt.",
  "Укажите итог, который совпадает с подтверждённой оплатой.": "Enter the total that matches the confirmed payment.",
  "Позиции, скидки и сборы не сходятся с итогом чека.": "Line items, discounts, and charges do not add up to the receipt total.",
  "Превышен лимит питания.": "The meal limit was exceeded.",
  "Превышен отдельный лимит алкоголя.": "The separate alcohol limit was exceeded.",
  "Алкоголь и относимые суммы исключены из федерального или спонсорского возмещения.": "Alcohol and related amounts are excluded from reimbursement with federal or sponsored funding.",
  "Для алкоголя нужно подтвердить допустимый источник финансирования.": "Confirm an eligible funding source for alcohol.",
  "Валюта в правке расходится с валютой на оригинале.": "The corrected currency differs from the currency on the original receipt.",
  "Ручную правку не удалось сопоставить со строкой оригинала.": "The manual correction could not be matched to a line on the original receipt.",
  "Кратко объясните, почему расходы превысили лимит.": "Briefly explain why the expenses exceeded the limit.",
  "SMTP отклонил отправку или оригинал недоступен.": "SMTP rejected the email or the original receipt is unavailable.",
  "Не удалось подтвердить исход доставки.": "The delivery outcome could not be confirmed.",
  "Jev вернул некорректную вероятность.": "Jev returned an invalid probability.",
  "Qwen не вернул читаемый JSON чека.": "Qwen did not return readable receipt JSON.",
  "Ответ Qwen не соответствует схеме чека.": "The Qwen response does not match the receipt schema.",
  "Ответ Qwen ссылается на отсутствующие строки OCR.": "The Qwen response references missing OCR lines.",
  "Завтрак": "Breakfast",
  "Обед": "Lunch",
  "Ужин": "Dinner",
  "Другое": "Other",
  "Спонсорские средства": "Sponsored funds",
  "Федеральные средства": "Federal funds",
  "Дискреционные средства": "Discretionary funds",
  "Общие средства": "General funds",
  "Неизвестно": "Unknown",
  "Какой это был тип делового мероприятия?": "What type of business meal or event was this?",
  "Когда состоялось мероприятие?": "On what date did the event take place?",
  "Во сколько состоялось мероприятие? Время не удалось подтвердить по чеку.": "What time did the event take place? The receipt did not confirm the time.",
  "Сколько человек участвовало?": "How many people attended?",
  "Какова конкретная деловая цель мероприятия?": "What was the specific business purpose of the event?",
  "Из какого источника запрашивается возмещение?": "Which funding source should cover the reimbursement?",
  "Вы лично оплатили расходы?": "Did you personally pay the expenses?",
  "Да": "Yes",
  "Нет": "No",
  "Дата мероприятия требует проверки применимости политики.": "Check which policy applies to the event date.",
  "С даты мероприятия прошло больше 60 дней.": "The event took place more than 60 days ago.",
  "Для этого типа мероприятия нужна отдельная проверка.": "This event type requires a separate review.",
  "Заявитель не подтвердил оплату расходов собой.": "The claimant has not confirmed that they paid the expenses personally.",
  "Источник возмещения пока не подтверждён.": "The funding source for reimbursement is still unconfirmed.",
  "Проверьте подтверждение выплаченной суммы и остаток к возмещению.": "Verify the amount already paid and the remaining reimbursement.",
  "Для этой суммы нужен детализированный чек.": "An itemized receipt is required for this amount.",
  "Весь недетализированный чек с алкоголем требует проверки ICRX.": "The entire non-itemized receipt containing alcohol requires ICRX review.",
  "Не удалось установить состав чека.": "The receipt line items could not be determined.",
  "На фото несколько документов, и их связь не подтверждена. Загрузите снимки отдельных покупок. Для каждой используйте один детализированный чек.": "The app could not link the documents in this photo. Upload a separate photo of one itemized receipt per purchase.",
  "Терминальный слип подтверждает оплату. Загрузите детализированный чек с позициями.": "A card terminal slip confirms payment. Upload an itemized receipt with the line items.",
  "В документе найдены суммы в нескольких валютах. Требуется сверка валюты покупки.": "The document shows amounts in multiple currencies. Verify the purchase currency.",
  "Почтовые реквизиты не совпадают с подтверждённой версией.": "The email headers do not match the confirmed version.",
  "Не удалось извлечь из письма данные заявки.": "The request data could not be extracted from the email.",
  "Данные письма расходятся с подтверждённой версией.": "The email data differs from the confirmed version.",
  "В письме отсутствует ожидаемое вложение или есть лишнее.": "The email has a missing or unexpected attachment.",
  "Байты вложения отличаются от оригинала.": "The attachment differs from the original file.",
  "Повторный расчёт отличается от суммы письма.": "The recalculated amount differs from the amount in the email.",
  "Валюта, курс или суммы пересчёта отличаются от данных письма.": "The currency, exchange rate, or converted amounts differ from those in the email.",
  "Повторный расчёт недоступен.": "The expense could not be recalculated.",
  "Подтвердите USD, только если это валюта оригинала чека.": "Confirm USD only if that is the currency on the original receipt.",
  "Укажите, что чек выставлен в USD.": "Confirm that the receipt is in USD.",
  "Сколько уже возместили из другого источника, в USD?": "How much has already been reimbursed from another source, in USD?",
  "Опишите, с кем и какой конкретный рабочий вопрос обсуждали.": "Who attended, and what specific work topic did you discuss?",
  "Уточните участников и конкретную рабочую тему.": "Specify who attended and the specific work topic.",
  "Сотрудник передал деловую цель на ручную проверку.": "The employee requested a manual review of the business purpose.",
  "При повторной проверке не удалось подтвердить дату мероприятия по чеку.": "The second check could not confirm the event date from the receipt.",
  "При повторной проверке не удалось подтвердить время мероприятия по чеку.": "The second check could not confirm the event time from the receipt."
};

const prefixes = new Map([
  ['Подтвердите цену позиции по оригиналу: ', 'Confirm this item price from the original receipt: '],
  ['Уточните, что это за позиция: ', 'Identify the category for this item: '],
  ['Укажите, к каким расходам относится сбор или скидка: ', 'Allocate this charge or discount to the expenses it applies to: '],
  ['Не удалось пересчитать сумму чека в ', 'Could not convert the receipt amount in '],
  ['Jev не вернул ожидаемый ответ ', 'Jev did not return the expected answer for '],
  ['Не настроен ключ ', 'The API key is not configured for '],
  ['Повторная проверка не завершилась: ', 'The review could not be completed: '],
]);

const mealTypes = { завтрак: 'breakfast', обед: 'lunch', ужин: 'dinner' };
const confirmedException = ' Обоснование и решение по исключению подтверждены.';

export function legacyMessage(value) {
  if (typeof value !== 'string') return value;
  if (Object.hasOwn(savedMessages, value)) return savedMessages[value];

  if (value.endsWith(confirmedException)) {
    return legacyMessage(value.slice(0, -confirmedException.length)) + ' The justification and exception approval have been verified.';
  }
  for (const [prefix, english] of prefixes) {
    if (value.startsWith(prefix)) {
      const detail = value.slice(prefix.length);
      return english + (prefix === 'Повторная проверка не завершилась: ' ? legacyMessage(detail) : detail);
    }
  }
  const currency = value.match(/^(?:Для валюты (.+) отсутствует курс\.|Распознана валюта (.+)\. Стенд рассчитывает возмещение по чекам в USD\.) Передайте этот расход на ручную проверку\.$/u);
  if (currency) return 'No exchange rate is available for ' + (currency[1] ?? currency[2]) + '. Send this expense for manual review.';

  const mismatch = value.match(/^Время (\d{2}:\d{2}) обычно соответствует типу «(завтрак|обед|ужин)»\. Подтвердите фактический тип мероприятия\.$/u);
  if (mismatch) return 'The time ' + mismatch[1] + ' usually indicates ' + mealTypes[mismatch[2]] + '. Confirm the actual meal type.';

  const httpError = value.match(/^(\S+) вернул HTTP (\d{3})\.$/u);
  if (httpError) return httpError[1] + ' returned HTTP ' + httpError[2] + '.';
  return value;
}
