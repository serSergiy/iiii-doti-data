/**
 * OpenDota source. Primary and, for v1, only.
 *
 * Phase 0 (docs/FINDINGS.md) established that OpenDota supplies the entire usable stat
 * catalog including teamfight_participation and stuns — both of which STRATZ lacks
 * entirely — plus series_id, replay_salt and cluster. STRATZ is retained only for the
 * Phase 4.2 cross-check.
 */
import { getJson } from '../lib/http.mjs';

const API = 'https://api.opendota.com/api';

const key = process.env.OPENDOTA_KEY ? `?api_key=${process.env.OPENDOTA_KEY}` : '';
// With a key the documented limit is far higher; without one, stay under ~60/min.
const gapMs = process.env.OPENDOTA_KEY ? 120 : 1100;

/**
 * Every match in a league. Returns the light listing shape:
 * { match_id, radiant_win, start_time, duration, leagueid, radiant_team_id,
 *   dire_team_id, series_id, series_type, radiant_score, dire_score }
 */
export async function listLeagueMatches(leagueId) {
  const list = await getJson(`${API}/leagues/${leagueId}/matches${key}`, { gapMs });
  if (!Array.isArray(list)) throw new Error('league match listing was not an array');
  return list;
}

/** Full match detail, including players[], objectives[], replay_salt, cluster. */
export async function getMatch(matchId) {
  return getJson(`${API}/matches/${matchId}${key}`, { gapMs });
}
