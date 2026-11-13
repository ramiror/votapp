// Transporte WhatsApp (Baileys). Se loguea como un número escaneando un QR.
const {
  default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { openDb } = require('./db');
const { createVotapp } = require('./core');

// Opcional: lista de JIDs de grupo permitidos, separados por coma. Vacío = todos los grupos.
const ALLOWED = (process.env.GROUPS || '').split(',').map((s) => s.trim()).filter(Boolean);
const app = createVotapp(openDb());
const adminCache = new Map(); // chatId -> { at, admins:Set }

async function admins(sock, chatId) {
  const c = adminCache.get(chatId);
  if (c && Date.now() - c.at < 60_000) return c.admins;
  const meta = await sock.groupMetadata(chatId);
  const set = new Set(meta.participants.filter((p) => p.admin).flatMap((p) => [p.id, p.lid, p.jid].filter(Boolean)));
  adminCache.set(chatId, { at: Date.now(), admins: set });
  return set;
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(process.env.AUTH_DIR || 'auth');
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'warn' }) });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'open') console.log('Conectado ✅');
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) return console.error('Sesión cerrada. Borrá ./auth y escaneá de nuevo.');
      setTimeout(start, 2000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      try {
        const chatId = m.key.remoteJid;
        if (!chatId?.endsWith('@g.us') || m.key.fromMe) continue;
        if (ALLOWED.length && !ALLOWED.includes(chatId)) continue;
        const text = m.message?.conversation || m.message?.extendedTextMessage?.text;
        if (!text?.startsWith('!')) continue;

        // Identidad = JID del participante, autenticado por WhatsApp. No se puede falsear desde el cliente.
        const sender = m.key.participant;
        if (!sender) continue;
        const isAdmin = text.toLowerCase().startsWith('!cerrar') ? (await admins(sock, chatId)).has(sender) : false;

        const reply = app.handle({ chatId, sender, senderName: m.pushName, isAdmin, text });
        if (reply) await sock.sendMessage(chatId, { text: reply }, { quoted: m });
      } catch (e) {
        console.error('Error procesando mensaje:', e);
      }
    }
  });
}

start();
