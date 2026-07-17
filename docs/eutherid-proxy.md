# EutherID HTTPS boundary

EutherHost exposes only a small allowlist of EutherID routes. It is not a general reverse proxy.

Admin session plus the normal CSRF token is required for:

- `POST /api/admin/eutherid/device-enrollments`
- `POST /api/admin/eutherid/challenges`
- `GET /api/admin/eutherid/challenges/{id}`
- `POST /api/admin/eutherid/challenges/{id}/action-proof`
- `POST /api/admin/eutherid/shadow-tests`
- `POST /api/admin/eutherid/shadow-tests/{id}/complete`

Those requests receive the localhost-only EutherID internal token inside EutherHost. Client-supplied cookies, CSRF headers, and EutherID internal-token headers are never forwarded.

The Android client can reach only these secret/signature-protected endpoints without a Host login cookie:

- `POST /api/eutherid/device-enrollments/complete`
- `POST /api/eutherid/challenges/{id}/approval`

No public route can create a challenge, issue an action proof, consume an action proof, list devices, or revoke devices. Request bodies are capped at 32 KiB, upstream redirects are not involved, and the mobile client independently requires a clean HTTPS origin.

The two `shadow-tests` routes are the safe physical-authentication smoke test used by the admin panel. EutherHost derives the actor, current session hash, HTTPS origin, action `eutherid.test`, target `shadow`, and command id `shadow-test`; none of those bindings can be supplied by the browser. Completion issues and consumes the action proof internally, deliberately attempts one replay, and succeeds only when EutherID rejects that replay. The response always reports `commandRun: false`; this test has no command execution path and does not enable EutherNet writes.

`EUTHERID_INTERNAL_TOKEN_FILE` must point to a root-owned credential readable by the EutherHost service account. EutherID itself remains bound to `127.0.0.1:8792`.
