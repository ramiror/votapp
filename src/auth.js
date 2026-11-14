// Flujos WebAuthn (passkeys). Los challenges viven en memoria 5 minutos, atados a una cookie de flujo.
const crypto = require('node:crypto');
const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { UserError } = require('./model');

const FLOW_TTL = 5 * 60_000;

function createAuth(model, { origin, rpName = 'Votapp' }) {
  const rpID = new URL(origin).hostname;
  const flows = new Map();

  const startFlow = (data) => {
    const now = Date.now();
    for (const [k, v] of flows) if (v.exp < now) flows.delete(k);
    const id = crypto.randomBytes(18).toString('base64url');
    flows.set(id, { ...data, exp: now + FLOW_TTL });
    return id;
  };
  const takeFlow = (id, kind) => {
    const f = flows.get(id);
    flows.delete(id);
    if (!f || f.kind !== kind || f.exp < Date.now()) throw new UserError('Se venció el intento. Probá de nuevo.');
    return f;
  };

  return {
    /**
     * body: { name, invite } para alta nueva, o { link } para sumar dispositivo a una cuenta.
     * Con verificación por WhatsApp (`ctx.wa`), la identidad sale de `ctx.verification`.
     */
    async registerOptions(body, ctx = {}) {
      let flow, userName, handle, exclude = [];
      if (body.link) {
        const mem = model.linkMember(body.link);
        if (!mem) throw new UserError('El link venció o ya se usó. Pedí otro.');
        userName = mem.name; handle = mem.handle;
        exclude = model.credentialIds(mem.id);
        flow = { kind: 'reg', link: body.link };
      } else if (ctx.wa) {
        const v = ctx.verification;
        if (!v?.verified_at) throw new UserError('Primero verificá con WhatsApp.');
        const existing = model.memberByWa(v.wa_lid, v.wa_pn);
        if (existing) {
          userName = existing.name; handle = existing.handle;
          exclude = model.credentialIds(existing.id);
          flow = { kind: 'reg', addTo: existing.id, browserKey: v.browser_key };
        } else {
          userName = model.checkName(body.name || v.wa_name);
          handle = crypto.randomBytes(16).toString('base64url');
          flow = { kind: 'reg', name: userName, handle, browserKey: v.browser_key };
        }
      } else {
        if (body.invite !== model.invite()) throw new UserError('El link de invitación no es válido. Pedí el actual en el grupo.');
        userName = model.checkName(body.name);
        handle = crypto.randomBytes(16).toString('base64url');
        flow = { kind: 'reg', name: userName, handle };
      }
      const options = await generateRegistrationOptions({
        rpName, rpID, userName, userDisplayName: userName,
        userID: Buffer.from(handle, 'base64url'),
        attestationType: 'none',
        excludeCredentials: exclude,
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      });
      return { options, flowId: startFlow({ ...flow, challenge: options.challenge }) };
    },

    async registerVerify(flowId, response) {
      const f = takeFlow(flowId, 'reg');
      let v;
      try {
        v = await verifyRegistrationResponse({ response, expectedChallenge: f.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
      } catch (e) { throw new UserError('No se pudo verificar la passkey: ' + e.message); }
      if (!v.verified) throw new UserError('No se pudo verificar la passkey.');
      const { id, publicKey, counter, transports } = v.registrationInfo.credential;
      const cred = { id, publicKey, counter, transports };
      if (f.link) return model.useLink(f.link, cred);
      if (!f.browserKey) return model.register(f.name, f.handle, cred);
      // Alta o dispositivo nuevo verificado por WhatsApp
      const ver = model.verification(f.browserKey);
      if (!ver?.verified_at) throw new UserError('La verificación de WhatsApp venció. Empezá de nuevo.');
      let memberId = f.addTo;
      if (memberId) model.addCredential(memberId, cred);
      else memberId = model.register(f.name, f.handle, cred, ver);
      model.consumeVerification(f.browserKey);
      return memberId;
    },

    async loginOptions() {
      const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
      return { options, flowId: startFlow({ kind: 'auth', challenge: options.challenge }) };
    },

    async loginVerify(flowId, response) {
      const f = takeFlow(flowId, 'auth');
      const cred = model.credential(response?.id);
      if (!cred) throw new UserError('Esa passkey no está registrada acá. ¿Te registraste con otro dispositivo?');
      let v;
      try {
        v = await verifyAuthenticationResponse({
          response, expectedChallenge: f.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
          credential: { id: cred.id, publicKey: cred.publicKey, counter: cred.counter, transports: cred.transports },
        });
      } catch (e) { throw new UserError('No se pudo verificar la passkey: ' + e.message); }
      if (!v.verified) throw new UserError('No se pudo verificar la passkey.');
      model.touchCredential(cred.id, v.authenticationInfo.newCounter);
      return cred.member_id;
    },
  };
}

module.exports = { createAuth };
