# EutherOxide Server Runbook

This machine is currently set up as the home EutherHost server. The notes below
capture the deployed shape so the same setup can be recreated on a new machine.

Current OS snapshot:

```text
Debian GNU/Linux 13 (trixie)
```

## Public Addresses

- Public site: `https://apothictech.se`
- Public play alias: `https://play.apothictech.se`
- Internal LAN site without TLS: `http://192.168.32.186:8080`
- LAN server IP: `192.168.32.186`
- LAN SSH: `ssh nichlas@192.168.32.186`
- EutherHost backend: `127.0.0.1:32162` only, fronted by Caddy

Current LAN HTTP behavior:

- `http://192.168.32.186:8080` is intentionally served without TLS for the home
  network.
- The web client allows a WebRTC/H.264 trial on private LAN IP hosts, so this
  URL can still use the fast WebRTC path in Firefox even though it is not HTTPS.
- Public/domain access should still use HTTPS through Caddy.

## Fresh Server Deploy

These steps recreate the current server shape on a new Debian-like machine.
Adjust the username, repo path, LAN IP, router gateway, and domain if they
change.

### 1. Base Packages

Install the runtime/build tools:

```sh
sudo apt-get update
sudo apt-get install -y \
  build-essential pkg-config curl git gh nodejs npm ffmpeg \
  caddy dnsmasq openssh-server
```

For EutherAlert/OpenRA host rendering, prefer the PipeWire stack and avoid
installing the standalone PulseAudio server:

```sh
sudo apt-get install -y pipewire pipewire-audio pipewire-alsa wireplumber xvfb
```

Do not purge `pipewire-pulse` on desktops that use it; it is PipeWire's
compatibility service. The old `pulseaudio` daemon package can be removed if it
was installed for the failed EutherAlert experiment.

Install Rust with rustup or the distro package. The current machine builds the
root crate with Rust `1.85.0`; newer stable Rust is fine for the root server.

### 2. Checkout And Build

```sh
cd /home/nichlas
git clone https://github.com/NichlasEk/EutherOxide.git
cd /home/nichlas/EutherOxide
npm ci
bash scripts/build-release.sh
```

`scripts/build-release.sh` writes `webview/build-info.ts`, builds `dist/`, and
builds `target/release/euther-oxide`.

Create the ROM directory:

```sh
mkdir -p /home/nichlas/roms
```

## Large Partition Storage

Keep source checkouts and service config in `/home/nichlas`, but put generated,
rebuildable, and bulky runtime data on the large `/srv` partition.

Current server layout:

- `/srv/eutherbooks/audio` - generated EutherBooks chapter audio, cleaned by `eutherbooks-clean.timer`.
- `/srv/eutheroxide/target` - EutherOxide Rust target cache, symlinked from `/home/nichlas/EutherOxide/target`.
- `/srv/eutheroxide/src-tauri-target` - desktop Tauri target cache, symlinked from `/home/nichlas/EutherOxide/src-tauri/target`.
- `/srv/eutheroxide/apps/*-src-tauri-target` - app-specific Android/Tauri target caches, symlinked from each app checkout.

`euther-srv-clean.timer` runs daily and removes old low-risk `/srv` build
scratch data such as Cargo temporary files and stale incremental caches.

### 2b. Android Download APKs

The EutherHost UI exposes public Android downloads under `/downloads/*.apk`.
Build both fronted Android APKs after app/frontend changes that should ship to
phones:

```sh
cd /home/nichlas/EutherOxide
npm run android:release-apks
```

Or build one APK at a time:

```sh
npm run android:eutherlist
npm run android:euthersync
npm run android:eutherbooks-player
```

Default outputs:

```text
/home/nichlas/EutherList-release-signed.apk
/home/nichlas/EutherOxide/apps/eutherlist/releases/EutherList-release-signed.apk
/home/nichlas/EutherSync-release-signed.apk
/home/nichlas/EutherOxide/apps/euthersync/releases/EutherSync-release-signed.apk
/home/nichlas/EutherBooksPlayer-release-signed.apk
/home/nichlas/EutherOxide/apps/eutherbooks-player/releases/EutherBooksPlayer-release-signed.apk
/home/nichlas/EutherBoard-0.2.6-debug.apk
/home/nichlas/EutherPal/android-mobile/dist/eutherpal-mobile.apk
/home/nichlas/EutherPal/android-tv/dist/eutherpal-tv.apk
```

The download route `/downloads/EutherList-release-signed.apk` uses
`EUTHERLIST_APK_PATH` when set, otherwise
`/home/nichlas/EutherList-release-signed.apk`, otherwise the repo release copy.
The shorter aliases `/downloads/eutherlist.apk` and `/downloads/EutherList.apk`
are also accepted.

The download route `/downloads/EutherSync-release-signed.apk` uses
`EUTHERSYNC_APK_PATH` when set, otherwise
`/home/nichlas/EutherSync-release-signed.apk`, otherwise the repo release copy.
The shorter aliases `/downloads/euthersync.apk` and `/downloads/EutherSync.apk`
are also accepted.

The download route `/downloads/EutherBooksPlayer-release-signed.apk` uses
`EUTHERBOOKS_PLAYER_APK_PATH` when set, otherwise
`/home/nichlas/EutherBooksPlayer-release-signed.apk`, otherwise the repo
release copy. The shorter aliases `/downloads/eutherbooksplayer.apk` and
`/downloads/EutherBooksPlayer.apk` are also accepted.

The download route `/downloads/EutherBoard-0.2.6-debug.apk` uses
`EUTHERBOARD_APK_PATH` when set, otherwise
`/home/nichlas/EutherBoard-0.2.6-debug.apk`. Older versioned routes remain
accepted as compatibility aliases, along with `/downloads/eutherboard.apk` and
`/downloads/EutherBoard.apk`.

The download route `/downloads/EutherPalMobile-release-signed.apk` uses
`EUTHERPAL_MOBILE_APK_PATH` when set, otherwise
`/home/nichlas/EutherPal/android-mobile/dist/eutherpal-mobile.apk`. The shorter
aliases `/downloads/eutherpal-mobile.apk` and `/downloads/EutherPalMobile.apk`
are also accepted.

The download route `/downloads/EutherPalTV-release-signed.apk` uses
`EUTHERPAL_TV_APK_PATH` when set, otherwise
`/home/nichlas/EutherPal/android-tv/dist/eutherpal-tv.apk`. The shorter aliases
`/downloads/eutherpal-tv.apk` and `/downloads/EutherPalTV.apk` are also
accepted.

The release script also syncs `apps/eutherbooks-player/src-tauri/icons/android` into the generated Android project before each build, so launcher icons stay deterministic.

The EutherBooks Player Android app tries LAN EutherBooks first
(`http://192.168.32.186:8088`) and then the hosted EutherOxide proxy
(`https://apothictech.se/eutherbooks`). The beta player uses WebView Media
Session controls plus a Cache Storage audio cache for generated parts. It also
uses an Android `PARTIAL_WAKE_LOCK` while playback is active so generated chunk
handoff can continue with the screen off. Native Android media notifications,
lockscreen polish, and a deeper native audio backend remain the next step after
the beta player stabilizes.

For LAN installs, keep
`eutherbooks.service` bound to `0.0.0.0:8088`; otherwise Android cannot reach
the API directly and browser CORS rules may block the fallback.

To build the EutherSync wrapper against another endpoint:

```sh
EUTHERSYNC_ANDROID_URL=https://photos.example.com npm run android:euthersync
```

The default EutherSync Android endpoints are tried in this order:

```text
http://192.168.32.186:3000
https://apothictech.se/euthersync/
```

Keep `euthersync.service` enabled so the WebView wrapper has a live backend:

```sh
sudo systemctl enable --now euthersync.service
```

Caddy fronts the public path by stripping `/euthersync` and proxying to the
Node service:

```caddyfile
handle_path /euthersync* {
	reverse_proxy 127.0.0.1:3000
}

handle {
	reverse_proxy 127.0.0.1:32162
}
```

### 3. EutherHost Config

Create `/home/nichlas/EutherOxide/.euther-host/config.toml`:

```toml
bind = "127.0.0.1:32162"
rom_dir = "/home/nichlas/roms"
session_timeout_minutes = 720
login_rate_limit_window_secs = 900
login_rate_limit_max_attempts = 8
secure_cookies = true
allowed_origins = "https://apothictech.se,https://play.apothictech.se,http://192.168.32.186:8080"
library_read_only = true
app_public_server_url = "https://apothictech.se"
app_lan_server_url = "http://192.168.32.186:8080"
eutherbooks_server_urls = "http://192.168.32.186:8088,http://192.168.32.186:8080/eutherbooks,https://apothictech.se/eutherbooks"
```

Create users with:

```sh
bash scripts/host-init-user.sh
```

That writes `/home/nichlas/EutherOxide/.euther-host/users.toml`.

### 4. EutherHost Systemd Unit

Create `/etc/systemd/system/eutherhost.service`:

```ini
[Unit]
Description=EutherHost
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nichlas
Group=nichlas
WorkingDirectory=/home/nichlas/EutherOxide
Environment=XDG_RUNTIME_DIR=/run/user/1000
Environment=PIPEWIRE_RUNTIME_DIR=/run/user/1000
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
ExecStart=/home/nichlas/EutherOxide/scripts/host-server.sh
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/home/nichlas/EutherOxide/.euther-host /home/nichlas/EutherOxide/.euther-bridge /home/nichlas/EutherOxide/target /home/nichlas/roms

[Install]
WantedBy=multi-user.target
```

Enable it:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now eutherhost.service
```

### 5. Caddy Reverse Proxy

Create `/etc/caddy/Caddyfile`:

```caddy
http://:80 {
	redir https://apothictech.se{uri} permanent
}

play.apothictech.se, apothictech.se, www.apothictech.se {
	encode zstd gzip

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "same-origin"
		Permissions-Policy "camera=(self), microphone=(self), geolocation=()"
	}

	reverse_proxy 127.0.0.1:32162
}

play.apothictech.se:8443, apothictech.se:8443, www.apothictech.se:8443 {
	encode zstd gzip

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "same-origin"
		Permissions-Policy "camera=(self), microphone=(self), geolocation=()"
	}

	reverse_proxy 127.0.0.1:32162
}

http://192.168.32.186:8080 {
	encode zstd gzip

	header {
		X-Content-Type-Options "nosniff"
		Referrer-Policy "same-origin"
		Permissions-Policy "camera=(self), microphone=(self), geolocation=()"
	}

	reverse_proxy 127.0.0.1:32162
}
```

Validate and reload:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### 6. Local DNS Override

This is optional while LAN HTTP WebRTC works, but it is still the clean way to
make `https://apothictech.se` resolve to the LAN server from inside the house.

Create `/etc/apothictech-dns.conf`:

```text
port=53
listen-address=127.0.0.1,192.168.32.186
bind-interfaces
no-resolv
server=192.168.32.1
domain-needed
bogus-priv
address=/apothictech.se/192.168.32.186
address=/www.apothictech.se/192.168.32.186
```

`address=/apothictech.se/192.168.32.186` also covers subdomains such as
`play.apothictech.se`.

Create `/etc/systemd/system/apothictech-dns.service`:

```ini
[Unit]
Description=Local DNS override for apothictech.se
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/sbin/dnsmasq --no-daemon --conf-file=/etc/apothictech-dns.conf
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable it:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now apothictech-dns.service
```

### 7. Loopia Dynamic DNS

Create `/usr/local/sbin/loopia-ddns` from the script currently used on this
server. It reads secrets from `/etc/loopia-ddns.env`.

The environment file should contain at least:

```text
LOOPIA_DDNS_USER=...
LOOPIA_DDNS_PASSWORD=...
LOOPIA_DDNS_HOSTNAMES=apothictech.se,www.apothictech.se,play.apothictech.se
```

Keep `/etc/loopia-ddns.env` readable only by root.

Create `/etc/systemd/system/loopia-ddns.service`:

```ini
[Unit]
Description=Update Loopia dynamic DNS records
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/loopia-ddns.env
ExecStart=/usr/local/sbin/loopia-ddns
```

Create `/etc/systemd/system/loopia-ddns.timer`:

```ini
[Unit]
Description=Run Loopia dynamic DNS updater periodically

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
AccuracySec=30s
Persistent=true

[Install]
WantedBy=timers.target
```

Enable it:

```sh
sudo chmod 700 /usr/local/sbin/loopia-ddns
sudo chmod 600 /etc/loopia-ddns.env
sudo systemctl daemon-reload
sudo systemctl enable --now loopia-ddns.timer
```

### 8. Router

Forward WAN traffic to the server:

```text
TCP 80  -> 192.168.32.186:80
TCP 443 -> 192.168.32.186:443
```

For local split DNS, set router DHCP DNS to:

```text
192.168.32.186
```

Do not set `8.8.8.8` as secondary if you need split DNS to be reliable; many
clients use secondary DNS in parallel.

### 9. Validation

```sh
systemctl status eutherhost.service --no-pager
systemctl status caddy --no-pager
systemctl status apothictech-dns.service --no-pager
systemctl status loopia-ddns.timer --no-pager
curl -i http://127.0.0.1:32162
curl -i http://192.168.32.186:8080
curl -i --resolve apothictech.se:443:127.0.0.1 https://apothictech.se
dig @192.168.32.186 apothictech.se +short
dig @192.168.32.186 play.apothictech.se +short
```

Expected app behavior on LAN:

- `http://192.168.32.186:8080` should show build info in the perf panel.
- In Firefox on a LAN client, the trace should include `WebRTC LAN HTTP trial`.
- Fast playback should report `BRIDGE WEBRTC + WEBRTC A/V` when WebRTC succeeds.

## Services

Check the main services:

```sh
systemctl status eutherhost.service --no-pager
systemctl status caddy --no-pager
systemctl status apothictech-dns.service --no-pager
systemctl status loopia-ddns.timer --no-pager
systemctl status ssh --no-pager
```

Boot-enabled services:

```sh
systemctl is-enabled eutherhost.service caddy apothictech-dns.service loopia-ddns.timer ssh nginx
```

Expected state:

```text
eutherhost.service  enabled
caddy               enabled
apothictech-dns     enabled
loopia-ddns.timer   enabled
ssh                 enabled
nginx               disabled
```

Restart after changes:

```sh
sudo systemctl restart eutherhost.service
sudo systemctl reload caddy
```

Logs:

```sh
journalctl -u eutherhost.service -n 100 --no-pager
journalctl -u caddy -n 100 --no-pager
journalctl -u apothictech-dns.service -n 100 --no-pager
journalctl -u loopia-ddns.service -n 100 --no-pager
```

## EutherHost

Config files:

```text
/home/nichlas/EutherOxide/.euther-host/config.toml
/home/nichlas/EutherOxide/.euther-host/users.toml
```

Runtime:

```text
WorkingDirectory=/home/nichlas/EutherOxide
ExecStart=/home/nichlas/EutherOxide/scripts/host-server.sh
Backend bind=127.0.0.1:32162
Allowed origins=https://apothictech.se,https://play.apothictech.se,http://192.168.32.186:8080
ROM dir=/home/nichlas/roms
```

Build the release server:

```sh
cd /home/nichlas/EutherOxide
bash scripts/build-release.sh
sudo systemctl restart eutherhost.service
```

Direct backend test:

```sh
curl -i http://127.0.0.1:32162
```

Public path test from the server:

```sh
curl -i --resolve apothictech.se:443:127.0.0.1 https://apothictech.se
```

Internal LAN path test:

```sh
curl -i http://192.168.32.186:8080
```

## Caddy

Caddy config:

```text
/etc/caddy/Caddyfile
```

Current role:

- Owns ports `80` and `443`
- Provides HTTPS certificates
- Reverse-proxies `apothictech.se`, `play.apothictech.se`, and
  `www.apothictech.se` to `127.0.0.1:32162`
- Also serves those HTTPS names on `:8443` as a fallback test port
- Exposes `http://192.168.32.186:8080` inside LAN; the web client allows a
  private-LAN WebRTC/H.264 trial on that HTTP origin

Validate and reload:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Loopia Dynamic DNS

Files:

```text
/usr/local/sbin/loopia-ddns
/etc/loopia-ddns.env
/etc/systemd/system/loopia-ddns.service
/etc/systemd/system/loopia-ddns.timer
```

The timer updates:

```text
apothictech.se
www.apothictech.se
play.apothictech.se
```

Run manually:

```sh
sudo systemctl start loopia-ddns.service
systemctl status loopia-ddns.service --no-pager
```

Check DNS:

```sh
getent ahostsv4 apothictech.se
getent ahostsv4 www.apothictech.se
getent ahostsv4 play.apothictech.se
```

## Router

Port forwarding should point to the server:

```text
TCP 80  -> 192.168.32.186:80
TCP 443 -> 192.168.32.186:443
```

Do not point these to `196.168.32.186`; that was the wrong address.

If exposing SSH from outside the home network, prefer a high external port:

```text
TCP 2222 -> 192.168.32.186:22
```

Then connect from outside with:

```sh
ssh -p 2222 nichlas@apothictech.se
```

Avoid exposing router remote management on WAN ports `80` or `443`.

## Local DNS For LAN

The server runs a small `dnsmasq` service that maps the public hostnames back to
the LAN server IP:

```text
apothictech.se      -> 192.168.32.186
www.apothictech.se  -> 192.168.32.186
play.apothictech.se -> 192.168.32.186
```

Files:

```text
/etc/apothictech-dns.conf
/etc/systemd/system/apothictech-dns.service
```

Commands:

```sh
systemctl status apothictech-dns.service --no-pager
sudo systemctl restart apothictech-dns.service
dig @192.168.32.186 apothictech.se +short
dig @192.168.32.186 play.apothictech.se +short
dig @192.168.32.186 github.com +short
```

To make LAN clients use it, set router DHCP DNS to:

```text
192.168.32.186
```

If the router does not allow custom DHCP DNS, set DNS manually per device:

```text
DNS server: 192.168.32.186
Fallback DNS, optional: 192.168.32.1
```

After changing DNS on a client, reconnect Wi-Fi or renew DHCP. Then test:

```sh
nslookup apothictech.se 192.168.32.186
```

Expected result:

```text
192.168.32.186
```

## SSH

SSH server is installed and enabled:

```sh
systemctl status ssh --no-pager
ss -tulpn | grep ':22'
```

From the main computer on the LAN, connect with:

```sh
ssh nichlas@192.168.32.186
```

Optional client config on the main computer:

```sshconfig
Host euther
    HostName 192.168.32.186
    User nichlas
    Port 22
```

Then connect with:

```sh
ssh euther
```

For Termius on the phone while on the home Wi-Fi:

```text
Alias: EutherServer LAN
Host: 192.168.32.186
Port: 22
Username: nichlas
Authentication: password or key
```

For Termius outside the home network, only after adding the router forward:

```text
Alias: EutherServer WAN
Host: apothictech.se
Port: 2222
Username: nichlas
Authentication: preferably key
```

### SSH Keys

From the main computer:

```sh
ssh-keygen -t ed25519 -C "nichlas-main"
ssh-copy-id nichlas@192.168.32.186
```

For Termius:

1. Generate or import an Ed25519 key in Termius.
2. Copy the public key.
3. Add it on the server:

```sh
mkdir -p ~/.ssh
chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

After keys are confirmed working, password login can be disabled by adding this
to `/etc/ssh/sshd_config.d/hardening.conf`:

```text
PasswordAuthentication no
PermitRootLogin no
```

Then reload SSH:

```sh
sudo systemctl reload ssh
```

Do not disable password login until both the main computer and Termius have been
tested with keys.

## GitHub Credentials

GitHub CLI is installed as the Git credential manager for HTTPS remotes.

Current remote:

```sh
git remote -v
```

Expected remote:

```text
origin  https://github.com/NichlasEk/EutherOxide (fetch)
origin  https://github.com/NichlasEk/EutherOxide (push)
```

Log in with a GitHub personal access token without putting the token in shell
history:

```sh
gh auth login --hostname github.com --git-protocol https --with-token
```

Paste the token, press Enter, then press `Ctrl-D`.

After login, wire `gh` into Git:

```sh
gh auth setup-git
gh auth status
```

Test GitHub access:

```sh
git ls-remote origin HEAD
```

For pushing this repo:

```sh
git push origin HEAD
```

The token should have access to `NichlasEk/EutherOxide`. For a classic PAT,
`repo` is enough for private repos. For a fine-grained token, grant repository
Contents read/write access.

## Useful Ports

```text
22     SSH
53     Local DNS override, dnsmasq on 127.0.0.1 and 192.168.32.186
80     HTTP, Caddy
443    HTTPS, Caddy
8080   LAN HTTP EutherHost through Caddy
8443   HTTPS fallback/test port through Caddy
32162  EutherHost backend, localhost only
2019   Caddy admin, localhost only
49152-49200 UDP WebRTC media candidate range
```

## Source Layout Notes

The build does not depend on a sibling `/home/nichlas/jgenesis` checkout.

Vendored crates:

```text
crates/z80-emu
crates/jgenesis-common
```
