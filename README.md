# Central Park Tennis Data

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

## What's in the site

Look: parks-green palette; owner-supplied logo (`app/public/logo.jpg`, also the iPhone home-screen icon). Built phone-first: on iPhones the answer comes first, filters collapse into a one-line summary, and inputs are sized so Safari doesn't zoom. Tabs, in plain language:

- **When to go** (home): tap **Tomorrow** or pick court time, day and month. You get five typical-day times (25%, half and 75% of courts gone, when the last 5 start going, and when the last one goes) and two charts: how fast courts go, and courts gone per 15 minutes on an average day. No recommendation; people read the data themselves. Counts **walk-up bookings only**, on **walk-up courts** by default: courts 19–24 are mostly booked online and left out unless you choose All. More filters (season, rain before, mornings closed by rain) and every day's detail are tucked away.
- **After rain**: live Central Park rain for yesterday or the last 2–3 days (NWS), or a number you enter. It shows how past days like it went: when courts came back, how often mornings were closed, and how much sooner afternoon and evening walk-ups went.
- **Rain & closures**: how much rain closes courts (same day, day before, 2- and 3-day totals), and days that were closed with little or no rain. Each of those days gets a label (no rain nearby / rain came later / wet from earlier days) and an hour-by-hour chart of rain against court status. Also split decisions, adjustable thresholds, and sources.
- **Court history**: any date as a grid, with times down the side, courts across, and a rain column.
- **Insights**: singles vs doubles, inferred 2-hour bookings, and when partners are checked in relative to the 15-minute rule.
- **About the data**: sources, checksums, assumptions, reconciliation, limits.

## Publish on GitHub Pages (free)

The site is fully static (hash-based URLs, relative asset paths), so GitHub Pages can host it as-is. The workflow `.github/workflows/pages.yml` runs the front-end tests, builds `app/dist`, and deploys it on every push to `main` that touches `app/`.

One-time setup:

1. Make the repository public (free plans only serve Pages from public repos): **Settings → General → Danger zone → Change visibility**. Only sanitized data is in the repo and its history; the raw FOIL CSV is not.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` (or run the workflow from the Actions tab). The site appears at `https://<user>.github.io/central_park_tennis/`.

To update the data: run `python -m pipeline.build` locally, check `python -m pipeline.audit app/dist` after `npm run build`, then commit `app/public/data` and push. CI never sees the raw export.

The live rain readings come straight from the National Weather Service API in the visitor's browser, so they work on Pages with no server or key.

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
