"""Step 4 of the corpus procedure: DocumentDB, only for the rest (verification 02 §A.6 step 4).

Reads the boards listed in ``corpus/pending-docdb.txt`` (those with no S3
snapshot) from production DocumentDB, **strictly read-only**, under the rules
of KB ``/backend/storage/mongodb.md`` §8:

- refuses to start outside **22:00-02:00 UTC**, re-checks the UTC clock before
  every batch and stops at 02:00;
- one connection through the SSH tunnel on ``127.0.0.1:27018`` as
  ``read@publicdb`` (``growthlib.docdb.connect``: the start-up role check, the
  pinned driver, ``maxPoolSize=1``, redacted errors);
- **one reader**, at most 200 docids per batch,
  ``find({docid: {$in: [...]}}, {docid, version, doc})``, one cursor at a time,
  a 2 s pause between batches;
- **stops on the first error** of any kind (low memory included) and resumes
  on the next run from the done-list ``corpus/docdb-done.txt``.

Writes ``corpus/boards/<idx>.lekh`` (the ``doc`` member as relaxed JSON) and
``corpus/meta/<idx>.json`` ``{source: "docdb", version, bytes}``. Prints counts
only.

    lbs/tools/growth/.venv/bin/python -I -B lekhjs/parity/corpus/fetch_docdb.py
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
import corpus_common as cc  # noqa: E402

cc.bootstrap()
from growthlib import docdb  # noqa: E402

TUNNEL = "127.0.0.1:27018"
PAUSE_S = 2.0
PROJECTION = {"_id": 0, "docid": 1, "version": 1, "doc": 1}
DONE = cc.CORPUS / "docdb-done.txt"


def in_window(now: dt.datetime | None = None) -> bool:
    h = (now or dt.datetime.now(dt.timezone.utc)).hour
    return h >= 22 or h < 2


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", type=int, default=docdb.MAX_BATCH)
    args = ap.parse_args()
    batch_size = min(args.batch, docdb.MAX_BATCH)

    cc.require_ignored_corpus()
    if not in_window():
        sys.exit("outside the 22:00-02:00 UTC DocumentDB window; not starting")

    by_idx = {r["idx"]: r for r in cc.read_manifest()}
    pending = []
    if cc.PENDING_DOCDB.exists():
        pending = [l.strip() for l in cc.PENDING_DOCDB.read_text().splitlines() if l.strip()]
    done = set()
    if DONE.exists():
        done = {l.strip() for l in DONE.read_text().splitlines() if l.strip()}
    todo = [i for i in dict.fromkeys(pending)
            if i in by_idx and i not in done and not (cc.BOARDS / f"{i}.lekh").exists()]
    counts = Counter(todo=len(todo))
    if not todo:
        print(json.dumps(dict(counts)))
        return 0

    import bson.json_util as ju
    _sessions, cred = cc.reader_sessions(require_mongo=True)
    secrets = (cred.mongo["MONGODB_USER"], cred.mongo["MONGODB_PASSWORD"])
    try:
        client, coll = docdb.connect(*secrets, TUNNEL)
    except docdb.DocDBStartupError as exc:
        print(f"startup check failed ({exc.check}): {docdb.describe(exc, secrets)}")
        return 3

    status = 0
    try:
        with DONE.open("a", encoding="utf-8") as done_fh:
            for start in range(0, len(todo), batch_size):
                if not in_window():
                    counts["stopped_window_closed"] = 1
                    break
                if start:
                    time.sleep(PAUSE_S)
                chunk = todo[start:start + batch_size]
                ids = {by_idx[i]["docid"]: i for i in chunk}
                cursor = None
                found: dict[str, dict] = {}
                try:
                    cursor = coll.find({"docid": {"$in": list(ids)}}, projection=PROJECTION,
                                       batch_size=docdb.MAX_BATCH, limit=docdb.MAX_BATCH)
                    for record in cursor:
                        d = record.get("docid")
                        if isinstance(d, str) and d in ids and d not in found:
                            found[d] = record
                except Exception as exc:  # noqa: BLE001 - every error stops the run
                    kind = docdb.classify(exc)
                    print(f"stopped on a read error ({kind}): {docdb.describe(exc, secrets)}")
                    counts[f"stopped_error_{kind}"] = 1
                    status = 1
                    break
                finally:
                    if cursor is not None:
                        try:
                            cursor.close()
                        except Exception:  # noqa: BLE001
                            pass
                counts["batches"] += 1
                for docid, idx in ids.items():
                    record = found.get(docid)
                    if record is None or not isinstance(record.get("doc"), dict):
                        counts["not_found"] += 1
                    else:
                        body = ju.dumps(record["doc"], json_options=ju.RELAXED_JSON_OPTIONS
                                        ).encode("utf-8")
                        version = record.get("version")
                        meta = {"source": "docdb",
                                "version": version if isinstance(version, (int, float)) else None,
                                "bytes": len(body)}
                        cc.write_atomic(cc.BOARDS / f"{idx}.lekh", body)
                        cc.write_atomic(cc.META / f"{idx}.json", json.dumps(meta).encode())
                        counts["fetched_docdb"] += 1
                        counts["bytes"] += len(body)
                    done_fh.write(idx + "\n")
                done_fh.flush()
    finally:
        client.close()
    print(json.dumps(dict(sorted(counts.items())), indent=2))
    return status


if __name__ == "__main__":
    sys.exit(main())
