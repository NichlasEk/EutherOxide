# EutherOxide Handoff

Date: 2026-06-01

## Current State

- `main` includes the first WebRTC A/V integration in commit `a239c50 Stream Mega Drive audio over WebRTC`.
- A follow-up local change is ready to commit: it smooths the WebRTC path by separating audio pacing from video packet publishing and keeping player input leases alive over the WebRTC datachannel.
- The follow-up release build completed successfully and `eutherhost` was restarted at 20:55 CEST with the new release binary.
- Public access was working through `https://play.apothictech.se` / `https://apothictech.se` with Caddy reverse-proxying to `127.0.0.1:32162`.
- Router/WebRTC UDP forwarding used range `49152-49200/UDP`.

## What Changed In The Follow-Up

- Server now publishes a dedicated per-frame audio snapshot (`latest_audio`) from the bridge runner.
- WebRTC Opus audio now reads from `latest_audio` instead of extracting PCM from the combined video/audio stream packet.
- The old combined stream is still present as fallback, but the WebRTC A/V happy path no longer depends on it for audio.
- WebRTC datachannel now sends periodic `ping` heartbeats from the browser.
- Server handles those `ping` messages by touching the current player's bridge lease, so inputs should not die after the old stream is stopped.
- Spectator WebRTC offers are explicitly marked with `role=spectator` so they do not claim player slots.

## Why This Was Needed

- After removing the old `/stream-frame-audio.bin` path from the WebRTC happy path, player leases were no longer refreshed continuously.
- That could make inputs appear to drop after the lease timed out, even while WebRTC media still looked alive.
- Opus was also fed from packets published at the video divisor cadence, which could make audio bursty. Dedicated audio snapshots should reduce jitter.

## Validation Already Run

- `cargo check`
- `./node_modules/.bin/tsc --noEmit`
- `git diff --check`
- `npm run build`
- `bash scripts/build-release.sh`

## Verify Next

1. Check service status if needed:
   ```bash
   sudo systemctl status eutherhost --no-pager -l
   ```

2. Open the app on desktop and phone, hard refresh, then load Mega Drive.

3. In the trace/status panel, confirm these appear:
   - `WebRTC datachannel active`
   - `WebRTC video active`
   - `WebRTC audio active`
   - transport label containing `WEBRTC A/V`

4. Test player input for longer than 10 seconds. The previous symptom to watch for was: media keeps playing but controls stop responding.

5. Test two devices in one reaction chamber:
   - one as P1
   - one as P2 or spectator
   - verify no slot stealing, no lease timeout, and no major audio/video drift

## If It Still Hitches

- Check server logs for `webrtc opus stream ended` or ffmpeg errors.
- Watch CPU while one phone is connected:
  ```bash
  top -p $(pidof euther-oxide)
  ```
- The next likely optimization is to replace the external ffmpeg Opus process with an in-process Opus encoder, or run a single bridge media worker per chamber that fans out encoded RTP samples to peers.
- If inputs still drop, add a visible datachannel heartbeat/lease indicator in the UI and log failed `/input` responses with the server error body.

## Files Touched

- `src/main.rs`
- `webview/main.ts`
- `en.md`
