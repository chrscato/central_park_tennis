"""Shape sanitized public assets from validated tables.

Only fields listed explicitly here reach ``app/public/data``. Nothing is copied
from raw rows wholesale, and the ``reason`` column is never referenced.
"""

from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path

import pandas as pd

from .core import SCHEDULE_STATUSES, audit_text_for_reasons


def _dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)


def overview_payload(slots: pd.DataFrame, daily: pd.DataFrame, cutoff: str) -> dict:
    pre = slots[slots["date"] < cutoff]
    n = len(pre)
    counts = pre["status"].value_counts().reindex(SCHEDULE_STATUSES, fill_value=0)
    week = pre.assign(week=pd.to_datetime(pre["date"]).dt.to_period("W-SUN").dt.start_time.dt.strftime("%Y-%m-%d"))
    weekly = week.pivot_table(index="week", columns="status", values="slot_id", aggfunc="count", fill_value=0)
    weekly = weekly.reindex(columns=SCHEDULE_STATUSES, fill_value=0)
    return {
        "unit": "recorded court-hours (distinct validated slot IDs)",
        "filter": f"reservation date before {cutoff}",
        "cards": {
            "recorded_court_hours": int(n),
            "status_counts": {k: int(v) for k, v in counts.items()},
            "checked_in_share": float(counts["all-checkedin"] / n) if n else None,
            "rained_out_share": float(counts["rained-out"] / n) if n else None,
            "represented_dates": int(pre["date"].nunique()),
            "first_outcome_date": pre["date"].min() if n else None,
            "latest_outcome_date": pre["date"].max() if n else None,
            "courts": int(pre["court_num"].nunique()),
        },
        "weekly": [
            {"week_start": w, **{s: int(r[s]) for s in SCHEDULE_STATUSES}} for w, r in weekly.iterrows()
        ],
        "daily": [
            {
                "date": r["date"],
                "recorded": int(r["recorded"]),
                "courts": int(r["courts"]),
                "hours": int(r["hours"]),
                "first_hour": int(r["first_hour"]),
                "last_hour": int(r["last_hour"]),
                "post_cutoff": bool(r["post_cutoff"]),
                **{s: int(r[s]) for s in SCHEDULE_STATUSES},
            }
            for _, r in daily.iterrows()
        ],
    }


def timing_payload(timing: pd.DataFrame, hourly: pd.DataFrame, cutoff: str, cohort_version: str, groups: dict | None = None) -> dict:
    hourly = hourly[hourly["date"] < cutoff]
    dates = sorted(set(hourly["date"]))
    idx = {d: i for i, d in enumerate(dates)}
    out = {
        "cohort_version": cohort_version,
        "unit": "earliest qualifying successful walkup entry per slot (local minute of day)",
        "dates": dates,
        "slots": {
            "d": [idx[d] for d in timing["date"]],
            "h": timing["hour"].astype(int).tolist(),
            "m": timing["minute_of_day"].astype(int).tolist(),
            "c": timing["court_num"].astype(int).tolist(),
        },
        "hourly": {
            "d": [idx[d] for d in hourly["date"]],
            "h": hourly["hour"].astype(int).tolist(),
            "recorded": hourly["recorded"].astype(int).tolist(),
            "checkedin": hourly["all-checkedin"].astype(int).tolist(),
            "qualifying": hourly["qualifying"].astype(int).tolist(),
        },
    }
    if groups is not None and "recorded_walkup_courts" in hourly:
        out["court_groups"] = {k: groups[k] for k in ("walkup", "online", "online_share", "rule")}
        out["hourly"]["recorded_wc"] = hourly["recorded_walkup_courts"].astype(int).tolist()
        out["hourly"]["qualifying_wc"] = hourly["qualifying_walkup_courts"].astype(int).tolist()
    return out


def _counts_by_slot(rows: pd.DataFrame, col: str) -> dict[str, dict[str, int]]:
    ct = rows[rows[col] != ""].groupby(["slot_id", col]).size()
    out: dict[str, dict[str, int]] = {}
    for (sid, val), n in ct.items():
        out.setdefault(sid, {})[val] = int(n)
    return out


def slot_partitions(
    norm: pd.DataFrame, slots: pd.DataFrame, timing: pd.DataFrame, cutoff: str, weather_by_date: dict | None = None
) -> dict[str, dict]:
    rows = norm[norm["slot_id"].isin(slots["slot_id"])]
    methods = _counts_by_slot(rows, "method_n")
    players = _counts_by_slot(rows, "player_status_n")
    permits = _counts_by_slot(rows, "permit_n")
    actions = _counts_by_slot(rows, "action_n")
    t = timing.set_index("slot_id")
    parts: dict[str, dict] = {}
    for date, grp in slots.sort_values(["court_num", "hour"]).groupby("date"):
        items = []
        for r in grp.itertuples(index=False):
            w = None
            if r.slot_id in t.index:
                tr = t.loc[r.slot_id]
                w = {"time": tr["earliest_local"].strftime("%H:%M"), "lead_minutes": float(tr["lead_minutes"])}
            items.append(
                {
                    "id": r.slot_id,
                    "court": int(r.court_num),
                    "hour": int(r.hour),
                    "status": r.status,
                    "rows": int(r.n_rows),
                    "methods": methods.get(r.slot_id, {}),
                    "player_statuses": players.get(r.slot_id, {}),
                    "permits": permits.get(r.slot_id, {}),
                    "actions": actions.get(r.slot_id, {}),
                    "walkup": w,
                }
            )
        parts[date] = {
            "date": date,
            "post_cutoff": date >= cutoff,
            "slots": items,
            "weather": (weather_by_date or {}).get(date),
        }
    return parts


def write_downloads(out: Path, timing: pd.DataFrame, daily: pd.DataFrame) -> None:
    d = out / "downloads"
    d.mkdir(parents=True, exist_ok=True)
    t = timing.assign(
        weekday=timing["res_local"].dt.day_name(),
        slot_start_local=timing["res_local"].dt.strftime("%Y-%m-%d %H:%M"),
        earliest_qualifying_walkup_local=timing["earliest_local"].dt.strftime("%Y-%m-%d %H:%M:%S"),
    )
    t[["date", "weekday", "hour", "court_num", "slot_start_local", "earliest_qualifying_walkup_local", "lead_minutes"]].to_csv(
        d / "walkup_timing_v1.csv", index=False, lineterminator="\n", quoting=csv.QUOTE_MINIMAL
    )
    daily.to_csv(d / "coverage_daily_v1.csv", index=False, lineterminator="\n")


def write_public(
    staging: Path,
    manifest: dict,
    overview: dict,
    timing: dict,
    partitions: dict[str, dict],
    timing_df: pd.DataFrame,
    daily_df: pd.DataFrame,
    weather_payload: dict | None = None,
    insight_payload: dict | None = None,
) -> None:
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    _dump(staging / "overview.json", overview)
    _dump(staging / "timing.json", timing)
    _dump(staging / "weather.json", weather_payload or {"status": "unavailable"})
    _dump(staging / "insights.json", insight_payload or {})
    for date, p in partitions.items():
        _dump(staging / "slots" / f"{date}.json", p)
    write_downloads(staging, timing_df, daily_df)
    files = sorted(str(p.relative_to(staging)).replace("\\", "/") for p in staging.rglob("*") if p.is_file())
    manifest["public_files"] = {"count": len(files) + 1, "non_slot_files": [f for f in files if not f.startswith("slots/")]}
    _dump(staging / "manifest.json", manifest)


def audit_public(staging: Path, reasons: set[str]) -> list[tuple[str, str]]:
    """Scan every generated file for raw reason text. Returns (file, hit) pairs."""
    leaks = []
    for p in staging.rglob("*"):
        if p.is_file():
            text = p.read_text(encoding="utf-8")
            for hit in audit_text_for_reasons(text, reasons):
                leaks.append((str(p), hit))
    return leaks


def promote(staging: Path, target: Path) -> None:
    """Swap staging into place, keeping the previous good build as a backup.

    The backup sits outside the web root's parent (e.g. app/.public-data.previous)
    so static-site bundlers never copy it into the published site.
    """
    previous = target.parent.parent / f".{target.parent.name}-{target.name}.previous"
    if previous.exists():
        shutil.rmtree(previous)
    if not target.exists():
        staging.rename(target)
        return
    try:
        target.rename(previous)
        staging.rename(target)
    except PermissionError:
        # Windows: a file watcher (e.g. the Vite dev server) can lock the directory.
        # Fall back to copying: back up, then mirror staging into place.
        if not previous.exists():
            shutil.copytree(target, previous)
        new = {p.relative_to(staging) for p in staging.rglob("*") if p.is_file()}
        for p in list(target.rglob("*")):
            if p.is_file() and p.relative_to(target) not in new:
                p.unlink()
        shutil.copytree(staging, target, dirs_exist_ok=True)
        shutil.rmtree(staging)
