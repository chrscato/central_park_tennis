# Central Park Tennis Watch

*Public courts. Public records. Clear answers.*

An independent, static-first historical explorer of Central Park tennis reservation records obtained through a New York FOIL request. It pairs practical player guidance ("when were comparable walkup courts booked?") with transparent scrutiny of what the records show and leave out.

Not affiliated with NYC Parks, the City of New York, DOGE, or any political party. Historical records only, never live availability.

**Status:** first draft covering the P0 data foundation, the P1 player MVP, and P2 weather from `guidelines/central_park_tennis_dashboard_plan.md`. Not deployed.

## Quick start

```bash
# 1. Python pipeline (3.11+; tested on 3.13)
pip install -r requirements.txt
#    put the private/local inputs in place (see "Data" below), then:
python -m pipeline.build          # raw inputs -> data/processed (private) + app/public/data (sanitized)
python -m pytest tests            # metric + weather fixtures

# 2. Front end (Node 20+; tested on 24)
cd app
npm install
npm run dev                       # http://localhost:5173
npm test                          # planner + weather math, pipeline reference checks
npm run build                     # static site in app/dist
cd .. && python -m pipeline.audit app/dist   # release gate: scan the bundle for staff-note text
```

The sanitized public assets in `app/public/data/` are committed, so `npm run dev` works on a fresh clone **without** any raw inputs. Rebuilding them requires the files below.

## Data

| File | Where | In git? |
| --- | --- | --- |
| `central_park_tennis_FOIL_request.csv` | `data/raw/` | **No**: contains staff free-text notes; never committed or deployed |
| `central_park_reservation_FOIL_data_dictionary_updated.txt` | `data/raw/` (copy in `docs/source/`) | dictionary only |
| NOAA LCD `LCD_USW00094728_*.csv` (metric units) | `data/nyc_weather/` | No (large; public NOAA data) |
| IEM ASOS `NYC_weather.csv` | `data/` | No (large; public IEM data) |
| NCEI API response cache | `data/raw/weather_cache/` | No (fetched at build time to fill days after the LCD file) |
| Private intermediates (Parquet) | `data/processed/` | No |
| Sanitized public assets | `app/public/data/` | Yes (generated; allowlisted fields only) |

Input paths, the historical cutoff, timezone, and weather units are set in `config/pipeline.toml`. Source files are never modified. If weather inputs are missing, the build still succeeds and the app shows weather as unavailable.

## What's in the draft

Lean editorial UI: serif section heads, key-figure rows, charts with title / subtitle / source line, and tables with horizontal rules only. Tabs:

- **Booking times** (default): filters for month, day, court start time, season, rain before, and late-opening mornings. Shows:
  - when courts were booked (25/50/75%, typical day)
  - how late courts were still being booked (the typical day's last booking and when its final five began)
  - two charts: daily booking curves and bookings per 15 minutes
  - arrive-by benchmark (suppressed below 10 dates) and alarm calculator
  - every date with its last five booking times

  Filters are encoded in the URL; travel times are included only if you opt in.
- **Rain outlook**: live Central Park rain from the NWS feed for yesterday, the last 2 days, or the last 3 days (or a manual value). For comparable past days, it shows the rained-out share by start hour, when recorded play resumed, and how often mornings washed out. It also shows how much earlier afternoon and evening walkups go on late-opening days.
- **Court records**: per-date grid with start times down the side and courts 1–26 across, plus a rain column, day and 1-/2-/3-day rain, and sanitized slot details.
- **Rain vs. closures**: small multiples of rained-out share by rainfall for the same day, the day before, 2- and 3-day totals, and 0/3/6/24 hours before the slot. Also a combined table, a daily timeline, and sources.
- **Anomalies**: rain-outs with little rain in the 24 hours before, sorted into "no rain nearby", "rain came later" (closed ahead of rain), or "wet from earlier days"; thresholds are adjustable. Also a scatter of every date, and "split decisions" (some courts rained out while others were checked in the same hour).
- **Methodology**: checksums, assumptions, reconciliation, ledgers, downloads, limits, records still needed.

## Verified against earlier analysis

All nine previously reported figures reproduce exactly (see `docs/data_profile.md`): 159,386 rows; 78,423 slots; 26 courts; reservations 2025-04-01 → 2026-10-22; latest activity 2026-09-22; 38,264 qualifying walkup slots; April/Wednesday/6 p.m. = 90 slots over 7 dates (which correctly triggers the limited-sample state).

## Repository layout

```text
app/                 React + TypeScript + Vite front end
  public/data/       generated sanitized assets (manifest, overview, timing, weather, per-date slots, downloads)
  src/lib/stats.ts   planner computations (stats.test.ts)
  src/lib/weather.ts weather joins and buckets (weather.test.ts)
pipeline/            import, validation, cohort, weather, publishing, audit (Python)
metrics/             metric definitions
config/              pipeline.toml: paths, cutoff, timezone, weather units, thresholds
data/raw/            private inputs (gitignored)
data/processed/      private intermediates (gitignored)
tests/               pipeline and weather fixtures for guideline §8/§11 cases
docs/                methodology, generated data profile, source dictionary
guidelines/          the build plan
```

## Known limitations

See `docs/methodology.md#limitations`. In short:

- Successful bookings only: no failed attempts or queue arrivals.
- Creation timestamps are entry times, not arrival or check-in times.
- No full slot inventory.
- The 2026-09-22 cutoff and America/New_York timezone are unconfirmed assumptions.
- Weather is a single gauge.
- Staff notes are withheld pending a reviewed category mapping.
- The FOIL request timeline and corrections contact are still to be supplied by the owner.
