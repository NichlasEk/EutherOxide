# EutherHost Security Plan

This is the deferred hardening track for exposing EutherHost beyond a trusted LAN.

## Current Scope

- Treat the current host server as LAN/prototype only.
- Keep `.euther-host/` private and out of git.
- ROMs are exposed only through the configured ROM root and canonicalized relative paths.
- Login uses Argon2 password hashes and an HttpOnly session cookie.
- Login failures are rate-limited per IP and username in memory.
- Session timeout and Secure-cookie mode are configurable in `.euther-host/config.toml`.
- Login attempts and ROM launches are written to `.euther-host/audit.log`.
- Mutating authenticated routes require a per-session CSRF token.
- Host stream routes reject mismatched request origins when an `Origin` header is present.
- Host users have explicit play, ROM launch, ROM upload, and library-management permissions.
- Library writes can be locked down with `library_read_only = true`.
- Static files and ROM library paths are canonicalized and contained within their configured roots.
- Public deployment templates are available in `deploy/`, and `scripts/host-public-config.sh` writes a locked HTTPS config.

## Before Internet Exposure

1. Copy `deploy/Caddyfile.example`, replace the domain, and proxy HTTPS to `127.0.0.1:32162`.
2. Run `scripts/host-public-config.sh https://your-domain.example /path/to/roms`.
3. Keep login rate limiting enabled per IP and per username.
4. Keep CSRF protection enabled for mutating HTTP routes.
5. Keep checking `Origin` on stream routes, and repeat that for future WebSocket routes.
6. Tune session expiry settings in `.euther-host/config.toml`.
7. Move sessions from memory to a persisted or restart-aware store if needed.
8. Review audit logging for login success/failure and ROM launches.
9. Keep read-only library mode enabled unless actively administering the ROM library.
10. Re-review all file-serving paths whenever new file endpoints are added.

## Safer Interim Option

Use Tailscale/WireGuard for remote access before opening ports to the public internet.

Recommended path:

1. LAN host mode.
2. Tailscale-only remote play.
3. HTTPS reverse proxy.
4. Public internet only after rate limiting, CSRF, origin checks, and logging are in place.

## Next Session

1. Pick the real public domain and run `scripts/host-public-config.sh https://domain.example /home/nichlas/roms`.
2. Install or adapt `deploy/Caddyfile.example` for the server.
3. Install or adapt `deploy/eutherhost.service.example` for systemd.
4. Smoke-test login, EutherDogs, Mega Drive launch, and blocked library writes over HTTPS.
5. Decide whether the first public test should be HTTPS-only or Tailscale/WireGuard first.

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
