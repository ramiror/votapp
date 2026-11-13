const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createVotapp } = require('../src/core');

const G = 'grupo@g.us';
const mk = () => {
  const db = openDb(':memory:');
  const app = createVotapp(db);
  const say = (sender, text, extra = {}) => app.handle({ chatId: G, sender, senderName: sender, text, ...extra });
  return { db, say };
};

test('proponer y votar', () => {
  const { say } = mk();
  assert.match(say('ana', '!proponer ¿Asado? | Sábado | Domingo'), /Tema #1/);
  assert.match(say('beto', '!votar 1 2'), /votó "Domingo"/);
  assert.match(say('ana', '!resultados 1'), /2\. Domingo — 1 \(100%\)/);
});

test('1000 votos de la misma persona cuentan como 1', () => {
  const { db, say } = mk();
  say('ana', '!proponer X');
  for (let i = 0; i < 1000; i++) say('troll', '!votar 1 1');
  assert.match(say('ana', '!resultados 1'), /Total: 1 voto/);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM vote_log WHERE result='duplicate'").get().c, 999);
});

test('cambiar voto no suma', () => {
  const { say } = mk();
  say('ana', '!proponer X');
  say('beto', '!votar 1 1');
  assert.match(say('beto', '!votar 1 2'), /cambió/);
  const r = say('ana', '!resultados 1');
  assert.match(r, /1\. Sí — 0/);
  assert.match(r, /2\. No — 1/);
  assert.match(say('ana', '!quien 1'), /beto → No/);
});

test('validaciones', () => {
  const { say } = mk();
  assert.match(say('a', '!proponer Solo | una'), /al menos 2/);
  assert.match(say('a', '!votar 99 1'), /No existe/);
  say('a', '!proponer X');
  assert.match(say('a', '!votar 1 7'), /inválida/);
  assert.equal(say('a', 'hola'), null);
  assert.equal(say('a', '!nada'), null);
});

test('cerrar: solo autor o admin, y cerrado no acepta votos', () => {
  const { say } = mk();
  say('ana', '!proponer X');
  assert.match(say('beto', '!cerrar 1'), /Solo quien/);
  assert.match(say('beto', '!cerrar 1', { isAdmin: true }), /Cerrado/);
  assert.match(say('carla', '!votar 1 1'), /cerrado/);
});

test('temas aislados por grupo', () => {
  const { db } = mk();
  const app = createVotapp(db);
  app.handle({ chatId: G, sender: 'a', text: '!proponer X' });
  assert.match(app.handle({ chatId: 'otro@g.us', sender: 'a', text: '!votar 1 1' }), /No existe/);
});
