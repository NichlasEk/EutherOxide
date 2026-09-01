#!/usr/bin/env bash
set -euo pipefail

umask 077

server="${EUTHERHOST_MIRROR_SERVER:-nichlas@192.168.32.186}"
identity_file="${EUTHERHOST_MIRROR_IDENTITY:-/home/nichlas/.ssh/euther_backup_pull}"
known_hosts_file="${EUTHERHOST_MIRROR_KNOWN_HOSTS:-/home/nichlas/.ssh/known_hosts}"
mirror_dir="${EUTHERHOST_MIRROR_DIR:-/home/nichlas/Backups/EutherOxide}"

[[ -f "${identity_file}" ]] || { echo "backup pull identity not found: ${identity_file}" >&2; exit 1; }
[[ -f "${known_hosts_file}" ]] || { echo "SSH known-hosts file not found: ${known_hosts_file}" >&2; exit 1; }

install -d -m 0700 "${mirror_dir}"
ssh_command="ssh -F /dev/null -i ${identity_file} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${known_hosts_file}"

# Pull-only och utan delete: `.88` behåller krypterade historiska objekt även
# efter serverns retention. Katalogincludes behövs endast för traversal.
rsync --recursive --times --ignore-existing --prune-empty-dirs \
  --chmod=F600,D700 \
  --include='*/' \
  --include='eutherhost-users-*.toml.age' \
  --include='eutherhost-users-*.toml.age.sha256' \
  --include='state/eutherhost-state-*.tar.gz.age' \
  --include='state/eutherhost-state-*.tar.gz.age.sha256' \
  --include='media/objects/*.age' \
  --include='media/objects/*.age.sha256' \
  --include='media/manifests/eutherhost-media-*.json.age' \
  --include='media/manifests/eutherhost-media-*.json.age.sha256' \
  --exclude='*' \
  --rsh="${ssh_command}" \
  "${server}:/" "${mirror_dir}/"

verified=0
while IFS= read -r -d '' checksum_file; do
  encrypted_file="${checksum_file%.sha256}"
  [[ -f "${encrypted_file}" ]] || { echo "encrypted backup missing for ${checksum_file}" >&2; exit 1; }
  expected="$(awk 'NR == 1 { print $1 }' "${checksum_file}")"
  actual="$(sha256sum "${encrypted_file}" | awk '{ print $1 }')"
  [[ -n "${expected}" && "${actual}" == "${expected}" ]] || {
    echo "checksum mismatch: ${encrypted_file}" >&2
    exit 1
  }
  [[ "$(head -n 1 "${encrypted_file}")" == "age-encryption.org/v1" ]] || {
    echo "invalid age header: ${encrypted_file}" >&2
    exit 1
  }
  verified=$((verified + 1))
done < <(find "${mirror_dir}" -type f -name '*.age.sha256' -print0)

[[ "${verified}" -gt 0 ]] || { echo "no mirrored EutherHost backups found" >&2; exit 1; }
accounts="$(find "${mirror_dir}" -maxdepth 1 -type f -name 'eutherhost-users-*.toml.age' | wc -l)"
state="$(find "${mirror_dir}/state" -maxdepth 1 -type f -name 'eutherhost-state-*.tar.gz.age' 2>/dev/null | wc -l)"
objects="$(find "${mirror_dir}/media/objects" -maxdepth 1 -type f -name '*.age' 2>/dev/null | wc -l)"
manifests="$(find "${mirror_dir}/media/manifests" -maxdepth 1 -type f -name 'eutherhost-media-*.json.age' 2>/dev/null | wc -l)"
printf 'verified %s encrypted files (accounts=%s state=%s media_objects=%s media_manifests=%s) in %s\n' \
  "${verified}" "${accounts}" "${state}" "${objects}" "${manifests}" "${mirror_dir}"
