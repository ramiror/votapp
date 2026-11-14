const { DatabaseSync } = require('node:sqlite');

function openDb(path = process.env.DB_PATH || 'votapp.db') {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      handle     TEXT NOT NULL UNIQUE,          -- user.id de WebAuthn (opaco)
      is_admin   INTEGER NOT NULL DEFAULT 0,
      status     TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'active'
      wa_lid     TEXT UNIQUE,                   -- identidad de WhatsApp (LID y/o número)
      wa_pn      TEXT UNIQUE,
      wa_name    TEXT,                          -- nombre de perfil de WhatsApp
      in_group   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Passkeys: solo guardamos la clave pública de cada dispositivo.
    CREATE TABLE IF NOT EXISTS credentials (
      id         TEXT PRIMARY KEY,               -- credential ID (base64url)
      member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      public_key BLOB NOT NULL,
      counter    INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used  TEXT
    );
    -- Links de un solo uso para sumar un dispositivo o recuperar la cuenta.
    CREATE TABLE IF NOT EXISTS link_tokens (
      token      TEXT PRIMARY KEY,
      member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    -- Verificaciones por WhatsApp: el navegador muestra un código, la persona se lo manda al bot.
    CREATE TABLE IF NOT EXISTS verifications (
      code        TEXT PRIMARY KEY,
      browser_key TEXT NOT NULL UNIQUE,         -- ata el código a la cookie del navegador que lo pidió
      expires_at  INTEGER NOT NULL,
      wa_lid      TEXT,
      wa_pn       TEXT,
      wa_name     TEXT,
      in_group    INTEGER,
      verified_at INTEGER
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
      result     TEXT NOT NULL,                -- 'new' | 'changed' | 'duplicate'
      ip         TEXT,
      at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

module.exports = { openDb };
