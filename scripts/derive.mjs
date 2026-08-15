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
  'tormentorGame',  // m_iTormentorKills — the game's own counter, and THE tormentor stat.
                    // Participation: every hero who damaged it, not the last hitter.
  'madstone',       // ESTIMATE — madstoneUses x MADSTONE_FACTOR. Not a measurement.
  'madstoneGame',   // raw m_nAcquiredMadstone — degenerate, evidence only. See UNVALIDATED.
  'madstoneUses',   // raw item_uses count — the measured per-player quantity
  'famango',        // raw famango+great+greater count — evidence, NOT a claimed mapping
  'lotus',
  'watcher',
];

/** Stats we have no source for at all. Emitted as null, NEVER 0 — see note below. */
/**
 * Nothing is unconditionally unsourced any more. lotus / watcher / madstone come from the
 * game's OWN counters inside the replay (m_iLotusesTaken, m_iWatchersTaken,
 * m_nAcquiredMadstone), so they are populated wherever a parsed replay exists and null
 * where it does not. Consumers must check meta.json.coverage per column rather than
 * assuming, which is what REPLAY_DERIVED is for.
 */
export const UNSOURCED = [];
export const REPLAY_DERIVED = ['lotus', 'watcher', 'madstoneGame', 'tormentorGame'];

/**
 * ЗІБРАНИЙ ЛЮТИТ has no measured source, so this is an OPENLY ESTIMATED one.
 *
 * What is measured: `item_uses.madstone_bundle`, which agrees with the replay's own
 * combat-log madstone events on 80/80 player-maps and behaves exactly as a collection stat
 * should — pos 1 averages 23.6 bundles a map against pos 5's 2.6.
 *
 * What is NOT known exactly: the conversion from bundles used to madstones collected. Two
 * banners carrying a ЗІБРАНИЙ ЛЮТИТ emblem now measure it directly, and both counted-map
 * pairs are pinned independently by teamfight agreeing to six decimals:
 *
 *   core (Noticed + Satanic, 1130027 g1+g3)  202.0000 units / 67 bundles   = 3.0149
 *   mid  (Malr1ne, 1130024 g1x1.11 + g3)      70.5201 units / 22.1 bundles = 3.1910
 *
 * Pooled: 3.0586, band [3.015, 3.191]. The underlying relationship looks like
 * `3 x bundles + a small per-player remainder` — a bundle is 3 madstones, and the mid
 * decomposes uniquely to 32 and 35 madstones off 10 and 11 bundles, i.e. 3n+2 both maps.
 * The remainder is not constant (the core needs +1 across four player-maps where the mid
 * needs +2 on each of two), which is exactly why a scalar cannot be exact.
 *
 * 3.06 is therefore a fitted estimate, not a measurement, and `madstone` stays flagged in
 * UNVALIDATED so the UI must badge it. It supersedes an earlier 1.97, which came from two
 * banner bands nobody can re-derive and understated madstone by ~36%.
 *
 * Deliberately NOT scaled by match duration on top of this. `madstoneUses` already carries
 * duration — the ten-player sum correlates with it at r=0.85, rising ~2.2 bundles a minute —
 * so a second duration term would count the same effect twice.
 *
 * Being a scalar multiple, this cannot change any ranking between players; it only sets the
 * absolute scale, which is all the fantasy points need it for.
 */
export const MADSTONE_FACTOR = 3.06;
export const MADSTONE_FACTOR_BAND = [3.01, 3.19];

/**
 * ЗІБРАНО ЛОТУСІВ = famango + great_famango + greater_famango, from item_uses.
 *
 * The Lotus Pool yields Famangos, so the fantasy "lotuses collected" stat counts those
 * item uses — it is not a separate objective event, which is why it appears nowhere in the
 * replay combat log and why every earlier hunt for a "lotus" string failed.
 *
 * RETRACTED as a mapping. It matched the Aurora banner exactly (9.0 units at coef 176),
 * but a fourth banner whose counted maps are PINNED INDEPENDENTLY BY STUNS
 * (8943267925 + 8943477775) needs 17.5-18.5 units and this gives 11.5 — and the weighted
 * 1/3/9 reading (small lotuses merge upward, 3 -> great, 3 more -> greater) gives 65.5.
 * Neither is reachable. The Aurora agreement was therefore a coincidence.
 *
 * The count is still emitted as its own `famango` column, because it is real measured data
 * and the true lotus stat is probably a function of it — but `lotus` goes back to null
 * rather than assert a mapping that a pinned-map test refutes.
 *
 * Root cause is likely what the user identified: item_uses counts lotuses EATEN, not
 * COLLECTED, and purchase_log confirms smalls merge into larger ones. Collection has to
 * come from inventory events in the replay, which we have not parsed.
 */
const LOTUS_ITEMS = ['famango', 'great_famango', 'greater_famango'];
const lotuses = (p) => LOTUS_ITEMS.reduce((a, k) => a + itemUses(p, k), 0);

/**
 * Stats whose mapping is real but whose exact definition is unvalidated against a real
 * in-client score. The site must be able to badge these rather than presenting them as
 * settled. See docs/FINDINGS.md 0.2.
 */
export const UNVALIDATED = {
  famango: 'raw item_uses famango+great+greater. NOT confirmed to be the lotus stat — refuted on a pinned-map banner. See docs/FINDINGS.md',
  madstone: `ESTIMATE, NOT A MEASUREMENT — madstoneUses x ${MADSTONE_FACTOR}, fitted to two banners carrying a ЗІБРАНИЙ ЛЮТИТ emblem (3.0149 and 3.1910, pooled 3.0586). The true relationship is about 3 madstones per bundle plus a small per-player remainder that is not constant, so a scalar is wrong by a few percent either way. Badge it. Being a scalar multiple of madstoneUses it preserves player ordering exactly, so it is safe to rank on and unsafe to quote as a count.`,
  madstoneGame: 'the game\'s own m_nAcquiredMadstone. DEGENERATE — not a per-player stat at all: all ten players carry an identical value on 43 of 63 maps, it equals item_uses.madstone_bundle on 1 of 280 rows, and players who used zero bundles still read 17-19. It tracks match duration in steps (16, 26, 36, 46 ...) rather than anything a player did. Emitted as evidence only; never score it.',
  madstoneUses: 'raw item_uses.madstone_bundle. A real measured per-player quantity (80/80 agreement with the replay combat log), but in bundles, NOT in the madstones the fantasy stat counts. Use `madstone` for scoring.',
  smokes: 'item_uses.smoke_of_deceit. The OFFICIAL glossary says simply "за використаний Дим омани" with no kill requirement, which argues against the prior-art theory that only smokes used in a kill count.',
  tormentorSelf: 'REFUTED as the fantasy stat. OpenDota objectives-log last-hitter reading. The "meow" banner (mid Nisha, УБИТО МУЧИТЕЛІВ 250% -> 4395, coef 879) pins the counted maps at 8943091110+8943148045 via towerKills/smokesUsed agreement and implies exactly 2.0000 raw units — but tormentorSelf sums to 1 on those two maps. The glossary wording ("за вбивство мучителя") was read as last-hit-only; that reading is now contradicted by data. Kept only as a fallback shape.',
  tormentorGame: 'the game\'s own m_iTormentorKills counter — PARTICIPATION, not the last hit: it credits every hero who damaged the tormentor, measured at 155 credits over 54 tormentor deaths (mean 2.87, max 4 heroes on one death) across the 29 parsed replays. On the "meow" banner + counted maps above it sums to exactly 2, matching the implied 2.0000 units where tormentorSelf (1) does not. This is the SHIPPED tormentor source. Still listed here because a single banner pins it: the definition is right, the exact credit threshold (any damage? a minimum share?) is not independently confirmed.',
};

/** A remake is a map that never really happened. Heuristic — flagged, not trusted. */
const REMAKE_MAX_DURATION_S = 300;

/** item_uses omits keys entirely when the count is zero. undefined is 0, not missing. */
const itemUses = (p, k) => (p.item_uses && p.item_uses[k]) || 0;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Read one of the game's own counters for a player, or null when no replay is parsed. */
function gs(gameStats, player, key) {
  if (!gameStats) return null;
  const rec = gameStats[player.account_id];
  if (!rec || rec[key] == null) return null;
  return rec[key];
}

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
export function deriveMatch(raw, { rosters = {}, gameNo = null, gameStats = null } = {}) {
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
    titleFlags: titleFlags(raw),
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
      // The game's own counters, when a parsed replay is available for this match.
      // These supersede every item_uses heuristic: m_iWatchersTaken reproduced
      // banner-derived ground truth exactly (5 and 7), and m_iLastHitCount matched
      // OpenDota on all 20 player-maps checked. null where no replay exists — never 0.
      gs(gameStats, p, 'tormentorKills'),
      // ESTIMATE. One decimal so it never reads as an exact count — see MADSTONE_FACTOR.
      +(itemUses(p, 'madstone_bundle') * MADSTONE_FACTOR).toFixed(1),
      gs(gameStats, p, 'acquiredMadstone'),
      itemUses(p, 'madstone_bundle'),
      lotuses(p),
      gs(gameStats, p, 'lotusesTaken'),
      gs(gameStats, p, 'watchersTaken'),
    ]);
  }

  return { match, rows, warnings };
}

/**
 * Per-map flags for the suffix (Звання) conditions, from config/titles.json.
 *
 * These are OFFICIAL in-game values and conditions, unlike the emblem coefficients. The
 * title is a per-GAME conditional multiplier on the role's emblem sum, which is why an
 * observed banner's uplift differs per role and is exactly 1.0 when nothing qualifies.
 *
 * `lastPossibleGameOfSeries` is filled in by numberSeriesGames, since it needs to know how
 * long the series ran. Note it means the last game the series COULD have reached, not the
 * last one played: a Bo3 that ends 2-0 never reaches game 3, so Вирішайло never fires for
 * it. That is confirmed — Nisha's 2-0 series is why the mid banner reads exactly x1.000000
 * on every observed banner carrying that suffix.
 */
export function titleFlags(raw) {
  const fb = (raw.objectives ?? []).find((o) => o.type === 'CHAT_MESSAGE_FIRSTBLOOD');
  const fbTime = fb ? fb.time : null;
  const dur = num(raw.duration);
  return {
    // Спритник +24%
    durationUnder25min: dur > 0 && dur < 1500,
    // Послушник Білованих Близнюків +9% — the horn is t=0, so pre-horn is a negative time
    firstBloodBeforeHorn: fbTime != null && fbTime < 0,
    // Терпеливець +23% — includes a game with no first blood at all
    noFirstBloodBefore10min: fbTime == null || fbTime >= 600,
    // Щасливчик +21% — AMBIGUOUS: which digit "ends in 8" refers to is unresolved,
    // so both readings are emitted rather than one being guessed.
    durationSecondsEndIn8: dur % 10 === 8,
    durationDisplaySecondsEndIn8: (dur % 60) % 10 === 8,
    // Вирішайло +16% — filled by numberSeriesGames
    lastPossibleGameOfSeries: null,
    // Кат +13% (fountain kills) is out of scope, and Страдник +23% needs the replay.
    firstBloodTime: fbTime,
  };
}

/** Assign gameNo within each series by start time, and resolve lastPossibleGameOfSeries. */
export function numberSeriesGames(matches) {
  const bySeries = new Map();
  for (const m of matches) {
    if (m.seriesId == null) continue;
    if (!bySeries.has(m.seriesId)) bySeries.set(m.seriesId, []);
    bySeries.get(m.seriesId).push(m);
  }
  for (const games of bySeries.values()) {
    games.sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
    // seriesType 1 = Bo3, 2 = Bo5, 0 = Bo1. The last POSSIBLE game is that maximum, which
    // a sweep never reaches — the whole point of the Вирішайло condition.
    const maxGames = { 0: 1, 1: 3, 2: 5 }[games[0]?.seriesType] ?? games.length;
    games.forEach((g, i) => {
      g.gameNo = i + 1;
      if (g.titleFlags) g.titleFlags.lastPossibleGameOfSeries = (i + 1) === maxGames;
      g.seriesGamesPlayed = games.length;
      g.seriesGamesPossible = maxGames;
    });
  }
  return matches;
}
