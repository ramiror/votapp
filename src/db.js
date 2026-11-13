const { DatabaseSync } = require('node:sqlite');

function openDb(path = process.env.DB_PATH || 'votapp.db') {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS members (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pin_hash     TEXT,                    -- NULL = todavía nadie reclamó este nombre
      is_admin     INTEGER NOT NULL DEFAULT 0,
      failed       INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS topics (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      author_id  INTEGER NOT NULL REFERENCES members(id),
      open       INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS options (
      topic_id INTEGER NOT NULL REFERENCES topics(id),
      idx      INTEGER NOT NULL,
      label    TEXT NOT NULL,
      PRIMARY KEY (topic_id, idx)
    );
    -- Un voto vigente por persona por tema, garantizado por la PK.
    CREATE TABLE IF NOT EXISTS votes (
      topic_id   INTEGER NOT NULL REFERENCES topics(id),
      member_id  INTEGER NOT NULL REFERENCES members(id),
      option_idx INTEGER NOT NULL,
      voted_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (topic_id, member_id),
      FOREIGN KEY (topic_id, option_idx) REFERENCES options(topic_id, idx)
    );
    -- Registro append-only de cada intento de voto.
    CREATE TABLE IF NOT EXISTS vote_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id   INTEGER NOT NULL,
      member_id  INTEGER NOT NULL,
      option_idx INTEGER NOT NULL,
      result     TEXT NOT NULL,             -- 'new' | 'changed' | 'duplicate'
      ip         TEXT,
      at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

module.exports = { openDb };
