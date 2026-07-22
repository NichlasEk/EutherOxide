#!/usr/bin/env bash
set -euo pipefail

umask 077

server="${EUTHERHOST_MIRROR_SERVER:-nichlas@192.168.32.186}"
identity_file="${EUTHERHOST_MIRROR_IDENTITY:-/home/nichlas/.ssh/euther_backup_pull}"
known_hosts_file="${EUTHERHOST_MIRROR_KNOWN_HOSTS:-/home/nichlas/.ssh/known_hosts}"
mirror_dir="${EUTHERHOST_MIRROR_DIR:-/home/nichlas/Backups/EutherOxide}"

if [[ ! -f "${identity_file}" ]]; then
  echo "backup pull identity not found: ${identity_file}" >&2
  exit 1
fi

if [[ ! -f "${known_hosts_file}" ]]; then
  echo "SSH known-hosts file not found: ${known_hosts_file}" >&2
  exit 1
fi

install -d -m 0700 "${mirror_dir}"

ssh_command="ssh -F /dev/null -i ${identity_file} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${known_hosts_file}"

rsync --recursive --times --ignore-existing --prune-empty-dirs \
  --chmod=F600,D700 \
  --include='eutherhost-users-*.toml.age' \
  --include='eutherhost-users-*.toml.age.sha256' \
  --exclude='*' \
  --rsh="${ssh_command}" \
  "${server}:/" "${mirror_dir}/"

verified=0
while IFS= read -r -d '' checksum_file; do
  encrypted_file="${checksum_file%.sha256}"
  if [[ ! -f "${encrypted_file}" ]]; then
    echo "encrypted backup missing for checksum: ${checksum_file}" >&2
    exit 1
  fi
  expected="$(awk 'NR == 1 { print $1 }' "${checksum_file}")"
  actual="$(sha256sum "${encrypted_file}" | awk '{ print $1 }')"
  if [[ -z "${expected}" || "${actual}" != "${expected}" ]]; then
    echo "checksum mismatch: ${encrypted_file}" >&2
    exit 1
  fi
  verified=$((verified + 1))
done < <(find "${mirror_dir}" -maxdepth 1 -type f -name 'eutherhost-users-*.toml.age.sha256' -print0)

if [[ "${verified}" -eq 0 ]]; then
  echo "no mirrored EutherHost backups found" >&2
  exit 1
fi

echo "verified ${verified} mirrored EutherHost backup(s) in ${mirror_dir}"
