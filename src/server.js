const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./db');
const { createModel, UserError } = require('./model');
const { createAuth } = require('./auth');
const views = require('./views');

const COOKIE = 'votapp_sid';
const FLOW = 'votapp_flow';
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'));

const MSGS = {
  new: [true, '✅ Voto registrado.'], changed: [true, '🔄 Cambiaste tu voto.'],
  duplicate: [false, 'Ya habías votado eso. Un voto por persona 😉'],
  proposed: [true, 'Tema creado. Pasá el link al grupo.'], closed: [true, 'Tema cerrado.'], saved: [true, 'Guardado.'],
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 50_000) { reject(new UserError('Demasiado largo.')); req.destroy(); } });
    req.on('end', () => {
      if (/json/.test(req.headers['content-type'] || '')) {
        try { resolve(JSON.parse(data || '{}')); } catch { reject(new UserError('JSON inválido.')); }
      } else resolve(Object.fromEntries(new URLSearchParams(data)));
    });
    req.on('error', reject);
  });
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';')
  .map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, v]) => [k, decodeURIComponent(v || '')]));

function createServer(model, { origin = 'http://localhost:3000' } = {}) {
  const auth = createAuth(model, { origin });
  const secure = origin.startsWith('https:') ? '; Secure' : '';
  const cookie = (name, val, maxAge) => `${name}=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const headers = { 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' };
    const send = (html, status = 200) => {
      res.writeHead(status, { ...headers, 'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'" });
      res.end(html);
    };
    const json = (obj, status = 200, extra = {}) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json', ...extra }); res.end(JSON.stringify(obj)); };
    const redirect = (to, extra = {}) => { res.writeHead(303, { Location: to, ...extra }); res.end(); };
    const msgFromQuery = () => {
      const k = url.searchParams.get('m'), e = url.searchParams.get('e');
      if (e) return { ok: false, text: e.slice(0, 200) };
      return MSGS[k] ? { ok: MSGS[k][0], text: MSGS[k][1] } : null;
    };
    const back = (to, err) => redirect(`${to}?e=${encodeURIComponent(err.message)}`);
    const login = (memberId) => cookie(COOKIE, model.createSession(memberId), 31536000);

    try {
      if (p === '/app.js') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' }); return res.end(APP_JS); }

      const ck = cookies(req);
      const token = ck[COOKIE];
      const me = model.sessionMember(token);
      const isPost = req.method === 'POST';
      // CSRF básico: SameSite=Lax + rechazamos POSTs de otro origen.
      if (isPost && req.headers.origin && req.headers.origin !== origin) return send('Origen inválido', 403);
      const body = isPost ? await readBody(req) : {};

      // --- API WebAuthn (JSON) ---
      if (p.startsWith('/api/') && isPost) {
        try {
          if (p === '/api/register/options' || p === '/api/login/options') {
            const { options, flowId } = p === '/api/login/options' ? await auth.loginOptions() : await auth.registerOptions(body);
            return json(options, 200, { 'Set-Cookie': cookie(FLOW, flowId, 300) });
          }
          if (p === '/api/register/verify' || p === '/api/login/verify') {
            const memberId = p === '/api/login/verify' ? await auth.loginVerify(ck[FLOW], body) : await auth.registerVerify(ck[FLOW], body);
            return json({ ok: true, redirect: '/' }, 200, { 'Set-Cookie': [login(memberId), cookie(FLOW, '', 0)] });
          }
        } catch (e) { if (e instanceof UserError) return json({ error: e.message }, 400); throw e; }
        return json({ error: 'No existe' }, 404);
      }

      // --- páginas públicas ---
      if (p === '/registro' && !isPost) {
        const inv = url.searchParams.get('i') || '';
        return send(views.register(inv, inv === model.invite()));
      }
      let mt;
      if ((mt = p.match(/^\/vincular\/([\w-]+)$/)) && !isPost) return send(views.link(model.linkMember(mt[1]), mt[1]));

      if (!me) return isPost ? redirect('/') : send(views.login(msgFromQuery()));

      if (p === '/logout' && isPost) {
        model.logout(token);
        return redirect('/', { 'Set-Cookie': cookie(COOKIE, '', 0) });
      }
      if (me.status !== 'active') return send(views.pending(me));

      if (p === '/' && !isPost) return send(views.home(me, model.topics(me.id), msgFromQuery()));
      if (p === '/link' && isPost) return send(views.linkCreated(me, me, `${origin}/vincular/${model.createLink(me.id)}`));
      if (p === '/topics' && isPost) {
        try {
          const id = model.propose(me.id, body.title, String(body.options || '').split(/\r?\n/));
          return redirect(`/t/${id}?m=proposed`);
        } catch (e) { if (e instanceof UserError) return back('/', e); throw e; }
      }

      if ((mt = p.match(/^\/t\/(\d+)(\/vote|\/close)?$/))) {
        const id = Number(mt[1]);
        const t = model.topic(id);
        if (!t) return send(views.notFound(me), 404);
        try {
          if (mt[2] === '/vote' && isPost) return redirect(`/t/${id}?m=${model.vote(id, me.id, body.option, req.socket.remoteAddress)}`);
          if (mt[2] === '/close' && isPost) { model.close(id, me); return redirect(`/t/${id}?m=closed`); }
        } catch (e) { if (e instanceof UserError) return back(`/t/${id}`, e); throw e; }
        if (!mt[2]) return send(views.topic(me, t, model.tally(id), model.voters(id), model.myVote(id, me.id), msgFromQuery()));
      }

      if (p.startsWith('/admin') && me.is_admin) {
        try {
          if (p === '/admin' && !isPost) return send(views.admin(me, model.members(), `${origin}/registro?i=${model.invite()}`, msgFromQuery()));
          if (p === '/admin/invite' && isPost) { model.rotateInvite(); return redirect('/admin?m=saved'); }
          if ((mt = p.match(/^\/admin\/members\/(\d+)\/(approve|reject|admin|link)$/)) && isPost) {
            const id = Number(mt[1]);
            if (mt[2] === 'link') {
              const mem = model.member(id);
              if (!mem) return send(views.notFound(me), 404);
              return send(views.linkCreated(me, mem, `${origin}/vincular/${model.createLink(id)}`));
            }
            if (mt[2] === 'approve') model.approve(id);
            else if (mt[2] === 'reject') model.reject(id);
            else model.setAdmin(id, body.on === '1');
            return redirect('/admin?m=saved');
          }
        } catch (e) { if (e instanceof UserError) return back('/admin', e); throw e; }
      }
      send(views.notFound(me), 404);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send('Error interno', 500);
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const origin = process.env.ORIGIN || `http://localhost:${port}`;
  const model = createModel(openDb());
  createServer(model, { origin }).listen(port, () => {
    console.log(`Votapp en ${origin} (escuchando en :${port})`);
    console.log(`Link de invitación: ${origin}/registro?i=${model.invite()}`);
  });
}

module.exports = { createServer };
