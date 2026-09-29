# Central Park Tennis Watch — Coding Agent Build Plan

Prepared: September 29, 2026  
Deliverable: implementation plan, not an authorization to publish a website.  
Working name: **Central Park Tennis Watch**  
Tagline: **Public courts. Public records. Clear answers.**

## 1. Product brief

Build a fast, mobile-friendly public accountability dashboard using Central Park tennis reservation records obtained through FOIL. Combine practical player guidance with transparent scrutiny of how public courts are administered.

The requested style is DOGE/Republican-inspired government accountability: bold numbers, direct questions, red/navy/white colors, visible evidence, downloadable findings, and an emphasis on access to public assets. Treat this as an editorial and visual direction. Use an independent identity; do not imply affiliation with DOGE, a political party, NYC Parks, or another government entity.

The central user question is:

> “I want to play in April on a Wednesday after work. When were comparable successful walkup reservations secured, and what time should I plan to leave home?”

The central accountability question is:

> “What do the records show about access, weather disruption, and unexplained gaps in the public record?”

Ship a working historical explorer first. Dynamic means responsive filtering and recalculation; it does not mean live court availability. Every page must display the dataset's historical coverage and its confirmed or unconfirmed extraction date.

## 2. Inputs and evidence status

Use these supplied files; preserve them unchanged:

- `project_sources/01-central_park_tennis_FOIL_request.csv`
- `project_sources/02-central_park_reservation_FOIL_data_dictionary_updated.txt`

They were supplied in `/workspace/scratch/54d6bd09880c/`. Make input paths configurable when moving to another workspace.

The dictionary was inspected for this plan. Earlier conversation analysis reported the following, but the implementing agent must recompute them rather than hard-code them:

| Reported property | Prior result to verify |
| --- | --- |
| Raw rows | 159,386 |
| Unique schedule slots | 78,423 |
| Courts | 26 |
| Reservation dates | April 1, 2025–October 22, 2026 |
| Latest booking/cancellation activity | September 22, 2026 |
| Qualifying successful walkup slots under earlier filters | 38,264 |

September 22 is an apparent snapshot boundary, not an agency-confirmed extraction timestamp. Default historical outcomes to reservation dates before September 22, 2026, until verified; expose this choice in methodology and configuration. Do not use today's date to treat post-snapshot reservations as completed outcomes.

### Raw schema

| Field | Meaning / handling |
| --- | --- |
| `schedule_slot_id` | Slot identifier; preserve as string |
| `court` | Court label; derive numeric sort key |
| `reservation_time_and_date` | Scheduled hourly start |
| `schedule_status` | Slot status, separate from player status |
| `reason` | Staff free text; private by default |
| `creation_timestamp` | Booking creation, not measured queue arrival |
| `player_status` | Status of the player record |
| `method_of_reservation` | Booking channel or additional-player entry |
| `permit_type` | Permit / Single Play / NP |
| `action` | Cancellation/rain-related action |
| `cancellation_time` | Action time; later changes may have occurred |

Known schedule statuses: `unbookable`, `unassigned`, `assigned`, `rained-out`, `all-checkedin`, `booking-in-progress`.

Known methods: `online`, `reservation`, `walkup`, `waiting list`, `repeat list`, `second`, `reservation-phone`, `third`, `fourth`.

The user explains that non-online reservations involve a first player securing a slot and another player arriving later to complete check-in. The dictionary confirms that `second`, `third`, and `fourth` represent additional players. Neither establishes an actual queue-arrival or check-in timestamp. Do not relabel creation timestamps as those events.

## 3. Non-negotiable analytical rules

1. A CSV row is not necessarily a booking, player, or court-hour. Multiple players and cancellation joins can multiply rows.
2. Count court-hours using distinct validated slot IDs. Assert that each ID maps to one court, scheduled time, and schedule status; quarantine conflicts rather than arbitrarily selecting a row.
3. Missing slots mean “not present in this export,” not “available,” “unused,” or “closed.” Never infer full inventory from a 26-court rectangle.
4. Historical booking timestamps describe successful observed reservations. They cannot establish a probability that an arriving person will get a court.
5. “All checked in” is a recorded status, not independently verified physical play.
6. Publish no taxpayer-loss, revenue-loss, corruption, favoritism, or waste estimate without the additional evidence needed for that claim. Dollar counters are out of scope for this export.
7. Never send raw `reason` text to the browser, public API, source maps, logs, or downloads. Use reviewed categories if useful; retain restricted source records for audit.
8. Preserve unknown weather and ambiguous timestamps. Do not convert missing precipitation into zero.
9. Distinguish snapshot outcomes from event histories. This export does not provide a trustworthy inventory of every slot's availability through time.
10. Every statistic needs its unit, denominator, filters, sample size, and data version.

## 4. MVP screens

### A. Overview — “Who gets to play?”

- Prominent historical-data banner and source/version link.
- Cards: recorded court-hours, recorded checked-in share, recorded rain-out share, represented dates, and latest reservation outcome date included.
- Use “share of recorded court-hours,” never an unqualified “utilization rate.”
- Weekly status composition chart and coverage calendar with unknown/missing dates visible.
- Two main actions: **Plan a walkup** and **Inspect court records**.
- Evidence cards phrased as questions or supported observations, e.g. “How early are evening courts booked?” and “Which dates have incomplete records?”
- No rotating political slogans, fabricated savings, or accusatory leaderboard.

### B. Walkup planner — primary experience

Controls:

- Month; day of week; season/year selection; exact start time or acceptable start-time window.
- Default query: April, Wednesday, 5–6 p.m. start times; make selected hours explicit.
- Weather filter disabled with a clear explanation until weather ingestion succeeds.
- Optional user-entered preparation time, travel time, and queue buffer.

Outputs:

- Median first qualifying reservation time and 25th/75th percentiles.
- Distribution of reservation times, counts of slots and distinct dates.
- Daily booking curves and a table of each comparable date.
- A suggested **planning target**, derived transparently below, with no success guarantee.
- Alarm calculator: planning target minus preparation, travel, and optional queue buffer. Label every entered buffer as a user assumption.
- Copyable/shareable URL encoding filters, not personal travel details unless the user explicitly chooses to include them.

Use phrasing such as: “On these recorded dates, half of qualifying successful reservations were entered by 7:15 a.m.” Avoid “50% chance of getting a court.”

#### Successful walkup cohort

Start with the earlier analysis definition, implemented as a versioned metric:

1. Slot's reservation date is before the configured historical outcome cutoff.
2. `schedule_status == 'all-checkedin'`.
3. Candidate row has `method_of_reservation == 'walkup'` and normalized `player_status == 'Checked in'`.
4. Creation and reservation dates are the same in the assumed local timezone.
5. Creation timestamp is at or before the slot start.
6. For each slot, use the earliest qualifying creation timestamp.

This is the **earliest qualifying successful walkup entry**, not necessarily the original reservation ever made for that slot. It excludes additional-player records, online entries, and later administrative entry. Keep exclusion counts. Repeated cancellation-action rows must not add observations. Do not claim this identifies unique people or complete booking histories.

#### Daily curves and planning target

For date d and selected playing window, let B_d contain the qualifying reservation timestamps and n_d its size. Define:

`F_d(t) = count(b in B_d where b <= t) / n_d`

This measures the fraction of that day's observed successful reservations entered by t. It is not inventory depletion or remaining availability. Dates with zero qualifying entries are reported separately as unknown for this curve, not dropped silently or assigned a zero curve.

- Display individual daily curves plus the median and interquartile band at each local clock time, weighting each represented day equally.
- Report pooled slot-level percentiles separately; label weighting so these are not confused with day-level results.
- Proposed optional planning heuristic: find each day's 25th-percentile booking time, then take the 25th percentile of those daily times and round down to 15 minutes. This is an intentionally early benchmark, not an optimized or validated arrival deadline.
- Make this heuristic selectable, explain it next to the result, and do not present it as an ML forecast.
- Fewer than 10 qualifying dates: display descriptive times with “limited sample,” but suppress automated planning targets. This is a product guardrail, not a statistical confidence guarantee.
- Allow explicit broadening of month/day filters; never silently substitute a broader cohort.
- The prior April Wednesday 6 p.m. example reported 90 slots over seven dates. Recompute it; if reproduced, it should trigger the limited-sample state. The earlier 6:30 a.m. recommendation was judgment, not a learned success threshold.

### C. Court explorer — “Show the records”

- Date picker; 26-court-by-hour grid with chronological/numeric sorting.
- Distinct visual states for each recorded status and missing records.
- Click a cell for sanitized slot details, methods observed, qualifying timing, and source/version references.
- Label any associated cancellation rows as recorded actions whose relationships may be ambiguous; do not manufacture a lifecycle timeline.
- Rainfall timeline above the grid once available.
- Accessible table alternative and keyboard navigation.

### D. Weather and recorded disruption

- Daily rain versus recorded rained-out court-hours; previous-day rain toggle.
- Hourly rainfall and court-status alignment for selected dates.
- Compare courts only on common represented dates/hours; show sample and coverage differences.
- Dry-station/rained-out discrepancies are investigative leads, not proof of erroneous closures. Wet surfaces, maintenance, local conditions, or reporting intervals can explain them.
- Defer court “recovery time” rankings until censoring and closure history are addressed.

### E. FOIL and methodology

- Source filenames, checksums, dictionary, pipeline version, retrieval/import time, timestamp assumptions, and exclusions.
- Request/response timeline with unknown fields clearly marked; do not invent request dates, agency delays, or correspondence.
- Sanitized downloads plus column definitions and a methodology README.
- “What the records cannot answer” and “Records still needed” sections.
- Corrections/contact mechanism and visible change log.

## 5. Visual direction

- Editorial civic watchdog, with a dense but readable evidence dashboard.
- Navy `#102033`, red `#B42332`, off-white `#F7F6F2`, charcoal text; green reserved for recorded checked-in status.
- Large tabular numerals, crisp borders, restrained typography, compact source footers.
- Headlines: “Public courts, examined.” / “When are the courts actually booked?” / “Follow the records.”
- Avoid official seals, party logos, impersonation, dramatic unsupported conclusions, and red coloring that implies every missing value is wrongdoing.
- Status colors need text/icons and adequate contrast. Responsive layouts must work at 375 px width.
- Share cards should include the actual filter, denominator, dates, source version, and limitation; no context-free viral counters.

## 6. Recommended architecture

Use a small static-first application. This data volume does not require distributed infrastructure or a transactional database in MVP.

- Front end: React + TypeScript + Vite; accessible components; a chart library appropriate to timelines/heatmaps.
- Data pipeline: Python with pandas or Polars; DuckDB for reproducible analytical SQL; Parquet for private intermediate tables.
- Public assets: sanitized, versioned JSON aggregates plus compressed per-date slot partitions loaded on demand.
- Query/filter state in the URL. Generate timing aggregates at the day/month/weekday/hour level so acceptable-hour windows can be combined correctly from counts/distributions rather than averaging percentiles.
- Build-time pipeline; deploy static output to the owner's selected host. No public raw-data bucket.
- Add a backend only when justified by new uploads, authenticated curation, or larger datasets.
- Pin dependencies during implementation, document setup, and choose supported versions then. No live credentials in the client.

Suggested repository structure:

```text
app/                     # interface and components
pipeline/                # import, validation, transformation, weather
metrics/                 # documented SQL / computation definitions
config/                  # cutoff, timezone, reviewed category mapping
data/raw/                # private, gitignored inputs
data/processed/          # private intermediates
public/data/             # generated allowlisted assets only
tests/                   # fixtures and core metric tests
docs/                    # methodology, provenance, deployment guide
```

## 7. Data contracts and ingestion

| Table / artifact | Grain | Required content |
| --- | --- | --- |
| `source_manifest` | Source file/version | SHA-256, filename, import time, source date range, assumptions |
| `raw_rows` | Original row | Original values, row number, source hash; restricted |
| `slots` | Validated slot per snapshot | ID, court, local/UTC start, schedule status, ambiguity flags |
| `walkup_timing` | Qualifying slot per snapshot | Earliest qualifying time, lead minutes, date/hour, source version |
| `coverage_daily` | Date per snapshot | Recorded slots/courts/hours, exclusions, conflicts; no invented capacity |
| `weather_daily` | Station/date/product | Measurements, units, flags, completeness, provenance |
| `weather_intervals` | Station/measurement interval | Start/end UTC, precipitation, trace/quality flags |
| `public_metrics` | Explicit filter/grain | Numerator, denominator, date count, method version |

Pipeline sequence:

1. Hash and preserve input; validate the exact required columns and parse errors.
2. Normalize whitespace/status casing for comparisons while retaining originals privately.
3. Assume `America/New_York` only as a documented provisional interpretation. Preserve naive source strings; mark DST ambiguity/nonexistent times rather than guessing.
4. Profile duplicates, slot consistency, method/status combinations, nulls, negative lead times, and coverage.
5. Build one slot row and the successful walkup cohort independently.
6. Generate coverage/exclusion reports and sanitized public artifacts via a positive field allowlist.
7. Validate the new build, then atomically promote its manifest. Retain the previous good version if ingestion fails.

Future exports must remain distinct snapshots. Do not append overlapping exports and double-count slots. Preserve snapshot histories; choose a documented authoritative snapshot for each analysis.

## 8. Historical weather integration

Implement after the core reservation explorer. The following are candidate sources carried forward from earlier research; verify their current documentation, station metadata, units, interval conventions, and coverage before coding the adapter. This planning turn has not retrieved weather.

| Source | Station / purpose | Starting URL |
| --- | --- | --- |
| NOAA daily summaries | `USW00094728`; PRCP, TMAX, TMIN | https://www.ncei.noaa.gov/access/services/data/v1 |
| NOAA API documentation | Request parameters and attributes | https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation |
| IEM processed hourly precipitation | `NYC`, network `NY_ASOS` | https://mesonet.agron.iastate.edu/request/hourlyprecip.phtml |
| IEM hourly endpoint documentation | Confirm query and interval semantics | https://mesonet.agron.iastate.edu/cgi-bin/request/hourlyprecip.py?help= |
| IEM historical observations | Temperature, humidity, wind | https://mesonet.agron.iastate.edu/request/download.phtml?network=NY_ASOS |
| NOAA LCD | Alternative hourly source | https://www.ncei.noaa.gov/products/land-based-station/local-climatological-data |

- Fetch at least 48 hours before the first relevant tennis date through the historical cutoff; cache raw responses and retrieval metadata.
- Daily NOAA request: `dataset=daily-summaries`, `stations=USW00094728`, `dataTypes=PRCP,TMAX,TMIN`, explicit dates, units and attributes.
- Confirm that the source actually returns all requested dates; future or unpublished weather must stay missing.
- Preserve trace precipitation flags. Do not blindly interpret a small sentinel as a real measured accumulation.
- Confirm whether hourly timestamps label interval starts or ends. Reconcile in UTC and display New York local time.
- Deduplicate reports and avoid summing overlapping precipitation accumulation intervals.
- Features: preceding 1/3/6/12/24-hour precipitation and coverage, prior-day rain, temperature, humidity, wind, time since observed rain where continuously covered.
- Keep pre-slot weather separate from during-slot weather. Daily totals are descriptive and cannot be predictors available at a morning booking time.
- Compare hourly aggregates with daily totals only after checking reporting-day boundaries; log differences rather than forcing agreement.
- Version a “dry day” definition and expose it. Missing weather cannot qualify as dry.
- Weather fetch failures must not block the core explorer; show unavailable data honestly.

## 9. Modeling roadmap

### First: descriptive booking timing

Deliver daily curves and empirical quantiles before ML. They directly answer the user's question with fewer assumptions. There is no training label for “unsuccessful arrival” in the current export.

### Later: conditional booking-time quantiles

Estimate successful recorded reservation times using season, weekday, requested playing hour, and defensible weather inputs. Compare against month/weekday/hour empirical baselines. Quantile regression is a candidate; evaluate pinball loss and interval coverage on held-out days. Outputs still concern successful recorded bookings, not personal access probability.

### Later: recorded rain-out model

Target “recorded rained-out status.” Explicitly define eligible statuses: a first model can compare `rained-out` with `all-checkedin` and exclude unresolved/program-blocked records, disclosing this selection. Compare simple prevalence/logistic baselines with a tree model. Report calibration, Brier score, precision/recall and class balance.

For all models:

- Split chronologically; keep every slot from a day together. Never random-split adjacent court records.
- Fit preprocessing using training data only; weather/storm correlation reduces effective sample size.
- Retrospective explanation may use observed weather; tomorrow's advice requires archived forecasts or information available at the prediction cutoff.
- Group uncertainty estimation by date; validate across seasons when adequate coverage exists.
- Add a model only if it improves held-out performance and can be explained honestly. Include a model card and baseline results.

Do not build walkup success probability until queue arrivals, failed attempts, and reliable availability history are available. Do not infer individual identities or rank staff/players.

## 10. Work packages and acceptance criteria

### P0 — Verified data foundation

- Produce a reproducible profile and compare with prior reported counts.
- Confirm or flag slot mappings; implement cohort and exclusion ledger.
- Create source manifest and sanitized public schema.
- Acceptance: every count traceable to inputs; public payloads contain no staff free text; unresolved issues documented.

### P1 — Player utility MVP

- Implement overview, walkup planner, daily curves, coverage states and court grid.
- Add URL filters, alarm arithmetic, source footers and responsive/accessibility behavior.
- Acceptance: April/Wednesday/6 p.m. reproduces the pipeline result; fewer than 10 dates suppresses the heuristic; filters never imply live availability.

### P2 — Weather and accountability

- Implement cached weather adapters, interval reconciliation and missing-data handling.
- Add rain view, sanitized downloads, methodology and records-needed tracker.
- Acceptance: demonstrate a wet date, dry date and missing-weather date; explain interval boundaries and all displayed denominators.

### P3 — Optional models and new evidence

- Implement chronological baseline evaluation and model cards.
- Add verified FOIL correspondence, additional snapshots, or budget data only when supplied.
- Acceptance: model metrics reproducible on held-out dates; no probability-of-access claim from successful-only records.

### Release gate

- Owner reviews findings, copy, privacy and deployment destination before public launch.
- No raw source CSV committed or deployed. Inspect generated bundles/downloads, not only visible UI.
- Provide README, commands, schema/metric documentation, known limitations, and screenshots of main mobile/desktop views.

## 11. Meaningful verification cases

- Adding duplicate cancellation-action rows cannot change slot counts or timing quantiles.
- Adding `second` / `third` / `fourth` entries cannot change the first qualifying walkup time.
- Earliest canceled walkup plus a later checked-in walkup uses the later qualifying entry, with the metric labeled accordingly.
- Creation after scheduled start is excluded and counted; the snapshot cutoff excludes future outcomes.
- Missing grid cells remain unknown. An unresolved status is never treated as confirmed play.
- Conflicting statuses for the same slot trigger quarantine, not nondeterministic output.
- Every reported share reconciles to the stated eligible denominator.
- Day-weighted curves differ correctly from pooled curves on an imbalanced fixture.
- Missing rainfall stays missing, trace survives, and interval boundaries prevent future-rain leakage.
- Public files contain only allowlisted fields and no raw `reason` values.
- Empty/small samples, weather failure and invalid URL filters have explicit UI states.

## 12. Additional records to request

- Complete slot inventory, including never-booked slots, opening hours, and program/maintenance blocks.
- Export join logic; stable anonymous booking/action identifiers; timestamp timezone and exact extraction time.
- Status definitions and timestamped transitions; actual first-player arrival and second-player check-in events if recorded.
- Waitlist arrival/assignment/departure, unsuccessful attempts, and queue position where available.
- Court closure/reopening logs, surface information and maintenance records.
- For any later fiscal reporting: actual operating expenditures, staffing, fee receipts and clearly defined accounting periods. Keep these separate from reservation-derived metrics.

Do not submit a FOIL request or contact anyone as part of implementation without explicit authorization.

## 13. Starting instruction for the coding agent

Read this plan and both supplied source files. Start with P0, then implement P1 end to end. Recompute prior conversational findings and record discrepancies. Use a static-first architecture and sanitized assets. Make the walkup planner the primary interaction, with bold public-accountability styling and visible evidence. Implement the historical cutoff, successful-only cohort, missing-data states and limited-sample guardrail before polishing charts. Add weather in P2 only after verifying source semantics. Do not fabricate records, promise court availability, infer waste, or publish raw notes. Finish with a runnable project, documented commands, verified metric fixtures and a concise list of remaining data limitations. Do not deploy publicly under this planning-only request.
