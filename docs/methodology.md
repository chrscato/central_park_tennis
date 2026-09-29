# Methodology

The live version of this page is the **FOIL & methodology** view in the app, rendered from `app/public/data/manifest.json`. Generated counts live in [`data_profile.md`](data_profile.md). Metric definition: [`../metrics/successful_walkup_v1.md`](../metrics/successful_walkup_v1.md).

## Pipeline

1. Hash the source (SHA-256) and read every value as an untouched string; fail on any column mismatch.
2. Normalize whitespace and casing into separate comparison columns; originals are retained privately.
3. Parse naive timestamps as local clock times; flag DST-ambiguous/nonexistent times (America/New_York, provisional) instead of guessing.
4. Build one row per slot ID; quarantine IDs that map to more than one court, start time, or schedule status.
5. Build the successful walkup cohort with slot- and row-level exclusion ledgers.
6. Write private Parquet intermediates; write public assets from an explicit field allowlist into a staging directory.
7. Scan every staged file for raw staff-note text (note values identical to controlled-vocabulary terms such as "waiting list" are exempt). Abort on any match, keeping the previous build.
8. Promote staging to `app/public/data`; the previous build is kept as `data.previous`.

`python -m pipeline.audit app/dist` repeats step 7 against the built site (release gate).

## Weather (dry-v1)

Inputs (configured in `config/pipeline.toml [weather]`):

| Use | Source | Verified semantics |
| --- | --- | --- |
| Daily totals | NOAA NCEI Local Climatological Data, USW00094728 (Central Park), `REPORT_TYPE = SOD` | Files were ordered in **metric**: precipitation in mm, temperature in °C. Converted to inches and rounded to 0.01 in (the gauge's native resolution). `T` = trace. Days are Local Standard Time calendar days. Daily summaries end 2026-09-18. |
| Hourly | Iowa Environmental Mesonet ASOS export, station NYC | `valid` is America/New_York local time (checked against METAR Z times). Precipitation parsed from the routine :51 METAR `Pxxxx` group = hundredths of an inch in the hour ending at the observation. `P0000` = trace (IEM stores these as null `p01i`). No P group in a routine AO2 report = none that hour; `PNO` = missing. Special (non-:51) reports are not summed, avoiding double counting. |

Byte-identical duplicate files (e.g. `... (1).csv`) are detected by SHA-256 and skipped.

**Daily series.** LCD daily totals first; for days LCD does not cover, the sum of a complete 24-hour local day of hourly observations (flagged `iem-hourly-sum`); otherwise missing.

**Trailing windows** (information available the morning of play; the day itself is excluded):
- `prev1`: previous calendar day.
- `trail2`: sum of the 2 days before.
- `trail3`: sum of the 3 days before.
Any missing day makes the window missing. Trace flags carry through.

**Slot-hour windows:** `during` = observation ending at :51 of the start hour; `prev3h`/`prev6h`/`prev24h` = sum of the N observations ending before the slot starts (no later rain can leak in). Any missing hour makes the window missing.

**Buckets:** dry (measured 0.00, no trace), trace only, 0.01–0.09", 0.10–0.49", 0.50"+, and no weather data. Missing never counts as dry.

**Check:** hourly sums regrouped to Local Standard Time days agree with LCD daily totals within 0.03" on 96.7% of wet days, with 99.3% dry/wet agreement across 597 complete days (see `manifest.json → weather.reconciliation`, including the largest differences, which are winter snow days).

**Planner filter** uses only `prev1` and `trail3`. Same-day rain is shown descriptively but is not known at booking time.

**Dry-day rain-outs** (rained-out records when both the day and the day before measured dry) are listed as investigative leads, not errors: saturated courts after earlier storms, localized showers, maintenance, or recording practice can explain them.

## Rain outlook (after-the-rain view)

**Live rainfall.** The browser calls the National Weather Service API (`api.weather.gov/stations/KNYC/observations`, the same Central Park ASOS gauge; no key, CORS enabled). Routine :51 METARs are parsed with the same P-group rules as the pipeline. If the feed omits the raw METAR, its decoded `precipitationLastHour` (mm) is used; if neither exists the hour is missing. Yesterday's total is shown as complete only when all 24 hourly reports are present; otherwise the partial sum is shown with a "may be low" warning. Users can override with a manual value. Live days are local clock days; historical "previous day" values are NOAA's Local Standard Time days (a one-hour offset during DST).

NOAA's NCEI Access Data Service is **not** used live: its daily summaries lag real time by about a week (on 2026-09-29 the newest Central Park value was 2026-09-22). The pipeline uses it only to fill days after the supplied LCD file ends (`ncei_fill`), caching raw responses in `data/raw/weather_cache/` and falling back to the cache when offline.

**Comparable days.** Past reservation dates whose previous-day rain falls in the same bucket as the entered amount; with "Stays dry", only dates with no measurable rain that day (trace allowed). Outputs:
- Per start hour: recorded rained-out share of recorded court-hours (a historical frequency of recorded statuses, not a closure schedule).
- **First recorded play:** earliest start hour with at least one court-hour recorded "all checked in" (median and IQR across days).
- **Late opening:** at least 50% of recorded 7–11 a.m. court-hours rained out (days with under 5 recorded morning court-hours are "unknown").

**Late-opening walkups.** Weekday walkup entry times (April–October) for afternoon (1–4 p.m.) and evening (5–7 p.m.) starts, compared between late- and normal-opening days using the day-weighted median. The planner offers the same opening filter; opening status is known on the morning itself, not in advance.

Small samples (for example 19 dry days after 0.50"+ of rain) are shown with their counts.

## Latest bookings

For each date in the filter: the day's **last** qualifying walkup booking and its **final five** booking times. Summaries weight each date once: median (and IQR) of the daily last booking, and the median of each day's 5th-from-last booking (days with 5+ bookings only). These show how late courts were still being booked, not when courts ran out, because the export has no inventory of unbooked courts.

## Anomalies

- **Rained out with little rain:** rained-out court-hours where the Central Park gauge recorded under 0.05" in the 24 hours before plus the hour of the slot (adjustable). Dates are listed if they have 10+ such court-hours. Each is labelled:
  - *rain came later* if 0.05"+ fell in the 6 hours after the slot started (a closure ahead of rain), else
  - *wet from earlier days* if the 3 days before totalled 0.25"+, else
  - *no rain nearby*.
- Court-hours with gaps in the hourly rain data are counted separately and not judged.
- **Split decisions:** hours where some courts were recorded rained out while others were checked in.
- **Check-ins during rain:** court-hours recorded checked in during an hour with 0.05"+ of rain.

These are leads, not findings: one gauge can miss local showers, and surfaces drain at different rates.

## Rules applied everywhere

- Court-hours = distinct validated slot IDs; a CSV row is not a booking, player, or court-hour.
- Missing slots mean "not present in this export", never available, unused, or closed.
- "All checked in" is a recorded status, not verified play.
- Shares always state numerator, denominator, filter, and data version.
- No dollar, waste, favoritism, or corruption estimates.
- Staff `reason` text never reaches the browser, downloads, or logs.

## Status colors

Recorded schedule statuses use a six-slot palette validated for color-vision deficiency in light and dark modes (adjacent CVD delta-E >= 13, normal-vision delta-E >= 19). Green is reserved for "all checked in". Every status also carries a text code (CI, RO, AS, BP, UA, UB) or label, and charts have table views or tooltips.

## Limitations

- **Successful-only records.** No failed attempts, queue arrivals, or waiting times, so no probability of getting a court.
- **Timestamps are entry times**, not arrival or check-in times.
- **No slot inventory.** Absent cells cannot be read as open, closed, or free.
- **Snapshot boundary unconfirmed.** 2026-09-22 is inferred from latest activity; the agency extraction time is unknown.
- **Timezone unconfirmed.** Timestamps assumed to be New York local.
- **Earliest qualifying entry is not the original booking.** Earlier canceled or non-walkup entries for the same slot are not reflected.
- **Cancellation joins are ambiguous.** Actions are shown as recorded counts; no lifecycle is reconstructed.
- **Weather is one gauge.** Central Park's station may miss localized showers; hourly intervals (:51 to :51) do not align exactly with slot hours.
- **Staff notes withheld** until a reviewed category mapping exists.

## Records still needed

Complete slot inventory; export join logic and stable anonymous identifiers; timestamp timezone and extraction time; status definitions and transitions; waitlist and unsuccessful-attempt data; closure and maintenance logs; and, for any fiscal claims, actual expenditure and receipt records kept separate from reservation metrics.
