"""Data-quality screen applied after the walk-up cohort (quality-v1).

Removes records that are implausible for the question "when were walk-up courts
taken?", and counts every removal. The unscreened cohort is kept for
reconciliation with earlier analysis; the app uses the screened one.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

QUALITY_VERSION = "quality-v1"


@dataclass
class QualityResult:
    timing: pd.DataFrame
    partial_days: list[str]
    ledger: list[dict]


def _hhmm(minute: int) -> str:
    return f"{minute // 60}:{minute % 60:02d}"


def first_taken(norm: pd.DataFrame, timing: pd.DataFrame) -> pd.DataFrame:
    """When each played court-hour was first taken by a walk-up.

    The cohort's time is the earliest *checked-in* walk-up entry. If an earlier
    walk-up booking for the same court-hour was cancelled or no-showed, the court
    was really gone at that earlier time and only freed up later. Returns timing
    with `taken_local` (earliest same-day walk-up first-player entry, any player
    status, at or before start) and `freed_then_retaken` (checked-in entry came
    more than a minute later).
    """
    rows = norm[
        norm["slot_id"].isin(timing["slot_id"]) & (norm["method_n"] == "walkup") & norm["created_local"].notna()
    ][["slot_id", "created_local"]].merge(timing[["slot_id", "res_local"]].rename(columns={"res_local": "start"}), on="slot_id")
    rows = rows[(rows["created_local"].dt.normalize() == rows["start"].dt.normalize()) & (rows["created_local"] <= rows["start"])]
    taken = rows.groupby("slot_id")["created_local"].min().rename("taken_local")
    out = timing.merge(taken, on="slot_id", how="left")
    out["taken_local"] = out["taken_local"].fillna(out["earliest_local"])
    out["taken_local"] = out[["taken_local", "earliest_local"]].min(axis=1)
    out["freed_then_retaken"] = (out["earliest_local"] - out["taken_local"]) > pd.Timedelta(minutes=1)
    out["retaken_minute"] = out["earliest_local"].dt.hour * 60 + out["earliest_local"].dt.minute
    out["minute_of_day"] = out["taken_local"].dt.hour * 60 + out["taken_local"].dt.minute
    return out


def morning_closed_days(slots: pd.DataFrame, share: float = 0.5, min_records: int = 5) -> set[str]:
    """Dates where at least `share` of recorded 7–11 AM court-hours were rained out."""
    m = slots[slots["hour"].between(7, 11)]
    g = m.groupby("date").agg(n=("slot_id", "size"), ro=("status", lambda s: int((s == "rained-out").sum())))
    g = g[g["n"] >= min_records]
    return set(g.index[g["ro"] / g["n"] >= share])


def screen_timing(
    timing: pd.DataFrame,
    slots: pd.DataFrame,
    desk_open_minute: int = 390,
    grace_minutes: int = 10,
    min_day_court_hours: int = 10,
    quiet_morning_minute: int = 540,
) -> QualityResult:
    """Drop walk-up entries made before the booking desk opens, and fragment days.

    desk_open_minute: minute of day the walk-up desk normally starts entering
    bookings (6:30 AM, observed: the median day's first walk-up entry).
    min_day_court_hours: dates with fewer recorded court-hours are fragments of
    a day (e.g. the first days of the export), not a representative day.
    """
    ledger: list[dict] = []
    earliest_ok = desk_open_minute - grace_minutes

    per_day = slots.groupby("date").size()
    partial = sorted(per_day.index[per_day < min_day_court_hours])

    pre_desk = timing["minute_of_day"] < earliest_ok
    ledger.append(
        {
            "rule": f"Walk-up entered before {_hhmm(earliest_ok)} AM",
            "removed": int(pre_desk.sum()),
            "unit": "court-hours",
            "why": f"The desk opens around {_hhmm(desk_open_minute)} AM; earlier entries look like staff pre-entries, not walk-ups.",
        }
    )
    in_partial = timing["date"].isin(partial) & ~pre_desk
    ledger.append(
        {
            "rule": f"Days with under {min_day_court_hours} recorded court-hours",
            "removed": int(in_partial.sum()),
            "unit": "court-hours",
            "why": f"{len(partial)} fragment days ({', '.join(partial) if partial else 'none'}) would count as full days in day-by-day figures.",
        }
    )
    kept = timing[~pre_desk & ~timing["date"].isin(partial)]

    # Dry days with no walk-up activity before `quiet_morning_minute` look like
    # system or event days (e.g. bookings entered later in bulk), not demand.
    first_of_day = kept.groupby("date")["minute_of_day"].min()
    closed = morning_closed_days(slots)
    quiet = sorted(d for d, m in first_of_day.items() if m >= quiet_morning_minute and d not in closed)
    in_quiet = kept["date"].isin(quiet)
    ledger.append(
        {
            "rule": f"Dry days with no walk-up before {_hhmm(quiet_morning_minute)} AM",
            "removed": int(in_quiet.sum()),
            "unit": "court-hours",
            "why": f"{len(quiet)} days ({', '.join(quiet) if quiet else 'none'}) where the desk shows no morning walk-ups although mornings weren't rained out; likely a system or event day.",
        }
    )
    clean = kept[~in_quiet].reset_index(drop=True)
    return QualityResult(timing=clean, partial_days=sorted(set(partial) | set(quiet)), ledger=ledger)
