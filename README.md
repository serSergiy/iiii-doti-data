# TI 2026 fantasy analytics — data

Per-map Dota 2 fantasy stats for **The International 2026** (league `19719`), ingested on a
schedule and committed to git. No server, no database, no cloud storage: **git is the
state**, and GitHub Pages serves the JSON.

The scoring engine and the public UI live in a separate repo. This one only produces data.

## What's here

| path | what it is |
| --- | --- |
| [`PLAN.md`](PLAN.md) | Step-by-step build plan, phases and their exit criteria. |
| [`docs/FINDINGS.md`](docs/FINDINGS.md) | **Live API probes, dated.** What each source actually returns — read before trusting any assumption. |
| [`ti2026-fantasy-analytics-spec.md`](ti2026-fantasy-analytics-spec.md) | Original product spec. Parts of it are superseded by FINDINGS; the table at the end of that file says which. |
| [`scripts/derive.mjs`](scripts/derive.mjs) | Raw match → stat rows. Pure, browser-importable, **no fantasy coefficients**. |
| [`scripts/ingest.mjs`](scripts/ingest.mjs) | Entry point: diff → fetch → write. |
| `data/` | The output. See below. |
| `test/fixtures/` | A complete Bo3 (series 1130069) for offline testing. |

## Live data

```
https://serhii-zashchyk.github.io/iiii-doti-data/data/stats.json
https://serhii-zashchyk.github.io/iiii-doti-data/data/meta.json
```

Served with `Access-Control-Allow-Origin: *`, so cross-origin `fetch()` from the site needs
no configuration. Pages forces `Cache-Control: max-age=600` with no override — append
`?t=${Date.now()}` for a manual refresh button.

## Output

| file | what it is |
| --- | --- |
| `data/stats.json` | The whole dataset, column-array form. **11 KB gzipped for 29 maps.** Fetch on page load. |
| `data/meta.json` | Version, counts, per-stat coverage, warnings. Health file and cache key. |
| `data/matches/{id}.json` | Per-match detail + retry state. Fetch lazily on drill-in. |
| `data/raw/{id}.json.gz` | Trimmed raw payload — the re-derivation substrate. ~10 KB/match. |

| `data/replay/{id}.json` | The game's own per-player counters, pulled out of the replay. ~20 KB/match. |

Rows are arrays ordered by `stats.json.columns`. Three conventions the consumer must
respect:

- **`stats.json.replayDerived` columns are `null` where no replay was parsed** — currently
  `lotus`, `watcher`, `madstoneGame`, `tormentorGame`. `null`, never `0`, so "no data" stays
  distinguishable from "played and scored zero". Check `meta.json.coverage` per column
  rather than assuming; do not coerce.
- **`madstone` is an estimate, not a count.** `madstoneUses × 1.97`, where the multiplier is
  a midpoint between two irreconcilable banner readings — right to about ±17%. It ranks
  players correctly (a scalar multiple preserves order) but must not be quoted as a number
  of madstones. Do **not** substitute `madstoneGame`: the game's own counter reads the same
  value for all ten players on 43 of 63 maps. See `docs/SCORING.md` §8.
- **Score `tormentorGame`, not `tormentorSelf`.** УБИТО МУЧИТЕЛІВ is participation — every
  hero who damaged the tormentor, not the last hitter. The two differ by ~3×, so
  `tormentorSelf` is not a usable fallback. See `docs/SCORING.md` §8.
- **`stats.json.unvalidated`** names stats whose mapping is real but whose definition has
  not been checked against a real in-client score. Badge them; do not present them as
  settled.

## Running it

```bash
node scripts/ingest.mjs
```

Needs no credentials — the OpenDota free tier is sufficient. `--dry-run` fetches without
writing, `--limit N` caps the batch, `--force ID` re-fetches one match.

```bash
npm test
```

Golden tests against the committed fixtures. They run in CI **before** ingest, so a
silently-changed upstream field fails the build instead of committing bad data.

### Replays

Four stats exist only in the replay, so the ingest alone leaves them `null`. Both scripts
are idempotent and resumable — run them as often as you like:

```bash
bash scripts/fetch-replays.sh; bash scripts/parse-replays.sh; node scripts/ingest.mjs --rederive
```

Note the `;` rather than `&&`. Both scripts exit nonzero if *any* single replay failed, which
is the right signal for CI but the wrong control flow here — one unavailable replay must not
stop the other seventy-nine from being parsed.

`fetch-replays.sh` pulls every match we hold a salt for into `replays/` (gitignored, ~110 MB
each). Completeness is checked against the server's `Content-Length`, not mere existence, so
an interrupted transfer resumes instead of being mistaken for a finished file.
`parse-replays.sh` runs the Go parser — on the host toolchain if there is one, in Docker
otherwise — and writes `data/replay/{id}.json`. The `--rederive` pass is what carries those
counters into `stats.json`; without it the parsed JSON sits there unused, because the ingest
diff skips matches already marked `ok`.

Every parse is gated by `scripts/verify-replays.mjs`, which cross-checks nine per-player
counters against OpenDota and rejects anything that disagrees. This is not belt-and-braces:
a truncated replay parses *successfully* and returns plausible mid-game numbers, and a
parse can silently drop half the players. Run it over the whole corpus any time:

```bash
node scripts/verify-replays.mjs
```

`JOBS=n` sets download concurrency (default 5 — the host throttles per connection, so
serial fetching is ~30× slower). `MAX_REPLAYS=n` bounds a run. `KEEP_DEM=0` deletes each
`.dem` once parsed — **CI only**.
Valve's retention is finite and unpublished, so locally the default keeps them; a replay
deleted today generally cannot be fetched back, and a future `ParserVersion` bump needs it.

CI does all of this automatically ([`.github/workflows/ingest.yml`](.github/workflows/ingest.yml)),
four replays per 15-minute run. Every replay step is `continue-on-error`: the replay host is
Perfect World's, not Valve's, and a bad day there must still commit the OpenDota data.

## Provenance

The fantasy coefficients this data feeds are **reverse-engineered and unofficial**. This
repo deliberately holds no coefficients at all — it emits counts, and the site multiplies
them, so a coefficient correction never requires a data rebuild.

Every mapping in `derive.mjs` cites its evidence. Several were wrong on the first attempt
and were corrected against an independent oracle; those notes are load-bearing, not
decoration.

## Conventions

- `data/` is generated. Never hand-edit it — rerun the ingest.
- Verify JS edits with `node --check`.
- Secrets live in `.env` (gitignored). This repo is public; `.env.example` is the template.
