const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createModel } = require('../src/model');
const { handleDirect, identify, isParticipant } = require('../src/whatsapp');

const cred = (id) => ({ id, publicKey: new Uint8Array([1]), counter: 0, transports: [] });
const GROUP = [{ id: '111@lid', phoneNumber: '5491100000001@s.whatsapp.net' }, { id: '5491100000002@s.whatsapp.net' }];

test('identify separa LID y número, sin sufijo de dispositivo', () => {
  assert.deepEqual(identify('111:7@lid', undefined, '5491100000001:3@s.whatsapp.net'), { lid: '111@lid', pn: '5491100000001@s.whatsapp.net' });
  assert.deepEqual(identify('5491100000002@s.whatsapp.net'), { lid: null, pn: '5491100000002@s.whatsapp.net' });
});

test('isParticipant matchea por LID o por número', () => {
  assert.ok(isParticipant(GROUP, { lid: '111@lid', pn: null }));
  assert.ok(isParticipant(GROUP, { lid: null, pn: '5491100000001@s.whatsapp.net' }));
  assert.ok(isParticipant(GROUP, { lid: '999@lid', pn: '5491100000002@s.whatsapp.net' }));
  assert.ok(!isParticipant(GROUP, { lid: '999@lid', pn: null }));
});

test('miembro del grupo: se verifica y queda activo; reverificar encuentra la cuenta', async () => {
  const m = createModel(openDb(':memory:'));
  m.register('Admin', 'h0', cred('c0')); // el primero siempre es admin
  const { code, browserKey } = m.startVerification();
  const r = await handleDirect(m, { text: `Mi código de Votapp: ${code.toLowerCase()}`, jids: ['111@lid'], name: 'Beto 🍖', participants: GROUP,
    resolvePn: async () => '5491100000001@s.whatsapp.net' });
  assert.match(r, /Verificado, Beto/);
  const v = m.verification(browserKey);
  assert.equal(v.wa_pn, '5491100000001@s.whatsapp.net');
  assert.equal(v.in_group, 1);
  const id = m.register(v.wa_name, 'h1', cred('c1'), v);
  assert.equal(m.member(id).status, 'active');

  const again = m.startVerification();
  assert.match(await handleDirect(m, { text: again.code, jids: ['5491100000001@s.whatsapp.net'], participants: GROUP }), /Ya tenías cuenta/);
});

test('fuera del grupo queda pendiente; código inválido; mensajes sin código se ignoran', async () => {
  const m = createModel(openDb(':memory:'));
  m.register('Admin', 'h0', cred('c0'));
  const { code, browserKey } = m.startVerification();
  assert.match(await handleDirect(m, { text: code, jids: ['777@lid'], name: 'Troll', participants: GROUP }), /no te encontré en el grupo/);
  const id = m.register('Troll', 'h1', cred('c1'), m.verification(browserKey));
  assert.equal(m.member(id).status, 'pending');
  assert.match(await handleDirect(m, { text: 'VOTAPP-ZZZZZZ', jids: ['777@lid'], participants: GROUP }), /no existe o venció/);
  assert.equal(await handleDirect(m, { text: 'hola bot', jids: ['777@lid'], participants: GROUP }), null);
});

test('una cuenta de WhatsApp = un miembro', () => {
  const m = createModel(openDb(':memory:'));
  const v = { wa_lid: '111@lid', wa_pn: null, wa_name: 'X', in_group: 1 };
  m.register('Uno', 'h1', cred('c1'), v);
  assert.throws(() => m.register('Dos', 'h2', cred('c2'), v), /UNIQUE/);
});
