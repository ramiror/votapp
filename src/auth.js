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
    /** body: { name, invite } para alta nueva, o { link } para sumar dispositivo a una cuenta. */
    async registerOptions(body) {
      let flow, userName, handle, exclude = [];
      if (body.link) {
        const mem = model.linkMember(body.link);
        if (!mem) throw new UserError('El link venció o ya se usó. Pedí otro.');
        userName = mem.name; handle = mem.handle;
        exclude = model.credentialIds(mem.id);
        flow = { kind: 'reg', link: body.link };
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
      return f.link ? model.useLink(f.link, cred) : model.register(f.name, f.handle, cred);
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
