# Encrypted EutherHost user backups

`eutherhost-users-backup.service` encrypts `.euther-host/users.toml` with an
SSH public key and stores the result under `/srv/backups/eutheroxide`. The
server never receives the matching private key. Backups run daily, use atomic
writes, are checksummed, and are retained for 30 days.

The default deployment uses `/home/nichlas/.ssh/euther_server` as the recovery
identity. Install `age` on the server and copy the matching SSH public key to:

```text
/etc/eutheroxide-backup/recipients
```

That file must be owned by root, mode `0600`, and contain only an `ssh-ed25519`
or `ssh-rsa` public-key line. Install the script and units from the repository:

```bash
sudo install -d -m 0700 /srv/backups/eutheroxide
sudo install -m 0644 deploy/eutherhost-users-backup.service /etc/systemd/system/eutherhost-users-backup.service
sudo install -m 0644 deploy/eutherhost-users-backup.timer /etc/systemd/system/eutherhost-users-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now eutherhost-users-backup.timer
sudo systemctl start eutherhost-users-backup.service
```

## Mirroring to 192.168.32.88

The server backup directory is readable by the dedicated `eutherbackup` group.
Add `nichlas` to that group on the server, then add a separate SSH public key to
the server's `authorized_keys` with all access forced through read-only rrsync:

```text
from="192.168.32.88",restrict,command="/usr/bin/rrsync -ro /srv/backups/eutheroxide" ssh-ed25519 AAAA... euther-backup-pull@192.168.32.88
```

The matching private key on `.88` is used only by the mirror timer. The forced
command prevents that key from opening a shell, writing files, deleting files,
or reading anything outside the encrypted backup directory.

Install the user units on `.88` and start the timer:

```bash
install -d -m 0700 /home/nichlas/Backups/EutherOxide /home/nichlas/.config/systemd/user /home/nichlas/.local/libexec
install -m 0755 scripts/eutherhost-users-mirror.sh /home/nichlas/.local/libexec/eutherhost-users-mirror
install -m 0644 deploy/eutherhost-users-mirror.service /home/nichlas/.config/systemd/user/
install -m 0644 deploy/eutherhost-users-mirror.timer /home/nichlas/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now eutherhost-users-mirror.timer
systemctl --user start eutherhost-users-mirror.service
```

The mirror uses `--ignore-existing` and never deletes local files, so `.88` may
retain encrypted recovery points after the server's 30-day rotation removes its
copy.

Verify the newest encrypted file and its checksum on the server:

```bash
cd /srv/backups/eutheroxide
sha256sum -c eutherhost-users-YYYYMMDDTHHMMSSZ.toml.age.sha256
```

For a restore test, copy one `.age` file to the machine holding the private SSH
key, decrypt it to a protected temporary directory, and validate the TOML:

```bash
umask 077
age --decrypt --identity /home/nichlas/.ssh/euther_server \
  --output /tmp/eutherhost-users.restore.toml \
  eutherhost-users-YYYYMMDDTHHMMSSZ.toml.age
python3 -c 'import pathlib, tomllib; tomllib.loads(pathlib.Path("/tmp/eutherhost-users.restore.toml").read_text())'
```

Do not overwrite the live file while EutherHost is running. During a real
restore, stop `eutherhost.service`, install the validated file as owner
`nichlas:nichlas` with mode `0600`, and then start the service again.

The `/srv` destination is a separate partition but remains on the same physical
server disk. The `.88` mirror therefore supplies the second-machine copy needed
to recover from total disk loss on `.186`.
