"""Shared plumbing for the corpus scripts (verification 02 §A.6, spec 11 §8).

Run every script with the growth venv's interpreter in isolated mode::

    lbs/tools/growth/.venv/bin/python -I lekhjs/parity/corpus/<script>.py ...

``-I`` keeps the script's own directory and the user site off ``sys.path``, so
each script inserts this folder and ``lbs/tools/growth`` itself (through
:func:`bootstrap`) and reuses ``growthlib`` (``access``, ``guard``, ``retry``,
``payers``, ``docdb``).

Rules every script follows:

- the only credential is ``lekh-prod-admin-read``, parsed by
  ``growthlib.access`` (never sourced, never printed); every AWS client is the
  policed **reader** of ``growthlib.guard.Sessions``, which refuses any
  non-read call before it leaves the process;
- output goes to ``<workspace_root>/corpus/`` only, and the scripts refuse to
  start unless git reports that folder as ignored (AC-ROL-16);
- stdout carries counts only: never a board id, user id, owner hash, email or
  content.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
# lekhjs/parity/corpus -> parity -> lekhjs -> <workspace_root>
WORKSPACE_ROOT = HERE.parents[2]
GROWTH = WORKSPACE_ROOT / "lbs" / "tools" / "growth"
CORPUS = WORKSPACE_ROOT / "corpus"
MANIFEST = CORPUS / "manifest.jsonl"
BOARDS = CORPUS / "boards"
META = CORPUS / "meta"
PENDING_DOCDB = CORPUS / "pending-docdb.txt"

READER_FILE = "lekh-prod-admin-read"
DEFAULT_ACCESS_DIR = Path("/home/rkumar/lekh/access")
OWNER_SALT = "lekhjs-parity:"


def bootstrap() -> None:
    for p in (str(GROWTH),):
        if p not in sys.path:
            sys.path.insert(0, p)


def access_dir() -> Path:
    env = os.environ.get("LEKH_ACCESS_DIR")
    return Path(env) if env else DEFAULT_ACCESS_DIR


def require_ignored_corpus() -> None:
    """AC-ROL-16: ``corpus/`` must be git-ignored at the workspace root."""
    r = subprocess.run(["git", "-C", str(WORKSPACE_ROOT), "check-ignore", "-q", "corpus/x"],
                       capture_output=True)
    if r.returncode != 0:
        sys.exit("corpus/ is not git-ignored at the workspace root; stopping (AC-ROL-16)")


def reader_sessions(require_mongo: bool = False):
    """The policed prod reader (``lekh-prod-admin-read``) and its credential."""
    bootstrap()
    from growthlib import access, guard
    try:
        cred = access.load_credential(READER_FILE, "reader", require_mongo=require_mongo,
                                      directory=access_dir())
    except access.AccessError as exc:
        sys.exit(f"exit 3: {exc}")  # the message names the file and key, never a value
    return guard.Sessions(env="prod", reader_credential=cred, writer_credential=None), cred


def owner_hash(userid: str) -> str:
    return hashlib.sha256((OWNER_SALT + userid).encode("utf-8")).hexdigest()[:12]


def read_manifest() -> list[dict]:
    if not MANIFEST.exists():
        return []
    with MANIFEST.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, path)


class RateLimiter:
    """At most ``rate`` calls per second, one process."""

    def __init__(self, rate: float):
        self.interval = 1.0 / rate
        self.next = 0.0

    def wait(self) -> None:
        now = time.monotonic()
        if now < self.next:
            time.sleep(self.next - now)
            now = self.next
        self.next = now + self.interval
