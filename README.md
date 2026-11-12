# Panamá Roleplay — web

Web del servidor Panamá RP (ER:LC) con inicio de sesión de Discord y contadores en vivo.

## Variables de entorno (en Render → Environment)

| Variable | Para qué |
|---|---|
| `DISCORD_CLIENT_ID` | Client ID de tu aplicación de Discord |
| `DISCORD_CLIENT_SECRET` | Client Secret de tu aplicación de Discord |
| `SESSION_SECRET` | Texto largo aleatorio para firmar la sesión |
| `DISCORD_INVITE_CODE` | Código de invitación (por defecto `j47JGCtxb`) |
| `DISCORD_GUILD_ID` | *(opcional)* solo deja entrar a miembros de tu servidor |

En el portal de Discord (OAuth2 → Redirects) agrega:
`https://TU-SERVICIO.onrender.com/auth/discord/callback`

## Editar contenido

Todo el texto, reglas, tienda y equipo están en `public/index.html`, en el bloque `CONFIG`.
Cada cambio que subas a GitHub se publica solo en Render.
