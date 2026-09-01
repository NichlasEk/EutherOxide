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


def check_backups(encrypted: list[pathlib.Path]) -> list[str]:
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
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate encrypted EutherHost backup freshness and checksums.")
    parser.add_argument("--directory", required=True)
    parser.add_argument("--timer", required=True)
    parser.add_argument("--state-timer")
    parser.add_argument("--media-timer")
    parser.add_argument("--user-systemd", action="store_true")
    parser.add_argument("--max-age-hours", type=float, default=36.0)
    parser.add_argument("--label", default="eutherhost-users")
    args = parser.parse_args()

    directory = pathlib.Path(args.directory)
    errors: list[str] = []
    timer_states = {}
    for timer in filter(None, (args.timer, args.state_timer, args.media_timer)):
        enabled, active = systemctl_state(timer, args.user_systemd)
        timer_states[timer] = {"enabled": enabled, "active": active}
        if not enabled:
            errors.append(f"timer not enabled: {timer}")
        if not active:
            errors.append(f"timer not active: {timer}")

    datasets: dict[str, dict[str, object]] = {}
    encrypted: list[pathlib.Path] = []
    if not directory.is_dir():
        errors.append(f"backup directory missing: {directory}")
    else:
        account_files = sorted(directory.glob("eutherhost-users-*.toml.age"))
        state_files = sorted((directory / "state").glob("eutherhost-state-*.tar.gz.age"))
        media_objects = sorted((directory / "media/objects").glob("*.age"))
        media_manifests = sorted(
            (directory / "media/manifests").glob("eutherhost-media-*.json.age")
        )
        dataset_files = {
            "accounts": (account_files, account_files),
            "state": (state_files, state_files),
            "media": (media_objects + media_manifests, media_manifests),
        }
        for name, (files, freshness_files) in dataset_files.items():
            dataset_errors = check_backups(files)
            errors.extend(f"{name}: {error}" for error in dataset_errors)
            latest_dataset = max(
                freshness_files, key=lambda path: path.stat().st_mtime, default=None
            )
            datasets[name] = {
                "ok": bool(files) and not dataset_errors,
                "backup_count": len(files),
                "total_bytes": sum(path.stat().st_size for path in files),
                "latest_file": latest_dataset.name if latest_dataset else None,
                "latest_epoch": int(latest_dataset.stat().st_mtime)
                if latest_dataset
                else 0,
            }
            encrypted.extend(files)
        for checksum_path in directory.rglob("*.age.sha256"):
            encrypted_path = checksum_path.with_name(
                checksum_path.name.removesuffix(".sha256")
            )
            if not encrypted_path.is_file():
                errors.append(f"orphan checksum {checksum_path.relative_to(directory)}")

    freshness_candidates = [
        path
        for name in ("accounts", "state", "media")
        if (latest_name := datasets.get(name, {}).get("latest_file"))
        for path in encrypted
        if path.name == latest_name
    ]
    latest = max(freshness_candidates, key=lambda path: path.stat().st_mtime, default=None)
    latest_epoch = int(latest.stat().st_mtime) if latest else 0
    now_epoch = int(dt.datetime.now(dt.UTC).timestamp())
    age_seconds = max(0, now_epoch - latest_epoch) if latest else None
    max_age_seconds = int(args.max_age_hours * 3600)
    for name, dataset in datasets.items():
        dataset_epoch = int(dataset["latest_epoch"])
        dataset_age = max(0, now_epoch - dataset_epoch) if dataset_epoch else None
        dataset["age_seconds"] = dataset_age
        if dataset_age is None:
            errors.append(f"{name}: no encrypted backups found")
            dataset["ok"] = False
        elif dataset_age > max_age_seconds:
            errors.append(
                f"{name}: latest backup is stale: "
                f"{dataset_age}s > {max_age_seconds}s"
            )
            dataset["ok"] = False
    if latest is None:
        errors.append("no encrypted backups found")
    elif age_seconds is not None and age_seconds > max_age_seconds:
        errors.append(f"latest backup is stale: {age_seconds}s > {max_age_seconds}s")

    payload = {
        "ok": not errors,
        "label": args.label,
        "directory": str(directory),
        "timer": args.timer,
        "timer_enabled": all(state["enabled"] for state in timer_states.values()),
        "timer_active": all(state["active"] for state in timer_states.values()),
        "timers": timer_states,
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
        "datasets": datasets,
        "errors": errors,
    }
    print(json.dumps(payload, sort_keys=True))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
