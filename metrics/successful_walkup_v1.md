# Metric: successful-walkup-v1

**Earliest qualifying successful walkup entry per slot.** Implemented in `pipeline/core.py::walkup_cohort`.

| # | Rule |
| --- | --- |
| 1 | Slot reservation date is before the configured historical outcome cutoff (`config/pipeline.toml`, default 2026-09-22, unconfirmed). |
| 2 | Slot `schedule_status == 'all-checkedin'` (normalized). |
| 3 | Row `method_of_reservation == 'walkup'` and `player_status == 'Checked in'` (normalized, case-insensitive). |
| 4 | Creation date equals reservation date (naive local times, provisionally America/New_York). |
| 5 | Creation timestamp <= slot start. |
| 6 | Per slot, keep the minimum remaining creation timestamp. |

Grain: one row per validated slot (court-hour). Slots whose ID maps to more than one court, start time, or status are quarantined before this step.

What it is **not**: the original reservation for the slot, a queue-arrival time, a check-in time, a person, or a probability of access.

## Derived planner outputs (`app/src/lib/stats.ts`)

- **Pooled percentiles**: P25/P50/P75 over all qualifying slots in the filter (busy dates weigh more). Linear interpolation (Hyndman-Fan type 7).
- **Day-weighted**: percentiles of each date's median entry time (each date counts once).
- **Daily curve**: for date *d* with qualifying times *B_d*, `F_d(t) = |{b in B_d : b <= t}| / |B_d|`. The band is the median and IQR of `F_d(t)` across dates at each 5-minute clock time. Dates with records but zero qualifying entries are reported separately, never drawn as zero.
- **Typical day (shown in the app):** for each matching date, that day's 25/50/75% booking time, its 5th-from-last booking and its last booking; the app shows the median of each across dates.
- **Planning benchmark and alarm:** still computed in `stats.ts` (P25 across dates of each date's P25, floored to 15 minutes), but **no longer shown**. The owner chose to present the data without a recommended arrival time.

Hour windows are combined from slot-level data, never by averaging percentiles.
