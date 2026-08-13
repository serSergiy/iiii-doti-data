/**
 * Trim a raw OpenDota match down to what we might ever need, then it gets gzipped into
 * data/raw/.
 *
 * Why keep raw at all: committing only derived stats means a derivation bug found in
 * September is unfixable, because the replay it came from has expired and — per Phase 0 —
 * we cannot download replays for this tournament's cluster anyway. The raw payload is the
 * only re-derivation substrate that will still exist. It is also the `git log -p`
 * debugging affordance the spec says it is buying by using git as storage.
 *
 * Why trim: a full payload is ~0.4-0.6 MB of which most is per-minute time series we have
 * no use for. Dropping those gets a full TI into a few MB.
 *
 * DROP-list, not keep-list: a keep-list silently discards fields OpenDota adds later,
 * which is exactly how you lose the one field that turns out to matter.
 */

const DROP_PLAYER_KEYS = [
  // per-minute series
  'gold_t', 'xp_t', 'lh_t', 'dn_t', 'times',
  // verbose logs we can rebuild from objectives/flat fields if ever needed
  'purchase_log', 'kills_log', 'obs_log', 'sen_log', 'obs_left_log', 'sen_left_log',
  'runes_log', 'connection_log', 'buyback_log', 'neutral_item_history', 'neutral_tokens_log',
  'ability_upgrades_arr', 'ability_targets', 'damage_targets', 'damage_inflictor',
  'damage_inflictor_received', 'killed', 'killed_by', 'damage', 'damage_taken',
  'hero_hits', 'item_usage', 'item_win', 'cosmetics', 'benchmarks', 'permanent_buffs',
  'life_state', 'actions', 'gold_reasons', 'xp_reasons', 'purchase', 'obs', 'sen',
  'lane_pos', 'multi_kills', 'kill_streaks', 'first_purchase_time',
];

const DROP_MATCH_KEYS = ['radiant_gold_adv', 'radiant_xp_adv', 'chat', 'teamfights', 'draft_timings', 'picks_bans', 'all_word_counts', 'my_word_counts', 'cosmetics'];

export function trimMatch(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (DROP_MATCH_KEYS.includes(k) || k === 'players') continue;
    out[k] = v;
  }
  out.players = (raw.players ?? []).map((p) => {
    const q = {};
    for (const [k, v] of Object.entries(p)) {
      if (DROP_PLAYER_KEYS.includes(k)) continue;
      q[k] = v;
    }
    return q;
  });
  return out;
}
