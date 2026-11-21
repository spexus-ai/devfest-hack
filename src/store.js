import { DatabaseSync } from 'node:sqlite';

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drafts (
      session_id TEXT NOT NULL REFERENCES sessions(id), revision INTEGER NOT NULL,
      message_id TEXT NOT NULL UNIQUE, data TEXT NOT NULL,
      PRIMARY KEY (session_id, revision)
    );
    CREATE TABLE IF NOT EXISTS checks (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
      revision INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mail_imports (
      session_id TEXT NOT NULL REFERENCES sessions(id), revision INTEGER NOT NULL,
      mailpit_id TEXT NOT NULL UNIQUE, data TEXT NOT NULL,
      PRIMARY KEY (session_id, revision)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id),
      occurred_at TEXT NOT NULL, actor_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_by_session ON events(session_id, id);
  `);

  const rowData = (row) => row ? JSON.parse(row.data) : null;

  function atomic(operation) {
    if (db.isTransaction) return operation();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function getSession(id) {
    return rowData(db.prepare('SELECT data FROM sessions WHERE id = ?').get(id));
  }

  function record(sessionId, type, data = {}, actorId = 'system') {
    const occurredAt = new Date().toISOString();
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO events(session_id, occurred_at, actor_id, type, data) VALUES (?, ?, ?, ?, ?)',
    ).run(sessionId, occurredAt, actorId, type, JSON.stringify(data));
    return { id: Number(lastInsertRowid), sessionId, occurredAt, actorId, type, data };
  }

  function createSession(session) {
    return atomic(() => {
      const created = { ...session, createdAt: new Date().toISOString() };
      db.prepare('INSERT INTO sessions(id, created_at, data) VALUES (?, ?, ?)').run(
        created.id, created.createdAt, JSON.stringify(created),
      );
      record(created.id, 'session_created', { status: created.status, policyId: created.policy.id, policyHash: created.policy.sha256 },
        created.claimantId);
      return created;
    });
  }

  function updateSession(id, mutator, event) {
    return atomic(() => {
      const session = getSession(id);
      if (!session) throw Object.assign(new Error('Сессия отсутствует.'), { status: 404 });
      const after = { ...session, ...mutator(session) };
      db.prepare('UPDATE sessions SET data = ? WHERE id = ?').run(JSON.stringify(after), id);
      if (event) {
        record(id, event.type, { ...event.data, before: session.status, after: after.status,
          revision: after.revision ?? null }, event.actorId);
      }
      return after;
    });
  }

  function updateDraft(id, revision, mutator) {
    return atomic(() => {
      const draft = getDraft(id, revision);
      if (!draft) throw Object.assign(new Error('Версия письма отсутствует.'), { status: 404 });
      const after = { ...draft, ...mutator(draft) };
      db.prepare('UPDATE drafts SET data = ? WHERE session_id = ? AND revision = ?')
        .run(JSON.stringify(after), id, revision);
      return after;
    });
  }

  function getDraft(id, revision) {
    return rowData(db.prepare('SELECT data FROM drafts WHERE session_id = ? AND revision = ?').get(id, revision));
  }

  return {
    close: () => db.close(),
    atomic, createSession, getSession, updateSession, record,
    listSessions: () => db.prepare('SELECT data FROM sessions ORDER BY created_at DESC').all().map(rowData),
    addReceipt(sessionId, receipt) {
      db.prepare('INSERT INTO receipts(id, session_id, data) VALUES (?, ?, ?)')
        .run(receipt.id, sessionId, JSON.stringify(receipt));
    },
    listReceipts: (id) => db.prepare('SELECT data FROM receipts WHERE session_id = ? ORDER BY rowid').all(id).map(rowData),
    addDraft(draft) {
      db.prepare('INSERT INTO drafts(session_id, revision, message_id, data) VALUES (?, ?, ?, ?)')
        .run(draft.sessionId, draft.revision, draft.messageId, JSON.stringify(draft));
      return draft;
    },
    getDraft, updateDraft,
    findDraftByMessageId: (id) => rowData(db.prepare('SELECT data FROM drafts WHERE message_id = ?').get(id)),
    putCheck(check) {
      db.prepare('INSERT INTO checks(id, session_id, revision, data) VALUES (?, ?, ?, ?)')
        .run(check.id, check.sessionId, check.revision, JSON.stringify(check));
      return check;
    },
    latestCheck: (id, revision) => rowData(db.prepare(
      'SELECT data FROM checks WHERE session_id = ? AND revision = ? ORDER BY rowid DESC LIMIT 1',
    ).get(id, revision)),
    getImport: (id, revision) => rowData(db.prepare(
      'SELECT data FROM mail_imports WHERE session_id = ? AND revision = ?',
    ).get(id, revision)),
    importMail(entry) {
      const result = db.prepare(`
        INSERT INTO mail_imports(session_id, revision, mailpit_id, data) VALUES (?, ?, ?, ?)
        ON CONFLICT DO NOTHING
      `).run(entry.sessionId, entry.revision, entry.mailpitId, JSON.stringify(entry));
      return result.changes === 1;
    },
    events: (id, since = 0) => db.prepare(`
      SELECT id, session_id AS sessionId, occurred_at AS occurredAt, actor_id AS actorId, type, data
      FROM events WHERE session_id = ? AND id > ? ORDER BY id
    `).all(id, since).map((event) => ({ ...event, data: JSON.parse(event.data) })),
  };
}
