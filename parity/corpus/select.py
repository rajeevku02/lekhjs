"""Step 1 of the corpus procedure: the population (verification 02 §A.6 step 1).

Read-only DynamoDB (``prod_subscriptions``, ``prod_history`` by Query only,
``prod_users``, ``prod_docs``) through the policed prod reader, and write
``corpus/manifest.jsonl``: one line per owned board of a paid or ex-paid user::

    {"idx": "b000001", "docid": ..., "group": "paid"|"expaid",
     "provider": "appstore"|"play"|"stripe"|"manual", "owner_hash": ...,
     "created_at": ms, "updated_at": ms|null}

- paid now: the org's self item in ``prod_subscriptions`` is valid now
  (``payers.is_valid``: ``status == active`` and ``expires_at > now``); the
  comped ``method == manual`` orgs are included;
- ever paid: the org's audit timeline (``prod_history`` ``org-{orgid}`` /
  ``subscription-*``, one Query per org, ``payers.timeline``: gaps <= 3 days
  joined, only ``active`` states count); ex-paid = at least one paid period and
  not paid now;
- users: the org -> user pointers of ``prod_users`` (existing users only);
- boards: ``prod_docs`` ``doc-*`` / ``scope-*`` items with ``type = board``
  whose ``owner`` is one of those users (owned boards only; deleted boards are
  not in the table).

The docid <-> idx map exists only in the manifest. A re-run keeps every idx
already assigned and appends new boards. Prints counts only.

    lbs/tools/growth/.venv/bin/python -I lekhjs/parity/corpus/select.py [--update]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

# appended, not prepended: this folder holds select.py, which must not shadow the stdlib module
sys.path.append(str(Path(__file__).resolve().parent))
import corpus_common as cc  # noqa: E402

cc.bootstrap()
from growthlib import payers  # noqa: E402
from sources import dynamodb as ddb  # noqa: E402
from sources.base import SourceContext  # noqa: E402

PROVIDERS = {"appstore": "appstore", "play": "play", "stripe": "stripe"}
GROUP_ORDER = {"paid": 0, "expaid": 1}


def provider_of(sub: dict) -> str:
    """kashi ``storeOf``: appstore / play / stripe; any other or missing method -> manual."""
    return PROVIDERS.get(str(sub.get("method") or ""), "manual")


def load_subscriptions(ctx) -> dict[str, dict]:
    out = {}
    rows = ddb.scan(ctx, "subscriptions",
                    filter_expression="begins_with(pkey, :o) AND pkey = skey",
                    values={":o": "org-"}, names={"#s": "status", "#m": "method"},
                    projection="pkey, #s, expires_at, #m")
    for row in rows:
        orgid = ddb._strip("org-", row.get("pkey"))
        if orgid:
            out[orgid] = row
    return out


def load_boards(ctx, owners: set[str]) -> dict[str, list[tuple]]:
    boards: dict[str, list[tuple]] = defaultdict(list)
    rows = ddb.scan(ctx, "docs",
                    filter_expression="begins_with(pkey, :d) AND begins_with(skey, :s) AND #t = :b",
                    values={":d": "doc-", ":s": "scope-", ":b": "board"},
                    names={"#t": "type", "#o": "owner"},
                    projection="pkey, #o, #t, created_at, updated_at")
    for row in rows:
        docid = ddb._strip("doc-", row.get("pkey"))
        owner = row.get("owner")
        if docid and owner and str(owner) in owners:
            boards[str(owner)].append((payers._num(row.get("created_at")),
                                       payers._num(row.get("updated_at")), docid))
    return boards


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--update", action="store_true",
                    help="merge into an existing manifest (keeps assigned idx values)")
    args = ap.parse_args()

    cc.require_ignored_corpus()
    existing = cc.read_manifest()
    if existing and not args.update:
        sys.exit("corpus/manifest.jsonl exists; pass --update to merge")

    sessions, _cred = cc.reader_sessions()
    now = dt.datetime.now(dt.timezone.utc)
    now_ms = int(now.timestamp() * 1000)
    ctx = SourceContext(env="prod", snapshot=now.date(), now=now, sessions=sessions)

    subs = load_subscriptions(ctx)
    print(f"subscription records: {len(subs)}", flush=True)
    paid_now = {o for o, s in subs.items() if payers.is_valid(s, now_ms)}
    timelines = ddb.org_timelines(ctx, sorted(set(subs) - paid_now))
    expaid = {o for o, tl in timelines.items() if tl.periods and not tl.paying_at(now_ms)}
    group_of = {**{o: "expaid" for o in expaid}, **{o: "paid" for o in paid_now}}
    provider = {o: provider_of(subs[o]) for o in group_of}
    org_counts = Counter((group_of[o], provider[o]) for o in group_of)
    print(f"orgs: paid {len(paid_now)}, expaid {len(expaid)}", flush=True)

    users = ddb.load_users(ctx)
    user_org = {u.userid: u.orgid for u in users.values() if u.orgid in group_of}
    user_counts = Counter((group_of[o], provider[o]) for o in user_org.values())
    print(f"users: {len(user_org)}", flush=True)

    boards = load_boards(ctx, set(user_org))

    by_docid = {e["docid"]: e for e in existing}
    next_n = 1 + max((int(e["idx"][1:]) for e in existing), default=0)
    new_rows = []
    for userid, items in boards.items():
        org = user_org[userid]
        for created, updated, docid in items:
            row = {"docid": docid, "group": group_of[org], "provider": provider[org],
                   "owner_hash": cc.owner_hash(userid), "created_at": created,
                   "updated_at": updated}
            if docid in by_docid:
                by_docid[docid].update(row)
            else:
                new_rows.append(row)
    new_rows.sort(key=lambda r: (GROUP_ORDER[r["group"]], r["provider"],
                                 r["created_at"] or 0, r["docid"]))
    for row in new_rows:
        row["idx"] = f"b{next_n:06d}"
        next_n += 1
        by_docid[row["docid"]] = row

    rows = sorted(by_docid.values(), key=lambda r: r["idx"])
    keys = ("idx", "docid", "group", "provider", "owner_hash", "created_at", "updated_at")
    body = "".join(json.dumps({k: r.get(k) for k in keys}) + "\n" for r in rows)
    cc.write_atomic(cc.MANIFEST, body.encode("utf-8"))

    board_counts = Counter((r["group"], r["provider"]) for r in rows)
    summary = {
        "generated_at": now.isoformat(timespec="seconds"),
        "orgs": {f"{g}/{p}": n for (g, p), n in sorted(org_counts.items())},
        "users": {f"{g}/{p}": n for (g, p), n in sorted(user_counts.items())},
        "boards": {f"{g}/{p}": n for (g, p), n in sorted(board_counts.items())},
        "totals": {"orgs": len(group_of), "users": len(user_org), "boards": len(rows),
                   "boards_new_this_run": len(new_rows)},
    }
    cc.write_atomic(cc.CORPUS / "select-summary.json",
                    (json.dumps(summary, indent=2) + "\n").encode("utf-8"))
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
