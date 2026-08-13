/**
 * Raw OpenDota match -> normalized fantasy stat rows.
 *
 * PURE. No node imports, no I/O, no network. This file is importable directly in a
 * browser so the site can re-derive from data/raw/ when it disagrees with a number.
 *
 * NO FANTASY COEFFICIENTS LIVE HERE. This module emits counts; the scoring engine in
 * site-repo multiplies them. Mixing the two would mean every coefficient correction
 * requires a full data rebuild, and the coefficients are explicitly unofficial.
 *
 * Field mapping evidence: docs/FINDINGS.md (probed live 2026-08-13). Where a mapping was
 * corrected in the prior art after a cross-check, the note says so — those bugs cost real
 * debugging and should not be reintroduced.
 */

export const SCHEMA_VERSION = 1;

export const COLUMNS = [
  'matchId',
  'accountId',
  'heroId',
  'isRadiant',
  'playerSlot',
  'pos', // 1..5, or null when unknown
  'roleSource', // 'roster' | 'position_est' | 'heuristic' | null
  'kills',
  'deaths',
  'lastHits',
  'denies',
  'gpm',
  'towers',
  'obs',
  'camps',
  'runes',
  'sentries',
  'smokes',
  'teamfight',
  'stuns',
  'firstBlood',
  'roshan',
  'courier',
  'tormentorSelf',
  'tormentorTeam',
  'madstone',
  'lotus',
  'watcher',
];

/** Stats we have no source for at all. Emitted as null, NEVER 0 — see note below. */
export const UNSOURCED = ['lotus', 'watcher'];

/**
 * Stats whose mapping is real but whose exact definition is unvalidated against a real
 * in-client score. The site must be able to badge these rather than presenting them as
 * settled. See docs/FINDINGS.md 0.2.
 */
export const UNVALIDATED = {
  madstone: 'item_uses.madstone_bundle — leading candidate for Безумруди, magnitude unconfirmed',
  smokes: 'item_uses.smoke_of_deceit — ran 1.4-4.6x high vs an independent oracle in prior art; the real stat may only count smokes used in a kill',
  tormentorSelf: 'credits the last hitter; the game is believed to credit all participants — compare with tormentorTeam',
  stuns: "OpenDota's stun definition may not equal the game's (spec: hard control only, not silence or slow)",
};

/** A remake is a map that never really happened. Heuristic — flagged, not trusted. */
const REMAKE_MAX_DURATION_S = 300;

/** item_uses omits keys entirely when the count is zero. undefined is 0, not missing. */
const itemUses = (p, k) => (p.item_uses && p.item_uses[k]) || 0;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Resolve a player's fantasy position 1-5.
 * Order: pinned roster (authoritative) -> OpenDota's position_est -> lane heuristic.
 * Returns the source too, so a wrong role is traceable instead of silent.
 */
export function resolveRole(player, rosters = {}) {
  const pinned = rosters[String(player.account_id)];
  if (pinned && pinned.pos) return { pos: pinned.pos, roleSource: 'roster' };

  if (Number.isInteger(player.position_est) && player.position_est >= 1 && player.position_est <= 5) {
    return { pos: player.position_est, roleSource: 'position_est' };
  }

  // Last resort. lane_role is 1 safe / 2 mid / 3 off / 4 jungle, which does not separate
  // the core from the support sharing a lane — so this is genuinely approximate.
  const lane = player.lane_role;
  if (lane === 2) return { pos: 2, roleSource: 'heuristic' };
  if (lane === 1 || lane === 3) return { pos: lane === 1 ? 1 : 3, roleSource: 'heuristic' };
  return { pos: null, roleSource: null };
}

/** Tormentor kills per player_slot, and per side, from the objective log. */
export function tormentorKills(raw) {
  const bySlot = new Map();
  const bySide = { radiant: 0, dire: 0 };
  for (const o of raw.objectives ?? []) {
    if (o.type !== 'CHAT_MESSAGE_MINIBOSS_KILL') continue;
    if (o.player_slot != null) bySlot.set(o.player_slot, (bySlot.get(o.player_slot) ?? 0) + 1);
    // player_slot < 128 is radiant, per OpenDota's slot encoding.
    if (o.player_slot != null) {
      if (o.player_slot < 128) bySide.radiant++;
      else bySide.dire++;
    }
  }
  return { bySlot, bySide };
}

/** Classify a map so the site can exclude it but still say why. */
export function matchStatus(raw) {
  if (!raw || raw.match_id == null) return 'missing';
  const parsed = raw.od_data?.has_parsed ?? raw.players?.[0]?.teamfight_participation != null;
  if (num(raw.duration) > 0 && num(raw.duration) < REMAKE_MAX_DURATION_S) return 'remade';
  if (!parsed) return 'unparsed';
  return 'ok';
}

/**
 * Derive one match.
 * @returns {{ match: object, rows: Array[], warnings: string[] }}
 *   rows are arrays ordered by COLUMNS. Empty when the match is not 'ok'.
 */
export function deriveMatch(raw, { rosters = {}, gameNo = null } = {}) {
  const warnings = [];
  const status = matchStatus(raw);

  const match = {
    matchId: raw.match_id,
    leagueId: raw.leagueid ?? null,
    seriesId: raw.series_id ?? null,
    seriesType: raw.series_type ?? null,
    gameNo,
    startTime: raw.start_time ?? null,
    duration: raw.duration ?? null,
    radiantWin: raw.radiant_win ?? null,
    radiantTeamId: raw.radiant_team_id ?? null,
    direTeamId: raw.dire_team_id ?? null,
    // Captured because it is irreplaceable: replays expire, a salt in git does not.
    // No download route is currently known for these (cluster 413 -> 403), see FINDINGS.
    cluster: raw.cluster ?? null,
    replaySalt: raw.replay_salt ?? null,
    parsed: status !== 'unparsed' && status !== 'missing',
    status,
  };

  if (status !== 'ok') {
    warnings.push(`match ${raw.match_id}: status=${status}, no rows emitted`);
    return { match, rows: [], warnings };
  }

  const torm = tormentorKills(raw);
  const rows = [];

  for (const p of raw.players ?? []) {
    if (p.account_id == null) {
      warnings.push(`match ${raw.match_id}: a player has no account_id (anonymous) — row skipped`);
      continue;
    }
    const { pos, roleSource } = resolveRole(p, rosters);
    if (roleSource === 'heuristic' || roleSource === null) {
      warnings.push(`match ${raw.match_id}: role for ${p.account_id} came from ${roleSource ?? 'nothing'}`);
    }

    rows.push([
      raw.match_id,
      p.account_id,
      p.hero_id ?? null,
      p.isRadiant === true,
      p.player_slot ?? null,
      pos,
      roleSource,
      num(p.kills),
      num(p.deaths),
      num(p.last_hits),
      num(p.denies),
      num(p.gold_per_min),
      num(p.towers_killed),
      num(p.obs_placed),
      num(p.camps_stacked),
      num(p.rune_pickups),
      // Corrected in prior art after an oracle cross-check read consistently low:
      // ALL enemy wards destroyed, not just observers.
      num(p.observer_kills) + num(p.sentry_kills),
      itemUses(p, 'smoke_of_deceit'),
      num(p.teamfight_participation),
      num(p.stuns),
      p.firstblood_claimed ? 1 : 0,
      num(p.roshans_killed),
      num(p.courier_kills),
      torm.bySlot.get(p.player_slot) ?? 0,
      p.isRadiant ? torm.bySide.radiant : torm.bySide.dire,
      itemUses(p, 'madstone_bundle'),
      // null, never 0. The spec's edge cases require "no data" to be distinguishable
      // from "played and scored zero", and baking in 0 makes that unrecoverable.
      null,
      null,
    ]);
  }

  return { match, rows, warnings };
}

/** Assign gameNo within each series by start time. Mutates nothing. */
export function numberSeriesGames(matches) {
  const bySeries = new Map();
  for (const m of matches) {
    if (m.seriesId == null) continue;
    if (!bySeries.has(m.seriesId)) bySeries.set(m.seriesId, []);
    bySeries.get(m.seriesId).push(m);
  }
  for (const games of bySeries.values()) {
    games.sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
    games.forEach((g, i) => { g.gameNo = i + 1; });
  }
  return matches;
}
