# EutherBooks Player

Standalone Tauri client for EutherBooks audiobook playback.

## Direction

The first build is intentionally a small Tauri WebView player that talks to the
existing EutherBooks API and only plays final `.wav` files. This keeps the
server/model pipeline stable while the app shell, playback session model,
sleep timer, and auto-next flow are developed.

Native audio is planned as the next playback layer once the app model is stable.
On Android this should become foreground/media-session playback so audio,
lock-screen controls, sleep timer, and focus handling keep working when the
screen is off or the app is backgrounded. The current HTML audio player is a
bootstrap path, not the final mobile audio architecture.

## Initial Scope

- Connect to an EutherBooks server.
- List books and chapters.
- Generate speech for the selected chapter.
- Play final generated audio parts.
- Poll active and next jobs.
- Provide app-owned sleep timer controls.
