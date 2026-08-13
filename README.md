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

Rows are arrays ordered by `stats.json.columns`. Two conventions the consumer must respect:

- **`lotus` and `watcher` are always `null`.** No source exposes them (see FINDINGS 0.2).
  They are `null`, never `0`, so "no data" stays distinguishable from "played and scored
  zero". Do not coerce them.
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
