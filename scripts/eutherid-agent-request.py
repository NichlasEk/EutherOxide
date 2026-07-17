#!/usr/bin/env python3
"""Create or follow a fixed EutherID action through the local Unix socket."""

from __future__ import annotations

import argparse
import json
import pathlib
import socket
import sys
import time


DEFAULT_SOCKET = pathlib.Path.home() / "EutherOxide" / ".euther-host" / "automation.sock"


def exchange(socket_path: pathlib.Path, payload: dict[str, str]) -> dict:
    encoded = json.dumps(payload, separators=(",", ":")).encode() + b"\n"
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(10)
        client.connect(str(socket_path))
        client.sendall(encoded)
        client.shutdown(socket.SHUT_WR)
        response = bytearray()
        while True:
            chunk = client.recv(65536)
            if not chunk:
                break
            response.extend(chunk)
            if len(response) > 1024 * 1024:
                raise RuntimeError("automation response is too large")
    result = json.loads(response)
    if not result.get("ok"):
        raise RuntimeError(result.get("error", "automation request failed"))
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", help="fixed allowlisted restart handle")
    parser.add_argument("--socket", type=pathlib.Path, default=DEFAULT_SOCKET)
    parser.add_argument("--handles", action="store_true", help="list available handles")
    parser.add_argument("--no-wait", action="store_true", help="return after creating the request")
    args = parser.parse_args()
    if args.handles:
        print(json.dumps(exchange(args.socket, {"op": "handles"}), indent=2))
        return 0
    if not args.command:
        parser.error("command is required unless --handles is used")
    result = exchange(args.socket, {"op": "create", "name": args.command})
    print(json.dumps(result, indent=2))
    if args.no_wait:
        return 0
    challenge_id = result["challengeId"]
    deadline = min(result.get("expiresAt", 0) / 1000, time.time() + 125)
    while time.time() < deadline:
        time.sleep(2)
        result = exchange(args.socket, {"op": "status", "challengeId": challenge_id})
        print(json.dumps(result, indent=2))
        if result.get("status") == "completed":
            return 0
        if result.get("status") in {"denied", "expired", "failed", "consumed"}:
            return 2
    raise RuntimeError("EutherID request timed out")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print(f"eutherid-agent-request: {error}", file=sys.stderr)
        raise SystemExit(1)
