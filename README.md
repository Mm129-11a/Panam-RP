# Panamá Roleplay — web

Web del servidor Panamá RP (ER:LC) con inicio de sesión de Discord y contadores en vivo.

## Variables de entorno (en Render → Environment)

| Variable | Para qué |
|---|---|
| `DISCORD_CLIENT_ID` | Client ID de tu aplicación de Discord |
| `DISCORD_CLIENT_SECRET` | Client Secret de tu aplicación de Discord |
| `SESSION_SECRET` | Texto aleatorio de 32+ caracteres para firmar la sesión (obligatorio en producción) |
| `DISCORD_INVITE_CODE` | Código de invitación (por defecto `fgRGQPbJF3`) |
| `DISCORD_GUILD_ID` | *(opcional)* solo deja entrar a miembros de tu servidor |
| `WHITELIST_WEBHOOK_URL` | Webhook del canal donde llegan las solicitudes |
| `DISCORD_BOT_TOKEN` | Token del bot de la misma app (Bot → Reset Token): publica las solicitudes con botones Aceptar/Rechazar |
| `DISCORD_PUBLIC_KEY` | Public Key de la app (General Information). Además pon `https://TU-WEB/api/discord/interactions` en *Interactions Endpoint URL* |
| `WHITELIST_ROLE` | Nombre o ID del rol que se da al aceptar (ej. `Ciudadano`). El rol del bot debe estar por encima |
| `STAFF_ROLES` | *(opcional)* roles que pueden revisar, separados por comas. Si no se pone: admins y quien pueda gestionar roles |
| `NODE_VERSION` | `24` |
| `NODE_ENV` | `production` |

En el portal de Discord (OAuth2 → Redirects) agrega:
`https://TU-SERVICIO.onrender.com/auth/discord/callback`

## Editar contenido

- Textos, reglas, tienda, equipo y galería: `public/js/app.js`, bloque `CONFIG`.
- Estructura de la página: `public/index.html`. Estilos: `public/css/styles.css`.
- Fotos de la galería: súbelas a `public/img/galeria/` y pon la ruta en `img` dentro de `CONFIG.gallery`.

No pongas código JavaScript ni estilos dentro del HTML (`<script>…</script>`, `style="…"`):
la política de seguridad los bloquea. Van en `app.js` y `styles.css`.

## Seguridad

Toda la lógica está en `lib/security.js` y se prueba con `npm test`.

- **Política de contenido (CSP):** solo se ejecutan scripts propios; bloquea código inyectado.
- **Anti-clickjacking:** ninguna otra web puede meter esta página en un marco.
- **HTTPS forzado (HSTS)** y cabeceras de seguridad estándar.
- **Límite de solicitudes por visitante:** 300/min en general, 60/min a la API y
  30 intentos de inicio de sesión cada 10 min. La IP se toma de la cabecera de Cloudflare.
- **Sesión:** cookie firmada `__Host-`, `httpOnly`, `Secure`, `SameSite=Lax`, 7 días.
  El servidor no arranca en producción sin un `SESSION_SECRET` fuerte.
- **Login con Discord:** `state` de un solo uso que caduca en 10 minutos, comparado en tiempo
  constante; se validan todos los datos que devuelve Discord; las llamadas tienen tiempo límite.
- **Cerrar sesión** solo por POST desde la propia web (otra web no puede desconectarte).
- Solo se aceptan GET/HEAD (y el POST de cerrar sesión); los errores no muestran detalles.

## Botones de la whitelist

1. Pon `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY` y `WHITELIST_ROLE` en Render y despliega.
2. Abre `https://TU-WEB/bot/invitar` para añadir el bot al servidor.
3. Sube el rol del bot por encima del rol de whitelist y, si el canal de solicitudes es privado, añade el bot a ese canal.
4. En el portal de Discord, *Interactions Endpoint URL* = `https://TU-WEB/api/discord/interactions` (abre la web antes para que esté despierta).

Si el bot no puede publicar, la solicitud llega igual por el webhook, pero sin botones (el motivo sale en los logs).

## Puente a Discord (cuando Discord bloquea la IP de Render)

Render gratis comparte su IP con muchos servicios y Discord a veces la bloquea horas (error 1015).
`relay.js` es un servicio aparte, en otra región, que hace las peticiones a Discord desde su propia IP.

- Servicio del puente: start `node relay.js`, variable `RELAY_SECRET` (32+ caracteres).
- Servicio principal: `RELAY_URL` (URL del puente) y el mismo `RELAY_SECRET`.
- El puente no guarda tokens: solo reenvía peticiones firmadas a `https://discord.com/api/`.
