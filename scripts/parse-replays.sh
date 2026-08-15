#!/usr/bin/env bash
# Parse every downloaded replay into data/replay/{match_id}.json.
#
# Runs the Go parser in Docker: no Go toolchain is needed on the host, and manta v1.5.0 is
# required — v1.4.0 fails on 2026 replays with "unable to find new baseline".
#
# Idempotent: an already-parsed match is skipped. Parsing is the slow part (~1-2 min per
# replay), the download is not, so never re-parse for free.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/replay

IMG=golang:1.24-alpine
echo "building parser..."
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/w" -w /w/tools/replay-parser "$IMG" \
  go build -o /w/tools/replay-parser/parse-bin . || exit 1

n=0; skip=0
for f in replays/*.dem.bz2; do
  base=$(basename "$f" .dem.bz2)
  id=${base%%_*}
  # Re-parse when the parser version moved on; the file alone is not enough.
  want=$(grep -o 'ParserVersion: [0-9]*' tools/replay-parser/main.go | grep -o '[0-9]*')
  have=$(node -e "try{console.log(require('./data/replay/${id}.json').parserVersion||0)}catch{console.log(0)}")
  if [ -s "data/replay/${id}.json" ] && [ "$have" = "$want" ]; then skip=$((skip+1)); continue; fi
  echo "parsing $id..."
  MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/w" -w /w "$IMG" \
    ./tools/replay-parser/parse-bin "/w/$f" "/w/data/replay/${id}.json" && n=$((n+1))
done
rm -f tools/replay-parser/parse-bin
echo "parsed $n, skipped $skip"
