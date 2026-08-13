#!/usr/bin/env bash
# Download every replay we have a salt for, into replays/ (gitignored).
#
# Cluster 413 is a Perfect World cluster: replay413.valve.net 403s, but
# replay413.dota2.com.cn serves it. Node's fetch() cannot reach that host in this
# environment; curl can. See docs/FINDINGS.md.
#
# Resumable and idempotent: an already-downloaded file is skipped, a partial one is
# resumed. Retention on these is finite and unpublished, so run it early and often.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p replays

ok=0; skip=0; fail=0
for f in data/matches/*.json; do
  read -r id salt cluster < <(node -e '
    const m=require("./"+process.argv[1]);
    if(m.replaySalt==null||m.cluster==null) process.exit(1);
    console.log(m.matchId, m.replaySalt, m.cluster);
  ' "$f") || { echo "no salt: $f"; fail=$((fail+1)); continue; }

  out="replays/${id}_${salt}.dem.bz2"
  if [ -s "$out" ] && ! [ -f "$out.aria2" ]; then
    # A complete file stays complete; don't re-pull 40 MB to prove it.
    skip=$((skip+1)); continue
  fi

  url="http://replay${cluster}.dota2.com.cn/570/${id}_${salt}.dem.bz2"
  printf '%s ' "$id"
  if curl -sS --fail --location --retry 3 --retry-delay 5 --connect-timeout 20 \
          --max-time 600 -C - -o "$out" "$url"; then
    printf 'ok %s\n' "$(du -h "$out" | cut -f1)"
    ok=$((ok+1))
  else
    printf 'FAILED\n'
    fail=$((fail+1))
  fi
done

echo "downloaded $ok, already had $skip, failed $fail"
du -sh replays 2>/dev/null
