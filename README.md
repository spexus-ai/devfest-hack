# Expense Reports Autopilot

Прототип для Challenge B. Сотрудник загружает чеки и подтверждает письмо в Mailpit. Назначенный согласующий открывает заявку, повторно проверяет вложения и утверждает зелёную версию. Оба решения видны в журнале.

## Запуск

Приложению нужны `OPENROUTER_API_KEY` и `TYPESAFE_API_KEY`. Docker Compose читает локальный `.env`, исключённый из Git и сборки образа.

```sh
docker compose up --build -d
```

Порт приложения — 3000, Mailpit — 8025. Порты на хосте переопределяются через `EXPENSE_APP_PORT` и `EXPENSE_MAILPIT_PORT`.

| Роль | Тестовая учётная запись | Пароль |
| --- | --- | --- |
| Заявитель | `employee@example.test` | `employee-demo` |
| Согласующий | `reviewer@example.test` | `reviewer-demo` |

Кабинет согласующего расположен на `/approvals`, журнал — на `/audit`. Политика U-M монтируется только для чтения. SQLite и оригиналы сохраняются в `./data`.

## Проверка

```sh
docker compose exec -T app npm run smoke
docker compose exec -T app npm run verify
```

Сквозная проверка создаёт заявки из синтетических чеков и тестовые письма в Mailpit. Для замера активных минут команда `npm run measure:demo` принимает фактические результаты `--manual-employee`, `--manual-reviewer`, `--autopilot-employee` и `--autopilot-reviewer`.

[Спецификация](SPEC.md) · [Архитектура](TECH_SPEC.md) · [Задачи](TASKS.md) · [Журнал исполнения](EXECUTION_LOG.md)
