// Lógica pura de votaciones: no sabe nada de WhatsApp, así se testea fácil.
const PREFIX = '!';
const MAX_OPTIONS = 10;

const HELP = `🗳️ *Votapp* — comandos:
• !proponer Pregunta | Opción 1 | Opción 2 ...  (sin opciones = Sí/No)
• !temas — temas abiertos
• !votar <tema> <opción> — ej: !votar 3 2 (podés cambiar tu voto)
• !resultados <tema>
• !quien <tema> — quién votó qué
• !cerrar <tema> — solo quien lo propuso o un admin`;

function createVotapp(db) {
  const q = {
    insTopic: db.prepare('INSERT INTO topics (chat_id, title, author) VALUES (?, ?, ?)'),
    insOption: db.prepare('INSERT INTO options (topic_id, idx, label) VALUES (?, ?, ?)'),
    topic: db.prepare('SELECT * FROM topics WHERE id = ? AND chat_id = ?'),
    openTopics: db.prepare(`
      SELECT t.id, t.title, COUNT(v.voter) AS n
      FROM topics t LEFT JOIN votes v ON v.topic_id = t.id
      WHERE t.chat_id = ? AND t.open = 1 GROUP BY t.id ORDER BY t.id`),
    options: db.prepare('SELECT idx, label FROM options WHERE topic_id = ? ORDER BY idx'),
    getVote: db.prepare('SELECT option_idx FROM votes WHERE topic_id = ? AND voter = ?'),
    upsertVote: db.prepare(`
      INSERT INTO votes (topic_id, voter, voter_name, option_idx) VALUES (?, ?, ?, ?)
      ON CONFLICT (topic_id, voter) DO UPDATE SET
        option_idx = excluded.option_idx, voter_name = excluded.voter_name, voted_at = datetime('now')`),
    log: db.prepare('INSERT INTO vote_log (topic_id, voter, voter_name, option_idx, result) VALUES (?, ?, ?, ?, ?)'),
    tally: db.prepare(`
      SELECT o.idx, o.label, COUNT(v.voter) AS n
      FROM options o LEFT JOIN votes v ON v.topic_id = o.topic_id AND v.option_idx = o.idx
      WHERE o.topic_id = ? GROUP BY o.idx ORDER BY o.idx`),
    voters: db.prepare(`
      SELECT v.voter, v.voter_name, o.label, v.voted_at
      FROM votes v JOIN options o ON o.topic_id = v.topic_id AND o.idx = v.option_idx
      WHERE v.topic_id = ? ORDER BY o.idx, v.voted_at`),
    close: db.prepare('UPDATE topics SET open = 0 WHERE id = ?'),
  };

  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };

  const who = (jid, name) => name || '+' + String(jid).split('@')[0];

  function getTopic(chatId, arg) {
    const id = parseInt(arg, 10);
    if (!Number.isInteger(id)) return [null, 'Pasame el número de tema. Ej: !resultados 3'];
    const t = q.topic.get(id, chatId);
    return t ? [t, null] : [null, `No existe el tema #${id} en este grupo.`];
  }

  function results(t) {
    const rows = q.tally.all(t.id);
    const total = rows.reduce((s, r) => s + r.n, 0);
    const lines = rows.map((r) => {
      const pct = total ? Math.round((100 * r.n) / total) : 0;
      return `${r.idx}. ${r.label} — ${r.n} (${pct}%)`;
    });
    return `📊 #${t.id} ${t.title}${t.open ? '' : ' [CERRADO]'}\n${lines.join('\n')}\nTotal: ${total} voto(s)`;
  }

  const commands = {
    ayuda: () => HELP,

    proponer({ chatId, sender, args }) {
      const parts = args.split('|').map((s) => s.trim()).filter(Boolean);
      const title = parts.shift();
      if (!title) return 'Uso: !proponer Pregunta | Opción 1 | Opción 2';
      let opts = parts.length ? parts : ['Sí', 'No'];
      if (opts.length === 1) return 'Necesito al menos 2 opciones (o ninguna para Sí/No).';
      if (opts.length > MAX_OPTIONS) return `Máximo ${MAX_OPTIONS} opciones.`;
      if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return 'Hay opciones repetidas.';
      const id = tx(() => {
        const id = Number(q.insTopic.run(chatId, title, sender).lastInsertRowid);
        opts.forEach((o, i) => q.insOption.run(id, i + 1, o));
        return id;
      });
      const list = opts.map((o, i) => `${i + 1}. ${o}`).join('\n');
      return `🆕 Tema #${id}: ${title}\n${list}\nVotá con: !votar ${id} <número>`;
    },

    temas({ chatId }) {
      const rows = q.openTopics.all(chatId);
      if (!rows.length) return 'No hay temas abiertos. Proponé uno con !proponer';
      return '🗂️ Temas abiertos:\n' + rows.map((r) => `#${r.id} ${r.title} (${r.n} votos)`).join('\n');
    },

    votar({ chatId, sender, senderName, args }) {
      const [tArg, oArg] = args.split(/\s+/);
      const [t, err] = getTopic(chatId, tArg);
      if (err) return err;
      if (!t.open) return `El tema #${t.id} está cerrado.`;
      const opts = q.options.all(t.id);
      const idx = parseInt(oArg, 10);
      const opt = opts.find((o) => o.idx === idx);
      if (!opt) return `Opción inválida. Elegí entre 1 y ${opts.length}.`;

      return tx(() => {
        const prev = q.getVote.get(t.id, sender);
        const result = !prev ? 'new' : prev.option_idx === idx ? 'duplicate' : 'changed';
        q.log.run(t.id, sender, senderName ?? null, idx, result);
        if (result === 'duplicate') return `${who(sender, senderName)}, ya votaste "${opt.label}" en #${t.id}. Un voto por persona 😉`;
        q.upsertVote.run(t.id, sender, senderName ?? null, idx);
        return result === 'new'
          ? `✅ ${who(sender, senderName)} votó "${opt.label}" en #${t.id}`
          : `🔄 ${who(sender, senderName)} cambió su voto a "${opt.label}" en #${t.id}`;
      });
    },

    resultados({ chatId, args }) {
      const [t, err] = getTopic(chatId, args);
      return err || results(t);
    },

    quien({ chatId, args }) {
      const [t, err] = getTopic(chatId, args);
      if (err) return err;
      const rows = q.voters.all(t.id);
      if (!rows.length) return `Nadie votó todavía en #${t.id}.`;
      return `🧾 Votos en #${t.id} ${t.title}:\n` + rows.map((r) => `• ${who(r.voter, r.voter_name)} → ${r.label}`).join('\n');
    },

    cerrar({ chatId, sender, isAdmin, args }) {
      const [t, err] = getTopic(chatId, args);
      if (err) return err;
      if (t.author !== sender && !isAdmin) return 'Solo quien propuso el tema o un admin del grupo puede cerrarlo.';
      if (!t.open) return `El tema #${t.id} ya estaba cerrado.`;
      q.close.run(t.id);
      return '🔒 Cerrado.\n' + results({ ...t, open: 0 });
    },
  };
  commands.help = commands.ayuda;
  commands.quién = commands.quien;

  /**
   * @param {{chatId:string, sender:string, senderName?:string, isAdmin?:boolean, text:string}} msg
   * @returns {string|null} respuesta, o null si no es un comando
   */
  function handle(msg) {
    const text = (msg.text || '').trim();
    if (!text.startsWith(PREFIX)) return null;
    const m = text.slice(PREFIX.length).match(/^(\S+)\s*([\s\S]*)$/);
    if (!m) return null;
    const cmd = commands[m[1].toLowerCase()];
    if (!cmd) return null;
    return cmd({ ...msg, args: m[2].trim() });
  }

  return { handle };
}

module.exports = { createVotapp, HELP };
