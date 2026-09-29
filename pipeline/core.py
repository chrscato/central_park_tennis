"""Pure transformation functions for the FOIL reservation export.

Everything here takes and returns DataFrames so it can be exercised with small
fixtures in tests. File I/O lives in ``pipeline.build``; public-asset shaping
lives in ``pipeline.publish``.

Key rules (see guidelines §3):
- A CSV row is not a booking, player, or court-hour. Court-hours are distinct,
  validated slot IDs.
- Slots whose ID maps to more than one court / start time / status are
  quarantined, never resolved by picking a row.
- The raw ``reason`` column never leaves this module except in private outputs.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

REQUIRED_COLUMNS = [
    "schedule_slot_id",
    "court",
    "reservation_time_and_date",
    "schedule_status",
    "reason",
    "creation_timestamp",
    "player_status",
    "method_of_reservation",
    "permit_type",
    "action",
    "cancellation_time",
]

SCHEDULE_STATUSES = [
    "all-checkedin",
    "rained-out",
    "assigned",
    "booking-in-progress",
    "unassigned",
    "unbookable",
]

TIMESTAMP_FORMAT = "%Y-%m-%d %H:%M:%S"


class SchemaError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_raw(path: Path) -> pd.DataFrame:
    """Read the export with every value as an untouched string."""
    df = pd.read_csv(path, dtype=str, keep_default_na=False, na_filter=False)
    validate_columns(df)
    df.insert(0, "row_number", range(1, len(df) + 1))
    return df


def validate_columns(df: pd.DataFrame) -> None:
    cols = [c for c in df.columns if c != "row_number"]
    if cols != REQUIRED_COLUMNS:
        missing = sorted(set(REQUIRED_COLUMNS) - set(cols))
        extra = sorted(set(cols) - set(REQUIRED_COLUMNS))
        raise SchemaError(f"Unexpected columns. missing={missing} extra={extra} order={cols}")


def _parse_ts(s: pd.Series) -> pd.Series:
    stripped = s.str.strip()
    return pd.to_datetime(stripped.where(stripped != ""), format=TIMESTAMP_FORMAT, errors="coerce")


def _tz_flag(naive: pd.Series, tz: str) -> pd.Series:
    """'ok', 'dst-ambiguous-or-nonexistent', or 'missing' for each naive local time."""
    localized = naive.dt.tz_localize(tz, ambiguous="NaT", nonexistent="NaT")
    flag = pd.Series("ok", index=naive.index)
    flag[naive.isna()] = "missing"
    flag[naive.notna() & localized.isna()] = "dst-ambiguous-or-nonexistent"
    return flag


def normalize(raw: pd.DataFrame, tz: str = "America/New_York") -> pd.DataFrame:
    """Add normalized comparison columns. Original columns are preserved as-is."""
    df = raw.copy()
    df["slot_id"] = df["schedule_slot_id"].str.strip()
    df["court_label"] = df["court"].str.strip()
    df["court_num"] = pd.to_numeric(
        df["court_label"].str.extract(r"(\d+)", expand=False), errors="coerce"
    ).astype("Int64")
    df["status_n"] = df["schedule_status"].str.strip().str.lower()
    df["player_status_n"] = df["player_status"].str.strip().str.lower()
    df["method_n"] = df["method_of_reservation"].str.strip().str.lower()
    df["permit_n"] = df["permit_type"].str.strip()
    df["action_n"] = df["action"].str.strip().str.lower()

    df["res_local"] = _parse_ts(df["reservation_time_and_date"])
    df["created_local"] = _parse_ts(df["creation_timestamp"])
    df["cancel_local"] = _parse_ts(df["cancellation_time"])

    df["res_parse_error"] = df["res_local"].isna()
    df["created_parse_error"] = df["created_local"].isna() & (df["creation_timestamp"].str.strip() != "")
    df["res_tz_flag"] = _tz_flag(df["res_local"], tz)
    df["created_tz_flag"] = _tz_flag(df["created_local"], tz)
    return df


@dataclass
class SlotBuild:
    slots: pd.DataFrame
    quarantine: pd.DataFrame
    issues: dict = field(default_factory=dict)


def build_slots(norm: pd.DataFrame) -> SlotBuild:
    """One row per validated slot ID; conflicting IDs are quarantined."""
    usable = norm[~norm["res_parse_error"] & (norm["slot_id"] != "")]
    g = usable.groupby("slot_id", sort=False)
    nun = g.agg(
        n_court=("court_label", "nunique"),
        n_time=("res_local", "nunique"),
        n_status=("status_n", "nunique"),
    )
    conflict_ids = nun.index[(nun > 1).any(axis=1)]
    quarantine = nun.loc[conflict_ids].reset_index()

    clean = usable[~usable["slot_id"].isin(conflict_ids)]
    slots = (
        clean.groupby("slot_id", sort=False)
        .agg(
            court_label=("court_label", "first"),
            court_num=("court_num", "first"),
            res_local=("res_local", "first"),
            status=("status_n", "first"),
            res_tz_flag=("res_tz_flag", "first"),
            n_rows=("row_number", "size"),
        )
        .reset_index()
    )
    slots["date"] = slots["res_local"].dt.strftime("%Y-%m-%d")
    slots["hour"] = slots["res_local"].dt.hour
    issues = {
        "rows_with_unparseable_reservation_time": int(norm["res_parse_error"].sum()),
        "rows_with_blank_slot_id": int((norm["slot_id"] == "").sum()),
        "rows_with_unparseable_creation_time": int(norm["created_parse_error"].sum()),
        "quarantined_slot_ids": int(len(conflict_ids)),
        "rows_in_quarantined_slots": int(usable["slot_id"].isin(conflict_ids).sum()),
        "unknown_schedule_statuses": sorted(set(slots["status"]) - set(SCHEDULE_STATUSES)),
    }
    return SlotBuild(slots=slots, quarantine=quarantine, issues=issues)


@dataclass
class CohortBuild:
    timing: pd.DataFrame
    slot_ledger: list[dict]
    row_ledger: list[dict]


def walkup_cohort(norm: pd.DataFrame, slots: pd.DataFrame, cutoff: str) -> CohortBuild:
    """Earliest qualifying successful walkup entry per slot (successful-walkup-v1).

    1. Slot reservation date is before the historical outcome cutoff.
    2. schedule_status == 'all-checkedin'.
    3. Row method == 'walkup' and player_status == 'checked in'.
    4. Creation date == reservation date (naive local, assumed America/New_York).
    5. Creation timestamp <= slot start.
    6. Per slot, take the earliest remaining creation timestamp.

    This is *not* necessarily the original reservation for the slot, and it does
    not identify people. Duplicate rows cannot add observations because the
    result is one row per slot.
    """
    cutoff_ts = pd.Timestamp(cutoff)
    ledger: list[dict] = []

    def step(label: str, count: int, note: str = "") -> None:
        ledger.append({"step": label, "slots": int(count), "note": note})

    step("Validated slots in export", len(slots))
    pre = slots[slots["res_local"] < cutoff_ts]
    step(
        "Excluded: reservation date on/after historical cutoff",
        len(slots) - len(pre),
        f"cutoff {cutoff} (post-snapshot, outcomes not final)",
    )
    step("Slots before cutoff", len(pre))

    status_counts = pre["status"].value_counts()
    for status, n in status_counts.items():
        if status != "all-checkedin":
            step(f"Excluded: schedule status '{status}'", n)
    ci = pre[pre["status"] == "all-checkedin"]
    step("Slots with status 'all-checkedin'", len(ci))

    rows = norm[norm["slot_id"].isin(ci["slot_id"])].merge(
        ci[["slot_id", "res_local"]].rename(columns={"res_local": "slot_start"}), on="slot_id"
    )
    row_ledger: list[dict] = [{"rule": "Rows attached to all-checkedin slots before cutoff", "rows": int(len(rows))}]
    for method, n in rows.loc[rows["method_n"] != "walkup", "method_n"].value_counts().items():
        row_ledger.append({"rule": f"Excluded row: method '{method}'", "rows": int(n)})
    walk = rows[rows["method_n"] == "walkup"]
    for ps, n in walk.loc[walk["player_status_n"] != "checked in", "player_status_n"].value_counts().items():
        row_ledger.append({"rule": f"Excluded row: walkup with player status '{ps}'", "rows": int(n)})
    cand = walk[walk["player_status_n"] == "checked in"]
    row_ledger.append({"rule": "Candidate rows: walkup + checked in", "rows": int(len(cand))})

    missing_created = cand["created_local"].isna()
    diff_date = ~missing_created & (cand["created_local"].dt.normalize() != cand["slot_start"].dt.normalize())
    after_start = ~missing_created & ~diff_date & (cand["created_local"] > cand["slot_start"])
    ok = ~missing_created & ~diff_date & ~after_start
    row_ledger += [
        {"rule": "Excluded row: missing/unparseable creation time", "rows": int(missing_created.sum())},
        {"rule": "Excluded row: created on a different date than the slot", "rows": int(diff_date.sum())},
        {"rule": "Excluded row: created after slot start", "rows": int(after_start.sum())},
        {"rule": "Qualifying rows", "rows": int(ok.sum())},
    ]

    cand_slots = set(cand["slot_id"])
    ok_slots = set(cand.loc[ok, "slot_id"])
    same_day_slots = set(cand.loc[~missing_created & ~diff_date, "slot_id"])
    no_candidate = len(set(ci["slot_id"]) - cand_slots)
    only_after_start = len(same_day_slots - ok_slots)
    only_other = len(cand_slots - ok_slots) - only_after_start
    step("Excluded: no walkup + checked-in row", no_candidate, "e.g. online, waiting list, repeat list")
    step("Excluded: walkup rows only on a different date / missing time", only_other)
    step("Excluded: walkup rows only created after slot start", only_after_start)

    q = cand[ok]
    timing = (
        q.groupby("slot_id")
        .agg(
            earliest_local=("created_local", "min"),
            n_qualifying_rows=("created_local", "size"),
            created_tz_flag=("created_tz_flag", lambda s: s.iloc[0]),
        )
        .reset_index()
        .merge(slots[["slot_id", "court_num", "res_local", "date", "hour", "res_tz_flag"]], on="slot_id")
    )
    # tz flag of the chosen (earliest) row
    earliest_rows = q.sort_values("created_local").drop_duplicates("slot_id")[["slot_id", "created_tz_flag"]]
    timing = timing.drop(columns="created_tz_flag").merge(earliest_rows, on="slot_id")
    timing["minute_of_day"] = timing["earliest_local"].dt.hour * 60 + timing["earliest_local"].dt.minute
    timing["lead_minutes"] = ((timing["res_local"] - timing["earliest_local"]).dt.total_seconds() / 60).round(1)
    timing = timing.sort_values(["res_local", "court_num"]).reset_index(drop=True)
    step("Qualifying successful walkup slots", len(timing), "earliest qualifying entry per slot")
    return CohortBuild(timing=timing, slot_ledger=ledger, row_ledger=row_ledger)


ADDITIONAL_PLAYER_METHODS = {"second", "third", "fourth"}


def court_groups(norm: pd.DataFrame, slots: pd.DataFrame, online_threshold: float = 0.5) -> dict:
    """Classify courts by how their slots are booked.

    A slot counts as "online" if any first-player row (not 2nd/3rd/4th player)
    was booked online. Courts where at least `online_threshold` of such slots
    are online are "online courts"; the rest are "walk-up courts".
    """
    rows = norm[norm["slot_id"].isin(slots["slot_id"]) & ~norm["method_n"].isin(ADDITIONAL_PLAYER_METHODS)]
    per_slot = rows.groupby("slot_id")["method_n"].agg(lambda s: bool((s == "online").any())).rename("online")
    per_slot = per_slot.to_frame().join(slots.set_index("slot_id")["court_num"])
    share = per_slot.groupby("court_num")["online"].mean().sort_index()
    return {
        "online_share": {int(c): round(float(v), 3) for c, v in share.items()},
        "walkup": [int(c) for c, v in share.items() if v < online_threshold],
        "online": [int(c) for c, v in share.items() if v >= online_threshold],
        "rule": f"online court = at least {online_threshold:.0%} of slots booked online by the first player",
    }


def coverage_hourly(slots: pd.DataFrame, timing: pd.DataFrame, walkup_courts: list[int] | None = None) -> pd.DataFrame:
    """Recorded slots per date x hour by status. Missing cells are simply absent."""
    counts = slots.pivot_table(index=["date", "hour"], columns="status", values="slot_id", aggfunc="count", fill_value=0)
    for s in SCHEDULE_STATUSES:
        if s not in counts.columns:
            counts[s] = 0
    counts = counts[SCHEDULE_STATUSES + [c for c in counts.columns if c not in SCHEDULE_STATUSES]]
    counts["recorded"] = counts.sum(axis=1)
    q = timing.groupby(["date", "hour"]).size().rename("qualifying")
    out = counts.join(q, how="left").fillna({"qualifying": 0})
    if walkup_courts is not None:
        wc = slots[slots["court_num"].isin(walkup_courts)]
        out = out.join(wc.groupby(["date", "hour"]).size().rename("recorded_walkup_courts"), how="left")
        tq = timing[timing["court_num"].isin(walkup_courts)].groupby(["date", "hour"]).size().rename("qualifying_walkup_courts")
        out = out.join(tq, how="left").fillna({"recorded_walkup_courts": 0, "qualifying_walkup_courts": 0})
    out = out.reset_index()
    out.columns.name = None
    return out.astype({c: int for c in out.columns if c not in ("date",)})


def coverage_daily(slots: pd.DataFrame, cutoff: str) -> pd.DataFrame:
    g = slots.groupby("date")
    daily = g.agg(
        recorded=("slot_id", "size"),
        courts=("court_num", "nunique"),
        hours=("hour", "nunique"),
        first_hour=("hour", "min"),
        last_hour=("hour", "max"),
    )
    by_status = slots.pivot_table(index="date", columns="status", values="slot_id", aggfunc="count", fill_value=0)
    for s in SCHEDULE_STATUSES:
        if s not in by_status.columns:
            by_status[s] = 0
    daily = daily.join(by_status[SCHEDULE_STATUSES]).reset_index()
    daily["post_cutoff"] = daily["date"] >= cutoff
    return daily


def planner_reference(timing: pd.DataFrame, month: int, weekday: int, hours: list[int]) -> dict:
    """Pipeline-side reference result used to check the front-end planner.

    weekday uses Monday=0 (pandas convention).
    """
    t = timing[
        (timing["res_local"].dt.month == month)
        & (timing["res_local"].dt.weekday == weekday)
        & (timing["hour"].isin(hours))
    ]
    mins = t["minute_of_day"].sort_values().to_numpy()

    def pct(p: float) -> float | None:
        # Linear interpolation between order statistics (Hyndman-Fan type 7).
        if len(mins) == 0:
            return None
        return float(pd.Series(mins).quantile(p, interpolation="linear"))

    return {
        "month": month,
        "weekday_mon0": weekday,
        "hours": hours,
        "slots": int(len(t)),
        "dates": int(t["date"].nunique()),
        "pooled_p25_minute": pct(0.25),
        "pooled_p50_minute": pct(0.5),
        "pooled_p75_minute": pct(0.75),
    }


CONTROLLED_VOCAB_COLUMNS = ["schedule_status", "player_status", "method_of_reservation", "permit_type", "action"]
# The app's own single-word labels (weather definitions). A note consisting only
# of one of these words reveals nothing when the app prints its own label.
APP_VOCAB = {"wet", "dry", "trace", "rain", "missing"}


def reason_strings(raw: pd.DataFrame) -> set[str]:
    """Distinct non-blank reason values for leak auditing.

    Values identical (case-insensitively) to a controlled-vocabulary value from
    another column, e.g. a note reading just "waiting list", or to one of the
    app's own labels (APP_VOCAB), carry no free text and are exempt; everything
    else must never appear in public output.
    """
    vocab = set(APP_VOCAB)
    for c in CONTROLLED_VOCAB_COLUMNS:
        vocab |= set(raw[c].str.strip().str.lower())
    vals = raw["reason"].str.strip()
    return {v for v in set(vals[vals != ""]) if v.lower() not in vocab}


_WS = re.compile(r"\s+")


def audit_text_for_reasons(text: str, reasons: set[str], min_substring_len: int = 12) -> list[str]:
    """Return any reason values found in text (exact JSON/CSV value or long substring)."""
    hits = []
    for r in reasons:
        if f'"{r}"' in text or f",{r}," in text or f",{r}\n" in text:
            hits.append(r)
        elif len(_WS.sub(" ", r)) >= min_substring_len and r in text:
            hits.append(r)
    return hits
