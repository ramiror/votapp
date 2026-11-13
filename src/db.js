const { DatabaseSync } = require('node:sqlite');

function openDb(path = process.env.DB_PATH || 'votapp.db') {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS topics (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id    TEXT NOT NULL,
      title      TEXT NOT NULL,
      author     TEXT NOT NULL,
      open       INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS options (
      topic_id INTEGER NOT NULL REFERENCES topics(id),
      idx      INTEGER NOT NULL,
      label    TEXT NOT NULL,
      PRIMARY KEY (topic_id, idx)
    );
    -- Un voto vigente por persona por tema: la PK lo garantiza a nivel DB.
    CREATE TABLE IF NOT EXISTS votes (
      topic_id   INTEGER NOT NULL REFERENCES topics(id),
      voter      TEXT NOT NULL,
      voter_name TEXT,
      option_idx INTEGER NOT NULL,
      voted_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (topic_id, voter),
      FOREIGN KEY (topic_id, option_idx) REFERENCES options(topic_id, idx)
    );
    -- Registro append-only de cada intento de voto (incluye cambios y repetidos).
    CREATE TABLE IF NOT EXISTS vote_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id   INTEGER NOT NULL,
      voter      TEXT NOT NULL,
      voter_name TEXT,
      option_idx INTEGER NOT NULL,
      result     TEXT NOT NULL,           -- 'new' | 'changed' | 'duplicate'
      at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

module.exports = { openDb };
