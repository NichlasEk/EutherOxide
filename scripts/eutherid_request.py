#!/usr/bin/env python3
"""Create and monitor a fixed EutherID request-only admin action."""

import argparse
import json
import pathlib
import time
import urllib.error
import urllib.request


BASE_URL = "https://apothictech.se"
TOKEN_FILE = pathlib.Path("/etc/eutherhost/eutherid-request-token")
CREATE_PATH = "/api/eutherid/request-actions/restart-eutherbooks"


def request_json(method: str, path: str, token: str) -> dict:
    request = urllib.request.Request(
        BASE_URL + path,
        method=method,
        data=b"{}" if method == "POST" else None,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-EutherID-Request-Token": token,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            message = json.load(error).get("error", str(error))
        except Exception:
            message = str(error)
        raise SystemExit(f"request rejected: {message}") from error


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["restart-eutherbooks"])
    parser.add_argument("--no-wait", action="store_true")
    args = parser.parse_args()
    token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    if len(token) < 32:
        raise SystemExit("request credential is unavailable")
    created = request_json("POST", CREATE_PATH, token)
    challenge_id = created["challengeId"]
    print(f"EutherID request {challenge_id}: restart EutherBooks")
    print("Waiting for biometric approval in the EutherID app.")
    if args.no_wait:
        return 0
    deadline = time.monotonic() + 125
    while time.monotonic() < deadline:
        status = request_json("GET", f"/api/eutherid/request-actions/{challenge_id}", token)
        state = status.get("status", "unknown")
        if state == "completed":
            print("EutherBooks restart completed and verified by EutherNet.")
            return 0
        if state in {"denied", "expired", "consumed"}:
            raise SystemExit(f"request ended with status: {state}")
        time.sleep(2)
    raise SystemExit("request timed out without approval")


if __name__ == "__main__":
    raise SystemExit(main())
