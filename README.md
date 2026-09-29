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

- **Overview**: recorded court-hours, recorded checked-in and rained-out shares (with denominators), weekly status composition, coverage calendar with missing dates visible, and evidence cards.
- **Walkup planner**: month / weekday / season / slot-hour filters (default: April, Wednesday, 5–6 p.m.), plus a weather filter for the day(s) before. Shows pooled and day-weighted percentiles, daily booking curves with median and IQR band, a histogram, and a per-date table. The optional planning benchmark is suppressed below 10 dates. Also includes an alarm calculator and a shareable URL (travel details only if opted in).
- **Rain outlook**: pulls yesterday's and today's rainfall live from the NWS feed for the Central Park gauge (or takes a manual value). For comparable past days, it shows the recorded rained-out share by start hour, when recorded play resumed, and how often mornings were washed out. It also shows how much earlier afternoon/evening walkups were booked on late-opening days (e.g. 1–4 p.m. slots: ~72 min earlier on weekdays).
- **Court explorer**: 26-court × hour grid per date with text status codes, an hourly rainfall strip, same-day/previous-day/2-/3-day rainfall, hatched "not in export" cells, keyboard navigation, and sanitized slot details.
- **Weather**: rained-out share by rainfall bucket for the same day, previous day, 2 and 3 days before, and during / 3h / 6h / 24h before the slot. Also a daily rain vs. rain-out timeline, rain-outs on measured-dry days (as leads, not findings), and source checks.
- **FOIL & methodology**: checksums, cutoff and timezone assumptions, reconciliation with earlier figures, exclusion ledgers, downloads, what the records cannot answer, records still needed, and a change log.

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
