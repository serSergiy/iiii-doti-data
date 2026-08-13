#!/usr/bin/env node
/**
 * Ingest entry point.  node scripts/ingest.mjs [--dry-run] [--limit N] [--force ID]
 *
 * Git is the state. The queue is derived, never stored: list the league's matches, diff
 * against what is already committed, process the difference. No queue file, no lock, no
 * marker — a failed run self-heals on the next one because the diff is recomputed from
 * scratch every time.
 *
 * Writes, all under data/:
 *   raw/{id}.json.gz    trimmed raw payload (re-derivation substrate)
 *   matches/{id}.json   per-match derived detail + retry state
 *   stats.json          the whole dataset, column-array form
 *   meta.json           version / counts / coverage — health file and site cache key
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { listLeagueMatches, getMatch } from './sources/opendota.mjs';
import { deriveMatch, numberSeriesGames, COLUMNS, SCHEMA_VERSION, UNSOURCED, UNVALIDATED } from './derive.mjs';
import { trimMatch } from './lib/trim.mjs';
import { writeIfChanged } from './lib/write-if-changed.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const RAW = path.join(DATA, 'raw');
const MATCHES = path.join(DATA, 'matches');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

const DRY = has('--dry-run');
const LIMIT = Number(val('--limit', Infinity));
const FORCE = val('--force', null);

/** Give up after this many failed attempts so a dead match stops burning quota. */
const MAX_ATTEMPTS = 8;

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };

function main() {
  const league = readJson(path.join(ROOT, 'config', 'league.json'));
  if (!league?.leagueId) throw new Error('config/league.json is missing leagueId');
  const rosters = readJson(path.join(ROOT, 'config', 'rosters.json'), {});

  for (const d of [DATA, RAW, MATCHES]) fs.mkdirSync(d, { recursive: true });

  return run(league, rosters);
}

async function run(league, rosters) {
  console.log(`league ${league.leagueId} (${league.name})`);

  const listing = await listLeagueMatches(league.leagueId);
  console.log(`  upstream: ${listing.length} matches`);

  // --- the diff -----------------------------------------------------------------
  const todo = [];
  for (const m of listing) {
    const id = m.match_id;
    if (FORCE && String(id) !== String(FORCE)) continue;
    const existing = readJson(path.join(MATCHES, `${id}.json`));

    if (!existing || FORCE) { todo.push({ id, listing: m, prior: existing }); continue; }
    // Re-attempt anything not yet successfully derived, until the attempt budget runs out.
    if (existing.status === 'ok') continue;
    if (existing.status === 'remade') continue; // terminal, and correct
    if ((existing.attempts ?? 0) >= MAX_ATTEMPTS) continue;
    todo.push({ id, listing: m, prior: existing });
  }

  const queue = todo.slice(0, LIMIT);
  console.log(`  to process: ${todo.length}${queue.length < todo.length ? ` (limited to ${queue.length})` : ''}`);

  // --- fetch + derive -----------------------------------------------------------
  const allWarnings = [];
  for (const [i, item] of queue.entries()) {
    process.stdout.write(`  [${i + 1}/${queue.length}] ${item.id} `);
    try {
      const raw = await getMatch(item.id);
      const { match, rows, warnings } = deriveMatch(raw, { rosters });
      allWarnings.push(...warnings);

      if (!DRY) {
        fs.writeFileSync(path.join(RAW, `${item.id}.json.gz`), zlib.gzipSync(JSON.stringify(trimMatch(raw))));
        fs.writeFileSync(path.join(MATCHES, `${item.id}.json`), JSON.stringify({
          ...match,
          attempts: (item.prior?.attempts ?? 0) + 1,
          lastAttempt: new Date().toISOString(),
          lastError: null,
          rows,
        }, null, 1));
      }
      console.log(`${match.status}  ${rows.length} rows`);
    } catch (e) {
      // A 404 here is routine, not a bug. Record and move on; the next run retries.
      const attempts = (item.prior?.attempts ?? 0) + 1;
      console.log(`FAILED (${e.message}) attempt ${attempts}/${MAX_ATTEMPTS}`);
      if (!DRY) {
        fs.writeFileSync(path.join(MATCHES, `${item.id}.json`), JSON.stringify({
          ...(item.prior ?? {}),
          matchId: item.id,
          seriesId: item.listing.series_id ?? null,
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          attempts,
          lastAttempt: new Date().toISOString(),
          lastError: String(e.message),
          rows: [],
        }, null, 1));
      }
    }
  }

  if (DRY) { console.log('  --dry-run: nothing written'); return; }

  // --- aggregate ----------------------------------------------------------------
  writeAggregate(league, allWarnings);
}

function writeAggregate(league, warnings) {
  const files = fs.readdirSync(MATCHES).filter((f) => f.endsWith('.json'));

  const matches = [];
  const rows = [];
  const counts = { ok: 0, pending: 0, failed: 0, remade: 0, unparsed: 0 };

  for (const f of files) {
    const m = readJson(path.join(MATCHES, f));
    if (!m) continue;
    counts[m.status] = (counts[m.status] ?? 0) + 1;
    const { rows: r, ...meta } = m;
    matches.push(meta);
    if (Array.isArray(r)) rows.push(...r);
  }

  numberSeriesGames(matches);

  const matchMap = {};
  for (const m of matches) {
    const { attempts, lastAttempt, lastError, ...rest } = m;
    matchMap[m.matchId] = rest;
  }

  // Per-stat non-null coverage: makes "lotuses are 100% null" visible on a dashboard
  // instead of something a confused visitor discovers.
  const coverage = {};
  COLUMNS.forEach((c, i) => {
    if (i < 7) return; // identity columns, not stats
    const nonNull = rows.filter((r) => r[i] !== null && r[i] !== undefined).length;
    coverage[c] = rows.length ? +(nonNull / rows.length).toFixed(3) : 0;
  });

  const stats = {
    v: SCHEMA_VERSION,
    leagueId: league.leagueId,
    generatedAt: new Date().toISOString(),
    columns: COLUMNS,
    unsourced: UNSOURCED,
    unvalidated: UNVALIDATED,
    matches: matchMap,
    rows,
  };
  const statsChanged = writeIfChanged(path.join(DATA, 'stats.json'), stats);

  const meta = {
    v: SCHEMA_VERSION,
    generatedAt: stats.generatedAt,
    leagueId: league.leagueId,
    leagueName: league.name,
    counts,
    matchCount: matches.length,
    rowCount: rows.length,
    seriesCount: new Set(matches.map((m) => m.seriesId).filter((x) => x != null)).size,
    playerCount: new Set(rows.map((r) => r[1])).size,
    coverage,
    warningSample: warnings.slice(0, 20),
    warningCount: warnings.length,
  };
  const metaChanged = writeIfChanged(path.join(DATA, 'meta.json'), meta, true);

  const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1);
  console.log(`\n  data/stats.json  ${kb(path.join(DATA, 'stats.json'))} KB`);
  console.log(`  matches ${meta.matchCount}, series ${meta.seriesCount}, rows ${meta.rowCount}, players ${meta.playerCount}`);
  console.log(`  status: ${JSON.stringify(counts)}`);
  if (warnings.length) console.log(`  warnings: ${warnings.length} (sample in data/meta.json)`);
  console.log(statsChanged || metaChanged ? '  aggregate updated' : '  aggregate unchanged — nothing to commit');
}

await main();
