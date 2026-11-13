const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createModel } = require('../src/model');

let n = 0;
const cred = () => ({ id: 'cred' + ++n, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] });
const mk = () => {
  const m = createModel(openDb(':memory:'));
  const ana = m.register('Ana', 'h-ana', cred());
  const beto = m.register('Beto', 'h-beto', cred());
  return { m, ana, beto };
};
const plain = (rows) => rows.map((r) => ({ ...r }));

test('el primero es admin activo, el resto queda pendiente', () => {
  const { m, ana, beto } = mk();
  assert.equal(m.member(ana).status, 'active');
  assert.equal(m.member(ana).is_admin, 1);
  assert.equal(m.member(beto).status, 'pending');
  m.approve(beto);
  assert.equal(m.member(beto).status, 'active');
});

test('nombres únicos sin importar mayúsculas', () => {
  const { m } = mk();
  assert.throws(() => m.register('  ana ', 'h-x', cred()), /Ya hay alguien/);
});

test('rechazar borra solo pendientes, con sus passkeys', () => {
  const { m, ana, beto } = mk();
  const c = m.credentialIds(beto)[0].id;
  m.reject(beto);
  assert.equal(m.member(beto), undefined);
  assert.equal(m.credential(c), undefined);
  assert.throws(() => m.reject(ana), /pendientes/);
});

test('link de un solo uso suma dispositivo y vence', () => {
  const { m, beto } = mk();
  const t = m.createLink(beto);
  m.useLink(t, cred());
  assert.equal(m.credentialIds(beto).length, 2);
  assert.throws(() => m.useLink(t, cred()), /venció o ya se usó/);
  const old = m.createLink(beto, 1000, 0);
  assert.equal(m.linkMember(old), undefined);
});

test('invitación persistente y rotable', () => {
  const { m } = mk();
  const a = m.invite();
  assert.equal(m.invite(), a);
  assert.notEqual(m.rotateInvite(), a);
});

test('1000 votos de la misma persona cuentan como 1', () => {
  const { m, ana, beto } = mk();
  const t = m.propose(ana, '¿Asado?', ['Sábado', 'Domingo']);
  for (let i = 0; i < 1000; i++) m.vote(t, beto, 2);
  assert.deepEqual(m.tally(t).map((r) => r.n), [0, 1]);
  assert.equal(m.vote(t, beto, 1), 'changed');
  assert.deepEqual(m.tally(t).map((r) => r.n), [1, 0]);
  assert.deepEqual(plain(m.voters(t)), [{ name: 'Beto', label: 'Sábado' }]);
});

test('validaciones de propuesta y cierre', () => {
  const { m, ana, beto } = mk();
  assert.throws(() => m.propose(ana, 'X', ['una']), /al menos 2/);
  assert.throws(() => m.propose(ana, 'X', ['a', 'A']), /repetidas/);
  const t = m.propose(beto, 'X', []);
  assert.deepEqual(m.tally(t).map((r) => r.label), ['Sí', 'No']);
  assert.throws(() => m.vote(t, ana, 7), /opción/);
  const carla = m.register('Carla', 'h-c', cred());
  assert.throws(() => m.close(t, m.member(carla)), /Solo quien/);
  m.close(t, m.member(ana));
  assert.throws(() => m.vote(t, beto, 1), /cerrado/);
});
