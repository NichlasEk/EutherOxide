#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import time
from dataclasses import dataclass
from pathlib import Path


SAFE_ROOT_NAMES = {"eutheroxide"}
EUTHERBOOKS_AUDIO_HINT = "/srv/eutherbooks/audio is cleaned by eutherbooks-clean.timer"


@dataclass(frozen=True)
class CleanupItem:
    path: Path
    reason: str
    size_bytes: int


def directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_file() or path.is_symlink():
        try:
            return path.stat().st_size
        except FileNotFoundError:
            return 0
    total = 0
    for child in path.rglob("*"):
        try:
            if child.is_file() or child.is_symlink():
                total += child.stat().st_size
        except FileNotFoundError:
            continue
    return total


def newest_mtime(path: Path) -> float:
    if not path.exists():
        return 0.0
    try:
        newest = path.stat().st_mtime
    except FileNotFoundError:
        return 0.0
    if path.is_file() or path.is_symlink():
        return newest
    for child in path.rglob("*"):
        try:
            newest = max(newest, child.stat().st_mtime)
        except FileNotFoundError:
            continue
    return newest


def old_enough(path: Path, max_age_seconds: float) -> bool:
    if max_age_seconds <= 0:
        return True
    mtime = newest_mtime(path)
    return bool(mtime and time.time() - mtime >= max_age_seconds)


def format_bytes(value: int) -> str:
    units = ["B", "KiB", "MiB", "GiB", "TiB"]
    amount = float(value)
    for unit in units:
        if amount < 1024 or unit == units[-1]:
            return f"{amount:.1f} {unit}"
        amount /= 1024
    return f"{value} B"


def under_allowed_root(path: Path, srv_root: Path) -> bool:
    try:
        relative = path.resolve().relative_to(srv_root.resolve())
    except ValueError:
        return False
    return bool(relative.parts) and relative.parts[0] in SAFE_ROOT_NAMES


def add_item(items: list[CleanupItem], path: Path, reason: str, srv_root: Path) -> None:
    if not path.exists() and not path.is_symlink():
        return
    if not under_allowed_root(path, srv_root):
        raise ValueError(f"Refusing cleanup outside safe /srv roots: {path}")
    items.append(CleanupItem(path=path, reason=reason, size_bytes=directory_size(path)))


def select_target_tmp_dirs(srv_root: Path, max_age_seconds: float) -> list[Path]:
    eutheroxide = srv_root / "eutheroxide"
    candidates: list[Path] = []
    for path in eutheroxide.glob("**/target/tmp"):
        if path.is_dir() and old_enough(path, max_age_seconds):
            candidates.append(path)
    return sorted(candidates)


def select_incremental_dirs(srv_root: Path, max_age_seconds: float) -> list[Path]:
    eutheroxide = srv_root / "eutheroxide"
    candidates: list[Path] = []
    for path in eutheroxide.glob("**/incremental"):
        if path.is_dir() and "target" in path.parts and old_enough(path, max_age_seconds):
            candidates.append(path)
    return sorted(candidates)


def select_empty_dirs(root: Path, srv_root: Path) -> list[Path]:
    if not root.exists():
        return []
    candidates: list[Path] = []
    for path in sorted((item for item in root.rglob("*") if item.is_dir()), key=lambda item: len(item.parts), reverse=True):
        if not under_allowed_root(path, srv_root):
            continue
        try:
            next(path.iterdir())
        except StopIteration:
            candidates.append(path)
        except OSError:
            continue
    return candidates


def collect_cleanup_items(args: argparse.Namespace) -> list[CleanupItem]:
    srv_root = args.srv_root.resolve()
    target_tmp_age = max(0.0, args.target_tmp_max_age_days) * 24 * 3600
    incremental_age = max(0.0, args.incremental_max_age_days) * 24 * 3600
    items: list[CleanupItem] = []

    for path in select_target_tmp_dirs(srv_root, target_tmp_age):
        add_item(items, path, "old cargo target tmp", srv_root)
    for path in select_incremental_dirs(srv_root, incremental_age):
        add_item(items, path, "stale incremental build cache", srv_root)

    if args.remove_empty_dirs:
        for path in select_empty_dirs(srv_root / "eutheroxide", srv_root):
            add_item(items, path, "empty directory", srv_root)

    seen: set[Path] = set()
    unique: list[CleanupItem] = []
    for item in sorted(items, key=lambda entry: (len(entry.path.parts), str(entry.path)), reverse=True):
        resolved = item.path.resolve()
        if any(parent in seen for parent in resolved.parents):
            continue
        seen.add(resolved)
        unique.append(item)
    return unique


def remove_item(item: CleanupItem) -> None:
    if item.path.is_dir() and not item.path.is_symlink():
        shutil.rmtree(item.path, ignore_errors=True)
    else:
        item.path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Clean low-risk generated data on the EutherServer /srv partition.")
    parser.add_argument("--srv-root", type=Path, default=Path("/srv"))
    parser.add_argument("--target-tmp-max-age-days", type=float, default=7.0)
    parser.add_argument("--incremental-max-age-days", type=float, default=14.0)
    parser.add_argument("--remove-empty-dirs", action="store_true")
    parser.add_argument("--apply", action="store_true", help="Delete selected files and directories. Without this, only reports.")
    args = parser.parse_args()

    usage = shutil.disk_usage(args.srv_root)
    print(f"srv usage: used={format_bytes(usage.used)} free={format_bytes(usage.free)} total={format_bytes(usage.total)}")
    print(EUTHERBOOKS_AUDIO_HINT)

    items = collect_cleanup_items(args)
    reclaim = sum(item.size_bytes for item in items)
    print(f"cleanup items: {len(items)}, reclaim {format_bytes(reclaim)}")
    for item in items:
        print("remove", item.reason, item.path, format_bytes(item.size_bytes))

    if not args.apply:
        print("dry run only; pass --apply to delete")
        return 0

    for item in items:
        remove_item(item)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
