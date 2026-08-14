/**
 * Golden tests against the committed Bo3 fixtures (series 1130069, TI 2026 day 1).
 *
 * These exist to catch silent upstream schema drift, which is a documented failure mode
 * here: prior art found that asking OpenDota for `tormentor_kills` returns 0 rather than
 * erroring, so a mapping can rot without anything going red.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { deriveMatch, numberSeriesGames, COLUMNS, resolveRole, tormentorKills, matchStatus } from '../scripts/derive.mjs';

const DIR = path.join(import.meta.dirname, 'fixtures');
const load = (id) => JSON.parse(fs.readFileSync(path.join(DIR, `match-${id}.json`), 'utf8'));
const IDS = [8943267925, 8943364918, 8943477775];
const col = (row, name) => row[COLUMNS.indexOf(name)];

test('every fixture derives cleanly with 10 rows', () => {
  for (const id of IDS) {
    const { match, rows } = deriveMatch(load(id));
    assert.equal(match.status, 'ok', `${id} should be ok`);
    assert.equal(match.parsed, true);
    assert.equal(rows.length, 10, `${id} should have 10 players`);
    assert.equal(match.seriesId, 1130069);
    assert.equal(match.leagueId, 19719);
  }
});

test('teamfight participation is present and in 0..1 — the stat STRATZ cannot supply', () => {
  const { rows } = deriveMatch(load(8943477775));
  const tf = rows.map((r) => col(r, 'teamfight'));
  assert.equal(tf.length, 10);
  for (const v of tf) {
    assert.equal(typeof v, 'number');
    assert.ok(v > 0 && v <= 1, `teamfight ${v} out of range`);
  }
});

test('unsourced stats are null, never 0', () => {
  const { rows } = deriveMatch(load(8943477775));
  for (const r of rows) {
    assert.equal(col(r, 'watcher'), null);
    // lotus mapping was retracted: refuted on a banner whose maps are pinned by stuns.
    assert.equal(col(r, 'lotus'), null);
  }
});

test('famango column carries the raw count (evidence, not a claimed lotus mapping)', () => {
  const raw = load(8943477775);
  const { rows } = deriveMatch(raw);
  for (const [i, p] of raw.players.entries()) {
    const iu = p.item_uses || {};
    const expected = (iu.famango || 0) + (iu.great_famango || 0) + (iu.greater_famango || 0);
    const row = rows.find((r) => col(r, 'accountId') === p.account_id);
    assert.equal(col(row, 'famango'), expected, `player ${i}`);
  }
  assert.ok(rows.some((r) => col(r, 'famango') > 0), 'someone ate a famango');
});


test('smoke reads 0 for a carry and nonzero for supports (item_uses omits zero keys)', () => {
  const { rows } = deriveMatch(load(8943477775));
  const smokes = rows.map((r) => col(r, 'smokes'));
  assert.ok(smokes.every((s) => typeof s === 'number'), 'no undefined leaked through');
  assert.ok(Math.max(...smokes) >= 13, 'a support should have used smokes');
  assert.ok(smokes.includes(0), 'a core should read 0, not undefined');
});

test('sentries sum observer_kills AND sentry_kills', () => {
  const raw = load(8943477775);
  const { rows } = deriveMatch(raw);
  const p0 = raw.players[0];
  const expected = (p0.observer_kills || 0) + (p0.sentry_kills || 0);
  assert.equal(col(rows[0], 'sentries'), expected);
  assert.equal(expected, 7, 'fixture player[0] had 4 observer + 3 sentry kills');
});

test('tormentor: last-hitter and team credit are both emitted and differ', () => {
  const raw = load(8943477775);
  const { bySlot, bySide } = tormentorKills(raw);
  assert.equal(bySide.dire, 2, 'fixture had 2 tormentor kills, both by dire');
  assert.equal(bySide.radiant, 0);
  const { rows } = deriveMatch(raw);
  const selfTotal = rows.reduce((a, r) => a + col(r, 'tormentorSelf'), 0);
  assert.equal(selfTotal, 2, 'individual credit sums to the number of events');
  const direRows = rows.filter((r) => col(r, 'isRadiant') === false);
  assert.ok(direRows.every((r) => col(r, 'tormentorTeam') === 2), 'team credit is uniform per side');
  assert.equal(bySlot.size, 2);
});

test('exactly one first blood across the map', () => {
  for (const id of IDS) {
    const { rows } = deriveMatch(load(id));
    const fb = rows.reduce((a, r) => a + col(r, 'firstBlood'), 0);
    assert.equal(fb, 1, `${id} should have exactly one first blood`);
  }
});

test('roles resolve 1..5 on each side via position_est', () => {
  const { rows } = deriveMatch(load(8943477775));
  for (const side of [true, false]) {
    const pos = rows.filter((r) => col(r, 'isRadiant') === side).map((r) => col(r, 'pos')).sort();
    assert.deepEqual(pos, [1, 2, 3, 4, 5], `side ${side} should cover all five positions`);
  }
  assert.ok(rows.every((r) => col(r, 'roleSource') === 'position_est'));
});

test('a pinned roster overrides position_est', () => {
  const raw = load(8943477775);
  const acct = raw.players[0].account_id;
  const { rows } = deriveMatch(raw, { rosters: { [String(acct)]: { pos: 5 } } });
  const row = rows.find((r) => col(r, 'accountId') === acct);
  assert.equal(col(row, 'pos'), 5);
  assert.equal(col(row, 'roleSource'), 'roster');
});

test('series games are numbered 1,2,3 by start time', () => {
  const matches = IDS.map((id) => deriveMatch(load(id)).match);
  matches.reverse(); // ensure ordering is by startTime, not input order
  numberSeriesGames(matches);
  const ordered = [...matches].sort((a, b) => a.gameNo - b.gameNo);
  assert.deepEqual(ordered.map((m) => m.gameNo), [1, 2, 3]);
  assert.ok(ordered[0].startTime < ordered[1].startTime);
  assert.ok(ordered[1].startTime < ordered[2].startTime);
  assert.equal(ordered[2].duration, 5678, 'game 3 is the 95-minute outlier');
});

test('replay salt and cluster are captured — replays expire, integers in git do not', () => {
  const { match } = deriveMatch(load(8943477775));
  assert.equal(match.cluster, 413);
  assert.equal(match.replaySalt, 2113524684);
});

test('a remake is classified, not silently scored', () => {
  const raw = { ...load(8943267925), duration: 120 };
  assert.equal(matchStatus(raw), 'remade');
  const { rows, match } = deriveMatch(raw);
  assert.equal(rows.length, 0, 'no rows from a remake');
  assert.equal(match.status, 'remade');
});

test('an unparsed match yields no rows rather than zeros', () => {
  const raw = load(8943267925);
  const stripped = { ...raw, od_data: { has_parsed: false }, players: raw.players.map((p) => ({ ...p, teamfight_participation: null })) };
  assert.equal(matchStatus(stripped), 'unparsed');
  assert.equal(deriveMatch(stripped).rows.length, 0);
});

test('resolveRole falls back predictably when nothing is available', () => {
  assert.deepEqual(resolveRole({ account_id: 1 }), { pos: null, roleSource: null });
  assert.deepEqual(resolveRole({ account_id: 1, lane_role: 2 }), { pos: 2, roleSource: 'heuristic' });
  assert.deepEqual(resolveRole({ account_id: 1, position_est: 4, lane_role: 2 }), { pos: 4, roleSource: 'position_est' });
});
