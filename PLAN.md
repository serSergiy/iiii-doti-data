# Parsing project — step-by-step realization

Scope: **the data repo only.** The scoring engine and public UI live in site-repo and are
out of scope here. This repo's single job is: *produce a stable, correct, versioned JSON
dataset of per-player-per-map fantasy stats, committed continuously during TI 2026.*

Deadline pressure is real: group stage starts **13 Aug 2026** (today) and replay retention
is finite and unpublished. Capture beats correctness in the first 48 hours — raw data not
captured now may be uncapturable later, whereas a derivation bug can be fixed and replayed.

---

## Spec corrections found while surveying prior art

Three findings from `F:\Wovk\Statistics collector app Fantasy 2026` and
`F:\Wovk\iiii-doti-doti-doti` change design decisions in the spec. Confirm each in Phase 0
before committing to them.

### 1. Teamfight participation is NOT missing — OpenDota exposes it directly

The spec calls this "the critical gap… the highest-value stat in the whole coefficient
table (2124 base)" and orders it validated *before anything else in the engine*, on the
grounds that it must be derived from kill/assist event clustering.

That is true of STRATZ. It is not true of OpenDota. `tools/fetch_stats.py:127` reads
`p["teamfight_participation"]` as a plain float field off a parsed match, and the same
file uses its presence as the definition of "this match is parsed"
(`"parsed": p.get("teamfight_participation") is not None`). OpenDota computes it in its
own Clarity-based replay parser, so it is already a replay-derived number, not an API
estimate.

**Consequence:** if confirmed, this deletes the single largest risk item in the project.
We do not need to invent a teamfight definition, and we do not need our own replay parser
to get one. It also downgrades STRATZ from primary source to cross-check.

### 2. OpenDota covers almost the whole stat catalog, with mappings already solved

`tools/fetch_stats.py:114-165` is a working, cross-checked mapping. Several of these were
wrong on the first attempt and were corrected against an independent oracle — that
debugging is already paid for and should not be repeated:

| Stat | OpenDota field | Note |
|---|---|---|
| Kills, deaths, last hits, denies, GPM | flat fields | — |
| Towers, Roshan, courier | `towers_killed`, `roshans_killed`, `courier_kills` | — |
| Teamfight | `teamfight_participation` | 0..1 fraction |
| Stuns | `stuns` | seconds, float |
| Wards placed | `obs_placed` | — |
| Camps stacked | `camps_stacked` | — |
| Runes | `rune_pickups` | — |
| First blood | `firstblood_claimed` | bool |
| **Sentries captured** | `observer_kills` **+** `sentry_kills` | corrected 2026-08-01; observer-only read consistently low |
| **Smokes used** | `item_uses.smoke_of_deceit` | direction confirmed, magnitude runs 1.4–4.6× high vs oracle — definition may be "smokes used *in a kill*" |
| **Tormentor kills** | *not a field* — count `match.objectives` `CHAT_MESSAGE_MINIBOSS_KILL` by `player_slot` | asking for `tormentor_kills` silently returns 0. Credit semantics still wrong: we credit the last-hitter, the game credits all participants |
| Lotuses, Безумруди/madstones, watchers | **none found** | the only genuinely unsourced stats |

`item_uses.madstone_bundle` exists and is a *guess* at Безумруди — magnitude doesn't
obviously fit. Unconfirmed.

**Consequence:** the replay pipeline shrinks from "the whole stat catalog" to **three
stats plus one credit-semantics fix**. That is a v2 item, not a v1 blocker — exactly the
deferral the spec hoped for under "Check first whether the banner actually rolls any of
these."

### 3. Playoff banners have FIVE emblems, not three

The spec assumes 9 emblems (3 banners × 3) throughout, including the URL encoding budget
("9 emblems × (stat, tier, trait) … ~15 bytes"). `emblem-data.js:46-92` establishes, from
`screenshots/play-off-banners.png` dated 2026-08-13, that the playoff format runs **5
slots per banner (15 total)**, with per-lane colour patterns that are *not* derivable from
the group-stage ones:

```
            group                     playoff
core        red green red             red green red green red
mid         red blue green            red blue green red green
support     blue green blue           blue green blue green blue
```

Token budget is 40 in groups, 30 in playoffs.

**Consequence for this repo:** none directly — we emit stats, not banners. **Consequence
for the spec and site-repo:** the URL encoding must size for 15 emblems and carry a format
discriminator. Worth correcting in the spec now so it isn't discovered after links are
shared.

### Also worth knowing

- OpenDota match objects carry `series_id` and `series_type`, so the "mandatory" STRATZ
  `seriesId` is not a reason to depend on STRATZ.
- `files/data/reference_maroomm.json` is a **ready-made independent oracle** — another
  fantasy tool's precomputed per-player averages. It is what caught the sentry and
  tormentor bugs. Reuse it as the Phase 4 cross-check instead of building one.

---

## Source strategy

**OpenDota primary, STRATZ secondary, own replay parsing last.**

This inverts the spec, which is STRATZ-first. Rationale: OpenDota is itself a replay
parser with a public API, so it gives us replay-derived numbers (teamfight, stuns) without
us running Clarity in CI, and its per-stat semantics have already been debugged against an
oracle in prior art. STRATZ is retained for two things it does better: `replaySalt` +
`clusterId` (needed only if we build our own parser) and as an independent cross-check on
kills/deaths/GPM to catch a silent OpenDota parse regression.

Contingency: if Phase 0 shows OpenDota is *not* auto-parsing TI matches promptly, flip to
STRATZ-primary and treat OpenDota as a backfill. The ingest layer is written so this is a
source-module swap, not a rewrite.

---

## Phase 0 — Probes that delete or keep whole subsystems ✅ DONE 2026-08-13

Full results and raw evidence in [`docs/FINDINGS.md`](docs/FINDINGS.md). Summary:

| # | Probe | Result |
|---|---|---|
| 0.1 | OpenDota field audit on a live TI match | **PASS.** `teamfight_participation` = 0.643, `stuns` = 1.83, everything else present |
| 0.2 | Hunt for lotus / madstone / watcher / tormentor | Only **watchers and lotuses** genuinely absent. Tormentor via `objectives`; `item_uses.madstone_bundle` is a live candidate for Безумруди |
| 0.3 | STRATZ `replaySalt` / `clusterId` | `clusterId` yes (413), **`replaySalt` null on 10/10**. Spec's "Resolved" item is wrong in practice |
| 0.4 | STRATZ introspection for the missing stats | 55 fields, **zero hits**. Nothing added since 2024 |
| 0.5 | TI 2026 league ID | **19719** (`tier: premium`). 29 matches / 12 series live at probe time |
| 0.6 | OpenDota parse latency | **29/29 parsed**, incl. a match ~6 h old. → **Trigger A, cron only** |
| 0.7 | Quotas | OpenDota free tier sufficient (no key needed); STRATZ 15,000/day |

**Go/no-go: v1 needs no replay parsing.** Build ingest on OpenDota alone.

Two findings that were *not* anticipated:

- **OpenDota is the salt source, not STRATZ.** `replay_salt` and `cluster` are on the match
  object, present 10/10. The spec's whole fallback ladder (OpenDota `/api/replays` → Steam
  Game Coordinator) collapses to reading one more field off a payload we already fetch.
- **Replay download is blocked anyway.** Every TI match probed is on **cluster 413, a China
  cluster**; `replay413.valve.net` returns 403 and OpenDota's own `.com.cn` URL is
  unreachable. This doesn't block v1 — but it does mean the Phase 3.1 hedge (parking
  `.dem.bz2` files) **cannot currently be executed**, so the insurance we hoped to buy on
  day one is not purchasable. See FINDINGS.

- **`position_est`** exists on each player and read cleanly 1–5 on the sample — a better
  default than the prior art's hand-rolled role heuristic (Phase 2.3 updated accordingly).

---

## Phase 1 — Ship ingest today (capture before correctness)

Goal: by end of day, a workflow is committing TI match data on a schedule, with **no
scoring engine and no normalization**. The spec's build order is right about this.

### 1.1 Scaffold

Node 24 (present locally, `v24.18.0`) — native `fetch`, native test runner, ESM, **zero
dependencies**. Matches the neighbour repo's conventions (no framework, no build step,
`node --check` to verify edits) so the two projects stay readable by the same person.

```
.github/workflows/ingest.yml
scripts/
  ingest.mjs            entry: diff → fetch → write → commit
  sources/opendota.mjs  list league matches, fetch one match
  sources/stratz.mjs    cross-check + replaySalt/clusterId
  lib/http.mjs          retry, backoff, rate limit, User-Agent
  lib/git.mjs           "commit only if the tree actually changed"
data/
  .nojekyll             (repo root, actually)
  meta.json             version, generatedAt, leagueId, counts — the health file
  raw/{id}.json.gz      trimmed raw payload (see 1.3)
docs/FINDINGS.md
```

### 1.2 The diff-driven queue

Exactly as the spec describes, and it is the right call: list the league's matches, diff
against what is already committed, process the difference. No queue file, no lock, no
marker. A failed run self-heals next run because the diff is recomputed from scratch.

Retry state lives in the per-match file so it is visible in `git log -p`:

```json
{ "matchId": 8123456789, "status": "pending" | "ok" | "failed",
  "attempts": 2, "lastError": "404 replay not yet uploaded",
  "lastAttempt": "2026-08-13T18:40:00Z" }
```

After N attempts (start with 8), mark `failed` so it stops burning quota, and surface the
count in `meta.json` rather than letting it fail silently.

### 1.3 Commit the raw payload, trimmed

**This is the most important decision in Phase 1 and it is a departure from the spec**,
which commits only derived stats.

A full OpenDota match JSON is 1–3 MB, mostly per-minute time series — too much for git
across ~200 maps. But committing *only* derived stats means a derivation bug discovered in
September is unfixable, because the replay it came from has expired.

So: trim the payload to every field we could plausibly ever need (player objects minus
`gold_t`/`xp_t`/`times`/`purchase_log`, plus `objectives`, `item_uses`, match metadata),
gzip it, commit to `data/raw/{id}.json.gz`. Estimated 50–150 KB per map, ~10–30 MB for a
full TI. That is a perfectly ordinary public repo size, and it buys unlimited re-derivation
without re-fetching anything. It is also precisely the `git log -p` debugging affordance
the spec says it is buying by using git as storage.

### 1.4 Workflow

Straight from the spec, which has this right:

- triggers: `schedule` (`*/15`), `workflow_dispatch`, optionally `repository_dispatch`
- **never** `push` — the workflow commits, which would retrigger it forever
- `concurrency: { group: parse, cancel-in-progress: false }` — for correctness, not rate
  limits: two overlapping runs compute the same diff and collide on push
- `permissions: contents: write`
- one commit per run, **no commit when nothing changed** (most runs find nothing)
- `.nojekyll` at repo root, Pages enabled on the default branch

Trigger decision (spec open item 5): **Option A, cron only.** This is retrospective
analytics; 15-minute granularity is irrelevant when the thing being analyzed is a
finished tournament. Revisit only if live in-progress scoring becomes a requirement, and
Phase 0.6 confirms OpenDota's own parse lag likely dominates our cron interval anyway.

Secrets: `STRATZ_TOKEN`, optionally `OPENDOTA_KEY`. Note the STRATZ `User-Agent:
STRATZ_API` header is mandatory — 403 without it.

**Exit criterion for Phase 1: a green scheduled run that committed at least one real TI
map.** Nothing else in this phase matters until that is true.

---

## Phase 2 — Data contract and derivation

Only once capture is running. This is the interface site-repo builds against, so it gets
frozen and versioned early even if the numbers inside are still wrong.

### 2.1 `derive.mjs` — pure, no coefficients

Raw match → normalized stat rows. **No fantasy coefficients in this repo.** Scoring is
site-side; mixing them means a coefficient correction requires a full data rebuild. The
boundary is: we emit *counts*, the site multiplies them.

Written as dependency-free ESM importable in a browser, so the site can re-derive from
`data/raw/` when debugging a disagreement.

### 2.2 `data/stats.json` — the whole dataset

Column-array format to hold the spec's ~100 KB gzipped target:

```json
{
  "v": 1,
  "leagueId": 00000,
  "generatedAt": "2026-08-13T18:40:00Z",
  "columns": ["matchId","accountId","heroId","isRadiant","pos","kills","deaths",
              "lastHits","denies","gpm","towers","obs","camps","runes","sentries",
              "smokes","teamfight","stuns","firstBlood","roshan","tormentor","courier",
              "lotus","madstone","watcher"],
  "players": { "<accountId>": { "name": "…", "teamId": 0 } },
  "matches": { "<matchId>": { "seriesId": 0, "seriesType": 1, "gameNo": 1,
                              "startTime": 0, "duration": 0, "radiantWin": true,
                              "radiantTeamId": 0, "direTeamId": 0,
                              "parsed": true, "status": "ok" } },
  "rows": [[ … ]]
}
```

Unsourced stats (`lotus`, `madstone`, `watcher`) ship as **`null`, never `0`** — the site
must be able to render "no data" distinctly from "scored zero". The spec's edge-case list
demands exactly this distinction and it is unrecoverable if we bake in zeros.

`data/matches/{id}.json` stays as the spec describes: event-level detail for title-trigger
evidence, fetched lazily on drill-in.

`data/meta.json` doubles as health file and the site's cache key — the spec's "cache
derived artifacts keyed by a data version string."

### 2.3 Two derivations that need care

**Roles.** The banner is role-indexed (core pair / mid / support pair). Phase 0 found
OpenDota emits **`position_est`** (1–5) per player, which read cleanly `1,3,2,4,5` /
`5,1,2,3,4` on the sample — so the prior art's hand-rolled heuristic
(`fetch_stats.py:76-110`: lane_role, then net worth, then wards) is a second fallback
rather than the primary path. Order: **pinned rosters by account ID → `position_est` →
heuristic**, and record which one was used per row so a bad role assignment is traceable
rather than silent. `config/rosters.json` in prior art is the shape for the pins.

**Series.** Group by `series_id`, order by `start_time`, emit `gameNo`. We do *not* do
best-2-of-3 selection here — the spec is right that selection depends on banner config and
so must be redone per counterfactual, client-side. We only supply the grouping.

### 2.4 Edge cases, handled at parse time

From the spec's list, these are ours (the rest are the site's): remakes and forfeits get
`status: "remade"` / `"forfeit"` and are excluded from `rows` but **present in `matches`**
so the site can say so in the breakdown; unparsed matches get `parsed: false` and no rows,
so the series shows provisional rather than scoring as zero.

---

## Phase 3 — Replay pipeline (only if Phase 0 says it's still needed)

Residue confirmed by Phase 0: **watchers and lotuses**, plus tormentor credit semantics.
Madstones dropped off this list — `item_uses.madstone_bundle` exists and its spread across
the ten players correlates with farm priority, so it is a validation problem rather than a
parsing one. Everything else comes from OpenDota.

### 3.1 The hedge — partly foreclosed by Phase 0

Intent was: park the `.dem.bz2` as a **GitHub Release asset** (not in the git tree) so that
deciding in September to add watchers/lotuses doesn't run into expired replays.

**Phase 0 found this is not currently executable.** Cluster 413 returns 403 on
`replay{n}.valve.net` and OpenDota's `.com.cn` URL is unreachable from here — so there is
no replay to park. Revisit if playoff matches land on a different cluster.

What *is* still worth doing from day one, and costs nothing: record `replay_salt` +
`cluster` (from OpenDota, present 10/10) in every per-match file. If a download route is
ever found, the salts are the irreplaceable half and they are captured. Retention kills
the `.dem`; it doesn't kill a 10-digit integer in git.

Accept the residual risk explicitly: **if no download route is found, watchers and lotuses
are permanently unavailable for TI 2026** and must be surfaced as `null` in the UI rather
than approximated.

### 3.2 The parser itself

Deferred past v1. Go/Manta or Java/Clarity, installed in the workflow (neither Go nor a
modern JDK is on this machine — local Java is 1.8, Clarity wants 11+ — but CI installs
whatever it needs, so this is not a local constraint). Stream-download → parse → discard,
one replay at a time; never commit `.dem` files to the tree.

### 3.3 Cheaper alternatives to try first

The spec's own suggestion, and it should genuinely be tried before writing a parser:

- **Tormentor** is structural, not scalar — credit all five players on the killing side
  instead of the last-hitter. Testable immediately against `reference_maroomm.json`, which
  is where the ~2–23% undercount was measured.
- **Watchers / lotuses / madstones**: battlepass.ru reports these as *directional scalar*
  biases (watchers ~1.5× over, madstones 3× under, lotuses ~20% missing). If any source
  exposes them at all, a correction factor beats a parser. If none does — which the audit
  suggests — this doesn't apply and the parser is the only route.

---

## Phase 4 — Validation

The spec's hard requirement is that the engine reproduce a real in-client score exactly
before any counterfactual is shown. That validation belongs to site-repo. **This repo's
share is proving the inputs are right**, which is a prerequisite and can start immediately.

1. **Golden fixtures.** Pin 3–5 real match payloads under `test/fixtures/`, assert
   `derive.mjs` output byte-for-byte. Catches silent OpenDota schema drift, which is a
   documented failure mode here (`tormentor_kills` returning 0 rather than erroring).
2. **Cross-source diff.** Same match through OpenDota and STRATZ; assert kills / deaths /
   GPM / last hits agree. Any disagreement is a bug in one of them and worth knowing about
   before it reaches a user.
3. **Oracle diff.** Compare per-player averages against `reference_maroomm.json`. This is
   the check that already caught two real bugs; it is free and should run in CI.
4. **`data/health.json`** surfacing per-stat non-null coverage, so "lotuses are 100% null"
   is visible on a dashboard rather than discovered by a confused visitor.

---

## Ordering, and what blocks what

```
Phase 0  probes                    ← today, ~1h, blocks everything
   │
Phase 1  ingest + raw capture      ← today/tomorrow, blocks nothing else but is time-critical
   │
   ├── Phase 2  contract + derive  ← this week; unblocks site-repo
   │      │
   │      └── Phase 4  validation  ← continuous from here on
   │
   └── Phase 3  replay parsing     ← deferred; only the salt-capture hedge is urgent
```

The critical path to site-repo starting work is **Phase 2.2 — the frozen `stats.json`
contract.** Publish it with mock data on day two if necessary; the site can be built
against a contract before it is built against real numbers.

## What I need from you

- ~~STRATZ API token~~ — supplied, and Phase 0 showed we don't actually need it for v1.
  Keep it as a repo secret for the cross-check in Phase 4.2; **do not commit it** (it is
  currently only in the session scratchpad, outside the repo).
- ~~TI 2026 league ID~~ — **19719**.
- ~~OpenDota API key~~ — not needed; free tier measured sufficient.
- Confirmation that this repo is the one that becomes public and gets Pages enabled.
- A **real in-client fantasy score** for a known banner, as early as possible. This is the
  only thing that can validate `madstone_bundle` → Безумруди, the tormentor credit rule, or
  the smoke definition, and it is the spec's hard gate on shipping counterfactuals.

## Open questions the spec lists that this plan does NOT resolve

These are site-repo's, and are recorded here only so they aren't lost:

- Multiplier stacking order — prefix/suffix additive or multiplicative with tier/trait
  (spec open item 3). Note the prior art hit the same wall from the other side:
  `scoring.json` `meta.modelNotes.traitComposition` documents a live banner showing +70%
  where the glossary formula predicts +80%.
- Best-series selection scope — per player, per role, or per banner (spec open item 4)
- Trait definitions and prefix hero lists, dumped from the client VPK (spec open item 6)
- `Мучитель` suffix remains uncomputable — fountain kills are unavailable from every
  source. Mark unsupported in the UI rather than approximating.
