# votapp
Bot de votaciones para grupos de WhatsApp. Se agrega a un grupo un número dedicado (vinculado vía QR) y la gente vota con comandos.

## Comandos
| Comando | Qué hace |
|---|---|
| `!proponer Pregunta \| Op 1 \| Op 2 ...` | Crea un tema (sin opciones = Sí/No, máx. 10) |
| `!temas` | Lista temas abiertos del grupo |
| `!votar <tema> <opción>` | Vota (podés cambiar tu voto, no duplicarlo) |
| `!resultados <tema>` | Conteo y porcentajes |
| `!quien <tema>` | Quién votó qué |
| `!cerrar <tema>` | Cierra el tema (autor o admin del grupo) |
| `!ayuda` | Ayuda |

## Anti-fraude
- Identidad = JID del participante que manda WhatsApp (autenticado por WA, no falseable desde el chat).
- `votes` tiene PK `(topic_id, voter)`: un voto vigente por persona por tema, garantizado por la DB.
- `vote_log` es append-only: registra cada intento (`new`, `changed`, `duplicate`).
- Los temas están aislados por grupo.

## Correr
Requiere Node >= 22.13 (usa `node:sqlite`, sin deps nativas).
```sh
npm install
npm start          # escaneá el QR con el WhatsApp del número bot (Dispositivos vinculados)
npm test
```
Variables: `DB_PATH` (default `votapp.db`), `AUTH_DIR` (default `auth`), `GROUPS` (JIDs de grupo permitidos, separados por coma; vacío = todos).

> Baileys usa el protocolo de WhatsApp Web (no oficial). Usá un número dedicado: WhatsApp puede banearlo.
