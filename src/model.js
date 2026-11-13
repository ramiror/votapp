// Lógica de negocio. No sabe nada de HTTP.
const crypto = require('node:crypto');

const MAX_OPTIONS = 10;

class UserError extends Error {}

const rnd = (n) => crypto.randomBytes(n).toString('base64url');

function createModel(db) {
  const q = (sql) => db.prepare(sql);
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };

  const m = {
    // --- config ---
    setting: (k) => q('SELECT value FROM settings WHERE key = ?').get(k)?.value,
    setSetting: (k, v) => q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(k, v),
    invite() {
      let v = m.setting('invite');
      if (!v) m.setSetting('invite', (v = rnd(12)));
      return v;
    },
    rotateInvite: () => { m.setSetting('invite', rnd(12)); return m.setting('invite'); },

    // --- miembros ---
    checkName(name) {
      name = String(name || '').trim().replace(/\s+/g, ' ');
      if (!name || name.length > 40) throw new UserError('Poné un nombre (máx. 40 caracteres).');
      if (q('SELECT 1 FROM members WHERE name = ?').get(name)) throw new UserError(`Ya hay alguien registrado como "${name}". Usá otro nombre.`);
      return name;
    },
    /** Alta de miembro con su primera passkey. El primero del sistema queda admin y activo. */
    register(name, handle, cred) {
      return tx(() => {
        name = m.checkName(name);
        const first = !q('SELECT 1 FROM members LIMIT 1').get();
        const id = Number(q('INSERT INTO members (name, handle, is_admin, status) VALUES (?, ?, ?, ?)')
          .run(name, handle, first ? 1 : 0, first ? 'active' : 'pending').lastInsertRowid);
        m.addCredential(id, cred);
        return id;
      });
    },
    members: () => q(`
      SELECT m.id, m.name, m.is_admin, m.status, COUNT(c.id) AS devices
      FROM members m LEFT JOIN credentials c ON c.member_id = m.id GROUP BY m.id ORDER BY m.status DESC, m.name`).all(),
    member: (id) => q('SELECT id, name, handle, is_admin, status FROM members WHERE id = ?').get(id),
    approve: (id) => q("UPDATE members SET status = 'active' WHERE id = ?").run(id),
    reject(id) {
      const r = q("DELETE FROM members WHERE id = ? AND status = 'pending'").run(id);
      if (!r.changes) throw new UserError('Solo se pueden rechazar registros pendientes.');
    },
    setAdmin: (id, on) => q('UPDATE members SET is_admin = ? WHERE id = ?').run(on ? 1 : 0, id),

    // --- passkeys ---
    addCredential(memberId, c) {
      q('INSERT INTO credentials (id, member_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)')
        .run(c.id, memberId, c.publicKey, c.counter || 0, JSON.stringify(c.transports || []));
    },
    credential(id) {
      const r = q('SELECT * FROM credentials WHERE id = ?').get(String(id || ''));
      return r && { ...r, publicKey: new Uint8Array(r.public_key), transports: JSON.parse(r.transports || '[]') };
    },
    credentialIds: (memberId) => q('SELECT id, transports FROM credentials WHERE member_id = ?').all(memberId)
      .map((r) => ({ id: r.id, transports: JSON.parse(r.transports || '[]') })),
    touchCredential: (id, counter) => q("UPDATE credentials SET counter = ?, last_used = datetime('now') WHERE id = ?").run(counter, id),

    // --- links de un uso (sumar dispositivo / recuperar) ---
    createLink(memberId, ttlMs = 30 * 60_000, now = Date.now()) {
      const t = rnd(24);
      q('INSERT INTO link_tokens (token, member_id, expires_at) VALUES (?, ?, ?)').run(t, memberId, now + ttlMs);
      return t;
    },
    linkMember(token, now = Date.now()) {
      q('DELETE FROM link_tokens WHERE expires_at < ?').run(now);
      const r = q('SELECT member_id FROM link_tokens WHERE token = ?').get(String(token || ''));
      return r && m.member(r.member_id);
    },
    useLink(token, cred) {
      return tx(() => {
        const mem = m.linkMember(token);
        if (!mem) throw new UserError('El link venció o ya se usó. Pedí otro.');
        q('DELETE FROM link_tokens WHERE token = ?').run(token);
        m.addCredential(mem.id, cred);
        return mem.id;
      });
    },

    // --- sesiones ---
    createSession(memberId) {
      const token = rnd(32);
      q('INSERT INTO sessions (token, member_id) VALUES (?, ?)').run(token, memberId);
      return token;
    },
    sessionMember: (token) => token
      ? q('SELECT m.id, m.name, m.is_admin, m.status FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token = ?').get(token)
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
