#!/usr/bin/env bash
# Runs parity/image/run.mjs in chunks of CHUNK boards, each under the box's heavy-job lock (waited
# for, not failed on), with a pause between chunks so other heavy jobs can take the lock; stops when
# a chunk processes nothing (all boards done). Arguments are passed to run.mjs (add --resume).
#
#   CHUNK=150 parity/image/run-chunks.sh --input <sample.json> --out <dir> --resume [...]
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
LOCK="$(node "$HERE/../tools/lock.mjs" --path)"
CHUNK="${CHUNK:-150}"
while true; do
  out="$(flock -w 14400 "$LOCK" env LEKH_HEAVY_LOCK_HELD=1 nice node "$HERE/run.mjs" "$@" --limit "$CHUNK" 2>&1)"
  status=$?
  printf '%s\n' "$out" | tail -n 3
  [ $status -ne 0 ] && { echo "chunk failed with status $status"; exit $status; }
  printf '%s\n' "$out" | grep -q '^done: 0 boards' && exit 0
  sleep 45
done
