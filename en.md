# EutherOxide Handoff

Date: 2026-06-01

## Current State

- `main` includes the first WebRTC A/V integration in commit `a239c50 Stream Mega Drive audio over WebRTC`.
- The follow-up change landed as commit `c14d11c Stabilize WebRTC bridge audio and inputs`: it smooths the WebRTC path by separating audio pacing from video packet publishing and keeping player input leases alive over the WebRTC datachannel.
- The follow-up release build completed successfully and `eutherhost` was restarted at 20:55 CEST with the new release binary. As of 21:27 CEST, `eutherhost.service` was active and running `target/release/euther-oxide --host-server`.
- A local UI diagnostic change is currently uncommitted: the perf panel now shows WebRTC lease heartbeat RTT and latest input status, and failed `/input` responses are logged with the server error body.
- A local latency reduction is also uncommitted and deployed in the running release binary: WebRTC H.264 video is now paced at 60 fps instead of 30 fps, and Mega Drive player input uses the WebRTC datachannel with HTTP `/input` as fallback.
- `eutherhost` was restarted again at 21:58:50 CEST with the latency-reduction release binary.
- After testing, audio and video were reported as very smooth but inputs still felt laggy. A follow-up input-path fix is now also uncommitted and deployed: datachannel/HTTP input writes to a lightweight `latest_input` snapshot, and only the bridge runner applies those snapshots immediately before `run_frame()`. This avoids taking the emulator mutex from the input request/datachannel path while the H.264 writer is copying frames.
- `eutherhost` was restarted again at 22:15:07 CEST with the input-snapshot release binary.
- Another follow-up is deployed locally: the bridge runner now publishes a dedicated `latest_video` RGB snapshot every emulated frame, and the WebRTC H.264 writer consumes that snapshot instead of locking the emulator directly. The browser perf panel also shows WebRTC inbound video stats as `Video age` (`jit`, decode time, and queue).
- `eutherhost` was restarted again at 22:29:48 CEST with the video-snapshot/frame-age release binary.
- Public access was working through `https://play.apothictech.se` / `https://apothictech.se` with Caddy reverse-proxying to `127.0.0.1:32162`.
- Router/WebRTC UDP forwarding used range `49152-49200/UDP`.
- On 2026-06-01 at about 21:44 CEST, local Caddy SNI checks worked, but public `https://apothictech.se` / `https://play.apothictech.se` curl checks returned a non-Caddy `400 Page not found` / weak certificate error from the external path. Local `--resolve apothictech.se:443:127.0.0.1` still reached Caddy and EutherHost.

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
- For the uncommitted UI diagnostic change: `./node_modules/.bin/tsc --noEmit`, `git diff --check`, and `npm run build`
- For the uncommitted latency-reduction change: `./node_modules/.bin/tsc --noEmit`, `cargo check`, `git diff --check`, `npm run build`, and `bash scripts/build-release.sh`
- For the input-snapshot follow-up: `cargo check`, `git diff --check`, and `bash scripts/build-release.sh`
- For the video-snapshot/frame-age follow-up: `cargo check`, `./node_modules/.bin/tsc --noEmit`, `git diff --check`, `npm run build`, and `bash scripts/build-release.sh`

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
- The heartbeat/lease and input-error indicators have now been added locally; use them during the next phone/desktop test.
- Watch CPU during 60 fps WebRTC video. If CPU or heat climbs too much on the server, make the WebRTC FPS configurable or try 45 fps as a middle ground.
- In the next test, watch `Video age`: sustained queue above `q0` or high `jit` means the last perceived control lag is video playout buffering, not input transport.

## Files Touched

- `src/main.rs`
- `webview/main.ts`
- `en.md`
