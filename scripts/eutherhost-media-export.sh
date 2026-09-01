#!/usr/bin/env bash
set -euo pipefail

umask 077

host_dir="${EUTHERHOST_STATE_DIR:-/home/nichlas/EutherOxide/.euther-host}"
studio_dir="${EUTHERSTUDIO_DIR:-/srv/eutherstudio}"
recipient_file="${EUTHERHOST_BACKUP_RECIPIENTS:-/etc/eutheroxide-backup/recipients}"
backup_root="${EUTHERHOST_BACKUP_DIR:-/srv/backups/eutheroxide}"
media_dir="${backup_root}/media"
objects_dir="${media_dir}/objects"
manifests_dir="${media_dir}/manifests"
backup_group="${EUTHERHOST_BACKUP_GROUP:-eutherbackup}"
manifest_retention_days="${EUTHERHOST_MEDIA_MANIFEST_RETENTION_DAYS:-90}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
staging=""
new_objects=0
total_objects=0

cleanup() {
  [[ -z "${staging}" ]] || rm -rf -- "${staging}"
}
trap cleanup EXIT

[[ "${EUID}" -eq 0 ]] || { echo "media export must run as root" >&2; exit 1; }
[[ -s "${recipient_file}" ]] || { echo "age recipients missing: ${recipient_file}" >&2; exit 1; }
command -v age >/dev/null
command -v python3 >/dev/null
getent group "${backup_group}" >/dev/null
[[ "$(id -gn)" == "${backup_group}" ]] || {
  echo "backup must run with primary group ${backup_group}" >&2
  exit 1
}

exec 9>/run/euthervault-backup.lock
flock -n 9 || { echo "another EutherVault backup is active" >&2; exit 1; }

install -d -m 0750 "${media_dir}" "${objects_dir}" "${manifests_dir}"
staging="$(mktemp -d "${media_dir}/.media-${timestamp}.XXXXXX")"
index_tsv="${staging}/objects.tsv"
: > "${index_tsv}"

process_file() {
  local logical="$1"
  local source="$2"
  local snapshot="${staging}/source"
  local plain_sha size mtime object temporary cipher_sha path_b64

  cp --reflink=auto -- "${source}" "${snapshot}"
  plain_sha="$(sha256sum "${snapshot}" | awk '{print $1}')"
  size="$(stat -c '%s' "${snapshot}")"
  mtime="$(stat -c '%Y' "${source}")"
  object="${objects_dir}/${plain_sha}.age"
  if [[ ! -e "${object}" ]]; then
    temporary="${staging}/${plain_sha}.age"
    age --encrypt --recipients-file "${recipient_file}" --output "${temporary}" "${snapshot}"
    [[ "$(head -n 1 "${temporary}")" == "age-encryption.org/v1" ]]
    chmod 0640 "${temporary}"
    mv -- "${temporary}" "${object}"
    (
      cd "${objects_dir}"
      sha256sum "${plain_sha}.age"
    ) > "${object}.sha256"
    chmod 0640 "${object}.sha256"
    new_objects=$((new_objects + 1))
  fi
  cipher_sha="$(awk 'NR == 1 {print $1}' "${object}.sha256")"
  [[ -n "${cipher_sha}" && "$(sha256sum "${object}" | awk '{print $1}')" == "${cipher_sha}" ]] || {
    echo "encrypted media object checksum mismatch: ${object}" >&2
    exit 1
  }
  path_b64="$(printf '%s' "${logical}" | base64 -w0)"
  printf '%s\t%s\t%s\t%s\t%s\n' "${plain_sha}" "${cipher_sha}" "${size}" "${mtime}" "${path_b64}" >> "${index_tsv}"
  total_objects=$((total_objects + 1))
}

scan_tree() {
  local label="$1"
  local root="$2"
  [[ -d "${root}" ]] || return 0
  while IFS= read -r -d '' source; do
    process_file "${label}/${source#"${root}"/}" "${source}"
  done < <(find "${root}" -type f -print0 | sort -z)
}

scan_tree 'euther-host/eutherium/joxbox' "${host_dir}/eutherium/joxbox"
scan_tree 'euther-host/social-chat/attachments' "${host_dir}/social-chat/attachments"
while IFS= read -r -d '' source; do
  process_file "eutherstudio/${source#"${studio_dir}"/}" "${source}"
done < <(find "${studio_dir}/users" -type f -path '*/output/*' -print0 2>/dev/null | sort -z)
while IFS= read -r -d '' source; do
  process_file "euther-host/${source#"${host_dir}"/}" "${source}"
done < <(find "${host_dir}/user-data" -type f -path '*/eutherbooks/voices/*' -print0 2>/dev/null | sort -z)

manifest_plain="${staging}/eutherhost-media-${timestamp}.json"
python3 - "${index_tsv}" "${manifest_plain}" "${timestamp}" <<'PY'
import base64
import json
import pathlib
import sys

entries = []
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    plain_sha, cipher_sha, size, mtime, path_b64 = line.split("\t")
    entries.append({
        "path": base64.b64decode(path_b64).decode("utf-8"),
        "plain_sha256": plain_sha,
        "cipher_sha256": cipher_sha,
        "size": int(size),
        "mtime_unix": int(mtime),
    })
payload = {
    "schema": 1,
    "kind": "eutherhost-content-addressed-media",
    "created_utc": sys.argv[3],
    "object_count": len(entries),
    "plain_bytes": sum(entry["size"] for entry in entries),
    "objects": sorted(entries, key=lambda entry: entry["path"]),
}
pathlib.Path(sys.argv[2]).write_text(
    json.dumps(payload, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
PY

manifest="${manifests_dir}/eutherhost-media-${timestamp}.json.age"
age --encrypt --recipients-file "${recipient_file}" --output "${manifest}" "${manifest_plain}"
[[ "$(head -n 1 "${manifest}")" == "age-encryption.org/v1" ]]
chmod 0640 "${manifest}"
(
  cd "${manifests_dir}"
  sha256sum "$(basename "${manifest}")"
) > "${manifest}.sha256"
chmod 0640 "${manifest}.sha256"

find "${manifests_dir}" -maxdepth 1 -type f \
  \( -name 'eutherhost-media-*.json.age' -o -name 'eutherhost-media-*.json.age.sha256' \) \
  -mtime "+${manifest_retention_days}" -delete

printf 'created %s (%s referenced objects, %s new encrypted objects)\n' \
  "${manifest}" "${total_objects}" "${new_objects}"
