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
console.log(`banner: ${obs.player}   title: ${obs.title?.prefix ?? '?'} ${obs.title?.suffix ?? '?'}`);
console.log('Emblem values are RAW (pre-title): the title acts on the emblem SUM, so a\n' +
            'missing title does not block calibrating the emblems themselves.\n');

/**
 * Candidate counted-map sets for a role: the best 2 maps within a single series.
 * For a pair the two players are on the same team and play the same maps, so the sets are
 * built from map ids and each map contributes the AVERAGE of the pair.
 */
function candidates(names) {
  const perPlayer = names.map((n) => byPlayer.get(n) ?? []);
  if (!perPlayer[0].length) return [];
  const bySeries = new Map();
  for (const m of perPlayer[0]) {
    if (!bySeries.has(m.seriesId)) bySeries.set(m.seriesId, []);
    bySeries.get(m.seriesId).push(m.matchId);
  }
  const out = [];
  for (const [sid, ids] of bySeries) {
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) out.push({ sid, ids: [ids[i], ids[j]] });
    if (ids.length === 1) out.push({ sid, ids: [ids[0]] });
  }
  return out;
}

/** Value of a stat over a candidate map set: sum over maps of the pair average. */
function valueOf(names, ids, get) {
  let total = 0;
  for (const id of ids) {
    let sum = 0, n = 0;
    for (const nm of names) {
      const rec = (byPlayer.get(nm) ?? []).find((m) => m.matchId === id);
      if (rec) { sum += get(rec.p); n++; }
    }
    if (!n) return null;
    total += sum / n; // "role score = average of both players on the role"
  }
  return total;
}

for (const [rid, role] of Object.entries(obs.roles)) {
  const names = role.players;
  console.log(`${role.label} — ${names.join(' + ')}   (x${role.impliedMultiplier} on the sum)`);
  const cands = candidates(names);
  if (!cands.length) { console.log('   no maps in dataset\n'); continue; }

  const agreed = new Map(); // candidate key -> how many emblems it reproduces
  const lines = [];

  for (const e of role.emblems) {
    const get = STAT[e.stat];
    const coef = COEF[e.stat];
    if (!get || coef == null || get({}) === null) {
      lines.push(`   ${e.statUk} (${e.stat}) ${e.percent}% -> ${e.score}   [no source — solved below]`);
      continue;
    }
    const implied = e.score / (e.percent / 100) / coef;
    let hit = null, best = null;
    for (const c of cands) {
      const v = valueOf(names, c.ids, get);
      if (v == null) continue;
      const err = Math.abs(v - implied);
      if (!best || err < best.err) best = { c, v, err };
      if (err < 0.02) { hit = { c, v }; agreed.set(c.ids.join('+'), (agreed.get(c.ids.join('+')) ?? 0) + 1); }
    }
    if (hit) {
      lines.push(`   ${e.statUk} (${e.stat}) ${e.percent}% -> ${e.score}`);
      lines.push(`      MATCH ${hit.c.ids.join(' + ')} (series ${hit.c.sid})  stat=${hit.v}  coef=${coef}`);
    } else {
      lines.push(`   ${e.statUk} (${e.stat}) ${e.percent}% -> ${e.score}   implied raw ${implied.toFixed(4)}`);
      lines.push(`      no match. closest ${best.c.ids.join(' + ')} = ${best.v} (off ${best.err.toFixed(3)})`);
      // If the maps are known from other emblems, the coefficient is the unknown.
      if (best) lines.push(`      coef that would fit closest set: ${(e.score / (e.percent / 100) / best.v).toFixed(4)}`);
    }
  }
  console.log(lines.join('\n'));

  // Whichever map set the *known* emblems agree on is the counted set. Use it to solve
  // the unsourced emblems — this is the only way to get a lotus number at all.
  const consensus = [...agreed.entries()].sort((a, b) => b[1] - a[1])[0];
  if (consensus) {
    const ids = consensus[0].split('+').map(Number);
    console.log(`   counted maps (agreed by ${consensus[1]} emblem(s)): ${ids.join(' + ')}`);
    for (const e of role.emblems) {
      const get = STAT[e.stat];
      if (get && COEF[e.stat] != null && get({}) !== null) continue;
      const impliedAtCoef = COEF[e.stat] ? e.score / (e.percent / 100) / COEF[e.stat] : null;
      console.log(`   SOLVE ${e.statUk}: raw x coef = ${(e.score / (e.percent / 100)).toFixed(4)}` +
        (impliedAtCoef != null ? `   -> ${impliedAtCoef.toFixed(4)} units at coef ${COEF[e.stat]}` : ''));
    }
  }
  console.log('');
}
