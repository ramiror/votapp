const http = require('node:http');
const { openDb } = require('./db');
const { createModel, UserError } = require('./model');
const views = require('./views');

const COOKIE = 'votapp_sid';
const SECURE = process.env.COOKIE_SECURE === '1'; // poné 1 si servís por HTTPS

const MSGS = {
  claimed: [true, '¡Listo! Ese PIN quedó como tuyo.'], new: [true, '✅ Voto registrado.'],
  changed: [true, '🔄 Cambiaste tu voto.'], duplicate: [false, 'Ya habías votado eso. Un voto por persona 😉'],
  proposed: [true, 'Tema creado. Pasá el link al grupo.'], closed: [true, 'Tema cerrado.'], saved: [true, 'Guardado.'],
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 20_000) { reject(new UserError('Demasiado largo.')); req.destroy(); } });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(data))));
    req.on('error', reject);
  });
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((p) => p[0]));

function createServer(model) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    const send = (html, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'" });
      res.end(html);
    };
    const redirect = (to, extra = {}) => { res.writeHead(303, { Location: to, ...extra }); res.end(); };
    const msgFromQuery = () => {
      const k = url.searchParams.get('m'), e = url.searchParams.get('e');
      if (e) return { ok: false, text: e.slice(0, 200) };
      return MSGS[k] ? { ok: MSGS[k][0], text: MSGS[k][1] } : null;
    };
    const back = (to, err) => redirect(`${to}${to.includes('?') ? '&' : '?'}e=${encodeURIComponent(err.message)}`);

    try {
      const token = cookies(req)[COOKIE];
      const me = model.sessionMember(token);
      const isPost = req.method === 'POST';
      // CSRF básico: además de SameSite=Lax, rechazamos POSTs de otro origen.
      if (isPost && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send('Origen inválido', 403);
      const body = isPost ? await readBody(req) : {};

      if (path === '/login' && isPost) {
        try {
          const { claimed } = model.login(Number(body.member), body.pin);
          const sid = model.createSession(Number(body.member));
          return redirect(claimed ? '/?m=claimed' : '/', {
            'Set-Cookie': `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${SECURE ? '; Secure' : ''}`,
          });
        } catch (e) { if (e instanceof UserError) return back('/', e); throw e; }
      }
      if (!me) return isPost ? redirect('/') : send(views.login(model.members(), msgFromQuery()));

      if (path === '/logout' && isPost) {
        model.logout(token);
        return redirect('/', { 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0` });
      }
      if (path === '/' && !isPost) return send(views.home(me, model.topics(me.id), msgFromQuery()));
      if (path === '/topics' && isPost) {
        try {
          const id = model.propose(me.id, body.title, String(body.options || '').split(/\r?\n/));
          return redirect(`/t/${id}?m=proposed`);
        } catch (e) { if (e instanceof UserError) return back('/', e); throw e; }
      }

      let mt;
      if ((mt = path.match(/^\/t\/(\d+)(\/vote|\/close)?$/))) {
        const id = Number(mt[1]);
        const t = model.topic(id);
        if (!t) return send(views.notFound(me), 404);
        try {
          if (mt[2] === '/vote' && isPost) return redirect(`/t/${id}?m=${model.vote(id, me.id, body.option, req.socket.remoteAddress)}`);
          if (mt[2] === '/close' && isPost) { model.close(id, me); return redirect(`/t/${id}?m=closed`); }
        } catch (e) { if (e instanceof UserError) return back(`/t/${id}`, e); throw e; }
        if (!mt[2]) return send(views.topic(me, t, model.tally(id), model.voters(id), model.myVote(id, me.id), msgFromQuery()));
      }

      if (path.startsWith('/admin')) {
        if (!me.is_admin) return send(views.notFound(me), 404);
        try {
          if (path === '/admin' && !isPost) return send(views.admin(me, model.members(), msgFromQuery()));
          if (path === '/admin/members' && isPost) {
            String(body.names || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach((n) => model.addMember(n));
            return redirect('/admin?m=saved');
          }
          if ((mt = path.match(/^\/admin\/members\/(\d+)\/(reset|admin)$/)) && isPost) {
            if (mt[2] === 'reset') model.resetPin(Number(mt[1]));
            else model.setAdmin(Number(mt[1]), body.on === '1');
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
  createServer(createModel(openDb())).listen(port, () => console.log(`Votapp en http://localhost:${port}`));
}

module.exports = { createServer };
