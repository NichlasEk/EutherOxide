# EutherHost Security Plan

This is the deferred hardening track for exposing EutherHost beyond a trusted LAN.

## Current Scope

- Treat the current host server as LAN/prototype only.
- Keep `.euther-host/` private and out of git.
- ROMs are exposed only through the configured ROM root and canonicalized relative paths.
- Login uses Argon2 password hashes and an HttpOnly session cookie.

## Before Internet Exposure

1. Put EutherHost behind Caddy or another reverse proxy with HTTPS.
2. Set cookies as `Secure`, keep `HttpOnly`, and keep `SameSite=Lax` or stricter.
3. Add login rate limiting per IP and per username.
4. Add CSRF protection for mutating HTTP routes.
5. Check `Origin` on WebSocket/future streaming routes.
6. Add session expiry settings in `.euther-host/config.toml`.
7. Move sessions from memory to a persisted or restart-aware store if needed.
8. Add audit logging for login success/failure and ROM launches.
9. Add a read-only library mode and explicit per-user permissions before sharing broadly.
10. Review all file-serving paths for canonicalization and root containment.

## Safer Interim Option

Use Tailscale/WireGuard for remote access before opening ports to the public internet.

Recommended path:

1. LAN host mode.
2. Tailscale-only remote play.
3. HTTPS reverse proxy.
4. Public internet only after rate limiting, CSRF, origin checks, and logging are in place.

## Performance Track Notes

Phone playback is currently expected to be slow because the host stream is still the dev-style
frame/audio packet path. The next performance work should measure and reduce:

- frame payload size
- frame encode/decode cost
- HTTP request cadence
- shader/render cost on mobile
- audio scheduling overhead

Likely next steps are a persistent binary stream, frame delta/compression, or a real video/WebRTC
transport once the baseline bottleneck is measured.
