"""Step 3 of the corpus procedure: S3 first (verification 02 §A.6 step 3).

For each manifest board without ``corpus/boards/<idx>.lekh``: Query
``prod_history`` ``pkey = doc-{docid}``, ``begins_with(skey, doc-version-)``,
``operation = doc-edit``, newest first, and take the newest row whose snapshot
was stored (``detail.available``); then ``GetObject`` of ``detail.location``
(``full/{docid}/{version}``) from ``lekhapp.prod.docslog`` into
``corpus/boards/<idx>.lekh``, with ``corpus/meta/<idx>.json``
``{source: "s3", version, bytes}``. Only the latest stored snapshot is fetched.

Boards with no usable ``doc-edit`` row (or whose object is missing) are listed
by idx in ``corpus/pending-docdb.txt`` for the DocumentDB step.

One process, at most 20 requests/s (Query pages and GetObject together),
resumable: existing board files and boards already pending are skipped.
Only the history attributes needed are projected (no emails, IPs or clients).
Prints counts only.

    lbs/tools/growth/.venv/bin/python -I lekhjs/parity/corpus/fetch_s3.py [--limit N]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from decimal import Decimal
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
import corpus_common as cc  # noqa: E402

cc.bootstrap()
from botocore.exceptions import ClientError  # noqa: E402
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer  # noqa: E402
from growthlib import retry  # noqa: E402

BUCKET = "lekhapp.prod.docslog"
TABLE = "prod_history"
RATE = 20.0
PAGE = 25

_ser = TypeSerializer()
_des = TypeDeserializer()


def newest_snapshot(client, limiter, docid: str) -> dict | None:
    kwargs = {
        "TableName": TABLE,
        "KeyConditionExpression": "pkey = :p AND begins_with(skey, :s)",
        "FilterExpression": "#op = :e",
        "ExpressionAttributeValues": {":p": _ser.serialize(f"doc-{docid}"),
                                      ":s": _ser.serialize("doc-version-"),
                                      ":e": _ser.serialize("doc-edit")},
        "ExpressionAttributeNames": {"#op": "operation", "#d": "detail", "#l": "location",
                                     "#a": "available", "#v": "version"},
        "ProjectionExpression": "skey, #op, #d.#l, #d.#a, #d.#v",
        "ScanIndexForward": False,
        "Limit": PAGE,
    }
    while True:
        limiter.wait()
        resp = retry.call(client.query, **kwargs)
        for raw in resp.get("Items", []):
            item = {k: _des.deserialize(v) for k, v in raw.items()}
            detail = item.get("detail") or {}
            if detail.get("available") is False or not detail.get("location"):
                continue
            version = detail.get("version")
            if isinstance(version, Decimal):
                version = int(version) if version == version.to_integral_value() else float(version)
            return {"location": str(detail["location"]), "version": version}
        last = resp.get("LastEvaluatedKey")
        if not last:
            return None
        kwargs["ExclusiveStartKey"] = last


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="stop after N boards attempted")
    args = ap.parse_args()

    cc.require_ignored_corpus()
    manifest = cc.read_manifest()
    if not manifest:
        sys.exit("corpus/manifest.jsonl is missing or empty; run select.py first")
    pending = set()
    if cc.PENDING_DOCDB.exists():
        pending = {l.strip() for l in cc.PENDING_DOCDB.read_text().splitlines() if l.strip()}

    sessions, _cred = cc.reader_sessions()
    ddb = sessions.reader("dynamodb")
    s3 = sessions.reader("s3")
    limiter = cc.RateLimiter(RATE)
    counts = Counter()
    attempted = 0
    with cc.PENDING_DOCDB.open("a", encoding="utf-8") as pend:
        for row in manifest:
            idx = row["idx"]
            if (cc.BOARDS / f"{idx}.lekh").exists():
                counts["already_present"] += 1
                continue
            if idx in pending:
                counts["already_pending"] += 1
                continue
            if args.limit and attempted >= args.limit:
                break
            attempted += 1
            snap = newest_snapshot(ddb, limiter, row["docid"])
            if snap is None:
                pend.write(idx + "\n"); pend.flush()
                counts["pending_no_doc_edit"] += 1
                continue
            limiter.wait()
            try:
                obj = retry.call(s3.get_object, Bucket=BUCKET, Key=snap["location"])
                body = obj["Body"].read()
            except ClientError as exc:
                code = exc.response.get("Error", {}).get("Code", "")
                if code in ("NoSuchKey", "404", "AccessDenied"):
                    pend.write(idx + "\n"); pend.flush()
                    counts[f"pending_s3_{code}"] += 1
                    continue
                raise
            cc.write_atomic(cc.BOARDS / f"{idx}.lekh", body)
            meta = {"source": "s3", "version": snap["version"], "bytes": len(body)}
            cc.write_atomic(cc.META / f"{idx}.json", json.dumps(meta).encode("utf-8"))
            counts["fetched_s3"] += 1
            counts["bytes"] += len(body)
            if counts["fetched_s3"] % 500 == 0:
                print(f"progress: fetched {counts['fetched_s3']}", flush=True)
    print(json.dumps(dict(sorted(counts.items())), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
