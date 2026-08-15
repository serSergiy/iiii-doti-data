#!/usr/bin/env bash
# Download every replay we have a salt for, into replays/ (gitignored).
#
# Cluster 413 is a Perfect World cluster: replay413.valve.net 403s, but
# replay413.dota2.com.cn serves it. Node's fetch() cannot reach that host in this
# environment; curl can. See docs/FINDINGS.md.
#
# Downloads run JOBS-wide. That is not impatience: the host throttles per connection at
# roughly 0.25 MB/s, while a second concurrent stream measured 7.5 MB/s — the ceiling is
# per-socket, not per-host, so serial fetching wastes ~97% of the available bandwidth.
# Serially this set takes ~4 hours; at JOBS=5 it takes minutes.
#
# Resumable and idempotent: a file is skipped only when its size matches the server's
# Content-Length, and resumed otherwise. Size, not mere existence, is the completeness
# test — a run interrupted mid-transfer leaves a non-empty file that is NOT a replay, and
# the parser fails on it much later and much less obviously.
#
# Retention on these is finite and unpublished, so run it early and often.
#
# JOBS=n concurrency (default 5). MAX_REPLAYS=n bounds one run, for CI where the job has a
# timeout.
set -uo pipefail
cd "$(dirname "$0")/.."

JOBS=${JOBS:-5}
MAX_REPLAYS=${MAX_REPLAYS:-0}

# --- worker: one match. Re-entry point for xargs, not for humans. -------------------
if [ "${1:-}" = "--one" ]; then
  id=$2; salt=$3; cluster=$4
  out="replays/${id}_${salt}.dem.bz2"
  url="http://replay${cluster}.dota2.com.cn/570/${id}_${salt}.dem.bz2"

  have=0
  [ -f "$out" ] && have=$(wc -c < "$out")
  want=$(curl -sS -I --location --connect-timeout 20 --max-time 60 "$url" \
         | tr -d '\r' | awk 'tolower($1)=="content-length:"{n=$2} END{print n+0}')

  if [ "$want" -gt 0 ] && [ "$have" -eq "$want" ]; then echo "$id skip"; exit 0; fi

  # HEAD failed, so completeness cannot be judged. If a file is already here, leave it
  # alone: resuming a file that is in fact complete asks for a range past its end, the
  # server answers 416, and --fail turns that into an error for a match that needed no work
  # at all. Verify it on a later run instead of manufacturing a failure now.
  if [ "$want" -eq 0 ] && [ "$have" -gt 0 ]; then
    echo "$id skip (size unverified — HEAD failed)"; exit 0
  fi

  [ "$have" -gt 0 ] && echo "$id resuming at $have/$want"

  if curl -sS --fail --location --retry 5 --retry-delay 5 --retry-all-errors \
          --connect-timeout 20 --max-time 3600 -C - -o "$out" "$url"; then
    got=$(wc -c < "$out")
    if [ "$want" -gt 0 ] && [ "$got" -lt "$want" ]; then
      # Left in place on purpose — the next run resumes from here rather than restarting.
      echo "$id SHORT $got/$want"; exit 1
    fi
    if [ "$want" -gt 0 ] && [ "$got" -gt "$want" ]; then
      # Overshoot means a resume appended onto bytes it should have overwritten — seen once
      # when a killed run's curl was still writing as the next one resumed. Resuming can
      # never repair a too-long file, so drop it and let the next run start clean.
      echo "$id OVERSIZE $got/$want — discarding for a clean re-fetch"
      rm -f "$out"; exit 1
    fi
    echo "$id ok $(du -h "$out" | cut -f1)"
  else
    echo "$id FAILED"; exit 1
  fi
  exit 0
fi

# --- driver -------------------------------------------------------------------------
mkdir -p replays

# Matches still wanting a replay. A match whose JSON exists and whose .dem is already gone
# is done — skipped here so it costs not even a HEAD request.
manifest=$(node -e '
  const fs = require("fs");
  for (const f of fs.readdirSync("data/matches")) {
    const m = JSON.parse(fs.readFileSync("data/matches/" + f, "utf8"));
    if (m.replaySalt == null || m.cluster == null) { console.error("no salt: " + m.matchId); continue; }
    const dem = `replays/${m.matchId}_${m.replaySalt}.dem.bz2`;
    if (fs.existsSync(`data/replay/${m.matchId}.json`) && !fs.existsSync(dem)) continue;
    console.log(m.matchId, m.replaySalt, m.cluster);
  }
')

[ "$MAX_REPLAYS" -gt 0 ] && manifest=$(echo "$manifest" | head -n "$MAX_REPLAYS")
total=$(echo "$manifest" | grep -c . || true)
if [ "$total" -eq 0 ]; then echo "nothing to fetch"; exit 0; fi
echo "fetching $total match(es), $JOBS at a time"

echo "$manifest" | xargs -P "$JOBS" -n 3 bash "$0" --one
rc=$?

echo "---"
du -sh replays 2>/dev/null
exit $rc
