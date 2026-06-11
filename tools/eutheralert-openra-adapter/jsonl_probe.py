#!/usr/bin/env python3
import json
import pathlib
import sys
import time


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: jsonl_probe.py /path/to/output.jsonl", file=sys.stderr)
        return 2

    output = pathlib.Path(sys.argv[1])
    output.parent.mkdir(parents=True, exist_ok=True)

    with output.open("a", encoding="utf-8") as handle:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError as err:
                print(f"bad json: {err}", file=sys.stderr)
                continue
            event["_probe_received_unix_ms"] = int(time.time() * 1000)
            handle.write(json.dumps(event, separators=(",", ":"), sort_keys=True))
            handle.write("\n")
            handle.flush()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
