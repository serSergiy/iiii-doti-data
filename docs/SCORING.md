# Scoring & display spec — for the interface repo

Everything the UI needs to turn this repo's data into a banner score. Self-contained: you
should not need to read `FINDINGS.md` to implement against this, though that file carries
the evidence behind every claim here.

Every rule below is **verified against a real in-client banner**, not inferred. Where
something is unverified it says so explicitly.

---

## 1. Data

Fetch over HTTPS, CORS is open (`Access-Control-Allow-Origin: *`), cached 10 min.

```
https://sersergiy.github.io/iiii-doti-data/data/stats.json   the dataset
https://sersergiy.github.io/iiii-doti-data/data/meta.json    version, counts, coverage
```

`stats.json`:

```jsonc
{
  "v": 1,
  "leagueId": 19719,
  "generatedAt": "…",
  "columns": ["matchId","accountId",…],   // row field order
  "unsourced": [],                          // nothing is unconditionally null now
  "replayDerived": ["lotus","watcher","madstone"], // null unless that match's replay is parsed
  "unvalidated": { "<col>": "why to distrust it" },
  "players": { "<accountId>": { "name": "…", "teamId": 0 } },
  "matches": { "<matchId>": {
      "seriesId": 0, "seriesType": 1, "gameNo": 1,
      "seriesGamesPlayed": 3, "seriesGamesPossible": 3,
      "duration": 0, "radiantWin": true, "status": "ok",
      "titleFlags": { … }                  // see §5
  }},
  "rows": [[ … ]]                          // one per player per map
}
```

`status` is `ok` / `remade` / `unparsed` / `pending` / `failed`. **Only `ok` maps have
rows.** Show the others as an explicit state, never as a zero.

Repo-side reference data, if you want it in the UI:
`config/coefficients.json`, `config/hero-pools.json`, `config/titles.json`.

---

## 2. The formula

```
emblemPoints = SUM over the 2 counted maps of
                 [ SUM over the role's players of ( stat × prefixMult(player, map) ) ]
                 × suffixMult(map)
               × coefficient
               × emblemPercent

roleScore    = SUM of the role's 3 emblemPoints  ÷  number of players in the role
bannerScore  = SUM of the 3 roleScores
```

Three things that are easy to get wrong, all of them confirmed:

- **The prefix is per player per map.** It multiplies only the qualifying player's
  contribution, because it depends on the hero *that player* picked in *that game*.
- **The suffix is per map.** It multiplies the whole map term.
- **The ÷ player count produces the role score.** Core and support are 2, mid is 1. The
  emblem number the client *displays* is the undivided sum.

### Worked example — verified to the cent

Banner `Crimson Elleyer the Clutch`, support = tOfu + Boxi, one counted map
(Liquid vs Vici game 1). Crimson is +6% on a red-pool hero; Boxi played Clockwerk (in the
pool), tOfu played Winter Wyvern (not). The Clutch suffix cannot fire in game 1 (§5).

```
runes      5 + 12×1.06 = 17.72000 × 141  × 3.00 = 7495.56    client 7495.56
teamfight  0.5385 + 0.7949×1.06   × 2124 × 1.30 = 3813.29    client 3813.29
```

And the whole banner:

| role | Σ emblems | ÷ n | client |
|---|---|---|---|
| CORE (2) | 26 660.57 | 13 330.28 | 13 330.28 |
| MID (1) | 12 558.39 | 12 558.39 | 12 558.39 |
| SUPPORT (2) | 15 690.63 | 7 845.32 | 7 845.31 |

---

## 3. Coefficients — official

From the in-game glossary, in `config/coefficients.json`. All 18 match the previously
reverse-engineered table exactly, so they can be trusted.

| stat | coef | | stat | coef |
|---|---|---|---|---|
| kills | 107 | | obsPlaced | 117 |
| deaths | 1950 base, −195 each | | campsStacked | 234 |
| creepScore | 3 | | runePickups | 141 |
| gpmX2 | 2 | | watchers | 147 |
| madstone | 13 | | lotuses | 176 |
| towerKills | 352 | | smokesUsed | 293 |
| roshanKills | 1172 | | stuns | 10 (per second) |
| teamfight | 2124 (MAX, ×fraction) | | tormentor | 879 |
| courierKills | 703 | | firstBlood | 1934 |

Two shapes are not per-unit:

- **deaths** — `1950 × (maps × players) − 195 × deaths`, then the multipliers. **Never
  clamp at zero**; the game lets a role go negative.
- **teamfight** — a 0..1 participation fraction scaled to the 2124 cap, not a rate.

### Emblem percent is FLOORED to 10

The client shows `210%` when the true multiplier is `216.66%`. So **you cannot reproduce a
client number from the displayed percent** — it only gives a lower bound. When comparing
against a screenshot, test membership in `[shown, shown+10)` rather than equality.

---

## 4. Slot colours

Fixed by role, never rerolled. Confirmed on every observed banner.

```
group stage (3 slots)      playoff (5 slots)
core     red green red      red green red green red
mid      red blue green     red blue green red green
support  blue green blue    blue green blue green blue
```

A slot only accepts a stat of its colour. Red: kills, deaths, creepScore, gpmX2, madstone,
towerKills. Blue: obsPlaced, campsStacked, runePickups, watchers, lotuses, smokesUsed.
Green: roshanKills, teamfight, stuns, tormentor, courierKills, firstBlood.

---

## 5. Title

### Prefixes — `config/hero-pools.json`

Eight pools, all hero-conditional. A player gets the bonus on a map if the hero they
played is in the banner's pool.

| pool | bonus | | pool | bonus |
|---|---|---|---|---|
| Кармазиновий crimson | +6% | | Золотий golden | +8% |
| Лазурний azure | +11% | | Елементальний elemental | +8% |
| Смарагдовий emerald | +6% | | Потойбічний otherworldly | +7% |
| Королівський royal | +10% | | Героїчний heroic | +9% |

**The pools overlap.** 123 of 127 heroes are in at least one; Batrider and Muerta are in
four. Only the banner's own prefix applies. (The original spec claimed five colours with no
overlap — that is wrong.)

Map hero → pool via `config/hero-localized.json`. Two client names differ from OpenDota's:
`Ringmaster` → `Ring Master`, `Outworld Destroyer` → `Outworld Devourer`.

### Suffixes — `config/titles.json`

Per-map conditions. Computable ones are precomputed per map in
`matches[id].titleFlags`:

| suffix | bonus | condition | flag |
|---|---|---|---|
| Вирішайло | +16% | last **possible** game of the series | `lastPossibleGameOfSeries` |
| Спритник | +24% | game under 25 min | `durationUnder25min` |
| Терпеливець | +23% | no first blood before 10:00 | `noFirstBloodBefore10min` |
| Послушник Біл. Близнюків | +9% | first blood before the horn | `firstBloodBeforeHorn` |
| Нещасливець | +6% | the player's team lost | derive per player |
| Щасливчик | +21% | duration "ends in 8" | `durationSecondsEndIn8` — **ambiguous**, two readings emitted |
| Страдник | +23% | someone died to a tormentor | not computed |
| Кат | +13% | killed at own fountain | **not computable** — mark unsupported |

**`lastPossibleGameOfSeries` means the last game the series *could* have reached**, not the
last one played. A Bo3 that ends 2-0 never reaches game 3, so Вирішайло never fires for it.
That single rule is why a mid banner often reads exactly ×1.000000.

### Stacking

Unresolved: whether prefix and suffix add (`1+p+s`) or multiply (`(1+p)(1+s)`) when both
fire on one map. No observed banner has had both fire together. Pick one, and surface it as
an assumption.

---

## 6. Map selection

**Only the 2 best maps of the best series count, chosen PER BANNER** — so different roles
on one lineup may count different series.

Implementation: for each role, enumerate every pair of maps within each series the role's
players appeared in, score the banner over each pair, take the maximum. The search space is
tiny (a handful of series × 3 pairs).

**Selection must be redone for every counterfactual**, because which series wins depends on
the emblems being scored. This is the "selection, not a sum" point from the spec.

A 2-0 series offers exactly one pair, so best-2-of-3 is a no-op there.

---

## 7. Display rules

These are correctness requirements, not styling.

- **`null` ≠ `0`.** Any column in `stats.json.unsourced` is always `null` and means *we have
  no data*. A real zero means *played and scored nothing*. Render them differently; never
  coerce null to 0. A real banner has been observed with a whole role at 0.00.
- **Badge `stats.json.unvalidated`.** Those mappings are real numbers whose definition has
  not been confirmed against a client score. Do not present them as settled.
- **Show non-`ok` maps explicitly** — `remade`, `unparsed` — rather than silently dropping
  them. An `unparsed` map should mark the series provisional, not score zero.
- **Never clamp deaths at zero.**
- **State that the tool is unofficial** and reverse-engineered, and offer a mismatch-report
  link. Coefficients and hero pools are official; the *arithmetic* around them was derived.

---

## 8. Known gaps

| stat | state |
|---|---|
| **watchers, lotuses, madstone** | **NOW SHIPPING**, from the game's own counters in the replay (`m_iWatchersTaken`, `m_iLotusesTaken`, `m_nAcquiredMadstone`). Validated: watchers reproduce banner-derived ground truth exactly (tOfu 5, Boxi 7), and `m_iLastHitCount` matches OpenDota on all 20 player-maps checked. Present only for matches whose replay is parsed — see `stats.json.replayDerived` and `meta.json.coverage`; currently ~0.48 of rows. `null` elsewhere, never 0. |
| prefix/suffix stacking | see §5 |
| Щасливчик digit | two readings emitted; pick one when a banner settles it |
| Кат | uncomputable, mark unsupported |

Note the published `stats.json` currently covers **more matches than we hold replays for**,
so replay-derived columns will populate only for the subset with replays. Check
`meta.json.coverage` per column rather than assuming.
