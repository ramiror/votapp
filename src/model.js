// Lógica de negocio. No sabe nada de HTTP.
const crypto = require('node:crypto');

const MAX_OPTIONS = 10;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

class UserError extends Error {}

function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pin, salt, 32).toString('hex');
}
function checkPin(pin, stored) {
  const [salt, hash] = stored.split(':');
  const got = crypto.scryptSync(pin, Buffer.from(salt, 'hex'), 32);
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex'));
}

function createModel(db) {
  const q = (sql) => db.prepare(sql);
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };

  const m = {
    // --- miembros ---
    addMember(name, isAdmin = false) {
      name = String(name || '').trim();
      if (!name || name.length > 60) throw new UserError('Nombre inválido.');
      try {
        return Number(q('INSERT INTO members (name, is_admin) VALUES (?, ?)').run(name, isAdmin ? 1 : 0).lastInsertRowid);
      } catch (e) {
        if (/UNIQUE/.test(e.message)) throw new UserError(`"${name}" ya existe.`);
        throw e;
      }
    },
    members: () => q('SELECT id, name, is_admin, pin_hash IS NOT NULL AS claimed FROM members ORDER BY name').all(),
    member: (id) => q('SELECT id, name, is_admin FROM members WHERE id = ?').get(id),
    resetPin: (id) => tx(() => {
      q('UPDATE members SET pin_hash = NULL, failed = 0, locked_until = 0 WHERE id = ?').run(id);
      q('DELETE FROM sessions WHERE member_id = ?').run(id);
    }),
    setAdmin: (id, on) => q('UPDATE members SET is_admin = ? WHERE id = ?').run(on ? 1 : 0, id),

    // --- login: el primero que entra con un nombre le pone el PIN ---
    login(memberId, pin, now = Date.now()) {
      if (!/^\d{4,8}$/.test(pin || '')) throw new UserError('El PIN tiene que ser de 4 a 8 dígitos.');
      const row = q('SELECT * FROM members WHERE id = ?').get(memberId);
      if (!row) throw new UserError('Elegí tu nombre.');
      if (row.locked_until > now) throw new UserError('Demasiados intentos. Probá en unos minutos.');
      if (!row.pin_hash) {
        q('UPDATE members SET pin_hash = ? WHERE id = ? AND pin_hash IS NULL').run(hashPin(pin), memberId);
        return { claimed: true };
      }
      if (!checkPin(pin, row.pin_hash)) {
        const failed = row.failed + 1;
        q('UPDATE members SET failed = ?, locked_until = ? WHERE id = ?')
          .run(failed >= MAX_FAILS ? 0 : failed, failed >= MAX_FAILS ? now + LOCK_MS : 0, memberId);
        throw new UserError('PIN incorrecto.');
      }
      q('UPDATE members SET failed = 0 WHERE id = ?').run(memberId);
      return { claimed: false };
    },
    createSession(memberId) {
      const token = crypto.randomBytes(32).toString('base64url');
      q('INSERT INTO sessions (token, member_id) VALUES (?, ?)').run(token, memberId);
      return token;
    },
    sessionMember: (token) => token
      ? q('SELECT m.id, m.name, m.is_admin FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token = ?').get(token)
      : undefined,
    logout: (token) => q('DELETE FROM sessions WHERE token = ?').run(token),

    // --- temas ---
    propose(memberId, title, opts) {
      title = String(title || '').trim();
      opts = opts.map((o) => String(o).trim()).filter(Boolean);
      if (!title || title.length > 200) throw new UserError('Poné una pregunta (máx. 200 caracteres).');
      if (!opts.length) opts = ['Sí', 'No'];
      if (opts.length === 1) throw new UserError('Necesito al menos 2 opciones (o ninguna para Sí/No).');
      if (opts.length > MAX_OPTIONS) throw new UserError(`Máximo ${MAX_OPTIONS} opciones.`);
      if (opts.some((o) => o.length > 100)) throw new UserError('Opciones de máx. 100 caracteres.');
      if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) throw new UserError('Hay opciones repetidas.');
      return tx(() => {
        const id = Number(q('INSERT INTO topics (title, author_id) VALUES (?, ?)').run(title, memberId).lastInsertRowid);
        opts.forEach((o, i) => q('INSERT INTO options (topic_id, idx, label) VALUES (?, ?, ?)').run(id, i + 1, o));
        return id;
      });
    },
    topics: (memberId) => q(`
      SELECT t.id, t.title, t.open, a.name AS author,
             (SELECT COUNT(*) FROM votes v WHERE v.topic_id = t.id) AS n,
             EXISTS (SELECT 1 FROM votes v WHERE v.topic_id = t.id AND v.member_id = ?) AS voted
      FROM topics t JOIN members a ON a.id = t.author_id
      ORDER BY t.open DESC, t.id DESC`).all(memberId),
    topic: (id) => q(`
      SELECT t.*, a.name AS author FROM topics t JOIN members a ON a.id = t.author_id WHERE t.id = ?`).get(id),
    tally: (id) => q(`
      SELECT o.idx, o.label, COUNT(v.member_id) AS n
      FROM options o LEFT JOIN votes v ON v.topic_id = o.topic_id AND v.option_idx = o.idx
      WHERE o.topic_id = ? GROUP BY o.idx ORDER BY o.idx`).all(id),
    voters: (id) => q(`
      SELECT m.name, o.label FROM votes v
      JOIN members m ON m.id = v.member_id
      JOIN options o ON o.topic_id = v.topic_id AND o.idx = v.option_idx
      WHERE v.topic_id = ? ORDER BY o.idx, m.name`).all(id),
    myVote: (id, memberId) => q('SELECT option_idx FROM votes WHERE topic_id = ? AND member_id = ?').get(id, memberId)?.option_idx,

    vote(topicId, memberId, idx, ip = null) {
      const t = m.topic(topicId);
      if (!t) throw new UserError('Ese tema no existe.');
      if (!t.open) throw new UserError('El tema está cerrado.');
      idx = Number(idx);
      if (!q('SELECT 1 FROM options WHERE topic_id = ? AND idx = ?').get(topicId, idx)) throw new UserError('Elegí una opción.');
      return tx(() => {
        const prev = m.myVote(topicId, memberId);
        const result = prev === undefined ? 'new' : prev === idx ? 'duplicate' : 'changed';
        q('INSERT INTO vote_log (topic_id, member_id, option_idx, result, ip) VALUES (?, ?, ?, ?, ?)').run(topicId, memberId, idx, result, ip);
        if (result !== 'duplicate') {
          q(`INSERT INTO votes (topic_id, member_id, option_idx) VALUES (?, ?, ?)
             ON CONFLICT (topic_id, member_id) DO UPDATE SET option_idx = excluded.option_idx, voted_at = datetime('now')`)
            .run(topicId, memberId, idx);
        }
        return result;
      });
    },
    close(topicId, member) {
      const t = m.topic(topicId);
      if (!t) throw new UserError('Ese tema no existe.');
      if (t.author_id !== member.id && !member.is_admin) throw new UserError('Solo quien lo propuso o un admin puede cerrarlo.');
      q('UPDATE topics SET open = 0 WHERE id = ?').run(topicId);
    },
  };
  return m;
}

module.exports = { createModel, UserError };
