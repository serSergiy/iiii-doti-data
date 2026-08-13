#!/usr/bin/env node
/**
 * Calibrate the scoring model against a real in-client banner.
 *
 * Targets the MID banner specifically, because it is the clean case: one player, and on
 * both observed banners its emblem values sum to the role total EXACTLY (x1.000000). No
 * title effect, no pair-averaging. Whatever reproduces mid is the core model.
 *
 * For each emblem it searches every candidate set of counted maps and reports which one
 * reproduces the client's number, and at what implied coefficient/multiplier.
 *
 *   node scripts/calibrate.mjs test/fixtures/banner-observation-mrmorale.json
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');

/** Coefficients from battlepass.ru — unofficial, which is exactly what we are testing. */
const COEF = {
  kills: 107, creepScore: 3, gpmX2: 2, towerKills: 352, madstone: 13,
  obsPlaced: 117, campsStacked: 234, runePickups: 141, watchers: 147,
  lotuses: 176, smokesUsed: 293,
  teamfight: 2124, stuns: 10, firstBlood: 1934, tormentor: 879,
  roshanKills: 1172, courierKills: 703, sentriesCaptured: 147,
};

/** Pull a stat out of a raw OpenDota player object, matching derive.mjs's mappings. */
const STAT = {
  kills: (p) => p.kills || 0,
  creepScore: (p) => (p.last_hits || 0) + (p.denies || 0),
  gpmX2: (p) => p.gold_per_min || 0,
  towerKills: (p) => p.towers_killed || 0,
  obsPlaced: (p) => p.obs_placed || 0,
  campsStacked: (p) => p.camps_stacked || 0,
  runePickups: (p) => p.rune_pickups || 0,
  stuns: (p) => p.stuns || 0,
  teamfight: (p) => p.teamfight_participation || 0,
  roshanKills: (p) => p.roshans_killed || 0,
  courierKills: (p) => p.courier_kills || 0,
  sentriesCaptured: (p) => (p.observer_kills || 0) + (p.sentry_kills || 0),
  watchers: (p) => (p.observer_kills || 0) + (p.sentry_kills || 0),
  smokesUsed: (p) => (p.item_uses || {}).smoke_of_deceit || 0,
  madstone: (p) => (p.item_uses || {}).madstone_bundle || 0,
  firstBlood: (p) => (p.firstblood_claimed ? 1 : 0),
  lotuses: () => null, // no source anywhere
  tormentor: () => null, // needs the replay-derived file, not the raw payload
};

// ---- load every map we have, indexed by player name -------------------------
const byPlayer = new Map();
for (const f of fs.readdirSync(RAW)) {
  const m = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(RAW, f))).toString());
  for (const p of m.players ?? []) {
    const n = p.name || p.personaname;
    if (!n) continue;
    if (!byPlayer.has(n)) byPlayer.set(n, []);
    byPlayer.get(n).push({ matchId: m.match_id, seriesId: m.series_id, p });
  }
}

const obs = JSON.parse(fs.readFileSync(process.argv[2] ?? 'test/fixtures/banner-observation-mrmorale.json', 'utf8'));
console.log(`banner: ${obs.player}   title: ${obs.title?.prefix ?? '?'} ${obs.title?.suffix ?? '?'}\n`);

const role = obs.roles.mid;
const name = role.players[0];
const maps = byPlayer.get(name) ?? [];
console.log(`MID — ${name}: ${maps.length} maps in dataset`);
console.log(`  emblem sum ${role.emblemSum} vs client total ${role.observedTotal} -> x${role.impliedMultiplier}\n`);

// Candidate counted-map sets: the best 2 maps within each single series.
const series = new Map();
for (const m of maps) {
  if (!series.has(m.seriesId)) series.set(m.seriesId, []);
  series.get(m.seriesId).push(m);
}

const pairs = [];
for (const [sid, ms] of series) {
  for (let i = 0; i < ms.length; i++) {
    for (let j = i + 1; j < ms.length; j++) pairs.push({ sid, set: [ms[i], ms[j]] });
  }
  if (ms.length === 1) pairs.push({ sid, set: [ms[0]] });
}

for (const e of role.emblems) {
  const get = STAT[e.stat];
  console.log(`  ${e.statUk}  (${e.stat})  ${e.percent}%  -> ${e.score}`);
  if (!get || COEF[e.stat] == null) { console.log('     no mapping/coefficient — skipped\n'); continue; }
  const raw = get(maps[0]?.p);
  if (raw === null) { console.log('     stat has no source — skipped\n'); continue; }

  // What raw total the client's number implies at the displayed percentage.
  const implied = e.score / (e.percent / 100) / COEF[e.stat];
  console.log(`     implied raw total = ${implied.toFixed(4)}`);

  let best = null;
  for (const c of pairs) {
    const total = c.set.reduce((a, m) => a + get(m.p), 0);
    const err = Math.abs(total - implied);
    if (!best || err < best.err) best = { ...c, total, err };
    if (err < 0.02) {
      // Re-derive the multiplier from the integer total: the displayed % is rounded,
      // so an exact stat match is stronger evidence than an exact % match.
      const mult = e.score / (total * COEF[e.stat]);
      console.log(`     MATCH  maps ${c.set.map((m) => m.matchId).join(' + ')} (series ${c.sid})`);
      console.log(`            stat total ${total}  ->  implied multiplier ${(mult * 100).toFixed(3)}%  (client shows ${e.percent}%)`);
    }
  }
  if (best && best.err >= 0.02) {
    console.log(`     no exact match. closest: ${best.set.map((m) => m.matchId).join(' + ')} total=${best.total} (off by ${best.err.toFixed(3)})`);
  }
  console.log('');
}
