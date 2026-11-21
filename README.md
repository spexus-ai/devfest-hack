# Expense Reports Autopilot

Prototype for Challenge B. An employee uploads receipts and confirms sending an email to Mailpit. The designated reviewer opens the request, checks the attachments again, and approves the version that passes the policy check. The audit log records both decisions.

## Getting started

The app requires `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY`. Docker Compose reads the local `.env` file, which is excluded from Git and the Docker build.

```sh
docker compose up --build -d
```

The app uses port 3000 and Mailpit uses port 8025. Set `EXPENSE_APP_PORT` and `EXPENSE_MAILPIT_PORT` to override the host ports.

| Role | Demo account | Password |
| --- | --- | --- |
| Claimant | `employee@example.test` | `employee-demo` |
| Reviewer | `reviewer@example.test` | `reviewer-demo` |

Open the reviewer dashboard at `/approvals` and the audit log at `/audit`. The app mounts the U-M policy as read-only and stores the SQLite database and original receipts in `./data`.

## Verification

```sh
docker compose exec -T app npm run smoke
docker compose exec -T app npm run verify
```

The end-to-end check creates requests from synthetic receipts and sends test emails to Mailpit. To compare active time spent, pass the measured minutes to `npm run measure:demo` using `--manual-employee`, `--manual-reviewer`, `--autopilot-employee`, and `--autopilot-reviewer`.

[Specification](SPEC.md) · [Architecture](TECH_SPEC.md) · [Tasks](TASKS.md) · [Implementation log](EXECUTION_LOG.md)
