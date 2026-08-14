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

## THE SCORING FORMULA — SOLVED (2026-08-14)

Reported by the user and then verified exactly against a real banner. Valve also **fixed a
bug** in which pair values were not divided, so banners captured before the fix follow a
different arithmetic than those after — that is why earlier observations in this file show
pair "multipliers" above 1 that no title could explain.

```
emblem points = SUM over counted matches of
                  [ SUM over the role's players of ( stat x (1 + prefix, if that player's
                                                              hero qualifies) ) ]
                  x (1 + suffix, if THAT MATCH qualifies)
                x coefficient x emblem percent

role score    = SUM of the role's emblem points  /  number of players in the role
```

Three structural facts, each of which I previously had wrong:

1. **The prefix is per PLAYER per MATCH** — it multiplies only the qualifying player's
   contribution, because it depends on the hero that player picked in that game.
2. **The suffix is per MATCH** — it multiplies the whole match term.
3. **The division by player count is the "divide by 2"**, applied to reach the role score.
   The emblem *display* is the undivided sum across both players.

### Verified exactly — Elleyer, support, after ONE match

Support = tOfu + Boxi (Team Liquid), counting only game 1 of Liquid vs Vici
(`8943091110`). Title `Crimson … the Clutch`: Crimson is +6% on a red hero, and the Clutch
suffix cannot fire in game 1 because it needs the last **possible** game.

```
runes      5 + 12 x 1.06 = 17.72000  x 141  x 3.00 = 7495.56   client 7495.56   EXACT
teamfight  0.5385 + 0.7949 x 1.06 = 1.38109 x 2124 x 1.30 = 3813.30   client 3813.29   EXACT
```

Two independent emblems agree that **Boxi** carried the red hero and tOfu did not. Nothing
was fitted: the coefficients are official, the percentages are the displayed ones, and the
only free choice was which of the two players took the +6%.

### This yields exact WATCHER ground truth

With the formula and the prefix assignment both pinned, the watcher emblem
(`WATCHERS TAKEN 240% -> 4381.78`, coefficient 147) solves to a unique whole-number pair:

```
a + 1.06b = 12.42   ->   tOfu = 5,  Boxi = 7      (b is Boxi, who holds the prefix)
```

The replay for that same match reports **lamp clicks of 7 and 11**. So:

| player | `ability_lamp_use` clicks | watchers actually credited |
|---|---|---|
| tOfu | 7 | **5** |
| Boxi | 11 | **7** |

This is the first hard confirmation that a watcher is a **completed capture** and that the
click count overcounts — exactly as the official wording ("за **захопленого** споглядача")
says. It also hands the parser a target to hit: any completion-detection scheme must
produce 5 and 7 for these two heroes in match `8943091110`.

---

## COEFFICIENTS ARE OFFICIAL — all 18 confirmed (2026-08-14)

The in-client glossary screen was transcribed into `config/coefficients.json`. **Every one
of the 18 values matches the reverse-engineered battlepass.ru table exactly.** The spec's
standing warning that the coefficients are "unofficial — validate before shipping" can be
retired: they are correct.

**This inverts how every remaining discrepancy must be debugged.** With the coefficients
fixed and known-good, a banner we cannot reproduce is now proof of a fault in our **stat
mapping** or **map selection** — never in the coefficient. Previous sections that solved
*for* a coefficient (e.g. "coef that would fit") are therefore obsolete as method: the
coefficient is a given, and the unit count is the unknown.

### Definitions the glossary supplies, and what each one settles

| Stat | Official wording | What it settles |
|---|---|---|
| РАХУНОК КРІПІВ | "за останній удар **чи добивання**" | last hit **or deny** — confirms `last_hits + denies` |
| ЗНИЩЕННЯ ВЕЖ | "за **останній удар** по вежі" | last hit on the tower — confirms `towers_killed` |
| ПОСТАВЛЕНІ ВАРДИ | "за встановлений **оглядовий** вард" | **observer** wards only; sentries do not count |
| ПІДНЯТІ РУНИ | "за підняту **чи закорковану**" | picked up **or bottled** — see the shortfall below |
| ЗАХОПЛЕНІ СПОГЛЯДАЧІ | "за **захопленого** споглядача" | a **completed capture**, confirming that the lamp *click* overcounts |
| ПІДНЯТІ ЛОТОСИ | "за **піднятий** лотос" | per lotus **picked up** — so `item_uses` (eaten) was always the wrong shape |
| ПРИГОЛОМШЕННЯ | "за **секунду** приголомшення" | per second — matches OpenDota `stuns` to five decimals |
| УЧАСТЬ У БИТВАХ | "**Макс.** 2 124,00" | a 0..1 fraction scaled to a cap, not a per-unit rate |
| УБИВСТВА МУЧИТЕЛІВ | "за **вбивство** мучителя" | per **kill** — argues the last-hitter reading is right and "credits all participants" is wrong |
| ВИКОРИСТАНО ДИМІВ | "за **використаний** Дим омани" | no kill requirement — argues against the prior-art "only smokes used in a kill" theory |
| СМЕРТІ | "1 950 початково, -195 за смерть" | confirms the base-minus-per-death shape, and the game does not clamp |

Two mapping notes flipped from "uncertain" to "probably right" on this evidence
(tormentor = last hitter, smokes = every use), and two stayed blocked but got sharper: a
watcher is a **completed capture**, a lotus is a **pickup**.

### The rune shortfall is now a measurable defect, not a mystery

Nisha's banner needs **38** rune units at the official 141. His only day-1 series gives
**37** (`20 + 17`), and OpenDota's `rune_pickups` and its `runes` histogram sum identically
on every map — so neither field counts whatever the glossary means by "закоркована"
(bottled). **Short by exactly one.** That is the right size for a single bottled rune the
API does not record, and it is now a concrete thing to hunt in the replay rather than an
unexplained mismatch.

---

## Selection rule — CONFIRMED, and it answers spec open item 4

**A banner counts only the 2 best matches of its best series — and the best series is chosen
per banner, so different roles on the same lineup can count different series.**

Stated by the user 2026-08-14 and consistent with everything measured: gpk~'s counted maps
were pinned to one series by two independent emblems, and Dukalis + 9Class pinned to a
different series again.

This resolves the spec's open item 4 ("best-series selection scope — per player, per role,
or per banner?"). The answer is **per banner** (i.e. per role), not per player and not once
for the whole lineup.

Consequences that matter for the engine:

- Selection must be redone for **every** counterfactual, because which series wins depends
  on the emblems being scored. This is what the spec means by calling it a selection problem
  rather than a sum.
- The search space per role is small: for each series the player appeared in, every pair of
  its maps. That is what `scripts/calibrate.mjs` enumerates, which is why it can pin counted
  maps from a single confirmed stat.
- A pair role shares one selection across both players; a solo role has its own.
- **A 2-0 series still offers only one pair**, so best-2-of-3 is a no-op there — and that is
  exactly why Вирішайло never fires for a swept series.

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

### Title values are now OFFICIAL — `config/titles.json`

Transcribed from the in-client «ЗМІНИТИ ТИТУЛУВАННЯ» screen. Unlike the emblem
coefficients, these are stated by the game.

**Prefixes (Атрибути)** — all hero-pool conditional, per game: Кармазиновий +6% (red),
Лазурний +11% (blue), Смарагдовий +6% (green), Королівський +10% (purple), Золотий +8%
(yellow/brown), Елементальний +8% (water/fire/ice), Потойбічний +7% (undead/demon/spirit),
Героїчний +9% (cloak/mask). **None is computable yet** — every one needs a hero→colour/trait
pool that must come from the client VPK (spec open item 6).

**Suffixes (Звання)** — per-game conditional, and mostly computable:

| Suffix | Bonus | Condition | Computable |
|---|---|---|---|
| Вирішайло | +16% | last **possible** game of the series | **yes** |
| Спритник | +24% | game under 25 minutes | **yes** |
| Терпеливець | +23% | no first blood before 10:00 | **yes** |
| Нещасливець | +6% | player's team lost | **yes** |
| Послушник Біл. Близнюків | +9% | first blood before the horn | **yes** |
| Щасливчик | +21% | duration "ends in 8" | ambiguous — which digit |
| Страдник | +23% | someone dies to a tormentor | from replay |
| Кат | +13% | killed at own fountain | no — out of scope |

Every computable flag is now emitted per map in `data/matches/{id}.json` → `titleFlags`.
Across the 29 maps: Вирішайло fires on 5, Терпеливець 1, Послушник 1, Спритник 0.

### Вирішайло explains the x1.000000 mid — exactly

The condition is the **last possible** game, not the last game *played*. A Bo3 that ends
2-0 never reaches game 3, so the suffix can never fire for it.

Nisha's counted series ran **2-0**. Both his maps are game 1 and 2 of a possible 3:

```
8943091110  game 1/2 (possible 3)  Вирішайло: false
8943148045  game 2/2 (possible 3)  Вирішайло: false
```

Predicted role multiplier **x1.000000**; observed **x1.000000** on both banners carrying
that suffix. That is the mid mystery closed.

### Lotus coefficient 176 is WRONG — proved by a solo mid

A fifth banner (`muted(`) carries the decisive case: a **solo mid with a lotus emblem**.
Solo means the unit count must be a whole number, which needs no knowledge of map selection.

```
СБОР ЛОТОСОВ  240%  ->  2449.92     raw x coef in (980.0, 1020.8]
   at coef 176:  units in (5.568, 5.800]  ->  NO INTEGER EXISTS
```

So 176 cannot be the lotus coefficient regardless of which maps counted. Coefficients that
*would* admit an integer: ~(163.3, 170.1] for 6 lotuses, ~(140.0, 145.8] for 7, ~(196.0,
204.2] for 5. Narrowing further needs a real pickup count.

The same banner confirms **kills = 28 at coefficient 107** — the fourth independent
confirmation — and mid reads **x1.000000 for the fourth consecutive banner**.

It also shows an entire role scoring **0.00 across all three emblems** with no opponent
listed: the spec's "picked player never fielded / played but scored zero" edge case, live.
It must render as an explicit state, never a blank.

### SOLVED: lotus pickups are attributable, from the HERO's inventory

The question "could only 2 players have picked them?" was worth asking and is **cleanly
disproved**: in match 8943477775, **8 of 10 players used famangos**, while
`m_iPlayerOwnerID` was populated for only 2 ids. The counts do not line up either —
playerID 1 accumulated 28 entities while slot 1 used 3, and the biggest user (9Class, 14)
never appears. The field is unreliable, not sparse.

**The working route is the hero side.** A Source 2 entity handle carries the entity index
in its low 14 bits, so a famango can be matched to the hero whose inventory
(`m_hItems.NNNN`) it first enters:

```
famango entities seen: 43,  credited to a hero: 43   (100%)
```

Per hero on that map — and note this measures **acquisition**, not consumption, which is
the whole point. Necrolyte holds 5 greaters and ate **zero**, so `item_uses` could never
have counted them:

| hero | small | great | greater |
|---|---|---|---|
| Treant | 5 | 4 | 3 |
| Windrunner | 3 | 3 | 5 |
| Necrolyte | 0 | 0 | 5 |
| EarthSpirit | 1 | 2 | 1 |
| Lion | 3 | 0 | 0 |

Credit is taken once per entity, on first entry to any inventory, so merges do not
double-count.

### Lotus coefficient: narrowed to one reading, but that reading is suspect

With attribution working, the three plausible readings were tested against the support
banner whose maps are **pinned by stuns** (`8943267925 + 8943477775`), then cross-checked
against the solo-mid integer constraint. Only one survives both:

| Reading | Pair units | Implied coef | Integer for solo Malr1ne? |
|---|---|---|---|
| flat (all tiers) | 14 | (219.7, 232.6] | **no** — (4.21, 4.65] |
| small tier only | 7.5 | (410.0, 434.1] | **no** — (2.26, 2.49] |
| weighted 1/3/9 | 48 | (64.1, 67.8] | **yes — 15** |

Intersecting both constraints gives a coefficient of roughly **65.3 – 67.8** with Malr1ne at
15 lotuses.

> **But do not adopt this yet.** The weighted reading almost certainly **double-counts
> merges**: three smalls enter the inventory and are credited, then the Great they combine
> into is a *new entity* entering the same inventory and is credited again as 3 more. So
> "weighted" is inflated by construction, and its apparent success may be that inflation
> happening to land on an integer.
>
> The clean fix is to credit only entities entering from **outside** the inventory
> (ground/pool) and ignore merge products — which needs distinguishing a merge from a
> pickup, not yet done. Note too that Malr1ne's own maps are **not pinned** (see the anomaly
> below), so his integer constraint is itself resting on an unverified map selection.

### ANOMALY: a solo-mid banner that no map selection can reproduce

Banner 5's mid is Malr1ne, whose kills emblem solves to **28** (unique at coefficient 107).
Falcons played exactly six TI maps — verified against the team endpoint, not just the league
listing, and **re-verified after the dataset grew to 40 matches** (Falcons still have 6) —
with kills `7, 10, 12 / 11, 5, 15`. **No pair of maps sums to 28**; the maximum is 26, and no
best-2-within-a-series combination comes close. This is not a stale-data artifact.

So for this banner at least one of these must be false: coefficient 107, the
best-2-maps-within-one-series rule, or floor-to-10 on the percentage. Recorded unresolved
rather than fitted, because the same coefficient reproduced Pure+33 exactly on pinned maps
and the two results cannot both be right under one model.

### When do lotus entities appear? (answering the direct question)

Measured over one 95-minute match: **43 distinct famango entities**, of which **12 never
receive an owner at all**. Only 15 are small-tier creations. That is far too few for
timer-spawned map objects across a game of that length, so the item entity is minted when
the item comes into a player's possession rather than sitting on the map — the pool itself
is `CDOTA_BaseNPC_LotusPool`, a separate entity holding charges.

**But the picker is still not recoverable from the item.** Per *distinct entity* (the
earlier count was per entity-op, which inflated a long-lived item into many observations —
a real flaw in that measurement, though the conclusion survives): `m_iPlayerOwnerID` is set
for only **2 of 10 players**, and `m_hOwnerEntity` / `m_nOwnerId` / `m_hOwner` do not exist
on the class at all. The full field list contains no other owner candidate.

So the answer to "who picked them" is: **not on the item — it has to come from the hero.**
Track each hero entity's inventory (`m_hItems`) and credit the hero whose inventory a
famango handle first enters, counting the small tier only so merges do not double-count.

### Entity-level attempt on lotuses and watchers — partial

Following the user's two corrections (lotuses are *picked*, not eaten, and merge upward;
watchers are *clicked* but not taken until the channel completes), the combat log was
exhausted and the search moved to entity state.

**Settled by this pass:**

- `ability_lamp_use` targets **`npc_dota_lantern`** — it is the watcher interaction.
- `ability_capture` targets **`#DOTA_OutpostName_North`** — it is **outposts**, definitively
  not watchers. That mapping is now closed, not merely doubted.
- Both famango items and lanterns exist as entities: `CDOTA_Item_Famango` /
  `GreatFamango` / `GreaterFamango`, and `CDOTA_NPC_Lantern`.
- The combat log records famangos only as `ITEM` (use) and `HEAL` (effect) — never
  acquisition. So no combat-log route to collection exists, confirming the user's diagnosis.

**Blocked, with the reason measured rather than assumed:**

| Goal | Blocker |
|---|---|
| Lotus pickups per player | The item entity does not know its player. Over one match `m_iPlayerOwnerID` is the **constant 1 on 265 of 269** famango entities, and `m_hOwnerEntity` / `m_nOwnerId` / `m_hOwner` are nil on all 269. Only `m_iTeamNum` varies (2/3/4), so side is available and player is not. |
| Watcher completions | `CDOTA_NPC_Lantern.m_iTeamNum` sits at the neutral 5 and **never transitions** across a full match, so a completed capture does not flip team. The completion state is somewhere else. |

**Next step for lotuses, concretely:** track each hero entity's inventory array
(`m_hItems[0..N]`) and credit the hero whose inventory a famango handle first appears in.
Counting only the SMALL tier avoids double-counting merges, since three smalls are destroyed
to create a Great. Team-level totals are already available; only the join to a player is
missing.

### WATCHERS: found the emblem, still not the mapping

Banner 4 carries **СМОТРИТЕЛИ 280% -> 6931.34** — the first non-zero watcher emblem seen.
Target: **16.5 units** at coefficient 147 (unique under floor-to-10).

`ability_lamp_use` summed to exactly 16.5 on one candidate map pair — but stuns pins the
counted maps to a *different* pair, where nothing fits:

| Candidate | Units on pinned maps | Coef needed | Spec says |
|---|---|---|---|
| ability_lamp_use | 20.5 | 116.6 - 120.8 | 147 |
| ability_capture | 2 | 1195 - 1238 | 147 |
| capture + lamp | 22.5 | 106.2 - 110.0 | 147 |
| dewards | 13 | 183.9 - 190.4 | 147 |

None reaches 147, so either the coefficient is wrong too or the stat is something we do not
measure. The 16.5 lamp agreement was a coincidence on the wrong series — the same trap the
lotus mapping fell into.

**Method note worth keeping:** an exact numeric agreement means nothing until the counted
maps are pinned independently. Twice now a mapping matched on maps that a second emblem
later ruled out. Pin the maps first, then test the mapping.

### But the title CANNOT explain the pair uplifts — open problem

Banner 3's support is Aurora (kaori + Mira), who played **exactly one series, a 2-0 sweep**.
So Вирішайло cannot fire on either map, and the only bonus available is the prefix
Лазурний at **+11%**. Maximum achievable uplift: **x1.11**.

**Observed: x1.523511.** Upstream confirms no further Aurora matches exist (29 matches
total, unchanged), so this is not a stale-data artifact.

The pattern across all three banners is sharp and unexplained:

| | solo mid | pair core | pair support |
|---|---|---|---|
| Banner 1 | x1.000000 | x1.161886 | x1.199148 |
| Banner 2 | x1.000000 | x1.322016 | x1.336835 |
| Banner 3 | x1.000000 | x1.270048 | **x1.523511** |

**Solo is always exactly 1.0; pairs are always >1.** That correlation, plus a magnitude the
title table cannot reach, says the pair uplift is **not a title effect**. The leading
hypothesis is that a pair's emblem display and its role total are computed over *different
map selections* — e.g. the display shows one shared set while the total optimises per
player — which would be identically 1.0 for a single player. Untested.

Until this is resolved, **only solo-mid banners can be reproduced end to end.**

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

### LOTUSES: RETRACTED — the Aurora match was a coincidence

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

**A fourth banner refutes it.** Support = Dukalis + 9Class, and its counted maps are pinned
**independently by stuns** to `8943267925 + 8943477775` (125.502 units -> 227.32%, the only
pair in range for the displayed 220%). On those maps:

| Reading | Units | Coef needed | vs claimed 176 |
|---|---|---|---|
| famango flat | 11.5 | 267.4 - 283.1 | no |
| famango weighted 1/3/9 | 65.5 | 46.9 - 49.7 | no |

Neither is reachable, so the mapping is withdrawn. `lotus` is `null` again and `UNSOURCED`
is back to `['lotus', 'watcher']`. The raw count still ships as its own **`famango`**
column — it is real measured data and the true stat is probably a function of it — but the
data no longer asserts a mapping a pinned-map test refutes.

**Likely root cause, and it was the user's diagnosis:** `item_uses` counts lotuses **eaten**,
not **collected**. `purchase_log` confirms the merge mechanic — it records `great_famango`
and `greater_famango` acquisitions, i.e. three smalls combining upward. So a player who
collects nine and eats one greater shows `greater:1`. Collection has to come from **inventory
events in the replay**, which we have not parsed.

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
