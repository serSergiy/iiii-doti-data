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

## CORRECTION (2026-08-13, later the same day): replays ARE downloadable

The section below concluded replay download was blocked. **That was wrong**, and the error
was mine: I tested `replay413.dota2.com.cn` with Node's `fetch`, which fails on that host
in this environment, and treated one failing client as proof the host was unreachable.
`curl` downloads from it fine.

```
http://replay413.valve.net/570/…      -> 403 Forbidden   (correct in the section below)
http://replay413.dota2.com.cn/570/…   -> 200 OK          (works; Node fetch cannot, curl can)
```

All **29 replays downloaded, 3.1 GB**, every one verified. Two further surprises:

- **The payload is zstd, not bzip2**, despite Valve still naming the file `.dem.bz2`.
  Magic bytes are `28 b5 2f`; `bzip2` fails with "bad magic value". Decompressed, it is a
  normal `PBDEMS2` Source 2 demo.
- Replays are **74–195 MB** each, not the ~40 MB first estimated (that measurement was
  taken against a file still being written).

Parser toolchain: **manta v1.5.0**. v1.4.0 fails immediately on 2026 replays with
`unable to find new baseline`. No Go toolchain is needed on the host — `scripts/parse-replays.sh`
runs it in Docker.

### What the replay recovers

| Stat | Source | Status |
|---|---|---|
| **Watchers** | `ability_capture` combat-log events | **RECOVERED**, per hero |
| Lamps | `ability_lamp_use` | Recovered — emitted so the API conflation is measurable |
| **Madstones** | `item_madstone_bundle` ITEM events | **RECOVERED**, per hero |
| Tormentor kills | `npc_dota_miniboss` DEATH, killer | Recovered (last hitter) |
| Tormentor participation | heroes damaging a tormentor that then died | Recovered, **but see caveat** |
| **Lotuses** | — | **NOT RECOVERABLE from the combat log.** No lotus pickup event exists; the only lotus strings are `item_lotus_orb`, an unrelated item. Would need entity-level work on `CDOTA_BaseNPC_LotusPool` |

**Critical attribution gotcha:** use `attacker_name`, **not** `damage_source_name`. The
latter is only meaningful for damage events and resolves to `dota_unknown` for every
ability cast — which initially made it look as though capture/lamp/madstone events carried
no player attribution at all. They do.

### Cross-check results

**Madstones agree exactly: 80/80 player-maps**, OpenDota `item_uses.madstone_bundle` vs the
replay's own combat-log count. The two are measuring the same event. That does *not* prove
the event is Безумруди — it proves the count is trustworthy, so the remaining question is
purely one of naming, answerable against a real in-client score.

**Watchers vs lamps: 45 vs 372** across the parsed maps. A source conflating them would
overstate watchers by **9.3×**.

> ⚠️ battlepass.ru reported the conflation as **~1.5×**, not 9.3×. That gap is unexplained
> and matters: either they measured a different source, or `ability_capture` is not the
> stat the game calls "watchers". **Do not treat the watcher mapping as settled** until a
> real in-client score confirms it. The madstone agreement above is much stronger evidence
> than this.

**Tormentor participation is under-counted and should not be trusted yet.** The damager
list came back with a single hero per tormentor kill, which is implausible for a real
tormentor fight. The combat log's own assist list (`assist_players`) is empty for miniboss
deaths, so participation has to be derived from damage events, and the current derivation
is evidently missing most of them. Unresolved.

---

## Replay acquisition: superseded — see the correction above

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

## Calibration against real in-client banners (2026-08-13)

Two banners transcribed from client screenshots, in `test/fixtures/banner-observation-*.json`.
Run `node scripts/calibrate.mjs <fixture>`.

### The mid banner reproduces EXACTLY

Banner 2 (Mr.Morale), ЦЕНТР = gpk~. Two independent emblems, both exact, from the **same
two maps** (`8943202720` + `8943357930`, series 1130060):

| Emblem | Raw total | × coef | × shown % | = | Client |
|---|---|---|---|---|---|
| РАХУНОК КРІПІВ | 1303 creeps | ×3 | ×3.20 | **12508.80** | 12508.80 |
| ПРИГОЛОМШЕННЯ | 86.00068 s | ×10 | ×3.00 | **2580.02** | 2580.02 |

This single result confirms, all at once:

1. **Creep coefficient = 3** and **stun coefficient = 10** — the battlepass.ru table is
   right at least here, and it was explicitly unofficial.
2. **Displayed percentages are exact**, not rounded. 320% is 3.20.
3. **Best 2 maps within ONE series**, not best 2 overall — gpk~'s highest-CS maps are not
   the ones that counted.
4. **All emblems on a banner share the same counted maps.** Creeps and stuns resolve to the
   identical pair. This matches the neighbouring project's independent conclusion.
5. **OpenDota's `stuns` IS the game's stun definition.** The spec warned it "likely ≠
   game's"; it matches to five decimal places. That worry is retired.

### The title is not a flat banner multiplier

Σ emblems vs the client's role total, on both banners:

| Role | Banner 1 (serSergiy) | Banner 2 (Mr.Morale) |
|---|---|---|
| ОСНОВА (pair) | ×1.161886 | ×1.322016 |
| **ЦЕНТР (solo)** | **×1.000000 exact** | **×1.000000 exact** |
| ПІДТРИМКА (pair) | ×1.199148 | ×1.336835 |

Mid is exactly 1.000000 on both, while the two *pair* roles are >1 and differ from each
other within the same banner. A flat title multiplier cannot produce that. Whatever the
uplift is, it is **absent for a solo role and varies per pair role** — which is why mid is
the clean calibration target and why the engine must not model prefix/suffix as a constant.
Bears directly on spec open item 3, which asks whether prefix/suffix are additive or
multiplicative with tier/trait; both framings assume a banner-level constant.

> Not yet explained. Two banners is enough to see the pattern, not enough to derive the
> rule. Banner 2's title was cropped out of the screenshot, which would have helped.

### Displayed percentages are FLOORED to the nearest 10 — and that retracts the table below

A third banner supplied the decisive control: **the same player (Nisha), the same stat
(towers), at a different displayed percentage.**

```
banner 1   270%  ->  3868.13     /2.70 /352  =  4.0700
banner 3   250%  ->  3520.00     /2.50 /352  =  4.0000   <- exactly 4
```

If Nisha killed 4 towers in both, banner 1's true multiplier is `3868.13 / (4 x 352)` =
**274.725%**, displayed as **270%**. So the client floors the percentage to the nearest 10.

**This invalidates the "REJECTED" verdicts in the next section.** They were computed by
treating the displayed percentage as exact, which makes any true multiplier of, say,
274.7% look like a non-integer unit count. Re-solved as a *range* — units in
`(score/((shown+10)/100)/coef, score/(shown/100)/coef]` — the rejections mostly dissolve:

| Stat | Coef | Solved units | Was |
|---|---|---|---|
| runePickups | 141 | **38** (unique, true 321.60%) | "rejected" |
| towerKills | 352 | **4** (unique, true 274.73%) | "rejected" |
| lotuses | 176 | **11** (unique, true 172.36%) | "rejected" |
| lotuses (banner 3) | 176 | **9** (unique, true 178.83%) | — |

Only `teamfight` still has no solution at coefficient 2124 — but teamfight participation is
a 0..1 *fraction*, so the integer/half-integer parity test does not apply to it at all.
That is a false negative of the method, not evidence against the coefficient.

**Lesson worth keeping:** never back-solve from a displayed percentage as if it were exact.
Solve for the interval. The three coefficients that survived the original test did so only
because their true multipliers happened to land exactly on a multiple of 10.

### LOTUSES SOLVED: `famango + great_famango + greater_famango`

```js
lotus = item_uses.famango + item_uses.great_famango + item_uses.greater_famango
```

The Lotus Pool yields **Famangos**. The fantasy stat counts those item uses — it is not an
objective event, which is exactly why every hunt for a "lotus" string in the combat log
failed, and why the replay was never going to have it. **It was in OpenDota the whole time.**

Confirmed under the tightest constraint available: **Aurora played exactly one series**, so
the two counted maps are forced and there is no map-selection freedom to fit against.

| Map | kaori | Mira | pair avg |
|---|---|---|---|
| 8943097729 | 7 | 9 | 8.0 |
| 8943171995 | 1 | 1 | 1.0 |
| | | **total** | **9.0** |

And the client's emblem back-solves to exactly **9.0 units at coefficient 176** (true
178.83%, floored to the displayed 170%). Coefficient 176 is confirmed, not rejected.

`lotus` now ships at **100% coverage** (510 across 290 player-maps). `UNSOURCED` is down to
`watcher` alone.

> **Not fully closed.** Banner 1's support pair (Cr1t- + Sneyking) needs 11.0 and their best
> available pair average is 5.5 — off by exactly 2x, which smells like a sum-vs-average or a
> missing-maps issue. None of banner 1's support emblems reconcile against our data, so the
> likeliest explanation is that its counted maps are not in the dataset. Aurora is the
> stronger evidence because its map selection is forced; banner 1 remains unexplained.

### Coefficient status after two banners — SUPERSEDED, see above

Because the title acts on the emblem **sum**, each emblem's displayed score is raw and
`score / (percent/100)` is a **coefficient-independent product** = `units × coef`. Where a
role is solo the unit count must be an **integer**; where it is a pair it must be a
**half-integer**, since the role score is the average of two players. That parity test
alone convicts or acquits a coefficient without knowing which maps counted.

| Stat | Coef | Units implied | Parity | Verdict |
|---|---|---|---|---|
| creepScore | 3 | **1303.0000** (solo gpk~) | integer | **CONFIRMED** |
| stuns | 10 | **86.0007** (solo gpk~) | float stat, matches maps exactly | **CONFIRMED** |
| kills | 107 | **12.5000** (pair Pure+33) | half-integer | **CONFIRMED** |
| runePickups | 141 | 38.1900 (**solo** Nisha) | not integer | **REJECTED** |
| towerKills | 352 | 4.0700 (**solo** Nisha) | not integer | **REJECTED** |
| obsPlaced | 117 | 28.5600 / 23.0500 (pairs) | not half-integer | **REJECTED** |
| tormentor | 879 | 2.7100 / 0.2675 (pairs) | not half-integer | **REJECTED** |
| **lotuses** | 176 | 11.1525 (pair) | not half-integer | **REJECTED** |

The solo rejections are the strongest: Nisha is one player, so 38.19 runes and 4.07 towers
are impossible at any map selection. Those two coefficients are simply wrong — or
OpenDota's `rune_pickups` is not the quantity the game counts (its own `runes` map sums to
a different number than `rune_pickups` on the same player, so this is live).

**The model is not in doubt — three emblems reproduce to the cent.** What is in doubt is
the battlepass.ru coefficient table, which was always flagged unofficial. It is right for
creeps, stuns and kills, and wrong or mis-mapped for the rest.

### Lotuses: cannot be confirmed, and 176 is probably wrong

Asked directly whether the support lotus number can be confirmed: **no.** There is no lotus
source anywhere — not the APIs, not the combat log — so the only fact available is the
product:

```
ЗІБРАНО ЛОТУСІВ  170%  ->  3336.83     raw x coef = 1962.84
```

With the unofficial coefficient 176 that is 11.1525 lotuses. For a *pair* that must be a
half-integer, and it is not — so **176 is inconsistent with the pair-average model**, which
is itself confirmed by the exact kills result. Candidate coefficients that would give clean
counts: 178.44 (11 lotuses), 170.68 (11.5), 163.57 (12).

Resolving this needs one of the two unknowns supplied independently: either a lotus count
from the client, or the true coefficient. Nothing in the current pipeline can supply either.

### ЗАХОПЛЕНО СПОГЛЯДАЧІВ: mapping RULED OUT, not resolved

gpk~'s third emblem reads **0.00** at 240%. Because the counted maps are now proven, any
correct mapping must total exactly 0 across them. Measured over those two maps:

| Candidate | Total | Verdict |
|---|---|---|
| observer_kills + sentry_kills (dewards) | 5 | ruled out |
| observer_kills alone | 3 | ruled out |
| sentry_kills alone | 2 | ruled out |
| `ability_capture` (replay) | 2 | **ruled out** |
| `ability_lamp_use` (replay) | 4 | ruled out |

**This retracts the earlier claim that `ability_capture` recovers the watcher stat.**
`ability_capture` is almost certainly *outpost* capture — which independently explains the
8.2× vs battlepass.ru's 1.5× conflation ratio that did not reconcile. The real watcher
stat remains unidentified, and a zero-valued emblem can only rule mappings out, never
confirm one.

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
