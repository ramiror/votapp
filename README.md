# votapp
Votaciones web para un grupo de WhatsApp. Se comparte un solo link en el grupo y todo lo demás pasa en la web.

## Cómo funciona
- Un admin carga la lista de miembros (nombres).
- Cada uno entra, elige su nombre y pone un PIN de 4 a 8 dígitos. **El primero que entra con un nombre le fija el PIN.** Si alguien se te adelantó, un admin resetea el PIN.
- Se pueden proponer temas (pregunta + opciones; sin opciones = Sí/No), votar, cambiar el voto, ver resultados y quién votó qué.
- Cierra un tema quien lo propuso o un admin.

## Anti-trampa (básico, a propósito)
- `votes` tiene PK `(topic_id, member_id)`: un voto vigente por persona por tema, garantizado por la DB.
- `vote_log` append-only registra cada intento (`new`, `changed`, `duplicate`) con IP.
- Solo votan miembros cargados por un admin. 5 PIN incorrectos bloquean el nombre por 15 min.
- PIN hasheado con scrypt, sesión en cookie HttpOnly + SameSite=Lax, chequeo de Origin en POST, HTML escapado.

## Correr
Node >= 22.13, sin dependencias.
```sh
npm run cli -- add "Tu Nombre" --admin     # primer admin
npm run cli -- import miembros.txt         # un nombre por línea (o cargalos desde /admin)
npm start                                  # http://localhost:3000
npm test
```
Variables: `PORT` (3000), `DB_PATH` (`votapp.db`), `COOKIE_SECURE=1` si servís por HTTPS (recomendado).

CLI: `add "Nombre" [--admin] | import archivo | list | reset "Nombre" | admin "Nombre"`.
