const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CSS = `
:root{--bg:#f4f1ea;--card:#fff;--fg:#1d1d1b;--mut:#6b6b66;--line:#e2ddd2;--acc:#0b7a55;--acc-fg:#fff;--bar:#cfe9dd;--err:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#141513;--card:#1e201d;--fg:#ecebe6;--mut:#9a9a93;--line:#2f322d;--acc:#3fbf8c;--acc-fg:#0d1a14;--bar:#1f4a39;--err:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:16px}
header{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:16px}
header>a{color:inherit;text-decoration:none;font-weight:700;font-size:1.2rem}header .mut a{color:inherit}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px}
h1,h2{margin:0 0 12px;line-height:1.2}h1{font-size:1.35rem}h2{font-size:1.05rem}
.mut{color:var(--mut);font-size:.9rem}.err{color:var(--err);font-weight:600}.ok{color:var(--acc);font-weight:600}
input,select,button{font:inherit;width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
button{background:var(--acc);color:var(--acc-fg);border:0;font-weight:600;cursor:pointer}
button.link{background:none;color:var(--mut);width:auto;padding:0;text-decoration:underline;font-weight:400}
label{display:block;margin:8px 0 4px;font-size:.9rem}form>*+button{margin-top:12px}
ul.topics{list-style:none;margin:0;padding:0}ul.topics li+li{border-top:1px solid var(--line)}
ul.topics a{display:flex;justify-content:space-between;gap:8px;padding:10px 0;color:inherit;text-decoration:none}
.tag{font-size:.75rem;padding:2px 8px;border-radius:99px;border:1px solid var(--line);white-space:nowrap;align-self:center}
.opt{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--line);border-radius:8px;margin-bottom:8px;cursor:pointer}
.opt input{width:auto}.opt:has(input:checked){border-color:var(--acc)}
.res{margin:6px 0}.res .bar{height:8px;border-radius:4px;background:var(--bar);margin-top:4px}
.res .bar i{display:block;height:100%;border-radius:4px;background:var(--acc)}
table{width:100%;border-collapse:collapse}td{padding:6px 4px;border-top:1px solid var(--line);vertical-align:middle}
td form{display:inline}td button{width:auto;padding:4px 10px;font-size:.85rem}
`;

const layout = (title, body, me) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head>
<body><main><header><a href="/">🗳️ Votapp</a>${me ? `<span class="mut">${esc(me.name)}${me.is_admin ? ' · <a href="/admin">admin</a>' : ''}
<form method="post" action="/logout" style="display:inline"> · <button class="link">salir</button></form></span>` : ''}</header>
${body}</main></body></html>`;

const flash = (msg) => msg ? `<p class="${msg.ok ? 'ok' : 'err'}">${esc(msg.text)}</p>` : '';

function login(members, msg) {
  const opts = members.map((m) => `<option value="${m.id}">${esc(m.name)}${m.claimed ? '' : ' (primera vez)'}</option>`).join('');
  return layout('Entrar', `<div class="card"><h1>Entrar</h1>${flash(msg)}
<form method="post" action="/login">
<label for="m">¿Quién sos?</label><select id="m" name="member" required><option value="">Elegí tu nombre…</option>${opts}</select>
<label for="p">PIN</label><input id="p" name="pin" inputmode="numeric" pattern="\\d{4,8}" maxlength="8" required autocomplete="current-password">
<button>Entrar</button></form>
<p class="mut">¿Primera vez? El PIN que pongas (4 a 8 números) queda como tuyo. ¿No aparecés o te olvidaste el PIN? Hablale a un admin.</p></div>`);
}

function home(me, topics, msg) {
  const li = (t) => `<li><a href="/t/${t.id}"><span>#${t.id} ${esc(t.title)}<br><span class="mut">${esc(t.author)} · ${t.n} voto(s)</span></span>
<span class="tag">${!t.open ? 'cerrado' : t.voted ? '✓ votaste' : 'votar'}</span></a></li>`;
  const open = topics.filter((t) => t.open), closed = topics.filter((t) => !t.open);
  return layout('Votapp', `${flash(msg)}
<div class="card"><h1>Temas abiertos</h1>${open.length ? `<ul class="topics">${open.map(li).join('')}</ul>` : '<p class="mut">No hay temas abiertos.</p>'}</div>
<div class="card"><h2>Proponer un tema</h2><form method="post" action="/topics">
<label for="ti">Pregunta</label><input id="ti" name="title" maxlength="200" required placeholder="¿Asado el finde?">
<label for="op">Opciones, una por línea (vacío = Sí / No)</label>
<textarea id="op" name="options" rows="4" style="width:100%;font:inherit;padding:10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg)" placeholder="Sábado&#10;Domingo"></textarea>
<button>Proponer</button></form></div>
${closed.length ? `<div class="card"><h2>Cerrados</h2><ul class="topics">${closed.map(li).join('')}</ul></div>` : ''}`, me);
}

function topic(me, t, tally, voters, mine, msg) {
  const total = tally.reduce((s, r) => s + r.n, 0);
  const canClose = t.open && (t.author_id === me.id || me.is_admin);
  const form = t.open ? `<form method="post" action="/t/${t.id}/vote">
${tally.map((o) => `<label class="opt"><input type="radio" name="option" value="${o.idx}" ${o.idx === mine ? 'checked' : ''} required>${esc(o.label)}</label>`).join('')}
<button>${mine ? 'Cambiar voto' : 'Votar'}</button></form>` : '<p class="mut">Tema cerrado.</p>';
  const res = tally.map((o) => {
    const pct = total ? Math.round((100 * o.n) / total) : 0;
    return `<div class="res">${esc(o.label)} <span class="mut">— ${o.n} (${pct}%)</span><div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }).join('');
  const who = voters.length ? voters.map((v) => `<tr><td>${esc(v.name)}</td><td>${esc(v.label)}</td></tr>`).join('') : '';
  return layout(t.title, `${flash(msg)}
<div class="card"><p class="mut">#${t.id} · propuesto por ${esc(t.author)}</p><h1>${esc(t.title)}</h1>${form}</div>
<div class="card"><h2>Resultados · ${total} voto(s)</h2>${res}</div>
${who ? `<div class="card"><h2>Quién votó qué</h2><table>${who}</table></div>` : ''}
${canClose ? `<form method="post" action="/t/${t.id}/close" onsubmit="return confirm('¿Cerrar el tema?')"><button class="link">Cerrar tema</button></form>` : ''}`, me);
}

function admin(me, members, msg) {
  const rows = members.map((m) => `<tr><td>${esc(m.name)}${m.is_admin ? ' <span class="tag">admin</span>' : ''}<br><span class="mut">${m.claimed ? 'con PIN' : 'sin PIN'}</span></td>
<td style="text-align:right">${m.claimed ? `<form method="post" action="/admin/members/${m.id}/reset"><button>Resetear PIN</button></form>` : ''}
${m.id !== me.id ? `<form method="post" action="/admin/members/${m.id}/admin"><input type="hidden" name="on" value="${m.is_admin ? 0 : 1}"><button>${m.is_admin ? 'Quitar admin' : 'Hacer admin'}</button></form>` : ''}</td></tr>`).join('');
  return layout('Admin', `${flash(msg)}
<div class="card"><h1>Agregar miembros</h1><form method="post" action="/admin/members">
<label for="n">Nombres, uno por línea</label>
<textarea id="n" name="names" rows="5" required style="width:100%;font:inherit;padding:10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg)"></textarea>
<button>Agregar</button></form></div>
<div class="card"><h2>Miembros (${members.length})</h2><table>${rows}</table></div>`, me);
}

const notFound = (me) => layout('No existe', '<div class="card"><h1>No existe</h1><a href="/">Volver</a></div>', me);

module.exports = { login, home, topic, admin, notFound };
