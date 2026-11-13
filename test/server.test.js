const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createModel } = require('../src/model');
const { createServer } = require('../src/server');

test('HTTP: sin sesión, invitación y API', async () => {
  const model = createModel(openDb(':memory:'));
  const srv = createServer(model, { origin: 'http://localhost' }).listen(0);
  const base = `http://localhost:${srv.address().port}`;
  const api = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.match(await (await fetch(base)).text(), /Entrar con passkey/);
    assert.match(await (await fetch(base + '/registro?i=trucho')).text(), /Link vencido/);
    assert.match(await (await fetch(base + '/registro?i=' + model.invite())).text(), /Crear passkey/);
    const bad = await api('/api/register/options', { name: 'X', invite: 'trucho' });
    assert.equal(bad.status, 400);
    const ok = await api('/api/register/options', { name: 'X', invite: model.invite() });
    assert.equal(ok.status, 200);
    const o = await ok.json();
    assert.equal(o.rp.id, 'localhost');
    assert.equal(o.authenticatorSelection.residentKey, 'required');
    assert.match(ok.headers.get('set-cookie'), /votapp_flow=/);
    const v = await api('/api/login/verify', { id: 'x' });
    assert.equal(v.status, 400);
    const csrf = await fetch(base + '/topics', { method: 'POST', redirect: 'manual', headers: { origin: 'http://evil.com' }, body: 'title=x' });
    assert.equal(csrf.status, 403);
  } finally { srv.close(); }
});
