#!/usr/bin/env bash
# Parse every downloaded replay into data/replay/{match_id}.json.
#
# Uses the host's Go toolchain when there is one (CI), and Docker otherwise (a dev box with
# no Go installed). manta v1.5.0 is required either way — v1.4.0 fails on 2026 replays with
# "unable to find new baseline".
#
# Idempotent: an already-parsed match at the current ParserVersion is skipped. Parsing is
# the slow part (~1-2 min per replay), the download is not, so never re-parse for free.
#
# MAX_REPLAYS=n bounds one run, for CI where the job has a timeout.
#
# KEEP_DEM defaults to 1 — the .dem stays after a successful parse. Do NOT flip that
# default: Valve's retention is finite and unpublished, so a deleted replay is usually
# unrecoverable, and re-parsing at a new ParserVersion is the whole reason the corpus is
# worth its disk. CI sets KEEP_DEM=0 because a runner has ~14 GB and is thrown away anyway.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/replay

MAX_REPLAYS=${MAX_REPLAYS:-0}
KEEP_DEM=${KEEP_DEM:-1}
BIN=tools/replay-parser/parse-bin

# The parser version lives in the Go source; a bump must force a re-parse, so it is read
# from there rather than duplicated here.
want=$(grep -o 'ParserVersion: [0-9]*' tools/replay-parser/main.go | grep -o '[0-9]*')
[ -n "$want" ] || { echo "cannot read ParserVersion from main.go"; exit 1; }
echo "parser version $want"

if command -v go >/dev/null 2>&1; then
  RUNNER=host
  echo "building parser with host go..."
  (cd tools/replay-parser && go build -o parse-bin .) || exit 1
  run_parser() { "$BIN" "$1" "$2"; }
else
  RUNNER=docker
  IMG=golang:1.24-alpine
  echo "no host go — building parser in docker..."
  MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/w" -w /w/tools/replay-parser "$IMG" \
    go build -o /w/$BIN . || exit 1
  run_parser() {
    MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/w" -w /w "$IMG" "/w/$BIN" "/w/$1" "/w/$2"
  }
fi
echo "runner: $RUNNER"

n=0; skip=0; fail=0
shopt -s nullglob
for f in replays/*.dem.bz2; do
  if [ "$MAX_REPLAYS" -gt 0 ] && [ "$n" -ge "$MAX_REPLAYS" ]; then
    echo "hit MAX_REPLAYS=$MAX_REPLAYS — stopping; the next run picks up the rest"
    break
  fi

  base=$(basename "$f" .dem.bz2)
  id=${base%%_*}
  out="data/replay/${id}.json"

  have=$(node -e "try{console.log(require('./$out').parserVersion||0)}catch{console.log(0)}")
  if [ -s "$out" ] && [ "$have" = "$want" ]; then
    skip=$((skip+1))
    [ "$KEEP_DEM" = "1" ] || rm -f "$f"
    continue
  fi

  echo "parsing $id..."
  if ! run_parser "$f" "$out"; then
    # Leave the .dem alone: a parse failure is usually a truncated download, and
    # fetch-replays.sh resumes it on the next run.
    echo "  FAILED $id"
    rm -f "$out"
    fail=$((fail+1))
    continue
  fi

  # A successful exit is NOT proof of a good parse. manta reads a truncated stream to its
  # end and reports the entity state it got to, so a half-downloaded replay yields a
  # complete-looking file of mid-game numbers — one was seen claiming 481 last hits against
  # a true 756. Cross-check against OpenDota before keeping it.
  if ! node scripts/verify-replays.mjs "$id" >/dev/null 2>&1; then
    echo "  REJECTED $id — disagrees with OpenDota, the .dem is corrupt"
    node scripts/verify-replays.mjs "$id" 2>&1 | sed 's/^/    /' | head -4
    rm -f "$out" "$f"   # both: a corrupt .dem is worth re-fetching, not resuming
    fail=$((fail+1))
    continue
  fi

  n=$((n+1))
  [ "$KEEP_DEM" = "1" ] || rm -f "$f"
done

rm -f "$BIN"
echo "parsed $n, skipped $skip, failed $fail"
[ "$fail" -eq 0 ]
