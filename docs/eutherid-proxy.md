# EutherID HTTPS boundary

EutherHost exposes only a small allowlist of EutherID routes. It is not a general reverse proxy.

Admin session plus the normal CSRF token is required for:

- `POST /api/admin/eutherid/device-enrollments`
- `GET /api/admin/eutherid/devices`
- `POST /api/admin/eutherid/devices/{id}/revoke`
- `POST /api/admin/eutherid/challenges`
- `GET /api/admin/eutherid/challenges/{id}`
- `POST /api/admin/eutherid/challenges/{id}/action-proof`
- `POST /api/admin/eutherid/shadow-tests`
- `POST /api/admin/eutherid/shadow-tests/{id}/complete`
- `POST /api/admin/eutherid/actions/euthergate-wake`
- `POST /api/admin/eutherid/actions/euthergate-wake/{id}/complete`
- `POST /api/admin/eutherid/actions/euthernet-step-up-test`
- `POST /api/admin/eutherid/actions/euthernet-step-up-test/{id}/complete`

Those requests receive the localhost-only EutherID internal token inside EutherHost. Client-supplied cookies, CSRF headers, and EutherID internal-token headers are never forwarded.

The Android client can reach only these secret/signature-protected endpoints without a Host login cookie:

- `POST /api/eutherid/device-enrollments/complete`
- `POST /api/eutherid/challenges/{id}/approval`
- `GET /api/eutherid/inbox/{device-id}` using the device's read-only inbox capability

The Host login page also exposes three purpose-built public endpoints that are handled inside EutherHost rather than forwarded as a general proxy:

- `POST /api/eutherid/login/start`
- `POST /api/eutherid/login/status`
- `POST /api/eutherid/login/complete`

They create a two-minute `eutherhost.login` challenge, poll it using a browser-only secret, and consume the resulting action proof once before setting a Host session cookie. The browser secret is never included in the app payload or QR code, password login remains available, and a Host restart invalidates all pending EutherID logins.

No public route can create a challenge, issue an action proof, consume an action proof, list devices, or revoke devices. Request bodies are capped at 32 KiB, upstream redirects are not involved, and the mobile client independently requires a clean HTTPS origin.

The two `shadow-tests` routes are the safe physical-authentication smoke test used by the admin panel. EutherHost derives the actor, current session hash, HTTPS origin, action `eutherid.test`, target `shadow`, and command id `shadow-test`; none of those bindings can be supplied by the browser. Completion issues and consumes the action proof internally, deliberately attempts one replay, and succeeds only when EutherID rejects that replay. The response always reports `commandRun: false`; this test has no command execution path and does not enable EutherNet writes.

The first real step-up action is display wake only. EutherHost derives `euthergate.displays.wake`, target `euthergate`, and command id `wake-displays`, consumes the proof once, verifies replay rejection, and only then calls the fixed EutherGate `/api/displays/wake` upstream path. Direct `POST /euthergate/api/displays/wake` through EutherHost is rejected, while all EutherGate navigation and recovery/login paths remain unchanged. Wake never unlocks a display.

The EutherNet pilot is a second fixed action boundary, not a generic command proxy. EutherHost derives action `euthernet.step-up.test`, target `euthernet`, and command id `eutherid-step-up-test`, then passes the short-lived proof server-to-server for one-time consumption by EutherNet. The only enabled pilot command prints `eutherid-step-up-ok` and changes no server state. Browser calls to the generic `POST /api/admin/euthernet/run` route are rejected even for an admin; real restart and maintenance commands remain disabled per command.

The browser can hand an enrollment or challenge to Android either as an on-screen QR code for another device or through the `eutherid://open?payload=...` deep link on the current Android device. Both transports carry the same short-lived server payload; neither carries the internal token or an action proof.

`EUTHERID_INTERNAL_TOKEN_FILE` must point to a root-owned credential readable by the EutherHost service account. EutherID itself remains bound to `127.0.0.1:8792`.

Automation uses a separate `EUTHERID_REQUEST_TOKEN_FILE`. It can only create `restart-eutherbooks` and poll the returned challenge id; action, target, actor and command id are server-derived. Approval still requires the enrolled Android key and biometric prompt. The bundled `scripts/eutherid_request.py restart-eutherbooks` is the request-only handle and never receives the EutherID internal token or an EutherNet consumer token.
