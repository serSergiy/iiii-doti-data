/**
 * Ground-truth regression: does the committed data still reproduce a real in-client banner?
 *
 * This is the only test that spans the WHOLE pipeline — stats, map selection, prefix/suffix
 * stacking and the per-role divide — against a number a human read off the game client. The
 * per-stat tests can all pass while the banner is wrong, because they check columns and this
 * checks the thing the columns are for.
 *
 * The arithmetic below is deliberately duplicated here rather than imported. This repo emits
 * counts and holds NO fantasy coefficients (see the header of scripts/derive.mjs) — the
 * scoring engine lives in the site repo. What follows is a verification harness, not an
 * engine, and it must not grow into one.
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
const banner = read('test/fixtures/banner-observation-sersergiy-2.json');

const C = Object.fromEntries(stats.columns.map((c, i) => [c, i]));
const NAME_FIX = { Ringmaster: 'Ring Master', 'Outworld Destroyer': 'Outworld Devourer' };
const poolIds = (key) =>
  new Set(pools[key].heroes.map((n) => localToId[NAME_FIX[n] ?? n]).filter((x) => x != null));

/** Dataset column feeding each official stat id, and its coefficient. */
const STAT = {
  obsPlaced: ['obs', 117],
  tormentor: ['tormentorGame', 879],
  lotuses: ['lotus', 176],
};

/**
 * Score one emblem over a chosen pair of maps.
 *
 * The multiplier is ADDITIVE — `1 + prefix + suffix` — which this banner is the evidence
 * for. Do not "fix" it to (1+p)(1+s): that overshoots every emblem here by ~0.36%.
 */
function emblem(rowsByMap, maps, col, coef, percent, prefix, suffixBonus) {
  let total = 0;
  for (const mid of maps) {
    const m = stats.matches[mid];
    const suffix = m.titleFlags.lastPossibleGameOfSeries ? suffixBonus : 0;
    for (const r of rowsByMap[mid]) {
      const p = prefix.ids.has(r[C.heroId]) ? prefix.bonus : 0;
      total += r[C[col]] * (1 + p + suffix);
    }
  }
  return total * coef * percent;
}

test('the committed data reproduces a real in-client banner to the cent', () => {
  const role = banner.roles.support;
  const players = { 'Cr1t-': 25907144, Sneyking: 10366616 };
  const maps = role.countedMaps.map(String);

  const rowsByMap = {};
  for (const r of stats.rows) {
    if (!Object.values(players).includes(r[C.accountId])) continue;
    if (!maps.includes(String(r[C.matchId]))) continue;
    (rowsByMap[r[C.matchId]] ??= []).push(r);
  }
  for (const mid of maps) {
    assert.equal(rowsByMap[mid]?.length, 2, `both supports must have a row on ${mid}`);
  }

  const prefix = { ids: poolIds('otherworldly'), bonus: pools.otherworldly.bonus };
  let sum = 0;
  for (const e of role.emblems) {
    const [col, coef] = STAT[e.stat];
    // ÷ 2 players: the client divides the emblem by the role's player count.
    const got = emblem(rowsByMap, maps, col, coef, e.percent / 100, prefix, 0.16) / 2;
    assert.ok(
      Math.abs(got - e.score) < 0.02,
      `${e.statUk}: computed ${got.toFixed(2)}, client ${e.score}`,
    );
    sum += got;
  }
  assert.ok(
    Math.abs(sum - role.observedTotal) < 0.02,
    `role total: computed ${sum.toFixed(2)}, client ${role.observedTotal}`,
  );
});

/**
 * The refutation, pinned so it cannot quietly come back. Multiplicative stacking was the
 * other live candidate and this banner is what killed it.
 */
test('multiplicative prefix/suffix stacking is refuted by the same banner', () => {
  const players = [25907144, 10366616];
  const maps = banner.roles.support.countedMaps.map(String);
  const rowsByMap = {};
  for (const r of stats.rows) {
    if (!players.includes(r[C.accountId]) || !maps.includes(String(r[C.matchId]))) continue;
    (rowsByMap[r[C.matchId]] ??= []).push(r);
  }
  const ids = poolIds('otherworldly');
  const b = pools.otherworldly.bonus;

  let mul = 0;
  for (const e of banner.roles.support.emblems) {
    const [col, coef] = STAT[e.stat];
    let total = 0;
    for (const mid of maps) {
      const s = stats.matches[mid].titleFlags.lastPossibleGameOfSeries ? 0.16 : 0;
      for (const r of rowsByMap[mid]) {
        total += r[C[col]] * (1 + (ids.has(r[C.heroId]) ? b : 0)) * (1 + s);
      }
    }
    mul += (total * coef * (e.percent / 100)) / 2;
  }
  const observed = banner.roles.support.observedTotal;
  assert.ok(mul - observed > 50, `multiplicative should overshoot noticeably, got ${mul.toFixed(2)} vs ${observed}`);
});
