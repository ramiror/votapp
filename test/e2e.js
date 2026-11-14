// E2E con autenticador virtual de Chromium (CDP). Uso: npm run e2e
const assert = require('node:assert');
const { chromium } = require('playwright');
const { openDb } = require('../src/db');
const { createModel } = require('../src/model');
const { createServer } = require('../src/server');
const { handleDirect } = require('../src/whatsapp');

const shots = process.env.SHOTS;

async function device(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  page.on('dialog', (d) => d.accept());
  return page;
}

(async () => {
  const model = createModel(openDb(':memory:'));
  const srv = createServer(model, { origin: 'http://localhost:3998' }).listen(3998);
  const base = 'http://localhost:3998';
  const browser = await chromium.launch();
  try {
    const ana = await device(browser);
    await ana.goto(`${base}/registro?i=${model.invite()}`);
    await ana.fill('#n', 'Ana');
    await ana.click('button:has-text("Crear passkey")');
    await ana.waitForURL(base + '/');
    assert.match(await ana.content(), /Temas abiertos/); // primera = admin activa

    // Logout + login con passkey
    await ana.click('button:has-text("salir")');
    await ana.click('#login');
    await ana.waitForSelector('text=Temas abiertos');

    const beto = await device(browser);
    await beto.goto(`${base}/registro?i=${model.invite()}`);
    await beto.fill('#n', 'ana');
    await beto.click('button:has-text("Crear passkey")');
    await beto.waitForSelector('text=Ya hay alguien');
    await beto.fill('#n', 'Beto');
    await beto.click('button:has-text("Crear passkey")');
    await beto.waitForSelector('text=esperando que un admin');

    await ana.goto(base + '/admin');
    if (shots) await ana.screenshot({ path: shots + '/admin.png', fullPage: true });
    await ana.click('button:has-text("Aprobar")');

    await ana.goto(base);
    await ana.fill('#ti', '¿Asado el finde?');
    await ana.fill('#op', 'Sábado\nDomingo');
    await ana.click('button:has-text("Proponer")');

    await beto.goto(base + '/t/1');
    await beto.check('input[value="2"]');
    await beto.click('button:has-text("Votar")');
    await beto.waitForSelector('text=Voto registrado');
    if (shots) await beto.screenshot({ path: shots + '/topic.png', fullPage: true });

    // Sumar un segundo dispositivo a Beto
    await beto.goto(base);
    await beto.click('button:has-text("Sumar otro dispositivo")');
    const linkUrl = await beto.inputValue('input[readonly]');
    const beto2 = await device(browser);
    await beto2.goto(linkUrl);
    await beto2.click('#link');
    await beto2.waitForSelector('text=Temas abiertos');
    await beto2.goto(base + '/t/1');
    await beto2.check('input[value="2"]');
    await beto2.click('button:has-text("Cambiar voto")');
    await beto2.waitForSelector('text=Ya habías votado');

    assert.deepEqual(model.tally(1).map((r) => r.n), [0, 1]);
    assert.equal(model.credentialIds(2).length, 2);
    console.log('E2E sin WhatsApp OK');
  } finally { await browser.close(); srv.close(); }
  await waScenario();
})().catch((e) => { console.error(e); process.exit(1); });

// Registro verificado por WhatsApp, con el bot simulado (llamamos a handleDirect como si llegara el mensaje).
async function waScenario() {
  const model = createModel(openDb(':memory:'));
  const GROUP = [{ id: '1@lid', phoneNumber: '5491100000001@s.whatsapp.net' }, { id: '2@lid', phoneNumber: '5491100000002@s.whatsapp.net' }];
  const wa = { ready: () => true, number: () => '5491199999999' };
  const srv = createServer(model, { origin: 'http://localhost:3997', wa }).listen(3997);
  const base = 'http://localhost:3997';
  const browser = await chromium.launch();
  const sendFromWhatsApp = async (page, jid, name) => {
    const code = (await page.textContent('p.mut b')).trim();
    const reply = await handleDirect(model, { text: `Mi código de Votapp: ${code}`, jids: [jid], name, participants: GROUP });
    await page.waitForSelector('text=WhatsApp verificado', { timeout: 10_000 }); // la página se recarga sola
    return reply;
  };
  try {
    const ana = await device(browser);
    await ana.goto(`${base}/registro?i=${model.invite()}`);
    assert.match(await ana.getAttribute('a.btn', 'href'), /^https:\/\/wa\.me\/5491199999999\?text=/);
    await sendFromWhatsApp(ana, '1@lid', 'Ana Banana');
    assert.equal(await ana.inputValue('#n'), 'Ana Banana'); // nombre tomado de WhatsApp
    await ana.click('button:has-text("Crear passkey")');
    await ana.waitForSelector('text=Temas abiertos');

    const beto = await device(browser);
    await beto.goto(`${base}/registro?i=${model.invite()}`);
    await sendFromWhatsApp(beto, '2@lid', 'Beto');
    if (shots) await beto.screenshot({ path: shots + '/wa-verified.png', fullPage: true });
    await beto.click('button:has-text("Crear passkey")');
    await beto.waitForSelector('text=Temas abiertos'); // en el grupo => aprobado solo

    const troll = await device(browser);
    await troll.goto(`${base}/registro?i=${model.invite()}`);
    if (shots) await troll.screenshot({ path: shots + '/wa-step1.png', fullPage: true });
    assert.match(await sendFromWhatsApp(troll, '666@lid', 'Troll'), /no te encontré/);
    await troll.click('button:has-text("Crear passkey")');
    await troll.waitForSelector('text=un admin te tiene que aprobar');

    // Beto en un dispositivo nuevo: reverifica y suma passkey a su misma cuenta
    const beto2 = await device(browser);
    await beto2.goto(`${base}/registro?i=${model.invite()}`);
    await sendFromWhatsApp(beto2, '5491100000002@s.whatsapp.net', 'Beto');
    await beto2.waitForSelector('text=Hola de nuevo, Beto');
    await beto2.click('button:has-text("Crear passkey")');
    await beto2.waitForSelector('text=Temas abiertos');

    await ana.goto(base + '/admin');
    if (shots) await ana.screenshot({ path: shots + '/wa-admin.png', fullPage: true });
    const members = model.members();
    assert.equal(members.length, 3);
    assert.equal(members.find((m) => m.name === 'Beto').devices, 2);
    assert.equal(members.find((m) => m.name === 'Beto').wa_pn, '5491100000002@s.whatsapp.net');
    console.log('E2E con WhatsApp OK');
  } finally { await browser.close(); srv.close(); }
}
