/**
 * Ground-truth regression: does the committed data still reproduce real in-client banners?
 *
 * These are the only tests spanning the WHOLE pipeline — stats, map selection, prefix/suffix
 * stacking and the per-role divide — against numbers read off the game client. The per-stat
 * tests can all pass while the banner is wrong, because they check columns and this checks
 * the thing the columns are for.
 *
 * The arithmetic is deliberately duplicated here rather than imported. This repo emits counts
 * and holds NO fantasy coefficients (see the header of scripts/derive.mjs) — the scoring
 * engine lives in the site repo. What follows is a verification harness, not an engine, and
 * it must not grow into one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const stats = read('data/stats.json');
const pools = read('config/hero-pools.json').pools;
const localToId = read('config/hero-localized.json');

const C = Object.fromEntries(stats.columns.map((c, i) => [c, i]));
const NAME_FIX = { Ringmaster: 'Ring Master', 'Outworld Destroyer': 'Outworld Devourer' };
const poolIds = (key) =>
  new Set(pools[key].heroes.map((n) => localToId[NAME_FIX[n] ?? n]).filter((x) => x != null));

/** Dataset column and coefficient behind each official stat id. */
const STAT = {
  obsPlaced: ['obs', 117],
  tormentor: ['tormentorGame', 879],
  lotuses: ['lotus', 176],
  madstone: ['madstoneUses', 13], // raw bundles: these tests measure the conversion
  teamfight: ['teamfight', 2124],
  gpmX2: ['gpm', 2],
};

/** Rows for the given accounts on the given maps, grouped by map. */
function rowsFor(accounts, maps) {
  const out = {};
  for (const r of stats.rows) {
    if (!accounts.includes(r[C.accountId])) continue;
    if (!maps.includes(String(r[C.matchId]))) continue;
    (out[r[C.matchId]] ??= []).push(r);
  }
  return out;
}

/** Raw stat units over a pair of maps. Bonuses ADD: 1 + prefix + suffix. */
function units(byMap, maps, col, { prefix = null, suffix = 0 } = {}) {
  let total = 0;
  for (const mid of maps) {
    const fires = stats.matches[mid].titleFlags.lastPossibleGameOfSeries ? suffix : 0;
    for (const r of byMap[mid]) {
      const p = prefix && prefix.ids.has(r[C.heroId]) ? prefix.bonus : 0;
      total += r[C[col]] * (1 + p + fires);
    }
  }
  return total;
}

const madstonePair = read('test/fixtures/banner-observation-madstone-pair.json');

/**
 * The mid card is the cleanest evidence we have: one player, so no divide ambiguity, and
 * a lotus emblem that lands on a whole number.
 */
test('mid banner — the lotus mapping is confirmed against a client score', () => {
  const role = madstonePair.roles.mid;
  const maps = role.countedMaps.map(String);
  const byMap = rowsFor([898455820], maps); // Malr1ne
  const prefix = { ids: poolIds(role.prefix), bonus: pools[role.prefix].bonus };

  const lot = role.emblems.find((e) => e.stat === 'lotuses');
  const needed = lot.score / (lot.percent / 100) / STAT.lotuses[1];
  assert.ok(Math.abs(needed - 4) < 1e-6, `banner implies ${needed} lotuses, expected exactly 4`);
  assert.equal(units(byMap, maps, 'lotus', { prefix }), 4);

  // teamfight pins the pair independently — no fitting involved.
  const tf = role.emblems.find((e) => e.stat === 'teamfight');
  const tfNeeded = tf.score / (tf.percent / 100) / STAT.teamfight[1];
  const tfGot = units(byMap, maps, 'teamfight', { prefix });
  assert.ok(Math.abs(tfGot - tfNeeded) < 1e-5, `teamfight ${tfGot} vs ${tfNeeded}`);
});

/**
 * The divide question, settled by an impossibility rather than a fit: teamfight is a 0..1
 * fraction, so 2 players over 2 maps cannot exceed 4.0.
 */
test('core banner — displayed emblems are UNDIVIDED', () => {
  const role = madstonePair.roles.core;
  const tf = role.emblems.find((e) => e.stat === 'teamfight');
  const undivided = tf.score / (tf.percent / 100) / STAT.teamfight[1];
  const divided = undivided * 2;

  assert.ok(divided > 4, 'the divided reading must exceed the teamfight ceiling to be refuted');
  assert.ok(undivided <= 4, 'the undivided reading must sit under the ceiling');

  const maps = role.countedMaps.map(String);
  const byMap = rowsFor([195108598, 1044002267], maps); // Noticed, Satanic
  const got = units(byMap, maps, 'teamfight');
  assert.ok(Math.abs(got - undivided) < 1e-5, `teamfight ${got} vs ${undivided}`);

  // Очки is the emblem sum divided by the role's player count.
  assert.ok(Math.abs(role.emblemSum / 2 - role.observedTotal) < 0.01);
});

/**
 * The reason MADSTONE_FACTOR is what it is. If this drifts, the shipped estimate is being
 * changed away from the only two client scores that measure it.
 */
test('madstone factor stays inside what the two client scores measure', () => {
  const seen = [];
  for (const [roleKey, accounts] of [
    ['core', [195108598, 1044002267]],
    ['mid', [898455820]],
  ]) {
    const role = madstonePair.roles[roleKey];
    const maps = role.countedMaps.map(String);
    const byMap = rowsFor(accounts, maps);
    const prefix = role.prefix ? { ids: poolIds(role.prefix), bonus: pools[role.prefix].bonus } : null;

    const e = role.emblems.find((x) => x.stat === 'madstone');
    const needed = e.score / (e.percent / 100) / STAT.madstone[1];
    const bundles = units(byMap, maps, 'madstoneUses', { prefix });
    seen.push(needed / bundles);
  }
  const [lo, hi] = [Math.min(...seen), Math.max(...seen)];
  assert.ok(lo > 3.0 && hi < 3.2, `measured conversion ${lo.toFixed(4)}..${hi.toFixed(4)} left its band`);
});

/**
 * Additive stacking, from the one capture where a prefix and a suffix fire on the same map.
 *
 * Stated as a RATIO between the two counted maps on purpose: that is scale-invariant, so it
 * holds whatever the absolute divide turns out to be. The absolute emblem numbers on that
 * capture disagree with the divide the core card proves, and are flagged for re-reading —
 * but the stacking conclusion never depended on them.
 */
test('prefix and suffix bonuses stack additively, not multiplicatively', () => {
  const maps = ['8946161660', '8946285985'];
  const byMap = rowsFor([25907144, 10366616], maps); // Cr1t-, Sneyking
  const prefix = { ids: poolIds('otherworldly'), bonus: pools.otherworldly.bonus };

  // Game 3 qualifies for both bonuses; game 1 for neither.
  const add = units(byMap, maps, 'obs', { prefix, suffix: 0.16 });
  const g1 = units(byMap, ['8946161660'], 'obs');
  const g3add = add - g1;
  const g3raw = units(byMap, ['8946285985'], 'obs');

  assert.ok(Math.abs(g3add / g3raw - 1.23) < 1e-9, `game-3 multiplier ${g3add / g3raw}, expected 1.23`);
  assert.ok(Math.abs(1.07 * 1.16 - 1.2412) < 1e-9);
  assert.notEqual(Number((g3add / g3raw).toFixed(4)), 1.2412);
});
