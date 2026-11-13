# votapp
Votaciones web para un grupo de WhatsApp. Al grupo va un solo link de invitación; todo lo demás pasa en la web.

## Identificación: passkeys (WebAuthn)
- Cada uno entra al link de invitación, pone su nombre y crea una **passkey**: el dispositivo genera un par de claves y el servidor guarda solo la **pública**. Se desbloquea con huella, cara o PIN del dispositivo.
- **El primero que se registra queda admin.** Los siguientes quedan pendientes hasta que un admin los aprueba (frena las cuentas truchas).
- Login con un botón, sin elegir usuario (passkeys "discoverable"). Desde la compu se puede usar la passkey del celu escaneando el QR del navegador.
- **Otro dispositivo:** "Sumar otro dispositivo" genera un link de un uso (30 min). Si alguien pierde el celu, un admin le genera un **link de recuperación**.
- Si el link de invitación se filtra, el admin genera uno nuevo y el viejo deja de andar.

## Anti-trampa
- `votes` tiene PK `(topic_id, member_id)`: un voto vigente por persona por tema, garantizado por la DB.
- `vote_log` append-only registra cada intento (`new`, `changed`, `duplicate`) con IP.
- Sesión en cookie HttpOnly + SameSite=Lax, chequeo de Origin en POST, CSP estricta, HTML escapado.

## Correr
Node >= 22.13. Única dependencia: `@simplewebauthn/server`.
```sh
npm install
ORIGIN=https://votapp.tudominio.com npm start   # imprime el link de invitación
npm test          # unit + HTTP
npm run e2e       # flujo completo con autenticador virtual de Chromium (requiere playwright)
```
Variables: `PORT` (3000), `ORIGIN` (URL pública exacta; default `http://localhost:PORT`), `DB_PATH` (`votapp.db`).

**WebAuthn exige HTTPS** (salvo en `localhost`), y `ORIGIN` tiene que coincidir con la URL que usa la gente. Cambiar de dominio invalida las passkeys.

CLI: `npm run cli -- list | invite [--rotate] | approve "Nombre" | admin "Nombre" | link "Nombre"`.
