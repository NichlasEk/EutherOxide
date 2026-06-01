# EutherOxide Server Runbook

This machine is currently set up as a local special server build. The repo has
local changes that make it build without a sibling `/home/nichlas/jgenesis`
checkout, but those changes do not have to be pushed upstream.

## Public Addresses

- Public site: `https://apothictech.se`
- LAN server IP: `192.168.32.186`
- LAN SSH: `ssh nichlas@192.168.32.186`
- EutherHost backend: `127.0.0.1:32162` only, fronted by Caddy

## Services

Check the main services:

```sh
systemctl status eutherhost.service --no-pager
systemctl status caddy --no-pager
systemctl status loopia-ddns.timer --no-pager
systemctl status ssh --no-pager
```

Boot-enabled services:

```sh
systemctl is-enabled eutherhost.service caddy loopia-ddns.timer ssh nginx
```

Expected state:

```text
eutherhost.service  enabled
caddy               enabled
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
Public origin=https://apothictech.se
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

## Caddy

Caddy config:

```text
/etc/caddy/Caddyfile
```

Current role:

- Owns ports `80` and `443`
- Provides HTTPS certificates
- Reverse-proxies `apothictech.se` and `www.apothictech.se` to `127.0.0.1:32162`

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
80     HTTP, Caddy
443    HTTPS, Caddy
32162  EutherHost backend, localhost only
2019   Caddy admin, localhost only
```

## Current Local Code Changes

The local build no longer depends on `/home/nichlas/jgenesis`.

Vendored crates:

```text
crates/z80-emu
crates/jgenesis-common
```

Rust 1.85 compatibility edits were also made in:

```text
src/bus.rs
src/rom.rs
src/z80.rs
```

These can stay local if the upstream repo should remain unchanged.
