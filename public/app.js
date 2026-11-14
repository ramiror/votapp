// Cliente WebAuthn sin dependencias.
const b2u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const u2b = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const msg = (t) => { const el = document.getElementById('msg'); if (el) { el.textContent = t; el.className = 'err'; } else alert(t); };

async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({ error: 'Error inesperado.' }));
  if (!r.ok) throw new Error(j.error || 'Error inesperado.');
  return j;
}

async function register(body) {
  const o = await api('/api/register/options', body);
  o.challenge = u2b(o.challenge);
  o.user.id = u2b(o.user.id);
  o.excludeCredentials = (o.excludeCredentials || []).map((c) => ({ ...c, id: u2b(c.id) }));
  const c = await navigator.credentials.create({ publicKey: o });
  return api('/api/register/verify', {
    id: c.id, rawId: b2u(c.rawId), type: c.type, authenticatorAttachment: c.authenticatorAttachment,
    clientExtensionResults: c.getClientExtensionResults(),
    response: {
      clientDataJSON: b2u(c.response.clientDataJSON), attestationObject: b2u(c.response.attestationObject),
      transports: c.response.getTransports ? c.response.getTransports() : [],
    },
  });
}

async function login() {
  const o = await api('/api/login/options');
  o.challenge = u2b(o.challenge);
  const c = await navigator.credentials.get({ publicKey: o });
  return api('/api/login/verify', {
    id: c.id, rawId: b2u(c.rawId), type: c.type, authenticatorAttachment: c.authenticatorAttachment,
    clientExtensionResults: c.getClientExtensionResults(),
    response: {
      clientDataJSON: b2u(c.response.clientDataJSON), authenticatorData: b2u(c.response.authenticatorData),
      signature: b2u(c.response.signature), userHandle: c.response.userHandle ? b2u(c.response.userHandle) : undefined,
    },
  });
}

const run = (btn, fn) => async (e) => {
  e.preventDefault();
  if (!window.PublicKeyCredential) return msg('Tu navegador no soporta passkeys. Actualizalo o probá con otro.');
  btn.disabled = true;
  try { const r = await fn(); location.href = r.redirect || '/'; }
  catch (err) { msg(err.name === 'NotAllowedError' ? 'Cancelado.' : err.message); }
  finally { btn.disabled = false; }
};

document.addEventListener('DOMContentLoaded', () => {
  const f = document.getElementById('register');
  if (f) f.addEventListener('submit', run(f.querySelector('button'), () => register({ name: f.elements.namedItem('name')?.value, invite: f.elements.namedItem('invite')?.value })));
  const l = document.getElementById('login');
  if (l) l.addEventListener('click', run(l, login));
  const k = document.getElementById('link');
  if (k) k.addEventListener('click', run(k, () => register({ link: k.dataset.token })));
  // Esperando que llegue el mensaje de WhatsApp al bot
  if (document.getElementById('wait')) {
    setInterval(async () => {
      try { if ((await (await fetch('/api/verify/status')).json()).verified) location.reload(); } catch { /* reintenta */ }
    }, 2500);
  }
  for (const el of document.querySelectorAll('form[data-confirm]')) {
    el.addEventListener('submit', (e) => { if (!confirm(el.dataset.confirm)) e.preventDefault(); });
  }
  for (const el of document.querySelectorAll('[data-copy]')) {
    el.addEventListener('click', async () => {
      const text = el.dataset.copy;
      try { if (navigator.share) await navigator.share({ url: text }); else { await navigator.clipboard.writeText(text); el.textContent = '¡Copiado!'; } }
      catch { /* cancelado */ }
    });
  }
});
