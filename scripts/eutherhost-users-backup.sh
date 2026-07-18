#!/usr/bin/env bash
set -euo pipefail

umask 077

source_file="${EUTHERHOST_USERS_FILE:-/home/nichlas/EutherOxide/.euther-host/users.toml}"
recipient_file="${EUTHERHOST_BACKUP_RECIPIENTS:-/etc/eutheroxide-backup/recipients}"
backup_dir="${EUTHERHOST_BACKUP_DIR:-/srv/backups/eutheroxide}"
backup_group="${EUTHERHOST_BACKUP_GROUP:-eutherbackup}"
retention_days="${EUTHERHOST_BACKUP_RETENTION_DAYS:-30}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="${backup_dir}/eutherhost-users-${timestamp}.toml.age"
staging=""

cleanup() {
  if [[ -n "${staging}" ]]; then
    rm -rf -- "${staging}"
  fi
}
trap cleanup EXIT

if [[ "${EUID}" -ne 0 ]]; then
  echo "eutherhost-users-backup must run as root" >&2
  exit 1
fi

if [[ ! -f "${source_file}" ]]; then
  echo "users file not found: ${source_file}" >&2
  exit 1
fi

if [[ "$(stat -c '%a' "${source_file}")" != "600" ]]; then
  echo "users file must have mode 600: ${source_file}" >&2
  exit 1
fi

if [[ ! -s "${recipient_file}" ]]; then
  echo "age recipients file not found or empty: ${recipient_file}" >&2
  exit 1
fi

if grep -Evq '^(#|$|ssh-ed25519 |ssh-rsa )' "${recipient_file}"; then
  echo "recipients file may only contain SSH public keys" >&2
  exit 1
fi

if ! command -v age >/dev/null 2>&1; then
  echo "age is not installed" >&2
  exit 1
fi

if ! getent group "${backup_group}" >/dev/null; then
  echo "backup reader group not found: ${backup_group}" >&2
  exit 1
fi

if [[ "$(id -gn)" != "${backup_group}" ]]; then
  echo "backup must run with primary group ${backup_group}" >&2
  exit 1
fi

install -d -m 0750 "${backup_dir}"
staging="$(mktemp -d "${backup_dir}/.eutherhost-users-${timestamp}.XXXXXX")"
snapshot="${staging}/users.toml"
encrypted="${staging}/users.toml.age"

install -m 0600 "${source_file}" "${snapshot}"
python3 -c 'import pathlib, sys, tomllib; tomllib.loads(pathlib.Path(sys.argv[1]).read_text())' "${snapshot}"

age --encrypt --recipients-file "${recipient_file}" --output "${encrypted}" "${snapshot}"
chmod 0640 "${encrypted}"

if [[ "$(head -n 1 "${encrypted}")" != "age-encryption.org/v1" ]]; then
  echo "encrypted backup has an invalid age header" >&2
  exit 1
fi

if [[ -e "${archive}" ]]; then
  echo "backup already exists: ${archive}" >&2
  exit 1
fi

mv -- "${encrypted}" "${archive}"
(
  cd "${backup_dir}"
  sha256sum "$(basename "${archive}")"
) >"${archive}.sha256"
chmod 0640 "${archive}.sha256"

find "${backup_dir}" -maxdepth 1 -type f \
  \( -name 'eutherhost-users-*.toml.age' -o -name 'eutherhost-users-*.toml.age.sha256' \) \
  -mtime "+${retention_days}" -delete

echo "${archive}"
