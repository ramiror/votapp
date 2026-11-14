// Bot "mudo": nunca escribe en el grupo. Solo recibe por privado el código de verificación
// y lee la lista de participantes del grupo para aprobar automáticamente.
const { UserError } = require('./model');

const CODE_RE = /VOTAPP-[A-Z2-9]{6}/i;

/** Normaliza un JID: saca el sufijo de dispositivo ("123:4@s.whatsapp.net" -> "123@s.whatsapp.net"). */
const norm = (jid) => {
  if (!jid || typeof jid !== 'string' || !jid.includes('@')) return null;
  const [user, server] = jid.split('@');
  return `${user.split(':')[0]}@${server}`;
};

/** Separa los JIDs que manda WhatsApp en LID (anónimo) y número de teléfono. */
function identify(...jids) {
  const out = { lid: null, pn: null };
  for (const j of jids.map(norm).filter(Boolean)) {
    if (j.endsWith('@lid')) out.lid ??= j;
    else if (j.endsWith('@s.whatsapp.net')) out.pn ??= j;
  }
  return out;
}

/** Busca a la persona entre los participantes del grupo por LID o número. */
function findParticipant(participants, { lid, pn }) {
  return participants.find((p) => {
    const ids = [p.id, p.lid, p.phoneNumber, p.jid].map(norm).filter(Boolean);
    return (!!lid && ids.includes(lid)) || (!!pn && ids.includes(pn));
  });
}
const isParticipant = (participants, who) => !!findParticipant(participants, who);

const phoneOf = (pn) => (pn ? '+' + pn.split('@')[0] : null);

/** Procesa un mensaje privado. Devuelve el texto a responder, o null para ignorarlo en silencio. */
async function handleDirect(model, { text, jids, name, participants, resolvePn }) {
  const code = String(text || '').match(CODE_RE)?.[0];
  if (!code) return null;
  const who = identify(...jids);
  if (!who.pn && who.lid && resolvePn) who.pn = norm(await resolvePn(who.lid).catch(() => null));
  const p = findParticipant(participants, who);
  if (p) { // el grupo conoce el par LID <-> número: completamos lo que falte
    const fromGroup = identify(p.id, p.lid, p.phoneNumber, p.jid);
    who.lid ??= fromGroup.lid;
    who.pn ??= fromGroup.pn;
  }
  const inGroup = !!p;
  try {
    const { existing } = model.completeVerification(code, { ...who, name, inGroup });
    if (existing) return `✅ Listo, ${existing.name}. Ya tenías cuenta: volvé a la web para sumar este dispositivo.`;
    return inGroup
      ? `✅ Verificado${name ? ', ' + name : ''}. Volvé a la web para terminar.`
      : '✅ Verificado, pero no te encontré en el grupo. Volvé a la web: un admin va a tener que aprobarte.';
  } catch (e) {
    if (e instanceof UserError) return '⚠️ ' + e.message;
    throw e;
  }
}

function startBot(model, { groupJid, authDir = 'wa-auth', pairNumber, log = console }) {
  const baileys = require('@whiskeysockets/baileys');
  const makeWASocket = baileys.default || baileys.makeWASocket;
  const { useMultiFileAuthState, DisconnectReason } = baileys;
  const pino = require('pino');
  const qrcode = require('qrcode-terminal');

  const state = { number: null, ready: false };
  let groupCache = { at: 0, participants: [] };
  let retryMs = 3000;

  async function participants(sock) {
    if (!groupJid) return [];
    if (Date.now() - groupCache.at < 30_000) return groupCache.participants;
    const meta = await sock.groupMetadata(groupJid);
    groupCache = { at: Date.now(), participants: meta.participants };
    return meta.participants;
  }

  async function connect() {
    const { state: auth, saveCreds } = await useMultiFileAuthState(authDir);
    const sock = makeWASocket({ auth, logger: pino({ level: 'warn' }), markOnlineOnConnect: false, syncFullHistory: false });
    sock.ev.on('creds.update', saveCreds);

    if (pairNumber && !auth.creds.registered) {
      setTimeout(async () => {
        try { log.log(`Código de vinculación: ${await sock.requestPairingCode(pairNumber.replace(/\D/g, ''))} (WhatsApp > Dispositivos vinculados > Vincular con número)`); }
        catch (e) { log.error('No pude pedir el código de vinculación:', e.message); }
      }, 3000);
    }

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr && !pairNumber) { log.log('Escaneá este QR con el WhatsApp del bot (Dispositivos vinculados):'); qrcode.generate(qr, { small: true }); }
      if (connection === 'open') {
        state.ready = true;
        retryMs = 3000;
        state.number = norm(sock.user?.id)?.split('@')[0] || null;
        log.log(`WhatsApp conectado como +${state.number}`);
        if (!groupJid) {
          const groups = await sock.groupFetchAllParticipating().catch(() => ({}));
          log.log('Falta WA_GROUP. Grupos en los que está el bot:');
          for (const g of Object.values(groups)) log.log(`  ${g.id}\t${g.subject}`);
        }
      }
      if (connection === 'close') {
        state.ready = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) return log.error(`WhatsApp cerró la sesión. Borrá ${authDir} y vinculá de nuevo.`);
        log.error(`WhatsApp desconectado (${lastDisconnect?.error?.message || code}). Reintento en ${retryMs / 1000}s.`);
        setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 60_000);
      }
    });

    sock.ev.on('group-participants.update', ({ id }) => { if (id === groupJid) groupCache.at = 0; });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        try {
          const jid = msg.key.remoteJid;
          if (!jid || msg.key.fromMe || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) continue;
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
          if (!text || !CODE_RE.test(text)) continue; // ignoramos todo lo demás, sin responder
          const reply = await handleDirect(model, {
            text, name: msg.pushName,
            jids: [jid, msg.key.remoteJidAlt, msg.key.senderPn, msg.key.senderLid],
            participants: await participants(sock),
            resolvePn: (lid) => sock.signalRepository?.lidMapping?.getPNForLID?.(lid),
          });
          if (reply) await sock.sendMessage(jid, { text: reply });
        } catch (e) { log.error('Error procesando mensaje de WhatsApp:', e); }
      }
    });
  }

  connect().catch((e) => log.error('No pude iniciar WhatsApp:', e));
  return { number: () => state.number, ready: () => state.ready };
}

module.exports = { startBot, handleDirect, identify, isParticipant, phoneOf, norm };
