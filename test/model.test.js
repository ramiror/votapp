const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createModel } = require('../src/model');

const mk = () => {
  const m = createModel(openDb(':memory:'));
  return { m, ana: m.addMember('Ana', true), beto: m.addMember('Beto') };
};
const plain = (rows) => rows.map((r) => ({ ...r }));

test('primer login reclama el nombre, después pide el mismo PIN', () => {
  const { m, beto } = mk();
  assert.deepEqual(m.login(beto, '1234'), { claimed: true });
  assert.deepEqual(m.login(beto, '1234'), { claimed: false });
  assert.throws(() => m.login(beto, '9999'), /incorrecto/);
  assert.throws(() => m.login(beto, '12'), /4 a 8/);
});

test('bloqueo tras 5 PIN incorrectos', () => {
  const { m, beto } = mk();
  m.login(beto, '1234');
  for (let i = 0; i < 5; i++) assert.throws(() => m.login(beto, '0000', 1000), /incorrecto/);
  assert.throws(() => m.login(beto, '1234', 1000), /Demasiados/);
  assert.deepEqual(m.login(beto, '1234', 1000 + 16 * 60_000), { claimed: false });
});

test('reset de PIN libera el nombre y mata sesiones', () => {
  const { m, beto } = mk();
  m.login(beto, '1234');
  const sid = m.createSession(beto);
  m.resetPin(beto);
  assert.equal(m.sessionMember(sid), undefined);
  assert.deepEqual(m.login(beto, '5678'), { claimed: true });
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
  const carla = m.addMember('Carla');
  assert.throws(() => m.close(t, m.member(carla)), /Solo quien/);
  m.close(t, m.member(ana)); // admin
  assert.throws(() => m.vote(t, beto, 1), /cerrado/);
});
