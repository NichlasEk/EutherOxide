#!/usr/bin/env bash
set -euo pipefail

umask 077

host_dir="${EUTHERHOST_STATE_DIR:-/home/nichlas/EutherOxide/.euther-host}"
studio_dir="${EUTHERSTUDIO_DIR:-/srv/eutherstudio}"
recipient_file="${EUTHERHOST_BACKUP_RECIPIENTS:-/etc/eutheroxide-backup/recipients}"
backup_root="${EUTHERHOST_BACKUP_DIR:-/srv/backups/eutheroxide}"
backup_dir="${backup_root}/state"
backup_group="${EUTHERHOST_BACKUP_GROUP:-eutherbackup}"
retention_days="${EUTHERHOST_STATE_RETENTION_DAYS:-30}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="${backup_dir}/eutherhost-state-${timestamp}.tar.gz.age"
staging=""

cleanup() {
  [[ -z "${staging}" ]] || rm -rf -- "${staging}"
}
trap cleanup EXIT

[[ "${EUID}" -eq 0 ]] || { echo "state backup must run as root" >&2; exit 1; }
[[ -d "${host_dir}" ]] || { echo "host state missing: ${host_dir}" >&2; exit 1; }
[[ -d "${studio_dir}" ]] || { echo "studio state missing: ${studio_dir}" >&2; exit 1; }
[[ -s "${recipient_file}" ]] || { echo "age recipients missing: ${recipient_file}" >&2; exit 1; }
grep -Evq '^(#|$|ssh-ed25519 |ssh-rsa )' "${recipient_file}" && {
  echo "recipients file contains unsupported entries" >&2
  exit 1
}
command -v age >/dev/null
command -v tar >/dev/null
command -v python3 >/dev/null
getent group "${backup_group}" >/dev/null
[[ "$(id -gn)" == "${backup_group}" ]] || {
  echo "backup must run with primary group ${backup_group}" >&2
  exit 1
}

exec 9>/run/euthervault-backup.lock
flock -n 9 || { echo "another EutherVault backup is active" >&2; exit 1; }

install -d -m 0750 "${backup_dir}"
staging="$(mktemp -d "${backup_dir}/.state-${timestamp}.XXXXXX")"
install -d -m 0700 "${staging}/payload/euther-host" "${staging}/payload/eutherstudio"

# Kopiera beständigt metadata/state. Stora eller återskapningsbara data hanteras
# av mediaexporten eller lämnas utanför backupen.
tar -C "${host_dir}" \
  --exclude='./backup-requests' \
  --exclude='./openra-alert' \
  --exclude='./openra-smoke' \
  --exclude='./social-chat/attachments' \
  --exclude='./eutherium/joxbox' \
  --exclude='./user-data/*/eutherbooks/voices' \
  --exclude='./*.log' \
  -cf - . | tar -C "${staging}/payload/euther-host" --no-same-owner -xf -

tar -C "${studio_dir}" \
  --exclude='users/*/output' \
  --exclude='users/*/output/*' \
  -cf - config jobs users | tar -C "${staging}/payload/eutherstudio" --no-same-owner -xf -

(
  cd "${staging}/payload"
  find euther-host eutherstudio -type f -print0 | sort -z | xargs -0 -r sha256sum \
    > .euthervault-files.sha256
)
file_count="$(wc -l < "${staging}/payload/.euthervault-files.sha256")"
plain_bytes="$(du -sb "${staging}/payload" | awk '{print $1}')"
python3 - "${staging}/payload/.euthervault-manifest.json" "${timestamp}" "${file_count}" "${plain_bytes}" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
payload = {
    "schema": 1,
    "kind": "eutherhost-critical-state",
    "created_utc": sys.argv[2],
    "file_count": int(sys.argv[3]),
    "plain_bytes": int(sys.argv[4]),
    "excluded": [
        "runtime/openra",
        "logs",
        "backup requests",
        "content-addressed media",
    ],
}
path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY

bundle="${staging}/eutherhost-state-${timestamp}.tar.gz"
tar -C "${staging}/payload" --sort=name --owner=0 --group=0 --numeric-owner -czf "${bundle}" .
tar -tzf "${bundle}" >/dev/null
encrypted="${staging}/$(basename "${archive}")"
age --encrypt --recipients-file "${recipient_file}" --output "${encrypted}" "${bundle}"
[[ "$(head -n 1 "${encrypted}")" == "age-encryption.org/v1" ]]
chmod 0640 "${encrypted}"
mv -- "${encrypted}" "${archive}"
(
  cd "${backup_dir}"
  sha256sum "$(basename "${archive}")"
) > "${archive}.sha256"
chmod 0640 "${archive}.sha256"

find "${backup_dir}" -maxdepth 1 -type f \
  \( -name 'eutherhost-state-*.tar.gz.age' -o -name 'eutherhost-state-*.tar.gz.age.sha256' \) \
  -mtime "+${retention_days}" -delete

printf 'created %s (%s files, %s plaintext bytes)\n' "${archive}" "${file_count}" "${plain_bytes}"
