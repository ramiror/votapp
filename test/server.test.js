const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createModel } = require('../src/model');
const { createServer } = require('../src/server');

test('flujo HTTP completo', async () => {
  const model = createModel(openDb(':memory:'));
  const ana = model.addMember('Ana');
  const srv = createServer(model).listen(0);
  const base = `http://localhost:${srv.address().port}`;
  const post = (p, body, cookie) => fetch(base + p, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie && { cookie }) }, body: new URLSearchParams(body) });
  try {
    assert.match(await (await fetch(base)).text(), /Ana \(primera vez\)/);
    const r = await post('/login', { member: ana, pin: '1234' });
    assert.equal(r.status, 303);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const p = await post('/topics', { title: '¿<b>Asado</b>?', options: 'Sábado\nDomingo' }, cookie);
    assert.equal(p.headers.get('location'), '/t/1?m=proposed');
    await post('/t/1/vote', { option: '2' }, cookie);
    const html = await (await fetch(base + '/t/1', { headers: { cookie } })).text();
    assert.match(html, /&lt;b&gt;Asado/);
    assert.match(html, /<td>Ana<\/td><td>Domingo/);
    assert.equal((await fetch(base + '/admin', { headers: { cookie } })).status, 404);
    const bad = await fetch(base + '/topics', { method: 'POST', redirect: 'manual', headers: { cookie, origin: 'http://evil.com' }, body: 'title=x' });
    assert.equal(bad.status, 403);
  } finally { srv.close(); }
});
