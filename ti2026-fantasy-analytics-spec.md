# TI 2026 Fantasy Analytics — Task Spec

## Goal

A **public** retrospective analytics tool for Dota 2 TI 2026 fantasy. Any visitor
configures their own banner through the interface; the tool then answers, against real
tournament results:

1. **Which series/maps actually counted** toward the score, per role.
2. **Per-emblem breakdown** — how many points each of the 9 emblems produced, per map.
3. **Did the title (prefix/suffix) trigger**, in which games, with evidence.
4. **Counterfactuals** — what would this banner have scored with different emblems,
   quality tiers/traits, a different title, or different players?
5. **Comparison** — diff two banners over the same match set.

**Hard requirement:** before any counterfactual is shown, the engine must reproduce a
known real in-client score exactly. Counterfactuals on an unvalidated engine are
worthless — and now wrong for every visitor, not just one.

**Design constraint:** no backend. Banner state lives in the URL, so the site stays a
static shell with zero server, zero database, and no user data at rest.

---

## Architecture

Two repos. No cloud storage, no database, no server.

```
data-repo (public)
  └── Action: STRATZ diff → parse replays → commit JSON
        │                    ▲
        │                    └── trigger: schedule (+ optional Worker dispatch)
        ▼
   GitHub Pages
        ▲
        │ fetch() at runtime
        │
  site-repo → Cloudflare Pages (static shell, manually deployed)
```

**Git is the state.** The Action derives its own queue: query STRATZ for the league match
list, diff against `data/matches/*.json` already committed, process whatever's missing.
No queue files, no markers, no locks, no race conditions. A failed run self-heals on the
next one because the diff is recomputed from scratch every time.

**The site is inert.** It's a static shell you deploy by hand when you change the *code*.
Data updates never trigger a rebuild.

### Trigger: pick one

| Option | Latency | Cost |
|---|---|---|
| **A — Actions cron only** | 15 min granularity, often 10–30 min late under load | Zero infrastructure |
| **B — + Cloudflare Worker** | ~2 min | A Worker whose only job is a POST |

Option A is sufficient for retrospective analytics. Choose B only if live in-progress
scoring becomes a requirement. If B: the Worker holds **only** a GitHub PAT
(`contents: write`) and fires `repository_dispatch` on a cron — nothing else. It never
touches STRATZ, never parses, never stores.

```js
await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/dispatches`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${env.GH_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ti-fantasy-worker',
  },
  body: JSON.stringify({ event_type: 'parse-replays' }),
});
```
Returns 204. `repository_dispatch` only triggers workflows **on the default branch** —
the workflow file must be merged to `main` first.

---

## data-repo

Public (unlimited Actions minutes). Runner: `ubuntu-latest`, 4 vCPU / 16 GB RAM / ~14 GB
disk — comfortable for Clarity.

```yaml
on:
  repository_dispatch:
    types: [parse-replays]
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch:

concurrency:
  group: parse
  cancel-in-progress: false

permissions:
  contents: write
```

**Never trigger on `push`** — the workflow commits, which would retrigger it in a loop.

**Keep the concurrency group.** Not for rate limits — for correctness. Two overlapping
runs compute the same diff, download the same replays twice, and then collide on push.

**One commit per run, and no commit when nothing changed.** Most runs will find nothing.
This keeps `git log` readable, which matters more than it sounds: when the engine
disagrees with your in-client score, `git log -p` shows exactly what data changed and
when. That's the debugging affordance you're buying by using git as storage.

Add `.nojekyll` at the repo root so Pages serves JSON without Jekyll processing.

### Run sequence

1. Query STRATZ for league match list (`id`, `seriesId`, `parsedDateTime`).
2. Diff against committed `data/matches/*.json`.
3. For each missing match: fetch STRATZ stats.
4. For each match needing replay-derived stats: resolve salt → download `.dem.bz2` →
   parse → discard the file.
5. Write `data/stats.json` (aggregate) + `data/matches/{id}.json` (per-match detail).
6. Commit once, push.

**Stream-download → parse → discard, one replay at a time.** Never commit `.dem` files —
a full TI is 6–10 GB compressed; the extracted stats are <300 KB.

Retry state lives in the committed per-match file: if a replay 404s (routine — uploads
lag match end), write a stub with `attempts` and `lastError`. After N attempts, mark
permanently failed so it stops consuming the daily Steam download quota.

### Output layout

- `data/stats.json` — flat player-match rows, ~15 numeric fields, ~100 KB gzipped for
  all of TI. The entire analytics dataset. Fetched on page load.
- `data/matches/{id}.json` — event-level detail for title-trigger evidence. Fetched
  lazily, only when a user drills into one specific match.

GitHub Pages sends `Access-Control-Allow-Origin: *`, so cross-origin fetch from
`*.pages.dev` needs no configuration. It also forces `Cache-Control: max-age=600` with no
override — fine here. Append `?t=${Date.now()}` for a manual refresh button.

---

## STRATZ ingest

**Endpoint:** `https://api.stratz.com/graphql`
**Headers:** `Authorization: Bearer <token>`, `User-Agent: STRATZ_API`
(the User-Agent is mandatory — 403s without it)

```graphql
league(id: $id) {
  matches(request: { take: 100, skip: 0 }) {
    id seriesId startDateTime endDateTime parsedDateTime
    didRadiantWin durationSeconds
    players {
      steamAccountId heroId isRadiant position isVictory
      kills deaths assists numLastHits numDenies
      goldPerMinute experiencePerMinute networth
      heroDamage towerDamage heroHealing
    }
  }
  nodeGroups { nodeGroupType nodes { id series { id matches { id } } } }
}
```

**`seriesId` is mandatory** — best-2-of-3 selection is impossible without it.

`endDateTime` populates within seconds of a match ending. `parsedDateTime` stays null
until STRATZ processes the replay; `stats` and `playbackData` are null alongside it — so
skip any match with a null `parsedDateTime` and pick it up on a later run.

Test whether `take: 100` survives with the nested `players` block; deep queries can hit
complexity limits. Drop to `take: 25` and paginate if so.

---

## Replay acquisition

**URL:** `http://replay{cluster}.valve.net/570/{match_id}_{replay_salt}.dem.bz2`
Also `{match_id}_{replay_salt}.meta.bz2` — smaller, lands earlier, use it to confirm
existence before pulling ~60 MB.

**Salt** — Valve removed `replay_salt` from the WebAPI years ago, so ignore any guide
describing that route.

**STRATZ exposes it.** Verified against the community schema mirror
(`TheAmazingLooser/STRATZ_Models`): `MatchType` carries `replaySalt` (`long?`) and
`clusterId` (`int?`). Both come back in the same query as everything else, so **no Steam
account and no Game Coordinator integration is required.**

Caveat: that mirror's last commit is **2024-08-25**, so this confirms the fields existed
in Aug 2024, not that they exist today. **Confirm live before building around it:**

```graphql
query { match(id: <any recent league match>) { id clusterId replaySalt parsedDateTime seriesId } }
```

Fallbacks if either field returns null:
1. OpenDota `GET /api/replays?match_id[]=X` → cluster + salt. Needs an API key; check
   whether it's free-tier or premium.
2. Steam Game Coordinator — `node-dota2` or ValvePython `dota2` + `steam`. Dota is F2P
   so a throwaway account works. Most robust, most setup. **Only build this if 1 fails.**

**Limits (fallback 2 only):** 100 downloads / Steam account / 24 h; 500 / IP / 24 h.
TI needs ~15/day. Actions runner IPs are shared across Azure tenants — treat 429 as
retryable, not fatal.

**Retention is finite and unpublished.** Download promptly; a bulk job after the
tournament risks finding group-stage replays already expired.

---

## Scoring engine (client-side, in site-repo)

Pure function:
`(stats, banner_config, title_config, series_context) → { total, per_emblem_breakdown, title_trigger_log }`

All five product questions fall out of one itemized breakdown from this function.

### Coefficients

Source: battlepass.ru, reverse-engineered and checked against the in-game glossary.
**Unofficial — validate against a real in-client score before shipping.**

| Red | | Blue | | Green | |
|---|---|---|---|---|---|
| Kills | 107 | Wards placed | 117 | Teamfight | 2124 |
| Deaths | 1950 − 195/death | Camps stacked | 234 | Stuns | 10 |
| Creeps | 3 | Runes | 141 | First blood | 1934 |
| GPM | 2 | Watchers taken | 147 | Tormentor kills | 879 |
| Безумруды | 13 | Lotuses | 176 | Roshan kills | 1172 |
| Towers | 352 | Smoke uses | 293 | Courier kills | 703 |

Emblem colour determines which banner slot a stat can occupy.

### Rules

- **Score is computed per map**, then aggregated.
- **Role score = average of both players on the role.** A stat only one of a pair can
  earn (first blood, Roshan, Tormentor, courier, tower) yields the role **half** its
  points.
- **Deaths emblem starts at 1950, −195 per death, and can go negative.** Do not clamp
  at zero — the game doesn't.
- **Quality tiers:** I +10%, II +30%, III +60%, IV +100%, V +150%.
- **Traits** multiply on top of the tier-adjusted emblem contribution. Fractal requires
  all three emblems at *different* tiers; Friendly requires all three Friendly.
- **Prefix** = hero-pool based. 127 heroes across five colours, no overlap; extracted
  from Dota 2 client files.
- **Suffix** applies to the whole game score. `Творец победы` (win the last possible game
  of a series) = +16%.
- **Series selection:** the best-performing series counts; within a Bo3 only the two best
  maps count. This is a **selection** problem, not a sum — and which series wins depends
  on the banner config, so selection must be redone for every counterfactual.
- **`Мучитель` suffix is uncomputable** — fountain kills are unavailable from any source.
  Mark unsupported in the UI.

### STRATZ schema coverage

Audited against the community mirror (`TheAmazingLooser/STRATZ_Models`, snapshot
2024-08-25). **Re-verify live** — the mirror is ~2 years stale and STRATZ may have added
fields since.

| Stat | STRATZ status |
|---|---|
| Kills, deaths, creeps, GPM, towers | Flat fields on `MatchPlayerType` — fine |
| Camps, runes, observers, sentries, smoke, roshan, courier, first blood | Present |
| **Stuns** | Only as `StunDuration` nested in `MatchPlayerHeroDamageTotalReportObjectType`, not a flat field. Definition likely ≠ game's |
| **Teamfight participation** | **Absent — zero schema hits** |
| Watchers, Lotuses, Tormentors, Безумруды | **Absent — zero schema hits** |

**Teamfight is the critical gap.** It is the highest-value stat in the whole coefficient
table (2124 base) and STRATZ has no equivalent — `imp` and `award` are proprietary STRATZ
metrics and are **not** the same thing. Participation must be derived from kill/death/
assist event clustering, and that definition will not match Valve's.

**Validate the teamfight stat before anything else in the engine.** If it can't be made
to match, every banner carrying a green teamfight emblem is unreliable, which is most of
them.

### Known API data-quality issues

Per battlepass.ru (who parsed 2,888 season replays because open APIs return the wrong
values for these four):

| Stat | API error |
|---|---|
| Watchers taken | Conflated with lamp presses; overstated ~1.5× |
| Безумруды | Counted as clusters not individual stones; understated 3× |
| Lotuses | ~20% of pickups missing |
| Tormentor kills | Credited to last-hitter; game credits **all** participants |

All other stats match the game one-to-one. Note the schema audit above suggests STRATZ
may expose **nothing at all** for these four rather than exposing them wrongly — either
way, replay parsing is the only route.

**Check first whether the banner actually rolls any of these.** If not, delete the entire
replay pipeline — step 4 of the run sequence and the whole Replay acquisition section
become dead code. Since the tool is public and any visitor can pick any stat, this
probably can't be dropped in production — but it can be deferred past v1.

**Cheap fallback:** three biases are scalar and directional — apply correction factors
instead of parsing. Tormentor is structural; heuristic = credit all five players on the
killing side. Try this before building the parser.

**Stuns** = seconds of any hard control: root, hex, sleep, taunt, cyclone, fear.
**Not** silence or slow. (Shadow Fiend is nonzero from Requiem's fear.)

### Counterfactual search space

Precompute `raw[player][match][stat]` once on load; each config is then a weighted sum
plus a re-selection pass.

- Lineups: ~16 core pairs × 16 mids × 16 support pairs ≈ 4,096. Exhaustive.
- Emblem configs: larger, but each eval is cheap. Full sweep runs in milliseconds
  in-browser.

Cache derived artifacts (the matrix, sweep results) keyed by a data version string. Don't
bother caching raw JSON — 100 KB parses in ~1 ms.

**Run the sweep in a Web Worker.** Milliseconds on a laptop can be seconds on a
mid-range phone, and a frozen UI mid-interaction reads as a broken site. Not optional
for public traffic.

---

## Banner input (public UI)

### Interface

Full banner setup through the UI — no URL editing, no JSON pasting:

- **3 role banners** (Core pair, Mid, Support pair), each with **3 emblem slots**.
- Per slot: **stat** (constrained to the slot's colour — red/blue/green, see coefficient
  table), **quality tier** (I–V), **trait**.
- **Title**: prefix + suffix dropdowns.
- **Player picks**: Core and Support are pairs from the *same team*; Mid is one player.
  16 teams → ~16 options per role.
- Live recalculation on every change. No submit button.

### URL as state

Encode the full banner into the query string and update it via `history.replaceState`
on change:

```
yoursite.com/?b=A7xK2mQ9pLv3nR8t
```

9 emblems × (stat, tier, trait) + prefix + suffix + 3 role picks packs into ~15 bytes →
~20 chars base64url. This is what keeps the site static: links are shareable, results
bookmarkable, nothing stored server-side, no abuse surface, no moderation, no GDPR
question.

**Version the encoding** (leading byte or `v` param). The scheme will change once the
hero/trait lists are finalised, and old shared links must not silently decode into a
different banner. Unknown version → show a clear message, don't guess.

`localStorage` as convenience only — restore the last banner for returning visitors.
Never as the source of truth; the URL always wins when present.

### Comparison mode

Second banner via a second param (`?b=...&c=...`). Both decode through the same path.
This covers "compare with other players' choices" without a backend — users share links.
A server-side leaderboard (write endpoint + database + Turnstile + moderation) is out of
scope unless a real leaderboard becomes a requirement.

### Credibility

- State plainly on the page that the formula is **reverse-engineered and unofficial**.
- Provide a "my real score was X, the tool said Y" report link (GitHub issue or Telegram).
  Zero backend, and mismatch reports from strangers are the best calibration data
  available.

---

## Edge cases

A single author's banner avoids these; a thousand strangers' banners will not. Each needs
a defined display, never `NaN` or a blank:

- **Substitute played instead of the picked player** — points for whom?
- **Picked player never fielded** (stand-in benched all tournament) → zero, shown as an
  explicit state, not an empty cell.
- **Player with zero maps in the dataset** — e.g. a returning pro with no season history.
  Distinguish "played, scored 0" from "no data".
- **Team eliminated in groups** → fewer series available for best-series selection.
- **Forfeited / cancelled / remade maps** — excluded, but say so in the breakdown.
- **Bo3 that ended 2–0** → only two maps exist; best-2-of-3 selection is a no-op.
- **Unparsed match** (`parsedDateTime` null at page load) → mark the series provisional
  rather than scoring it as zero.
- **Deaths emblem driving a role negative** — display honestly; the game doesn't clamp.

---

## Validation plan

1. Enter a real banner + title, run over real TI matches.
2. Diff against the actual in-client score. Iterate until it matches **to the point**.
3. Reproduce a *second* person's score with a *different* banner — guards against
   coefficients overfitted to one configuration. **Mandatory for a public tool**: the
   first banner validating alone proves almost nothing about strangers' configurations.
4. Only then enable counterfactual output.
5. Keep validating after launch via the mismatch report link — treat a confirmed
   mismatch as a P1 bug, since the tool's only asset is being right.

---

## Resolved

- [x] **STRATZ exposes `replaySalt` + `clusterId`** on `MatchType` → no Steam GC needed
      (confirm live; mirror snapshot is 2024-08-25)
- [x] **`seriesId` and `parsedDateTime` confirmed** on `MatchType`
- [x] **STRATZ has no teamfight-participation field** — must be derived; `imp` / `award`
      are proprietary and not equivalent
- [x] **Stun duration exists** but nested in the hero-damage report, not flat

## Open — resolve before building

Ordered by how much they change the design:

1. [ ] **Live schema check.** One query confirming `clusterId`, `replaySalt`,
       `parsedDateTime`, `seriesId` are non-null on a recent league match. Also check
       whether watchers/lotuses/tormentors have been added since the 2024 snapshot.
       *Outcome: deletes or keeps the entire replay pipeline.*
2. [ ] **Teamfight definition.** Derive from kill/assist event clustering, validate
       against a real in-client score. *Outcome: determines whether the highest-value
       stat in the game is trustworthy.*
3. [ ] **Multiplier stacking order.** Are prefix/suffix additive or multiplicative with
       tier/trait? Verify empirically against a known score.
4. [ ] **Best-series selection scope** — per player, per role, or per banner?
5. [ ] **Trigger decision** — Worker (~2 min) vs Actions cron alone (15 min, often late).
       Cron alone is sufficient for retrospective analytics.
6. [ ] Trait definitions and prefix hero lists (dump from Dota 2 client VPK)
7. [ ] Whether OpenDota `/replays` is free-tier or premium-only (only if item 1 fails)

## Build order

Group stage starts **13 Aug 2026**. Replay retention is finite and unpublished, so data
not captured during the tournament may not be capturable afterward.

1. **Ship the Action first**, even with no scoring engine. Commit STRATZ data from day
   one. The engine can be built against a growing dataset; it cannot be built against
   one that has expired.
2. Add replay parsing for the four missing stats once ingest is stable.
3. Build the scoring engine and validate against real scores.
4. Build the public UI last — it is ordinary web work and depends on everything above.

## Reference

- `battlepass.ru/ti2026/fantasy-calc` — coefficients, rules, API-bias findings
- `github.com/TheAmazingLooser/STRATZ_Models` — auto-generated schema mirror, useful for
  offline field lookup; check the last-commit date before trusting it
- `https://api.stratz.com/graphiql` — live introspection
- Cross-check output against bydoodle, ti2026calculator.com, dota2.tools;
  disagreement is a cheap bug detector
