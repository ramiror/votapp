# votapp
Votaciones web para un grupo de WhatsApp. Al grupo va un solo link de invitación; todo lo demás pasa en la web.

## Registro: WhatsApp + passkey
1. La persona abre el link de invitación y toca **"Verificar con WhatsApp"**: se abre WhatsApp con un código listo para mandarle al número bot.
2. El bot recibe el mensaje y toma de WhatsApp el **nombre de perfil** y el **número** (o el identificador anónimo, si la persona usa nombre de usuario). Si está en el grupo, queda **aprobada automáticamente**; si no, un admin la aprueba a mano.
3. Crea su **passkey**: el dispositivo genera un par de claves y el servidor guarda solo la pública. De ahí en más entra con huella, cara o PIN del dispositivo.

- **El bot es mudo:** nunca escribe en el grupo. Solo lee la lista de participantes y contesta por privado a quien le manda un código. Todo lo demás lo ignora.
- **Una cuenta de WhatsApp = un miembro.** Verificar de nuevo desde otro dispositivo (o si perdiste el tuyo) suma una passkey a tu misma cuenta.
- El primero que se registra queda admin.
- Sin bot (`WA_ENABLED=0`), el registro es con nombre libre y aprobación manual del admin.

## Anti-trampa
- `votes` tiene PK `(topic_id, member_id)`: un voto vigente por persona por tema, garantizado por la DB.
- `vote_log` append-only registra cada intento (`new`, `changed`, `duplicate`) con IP.
- `members.wa_lid` / `wa_pn` son únicos: no se pueden tener dos cuentas con el mismo WhatsApp.
- Sesión en cookie HttpOnly + SameSite=Lax, chequeo de Origin en POST, CSP estricta, HTML escapado.

## Deploy gratis (Google Cloud e2-micro + DuckDNS + Caddy)
1. Creá una VM **e2-micro** con Debian 12 en `us-west1`, `us-central1` o `us-east1` (las del free tier), con disco estándar de 30 GB y **"Permitir tráfico HTTP/HTTPS"** tildado.
2. Sacá un subdominio y token en [duckdns.org](https://www.duckdns.org).
3. En la VM:
   ```sh
   sudo git clone -b claude/votapp-web <url-del-repo> /opt/votapp
   sudo /opt/votapp/deploy/setup.sh tu-sub.duckdns.org TU_TOKEN_DUCKDNS
   ```
4. Seguí los pasos que imprime: vincular el número bot con código, elegir el grupo y abrir el link de invitación.

Actualizar: `sudo /opt/votapp/deploy/update.sh`. Backups diarios en `/var/backups/votapp` (copialos fuera de la VM de vez en cuando).

## Local
Node >= 22.13.
```sh
npm install
WA_PAIR_NUMBER=5491112345678 npm start   # o sin WA_PAIR_NUMBER para vincular con QR
npm test          # unit + HTTP
npm run e2e       # flujos completos con autenticador virtual de Chromium (requiere playwright)
```
Variables: `PORT` (3000), `ORIGIN` (URL pública exacta), `DB_PATH` (`votapp.db`), `WA_ENABLED` (`0` para desactivar el bot), `WA_GROUP` (JID del grupo), `WA_AUTH_DIR` (`wa-auth`), `WA_PAIR_NUMBER`.

**WebAuthn exige HTTPS** (salvo en `localhost`) y `ORIGIN` tiene que coincidir con la URL que usa la gente: cambiar de dominio invalida las passkeys.

CLI (`votapp-cli` en la VM, `npm run cli --` local): `list | invite [--rotate] | approve "Nombre" | admin "Nombre" | link "Nombre"`.

> Baileys usa el protocolo de WhatsApp Web (no oficial). Usá un número dedicado para el bot.
