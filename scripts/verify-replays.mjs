#!/usr/bin/env node
/**
 * Cross-check parsed replays against OpenDota, and fail loudly when they disagree.
 *
 * WHY THIS EXISTS: a truncated replay parses *successfully*. manta reads the stream until
 * it runs out and returns whatever the entity state held at that point, so a half-downloaded
 * file yields a complete-looking JSON full of mid-game numbers. One was observed reading
 * 481 last hits against a true 756 — plausible, wrong, and silent. Size checks in
 * fetch-replays.sh catch the common case; this catches whatever they miss, which matters
 * most in CI where nobody is watching the numbers go by.
 *
 * The test is only possible because nine of the replay's per-player counters are also
 * reported by OpenDota, independently derived. On a sound replay they agree exactly —
 * measured at 290/290 across the tournament — so ANY mismatch means the parse is bad.
 * That makes this a hard gate, not a heuristic: there is no acceptable-drift band.
 *
 *   node scripts/verify-replays.mjs            # every parsed replay
 *   node scripts/verify-replays.mjs 8944475901 # just these
 *
 * Exit 1 if any replay disagrees, so a shell caller can discard the bad parse.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const REPLAY = path.join(ROOT, 'data', 'replay');
const RAW = path.join(ROOT, 'data', 'raw');

/**
 * HARD: replay counter -> OpenDota field, where any disagreement condemns the parse.
 *
 * These are high-count, monotone, and unambiguously attributed, which makes them precise
 * truncation detectors — a replay cut short reads catastrophically low (20 last hits against
 * a true 753), never off by one.
 */
const HARD = {
  lastHits: 'last_hits',
  denies: 'denies',
  runePickups: 'rune_pickups',
  campsStacked: 'camps_stacked',
  observerWardsPlaced: 'obs_placed',
};

/**
 * SOFT: reported, but not grounds for rejection.
 *
 * Low-cardinality objective counters where the game's own tally and OpenDota's combat-log
 * derivation can legitimately differ on credit — a tower finished by creeps, a Roshan
 * last-hit in a scrum. Observed twice in 80 maps, both `towerKills` off by exactly one and
 * in OPPOSITE directions, on replays whose other 79 counters agreed. Corruption does not
 * look like that, and throwing away a sound replay over it loses real data.
 */
const SOFT = {
  courierKills: 'courier_kills',
  roshanKills: 'roshans_killed',
  towerKills: 'towers_killed',
};

const CHECKS = { ...HARD, ...SOFT };

const argv = process.argv.slice(2);
const ids = argv.length
  ? argv
  : fs.readdirSync(REPLAY).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));

let checked = 0;
const bad = [];

for (const id of ids) {
  const replayFile = path.join(REPLAY, `${id}.json`);
  const rawFile = path.join(RAW, `${id}.json.gz`);
  if (!fs.existsSync(replayFile)) { console.error(`${id}: no parsed replay`); bad.push(id); continue; }
  // No raw payload means nothing to compare against. Not a failure — a match can be parsed
  // before its OpenDota row lands — but say so rather than reporting a silent pass.
  if (!fs.existsSync(rawFile)) { console.log(`${id}: SKIP (no raw payload to compare)`); continue; }

  const replay = JSON.parse(fs.readFileSync(replayFile, 'utf8'));
  const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(rawFile)).toString());
  const byAccount = Object.fromEntries((raw.players ?? []).map((p) => [p.account_id, p]));

  const diffs = [];
  const warns = [];
  let compared = 0;

  // Player COUNT first. Comparing only the players that are present cannot detect a parse
  // that silently dropped half of them — two replays were found holding a correct-looking
  // Radiant five and no Dire at all, and every value in them agreed with OpenDota. A
  // replay must account for everyone in the match or it is not usable.
  const expected = (raw.players ?? []).filter((p) => p.account_id != null).length;
  const got = Object.values(replay.gameStats ?? {}).filter((g) => byAccount[g.accountId]).length;
  if (got !== expected) diffs.push(`only ${got} of ${expected} players have gameStats`);

  for (const g of Object.values(replay.gameStats ?? {})) {
    const p = byAccount[g.accountId];
    if (!p) continue;
    for (const [ours, theirs] of Object.entries(CHECKS)) {
      // Absent on either side is not a disagreement — only two present-and-different values.
      if (g[ours] == null || p[theirs] == null) continue;
      compared++;
      if (g[ours] === p[theirs]) continue;
      const msg = `${g.accountId} ${ours}=${g[ours]} opendota=${p[theirs]}`;
      (ours in HARD ? diffs : warns).push(msg);
    }
  }

  checked++;
  for (const w of warns) console.log(`${id}: note — ${w} (credit differs; not a parse fault)`);
  if (diffs.length) {
    bad.push(id);
    console.error(`${id}: FAIL — ${diffs.length}/${compared} counters disagree`);
    for (const d of diffs.slice(0, 5)) console.error(`    ${d}`);
    if (diffs.length > 5) console.error(`    … and ${diffs.length - 5} more`);
  } else if (argv.length) {
    console.log(`${id}: ok (${compared} counters agree)`);
  }
}

console.log(`verified ${checked} replay(s), ${bad.length} bad`);
if (bad.length) {
  console.error(`BAD: ${bad.join(' ')}`);
  process.exit(1);
}
