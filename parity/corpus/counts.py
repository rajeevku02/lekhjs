"""The aggregate count report of the corpus (verification 02 §A.6; spec 11 §8 "Reports").

Reads only local files under ``corpus/`` (no network) and writes
``corpus/counts.json``: per stratum (group x provider), the boards in the
manifest, fetched from S3, fetched from DocumentDB, still pending DocumentDB,
not found in DocumentDB, and their bytes. Counts only: safe to copy to Windy.

    lbs/tools/growth/.venv/bin/python -I -B lekhjs/parity/corpus/counts.py
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
import corpus_common as cc  # noqa: E402


def lines(path: Path) -> set[str]:
    return {l.strip() for l in path.read_text().splitlines() if l.strip()} if path.exists() else set()


def main() -> int:
    manifest = cc.read_manifest()
    pending = lines(cc.PENDING_DOCDB)
    done = lines(cc.CORPUS / "docdb-done.txt")
    keys = ("manifest", "s3", "docdb", "pending_docdb", "docdb_not_found", "bytes")
    table: dict[str, dict] = defaultdict(lambda: dict.fromkeys(keys, 0))
    for row in manifest:
        for stratum in (f"{row['group']}/{row['provider']}", "all"):
            t = table[stratum]
            t["manifest"] += 1
            meta_path = cc.META / f"{row['idx']}.json"
            if (cc.BOARDS / f"{row['idx']}.lekh").exists() and meta_path.exists():
                meta = json.loads(meta_path.read_text())
                t[meta.get("source", "s3")] += 1
                t["bytes"] += int(meta.get("bytes") or 0)
            elif row["idx"] in done:
                t["docdb_not_found"] += 1
            elif row["idx"] in pending:
                t["pending_docdb"] += 1
    out = {k: table[k] for k in sorted(table)}
    cc.write_atomic(cc.CORPUS / "counts.json", (json.dumps(out, indent=2) + "\n").encode())
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
