#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import pathlib
import subprocess
import sys


def systemctl_state(timer: str, user: bool) -> tuple[bool, bool]:
    prefix = ["systemctl"]
    if user:
        prefix.append("--user")

    def check(action: str) -> bool:
        result = subprocess.run(
            [*prefix, action, timer],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return result.returncode == 0

    return check("is-enabled"), check("is-active")


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_backups(directory: pathlib.Path) -> tuple[list[pathlib.Path], list[str]]:
    encrypted = sorted(directory.glob("eutherhost-users-*.toml.age"))
    errors: list[str] = []
    for path in encrypted:
        checksum_path = path.with_name(f"{path.name}.sha256")
        if not checksum_path.is_file():
            errors.append(f"missing checksum for {path.name}")
            continue
        fields = checksum_path.read_text(encoding="utf-8").split()
        if not fields:
            errors.append(f"empty checksum file for {path.name}")
            continue
        if sha256(path) != fields[0]:
            errors.append(f"checksum mismatch for {path.name}")
        with path.open("rb") as handle:
            if handle.readline().rstrip(b"\r\n") != b"age-encryption.org/v1":
                errors.append(f"invalid age header for {path.name}")
    orphan_checksums = [
        path.name
        for path in directory.glob("eutherhost-users-*.toml.age.sha256")
        if not path.with_name(path.name.removesuffix(".sha256")).is_file()
    ]
    errors.extend(f"orphan checksum {name}" for name in sorted(orphan_checksums))
    return encrypted, errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate encrypted EutherHost backup freshness and checksums.")
    parser.add_argument("--directory", required=True)
    parser.add_argument("--timer", required=True)
    parser.add_argument("--user-systemd", action="store_true")
    parser.add_argument("--max-age-hours", type=float, default=36.0)
    parser.add_argument("--label", default="eutherhost-users")
    args = parser.parse_args()

    directory = pathlib.Path(args.directory)
    errors: list[str] = []
    enabled, active = systemctl_state(args.timer, args.user_systemd)
    if not enabled:
        errors.append(f"timer not enabled: {args.timer}")
    if not active:
        errors.append(f"timer not active: {args.timer}")

    encrypted: list[pathlib.Path] = []
    if not directory.is_dir():
        errors.append(f"backup directory missing: {directory}")
    else:
        encrypted, backup_errors = check_backups(directory)
        errors.extend(backup_errors)

    latest = max(encrypted, key=lambda path: path.stat().st_mtime) if encrypted else None
    latest_epoch = int(latest.stat().st_mtime) if latest else 0
    now_epoch = int(dt.datetime.now(dt.UTC).timestamp())
    age_seconds = max(0, now_epoch - latest_epoch) if latest else None
    max_age_seconds = int(args.max_age_hours * 3600)
    if latest is None:
        errors.append("no encrypted backups found")
    elif age_seconds is not None and age_seconds > max_age_seconds:
        errors.append(f"latest backup is stale: {age_seconds}s > {max_age_seconds}s")

    payload = {
        "ok": not errors,
        "label": args.label,
        "directory": str(directory),
        "timer": args.timer,
        "timer_enabled": enabled,
        "timer_active": active,
        "backup_count": len(encrypted),
        "latest_file": latest.name if latest else None,
        "latest_created_utc": (
            dt.datetime.fromtimestamp(latest_epoch, dt.UTC).replace(microsecond=0).isoformat()
            if latest
            else None
        ),
        "age_seconds": age_seconds,
        "max_age_seconds": max_age_seconds,
        "all_checksums_ok": not any("checksum" in error or "age header" in error for error in errors),
        "errors": errors,
    }
    print(json.dumps(payload, sort_keys=True))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
