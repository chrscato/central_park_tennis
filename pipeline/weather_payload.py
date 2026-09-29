"""Assemble the public weather.json payload and per-date hourly strips."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from . import weather


def col(values, digits: int | None = 2) -> list:
    """NaN-safe JSON column: NaN -> None, floats rounded."""
    out = []
    for v in values:
        if v is None or (isinstance(v, float) and np.isnan(v)):
            out.append(None)
        elif isinstance(v, (bool, np.bool_)):
            out.append(bool(v))
        elif isinstance(v, (float, np.floating)):
            out.append(round(float(v), digits) if digits is not None else float(v))
        elif isinstance(v, np.integer):
            out.append(int(v))
        else:
            out.append(v)
    return out


def reconcile(hdaily: pd.DataFrame, lcd: pd.DataFrame) -> dict:
    """Compare complete-day hourly sums with official daily totals.

    Hourly sums are regrouped to Local Standard Time days first; remaining
    differences are logged rather than forced to agree.
    """
    j = hdaily.merge(lcd[["date", "rain_in"]].rename(columns={"rain_in": "lcd"}), on="date").dropna(subset=["rain_in", "lcd"])
    wet = j[(j["rain_in"] > 0) | (j["lcd"] > 0)]
    diff = (wet["rain_in"] - wet["lcd"]).abs()
    return {
        "complete_days_compared": int(len(j)),
        "wet_days": int(len(wet)),
        "wet_within_0_03_in": round(float((diff <= 0.03 + 1e-9).mean()), 3) if len(wet) else None,
        "dry_wet_agreement": round(float(((j["rain_in"] > 0) == (j["lcd"] > 0)).mean()), 3) if len(j) else None,
        "largest_differences": [
            {"date": r.date, "hourly_sum_in": round(float(r.rain_in), 2), "lcd_daily_in": round(float(r.lcd), 2)}
            for r in wet.assign(d=diff).sort_values("d", ascending=False).head(5).itertuples()
        ],
    }


def build(
    lcd_paths: list[Path],
    lcd_units: str,
    iem_path: Path,
    hourly_cov: pd.DataFrame,
    cutoff: str,
    first_date: str,
    dry_version: str,
    ncei_cache: Path | None = None,
) -> tuple[dict, dict[str, list]]:
    if not lcd_paths or not iem_path.exists():
        raise FileNotFoundError(f"weather inputs missing (lcd files={len(lcd_paths)}, iem exists={iem_path.exists()})")
    lcd_used, lcd_report = weather.dedupe_files(lcd_paths)
    lcd = weather.load_lcd_daily(lcd_used, lcd_units)
    warnings = weather.check_units(lcd, lcd_units)
    iem = weather.load_iem_hourly(iem_path)
    grid = weather.hourly_grid(iem)
    hdaily = weather.daily_from_hourly(grid)
    recon = reconcile(weather.daily_from_hourly(grid, basis="lst"), lcd)
    recon["basis"] = "hourly sums regrouped to Local Standard Time days to match LCD"

    start = (pd.Timestamp(first_date) - pd.Timedelta(days=3)).strftime("%Y-%m-%d")
    end = (pd.Timestamp(cutoff) - pd.Timedelta(days=1)).strftime("%Y-%m-%d")

    ncei_meta = None
    lcd_last = lcd["date"].max()
    if ncei_cache and lcd_last < end:
        fill_start = (pd.Timestamp(lcd_last) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        try:
            ncei, ncei_meta = weather.fetch_ncei_daily("USW00094728", fill_start, end, ncei_cache)
            ncei = ncei[~ncei["date"].isin(lcd["date"]) & ncei["rain_in"].notna()].assign(
                suspect=False, tmax_f=np.nan, tmin_f=np.nan, source="ncei-daily-api"
            )
            lcd_all = pd.concat([lcd, ncei], ignore_index=True).sort_values("date")
        except Exception as e:  # never block the build on the network
            ncei_meta = {"error": str(e)}
            lcd_all = lcd
    else:
        lcd_all = lcd
    d = weather.build_daily(lcd_all, hdaily, start, end)

    cells = hourly_cov[hourly_cov["date"] < cutoff][["date", "hour", "recorded", "all-checkedin", "rained-out"]].reset_index(drop=True)
    feats = weather.slot_hour_features(grid, cells)
    didx = {x: i for i, x in enumerate(d["date"])}

    by_date: dict[str, list] = {}
    lo = pd.Timestamp(first_date)
    for ts, row in grid[grid.index >= lo].iterrows():
        by_date.setdefault(ts.strftime("%Y-%m-%d"), []).append(
            {
                "hour": int(ts.hour),
                "rain_in": None if np.isnan(row["rain_in"]) else round(float(row["rain_in"]), 2),
                "trace": bool(row["trace"]),
            }
        )

    covered = d[d["source"] != "missing"]
    payload = {
        "status": "available",
        "dry_definition": dry_version,
        "definitions": {
            "dry": "Measured 0.00 in with no trace. Missing data never counts as dry.",
            "trace": "Precipitation observed but too small to measure (under 0.005 in).",
            "wet": "At least 0.01 in measured.",
            "same_day": "Rain on the reservation date itself (known only after the fact).",
            "prev1": "Rain on the previous calendar day.",
            "trail2": "Total over the 2 days before the date (excludes the date itself).",
            "trail3": "Total over the 3 days before the date (excludes the date itself).",
            "during": "Hourly observation ending at :51 of the slot's start hour (covers the prior :51 to :51).",
            "prevNh": "Sum of the N hourly observations ending before the slot starts; any missing hour makes it missing.",
        },
        "sources": [
            {
                "role": "daily",
                "provider": "NOAA NCEI Local Climatological Data",
                "station": "USW00094728 (Central Park)",
                "units_in_file": lcd_units,
                "time_basis": "Local Standard Time calendar day",
                "files": lcd_report,
            },
            {
                "role": "hourly",
                "provider": "Iowa Environmental Mesonet ASOS",
                "station": "NYC (Central Park)",
                "units_in_file": "hundredths of an inch (METAR P group)",
                "time_basis": "America/New_York local clock time",
                "files": [
                    {"filename": iem_path.name, "sha256": weather._sha(iem_path), "bytes": iem_path.stat().st_size, "duplicate_of": None}
                ],
            },
        ],
        "coverage": {
            "daily_start": start,
            "daily_end": end,
            "lcd_daily_last": lcd["date"].max(),
            "hourly_first": str(iem["end_local"].min()),
            "hourly_last": str(iem["end_local"].max()),
            "days_by_source": {k: int(v) for k, v in d["source"].value_counts().items()},
            "days_covered": int(len(covered)),
            "days_total": int(len(d)),
            "ncei_gap_fill": ncei_meta,
        },
        "reconciliation": recon,
        "warnings": warnings,
        "daily": {
            "date": d["date"].tolist(),
            "rain": col(d["rain_in"]),
            "trace": col(d["trace"]),
            "source": d["source"].tolist(),
            "prev1": col(d["prev1_in"]),
            "prev1_trace": col(d["prev1_trace"]),
            "trail2": col(d["trail2_in"]),
            "trail2_trace": col(d["trail2_trace"]),
            "trail3": col(d["trail3_in"]),
            "trail3_trace": col(d["trail3_trace"]),
            "tmax_f": col(d["tmax_f"], 1),
            "tmin_f": col(d["tmin_f"], 1),
        },
        "cells": {
            "d": [didx.get(x, -1) for x in feats["date"]],
            "h": feats["hour"].astype(int).tolist(),
            "recorded": feats["recorded"].astype(int).tolist(),
            "checkedin": feats["all-checkedin"].astype(int).tolist(),
            "rainedout": feats["rained-out"].astype(int).tolist(),
            "during": col(feats["during_in"]),
            "during_trace": col(feats["during_trace"]),
            "prev3h": col(feats["prev3h_in"]),
            "prev3h_trace": col(feats["prev3h_trace"]),
            "prev6h": col(feats["prev6h_in"]),
            "prev6h_trace": col(feats["prev6h_trace"]),
            "prev24h": col(feats["prev24h_in"]),
            "prev24h_trace": col(feats["prev24h_trace"]),
        },
    }
    return payload, by_date
