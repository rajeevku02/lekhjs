"""Step 5 of the corpus procedure: images for the image comparison (verification 02 §A.6 step 5).

For every ``res://<resid>`` referenced by a board of the image sample
(``corpus/sample/image-sample.json``, made by ``sample.mjs`` from
``corpus/inventory.json``): Query ``prod_docs`` ``pkey = res-{resid}``,
``begins_with(skey, scope-)`` for the resource metadata ``location`` (the S3 key
is the record's ``location``, never the resid; ``/backend/storage/s3.md`` §1),
then ``GetObject`` of ``resources/{location}/content`` from
``lekhapp.prod.resources`` into ``corpus/res/<sha256 of the bytes>``, and
``corpus/res/index.json`` ``{resid: {file, bytes, type} | {missing: reason}}``.
During image runs the harness serves ``<api>/v1.1/resources/<resid>`` from this
cache; nothing is fetched at render time.

The policed reader of ``lekh-prod-admin-read`` only; one process, at most 20
requests/s, resumable (resids already in the index are skipped). Only
``location`` and ``type`` are projected. Prints counts only.

    lbs/tools/growth/.venv/bin/python -I lekhjs/parity/corpus/fetch_res.py [--limit N]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
import corpus_common as cc  # noqa: E402

cc.bootstrap()
from botocore.exceptions import ClientError  # noqa: E402
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer  # noqa: E402
from growthlib import retry  # noqa: E402

BUCKET = "lekhapp.prod.resources"
TABLE = "prod_docs"
RATE = 20.0
RES = cc.CORPUS / "res"
INDEX = RES / "index.json"
SAMPLE = cc.CORPUS / "sample" / "image-sample.json"
INVENTORY = cc.CORPUS / "inventory.json"
KASHI_FORM = cc.CORPUS / "out" / "kashi-form" / "boards"
RES_REF = re.compile(r"res://([A-Za-z0-9_.-]+)")

_ser = TypeSerializer()
_des = TypeDeserializer()


def location_of(client, limiter, resid: str) -> dict | None:
    limiter.wait()
    resp = retry.call(
        client.query,
        TableName=TABLE,
        KeyConditionExpression="pkey = :p AND begins_with(skey, :s)",
        ExpressionAttributeValues={":p": _ser.serialize(f"res-{resid}"), ":s": _ser.serialize("scope-")},
        ExpressionAttributeNames={"#l": "location", "#t": "type"},
        ProjectionExpression="#l, #t",
    )
    items = [{k: _des.deserialize(v) for k, v in raw.items()} for raw in resp.get("Items", [])]
    if len(items) != 1 or not items[0].get("location"):
        return None
    return {"location": str(items[0]["location"]), "type": str(items[0].get("type", ""))}


def save_index(index: dict) -> None:
    cc.write_atomic(INDEX, json.dumps(index, sort_keys=True).encode("utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="stop after N resids attempted")
    args = ap.parse_args()

    cc.require_ignored_corpus()
    sample = json.loads(SAMPLE.read_text(encoding="utf-8"))
    inv = json.loads(INVENTORY.read_text(encoding="utf-8"))
    # Every res:// reference in the board text (the inventory's resids are only the template
    # images it walks; a board can reference resources elsewhere too).
    wanted = set()
    for idx in sample["boards"]:
        wanted.update(inv[idx].get("resids", []))
        text = (KASHI_FORM / f"{idx}.lekh").read_text(encoding="utf-8", errors="replace")
        wanted.update(RES_REF.findall(text))
    wanted = sorted(wanted)
    index = json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else {}

    sessions, _cred = cc.reader_sessions()
    ddb = sessions.reader("dynamodb")
    s3 = sessions.reader("s3")
    limiter = cc.RateLimiter(RATE)
    counts = Counter()
    attempted = 0
    for resid in wanted:
        if resid in index:
            counts["already_indexed"] += 1
            continue
        if args.limit and attempted >= args.limit:
            break
        attempted += 1
        meta = location_of(ddb, limiter, resid)
        if meta is None:
            index[resid] = {"missing": "no_metadata"}
            counts["missing_no_metadata"] += 1
        else:
            limiter.wait()
            try:
                obj = retry.call(s3.get_object, Bucket=BUCKET, Key=f"resources/{meta['location']}/content")
                body = obj["Body"].read()
            except ClientError as exc:
                code = exc.response.get("Error", {}).get("Code", "")
                if code in ("NoSuchKey", "404", "AccessDenied"):
                    index[resid] = {"missing": f"s3_{code}"}
                    counts[f"missing_s3_{code}"] += 1
                    continue
                raise
            digest = hashlib.sha256(body).hexdigest()
            f = RES / digest
            if not f.exists():
                cc.write_atomic(f, body)
            index[resid] = {"file": digest, "bytes": len(body), "type": meta["type"]}
            counts["fetched"] += 1
            counts["bytes"] += len(body)
        if attempted % 200 == 0:
            save_index(index)
            print(f"progress: attempted {attempted}", flush=True)
    save_index(index)
    counts["wanted"] = len(wanted)
    print(json.dumps(dict(sorted(counts.items())), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
