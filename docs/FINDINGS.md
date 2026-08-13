# Phase 0 findings — live probes

All probes run **2026-08-13**, against TI 2026 group-stage day 1 while it was in progress.
Every claim below is a measurement, not a schema-mirror inference. Re-run before trusting
any of it in a later month — all three sources have been observed to drift, which is why
this file records the date and the raw shape rather than just a conclusion.

Probe scripts live in the session scratchpad, not the repo; the reproducible ones are
worth porting to `test/` when ingest is built.

---

## 0.5 — League ID: **19719**

```json
{ "leagueid": 19719, "name": "The International 2026", "tier": "premium" }
```

Found via OpenDota `GET /api/leagues` (10,057 leagues, 75 matching `/international/i`).
Do not confuse with the qualifier leagues, which are separate IDs and tier `excluded`:
19838 SEA, 19839 NA, 19840 SA, 19841 EU, 19842 CN.

As of the probe the league had **29 matches across 12 series**, all `series_type: 1` (Bo3),
series sizes 2–3 maps, spanning 03:03–12:50 UTC on 2026-08-13.

---

## 0.1 — OpenDota covers the stat catalog. **The teamfight gap does not exist.**

Sample: match `8943477775`, a real TI 2026 map. `od_data` reports
`{"has_api":true,"has_gcdata":true,"has_parsed":true,"has_archive":false}`.

| Stat | Field | Sample value | Status |
|---|---|---|---|
| Teamfight participation | `teamfight_participation` | `0.64285713` | **PRESENT** |
| Stun seconds | `stuns` | `1.8340576` | **PRESENT** |
| Kills / deaths | `kills` `deaths` | 29 / 5 | present |
| Last hits / denies | `last_hits` `denies` | 1361 / 8 | present |
| GPM | `gold_per_min` | 1015 | present |
| Towers | `towers_killed` | 7 | present |
| Roshan | `roshans_killed` | 2 | present |
| Courier | `courier_kills` | 0 | present |
| Wards placed | `obs_placed` | 0 (36 on a support) | present |
| Camps stacked | `camps_stacked` | 2 | present |
| Runes | `rune_pickups` | 14 | present, plus a `runes` map by rune type |
| Sentries captured | `observer_kills` + `sentry_kills` | 4 + 3 | present |
| First blood | `firstblood_claimed` | 0 (1 on AMMAR_THE_F) | present |
| Smokes used | `item_uses.smoke_of_deceit` | 13 on supports | present — **key is absent, not 0, when unused** |
| Series | `series_id` / `series_type` | 1130069 / 1 | present |

**This closes the spec's single largest risk item.** The spec ranks teamfight participation
as "the critical gap… the highest-value stat in the whole coefficient table (2124 base)",
requires deriving it from kill/assist event clustering, and orders it validated before
anything else in the engine. That is true of STRATZ and false of OpenDota, which computes
it in its own replay parser and serves it as a plain float.

**Gotcha to encode in `derive.mjs`:** `item_uses` keys are *omitted* when the count is zero.
`smoke_of_deceit` read `undefined` on the first player inspected (a carry) and 13 on
supports. Treat `undefined` as 0, and never let a missing key be mistaken for a data gap.

**Bonus find: `position_est`.** OpenDota emits an estimated position 1–5 per player, and on
the sample it read cleanly `1,3,2,4,5` / `5,1,2,3,4` across the two teams. This is strictly
better than the hand-rolled lane_role + net-worth heuristic in the prior art
(`Statistics collector app Fantasy 2026/files/tools/fetch_stats.py:76-110`). Still pin the
16 TI rosters by account ID and treat `position_est` as fallback — but the fallback is now
a real field rather than a guess.

---

## 0.2 — What is genuinely missing: **watchers and lotuses. Only.**

Full-payload regex hunt across the match JSON:

| Term | Result |
|---|---|
| `watcher` | **NO HITS** |
| `lotus` | only `lotus_orb` / `recipe_lotus_orb` — the item, not the objective |
| `tormentor` | no field, but **`CHAT_MESSAGE_MINIBOSS_KILL` objectives carry `player_slot`** |
| `madstone` | `item_uses.madstone_bundle` — values 2–74 across the ten players |
| `fury` | NO HITS |

So the replay-parsing residue is **two stats** (watchers, lotuses), not the spec's four,
plus one credit-semantics fix on tormentors.

`madstone_bundle` is the leading candidate for Безумруди and is now *more* plausible than
the prior art judged it: the observed spread (74, 64, 55, 39, 28, 23, 21, 14, 14, 2) is
strongly rank-correlated with farm priority, which is how a gem-collection stat should
behave. Still unconfirmed — validate against a real in-client number before shipping it.

Objective event shapes, for the derivation:

```json
{"time":1242,"type":"CHAT_MESSAGE_MINIBOSS_KILL","team":3,"slot":9,"player_slot":132}
{"time":176, "type":"CHAT_MESSAGE_FIRSTBLOOD","key":"4","slot":8,"player_slot":131}
{"time":2103,"type":"CHAT_MESSAGE_ROSHAN_KILL","team":2}
{"time":398, "type":"CHAT_MESSAGE_COURIER_LOST","team":3,"value":35,"killer":3}
```

Note Roshan and courier events identify only a **team**, not a player — but per-player
`roshans_killed` and `courier_kills` exist, so use the flat fields for those and the
objective log only for tormentors and first blood.

---

## 0.3 / 0.4 — STRATZ is not needed, and could not have done the job anyway

| Probe | Result |
|---|---|
| `match(id: 8943477775)` | Known. Returns `leagueId`, `seriesId`, `clusterId: 413` |
| `replaySalt` | **null on 10/10 matches tested** |
| `parsedDateTime` | **null on 10/10** — STRATZ had not parsed any TI match yet |
| `league(id: 19719)` | **returns `null`** despite `match.leagueId` being 19719 |
| `MatchPlayerType` introspection | 55 fields; **zero** hits for lotus / watcher / tormentor / madstone / stun / teamfight / smoke / camp / rune / courier / roshan / observer / sentry |
| Rate limit | 15,000/day, 150/minute — ample |

**This contradicts the spec's "Resolved" section**, which marks
"STRATZ exposes `replaySalt` + `clusterId` → no Steam GC needed" as settled on the strength
of a 2024-08-25 schema mirror. The field exists; it is null in practice, at least while a
match is fresh. The spec's own caveat — "this confirms the fields existed in Aug 2024, not
that they exist today" — was well placed.

The introspection also confirms the 2024 mirror's audit still holds exactly: STRATZ has
added **nothing** in two years for any of the missing stats. It was never going to be the
source for them.

> **Correction to a measurement made earlier in this session:** a first batched STRATZ
> query aliased a field onto a field (`query { matches: m0: match(…) … }`), which is invalid
> GraphQL and returned nothing — making all 29 matches *appear* to have null salt and null
> cluster. The table above is the re-run with a valid query. The conclusion is unchanged for
> salt and parse state, but `clusterId` is in fact **413 on every match**, not absent.

---

## Replay acquisition: **blocked, and not for the reason the spec expects**

OpenDota supplies everything needed, on the match object:

```json
"cluster": 413,
"replay_salt": 2113524684,
"replay_url": "http://replay413.dota2.com.cn/570/8943477775_2113524684.dem.bz2"
```

Salt present on **10/10** matches — so *OpenDota, not STRATZ, is the salt source*, and the
spec's fallback ladder (OpenDota `/api/replays` → Steam Game Coordinator) collapses to
"read one more field off the match you already fetched."

But the download itself fails:

- `http://replay413.valve.net/570/…meta.bz2` → **403 Forbidden** (238-byte Valve error page)
- same for `.dem.bz2`, with and without a `Range` header
- OpenDota's own `replay413.dota2.com.cn` URL → DNS/connection failure from here

**Cluster 413 is a China cluster**, and every one of the 29 matches probed is on it. The
`replay{n}.valve.net` pattern the spec is built around does not serve it.

This is a genuine unknown rather than a solved problem: it may be geo-restriction, it may
be that this cluster only ever serves from the `.com.cn` host, and it may differ for
playoff matches on other clusters. **It does not block v1**, because the only stats that
need replays are watchers and lotuses. It does mean the "park the `.dem.bz2` as a hedge"
idea in the plan cannot currently be executed for these matches — worth knowing now rather
than in September.

---

## Latency and quotas

- **OpenDota parse coverage: 29/29 (100%)**, including a match that had started 12:50 UTC
  and was already parsed when probed. Parse lag is short enough that a 15-minute cron is
  not the bottleneck.
- **This settles spec open item 5 (trigger choice): Option A, Actions cron alone.** A
  Cloudflare Worker buys nothing when the upstream parse is the long pole.
- OpenDota free tier (no key) served ~60 requests in this session without a 429. The
  documented free limit is roughly 60/min and ~2,000/day; TI runs ~15 matches/day, so an
  API key is unnecessary. Keep the 1.1 s pacing used in the probes.
- STRATZ: 15,000/day, 150/min.

---

## Test fixtures committed

`test/fixtures/` holds a **complete Bo3**, series `1130069`, deliberately chosen over a
single map so that series grouping and best-2-of-3 selection are exercisable offline:

| Game | Match ID | Duration | Radiant win | Size |
|---|---|---|---|---|
| 1 | 8943267925 | 45 min | true | 0.40 MB |
| 2 | 8943364918 | 51 min | false | 0.43 MB |
| 3 | 8943477775 | 95 min | true | 0.59 MB |

All three `has_parsed: true`. Teams 9247354 vs 9572001. Rosters: Sneyking, skiter,
Malr1ne, AMMAR_THE_F, Cr1t- / Satanic, Noticed, No[o]ne-, 9Class, Dukalis.

`series-1130069.index.json` is a small derived summary (per-game metadata, salts, rosters,
`lane_role` and `position_est` per player) for assertions that shouldn't re-read 1.5 MB.

The 95-minute game 3 is a useful outlier — long games skew every per-map stat and are
exactly where a rate-vs-total confusion in the scoring engine would show up.

---

## Net effect on the plan

| Spec assumption | Reality |
|---|---|
| Teamfight must be derived from event clustering; validate before anything else | **Free from OpenDota.** Risk item deleted |
| Four stats need replay parsing | **Two** (watchers, lotuses) + tormentor credit fix |
| STRATZ is the primary source, `seriesId` mandatory from it | OpenDota has `series_id`; STRATZ optional |
| STRATZ supplies `replaySalt` → no Steam GC | **Salt is null on STRATZ.** OpenDota supplies it |
| Replay download from `replay{cluster}.valve.net` | **403 on cluster 413.** Unsolved, v2 problem |
| Trigger A vs B undecided | **A.** Upstream parse lag dominates |
| Banner is 9 emblems | 9 in groups, **15 in playoffs** (site-repo concern) |

**v1 needs no replay pipeline.** Build ingest on OpenDota alone.
