"""Historical weather adapter: NOAA LCD (daily) + IEM ASOS METARs (hourly).

Verified source semantics (see docs/weather.md):

* NOAA LCD, station USW00094728 (Central Park). Downloaded in METRIC units:
  DailyPrecipitation is millimetres, temperatures are degrees C. "T" = trace.
  Timestamps are Local Standard Time (no DST); the daily summary (REPORT_TYPE
  "SOD") covers the LST calendar day.
* IEM ASOS, station NYC (same Central Park sensor). ``valid`` is America/New_York
  local clock time (checked against the METAR Z time). Hourly precipitation is
  parsed from the METAR ``Pxxxx`` group of routine :51 observations: hundredths
  of an inch in the hour ending at the observation; ``P0000`` = trace (IEM
  stores these as null in ``p01i``). No P group in a routine AO2 report = no
  precipitation that hour; ``PNO`` (sensor not operating) = missing.

Missing values never become zero, and a trailing window with any missing day or
hour is missing.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import numpy as np
import pandas as pd

MM_PER_INCH = 25.4
TRACE = "trace"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dedupe_files(paths: list[Path]) -> tuple[list[Path], list[dict]]:
    """Drop byte-identical duplicates (e.g. 'file (1).csv'); report what was used."""
    seen: dict[str, Path] = {}
    report = []
    for p in sorted(paths, key=lambda q: (len(q.name), q.name)):  # 'x.csv' before 'x (1).csv'
        h = _sha(p)
        dup_of = seen.get(h)
        report.append({"filename": p.name, "sha256": h, "bytes": p.stat().st_size, "duplicate_of": dup_of.name if dup_of else None})
        seen.setdefault(h, p)
    return list(seen.values()), report


# ---------------------------------------------------------------------------
# Daily (LCD)
# ---------------------------------------------------------------------------


def _lcd_precip_in(v: str, units: str) -> tuple[float, bool]:
    v = v.strip()
    if v == "T":
        return 0.0, True
    if v in ("", "M"):
        return np.nan, False
    v = v.rstrip("s")  # 's' suffix = suspect; value kept, flagged upstream
    x = float(v)
    # ASOS gauges measure hundredths of an inch; LCD metric values are conversions
    # of those, so convert back and round to 0.01 in (e.g. 2.5 mm -> 0.10 in).
    return (round(x / MM_PER_INCH, 2) if units == "metric" else x), False


def load_lcd_daily(paths: list[Path], units: str) -> pd.DataFrame:
    frames = [pd.read_csv(p, dtype=str, keep_default_na=False, low_memory=False) for p in paths]
    lcd = pd.concat(frames, ignore_index=True)
    sod = lcd[lcd["REPORT_TYPE"].str.strip() == "SOD"].copy()
    sod["date"] = sod["DATE"].str[:10]
    sod = sod.drop_duplicates("date", keep="last")
    parsed = sod["DailyPrecipitation"].map(lambda v: _lcd_precip_in(v, units))
    out = pd.DataFrame(
        {
            "date": sod["date"].to_numpy(),
            "rain_in": [a for a, _ in parsed],
            "trace": [t for _, t in parsed],
            "suspect": sod["DailyPrecipitation"].str.strip().str.endswith("s").to_numpy(),
        }
    )

    def temp_f(col: str) -> pd.Series:
        x = pd.to_numeric(sod[col].str.rstrip("s"), errors="coerce").to_numpy()
        return x * 9 / 5 + 32 if units == "metric" else x

    out["tmax_f"] = np.round(temp_f("DailyMaximumDryBulbTemperature"), 1)
    out["tmin_f"] = np.round(temp_f("DailyMinimumDryBulbTemperature"), 1)
    out["source"] = "lcd-daily"
    return out.sort_values("date").reset_index(drop=True)


def check_units(daily: pd.DataFrame, units: str) -> list[str]:
    """Plausibility checks that catch a metric/imperial mix-up."""
    warn = []
    hi = daily["tmax_f"].max()
    if not (60 <= hi <= 115):
        warn.append(f"Max daily temperature {hi}F implausible for NYC; check lcd_units={units!r}")
    if daily["rain_in"].max() > 10:
        warn.append(f"Daily rain {daily['rain_in'].max():.2f} in implausible; check lcd_units={units!r}")
    return warn


# ---------------------------------------------------------------------------
# Hourly (IEM METAR)
# ---------------------------------------------------------------------------

_P = re.compile(r"\sP(\d{4})\b")
_PNO = re.compile(r"\bPNO\b")


def load_iem_hourly(path: Path, tz: str = "America/New_York") -> pd.DataFrame:
    """One row per local clock hour: precipitation in the hour ending at HH:51 local."""
    iem = pd.read_csv(path, dtype=str, keep_default_na=False)
    iem["ts"] = pd.to_datetime(iem["valid"], format="%Y-%m-%d %H:%M")
    routine = iem[iem["ts"].dt.minute == 51].drop_duplicates("ts", keep="last").copy()
    p = routine["metar"].str.extract(_P)[0]
    pno = routine["metar"].str.contains(_PNO)
    amt = np.where(p.notna(), p.astype(float) / 100.0, np.where(pno, np.nan, 0.0))
    out = pd.DataFrame(
        {
            "end_local": routine["ts"].to_numpy(),
            "rain_in": amt,
            "trace": (p == "0000").to_numpy(),
        }
    )
    # Hour label H = the hour in which the observation ends (covers (H-1):51 to H:51).
    out["date"] = out["end_local"].dt.strftime("%Y-%m-%d")
    out["hour"] = out["end_local"].dt.hour
    return out.sort_values("end_local").reset_index(drop=True)


def hourly_grid(hourly: pd.DataFrame) -> pd.DataFrame:
    """Reindex onto a complete hourly grid so gaps are explicit NaN, not absent."""
    idx = pd.date_range(hourly["end_local"].min().floor("h"), hourly["end_local"].max().floor("h"), freq="h")
    h = hourly.assign(hkey=hourly["end_local"].dt.floor("h")).set_index("hkey")
    g = h[["rain_in", "trace"]].reindex(idx)
    g["trace"] = g["trace"].astype("boolean").fillna(False).astype(bool)
    g.index.name = "hour_start"
    return g


def daily_from_hourly(grid: pd.DataFrame, basis: str = "local", tz: str = "America/New_York") -> pd.DataFrame:
    """Day totals from hourly data, only for days with all 24 hours present.

    basis='local' groups by local clock day; basis='lst' by Local Standard Time
    day (clock time minus 1 h during DST), matching NOAA LCD daily summaries.
    """
    idx = grid.index
    if basis == "lst":
        loc = idx.tz_localize(tz, ambiguous="NaT", nonexistent="NaT")
        dst = np.array([bool(x.dst()) if not pd.isna(x) else False for x in loc])
        idx = idx - pd.to_timedelta(dst.astype(int), unit="h")
    d = grid.groupby(idx.strftime("%Y-%m-%d")).agg(
        rain_in=("rain_in", lambda s: s.sum() if s.notna().all() and len(s) == 24 else np.nan),
        trace=("trace", "any"),
        hours=("rain_in", "count"),
    )
    d.index.name = "date"
    return d.reset_index()


# ---------------------------------------------------------------------------
# Features
# ---------------------------------------------------------------------------


def build_daily(lcd: pd.DataFrame, hourly_daily: pd.DataFrame, start: str, end: str) -> pd.DataFrame:
    """Continuous daily series [start, end] with trailing-window features.

    Primary source: LCD daily summary. Fallback: complete-day IEM hourly sums
    (flagged ``source='iem-hourly-sum'``) for dates LCD does not cover.
    """
    dates = pd.date_range(start, end, freq="D").strftime("%Y-%m-%d")
    base = pd.DataFrame({"date": dates})
    d = base.merge(lcd, on="date", how="left")
    fb = hourly_daily.rename(columns={"rain_in": "fb_rain", "trace": "fb_trace"})[["date", "fb_rain", "fb_trace"]]
    fb = fb.astype({"fb_rain": float, "fb_trace": bool})
    d = d.merge(fb, on="date", how="left")
    use_fb = d["rain_in"].isna() & d["source"].isna() & d["fb_rain"].notna()
    d.loc[use_fb, "rain_in"] = d.loc[use_fb, "fb_rain"]
    d.loc[use_fb, "trace"] = d.loc[use_fb, "fb_trace"] & (d.loc[use_fb, "fb_rain"] == 0)
    d.loc[use_fb, "source"] = "iem-hourly-sum"
    d["source"] = d["source"].fillna("missing")
    d["trace"] = d["trace"].astype("boolean").fillna(False).astype(bool)
    d["suspect"] = d["suspect"].astype("boolean").fillna(False).astype(bool)
    d = d.drop(columns=["fb_rain", "fb_trace"])

    r = d["rain_in"]
    # Trailing windows EXCLUDE the day itself: information available that morning.
    d["prev1_in"] = r.shift(1)
    d["trail2_in"] = r.shift(1).rolling(2, min_periods=2).sum()
    d["trail3_in"] = r.shift(1).rolling(3, min_periods=3).sum()
    t = d["trace"]
    d["prev1_trace"] = t.shift(1, fill_value=False)
    d["trail2_trace"] = t.shift(1, fill_value=False) | t.shift(2, fill_value=False)
    d["trail3_trace"] = d["trail2_trace"] | t.shift(3, fill_value=False)
    return d


def slot_hour_features(grid: pd.DataFrame, cells: pd.DataFrame) -> pd.DataFrame:
    """Rain during and before each date x start-hour cell.

    during   = obs ending H:51 (covers (H-1):51-H:51: 51 of the slot's 60 minutes)
    prevNh   = obs ending (H-1):51 back to (H-N):51, all strictly before slot start.
    Any missing hour in a window makes that window missing.
    """
    s = grid["rain_in"]
    tr = grid["trace"]
    starts = pd.to_datetime(cells["date"]) + pd.to_timedelta(cells["hour"], unit="h")

    def window(n_back: int, offset: int) -> tuple[np.ndarray, np.ndarray]:
        vals, traces = [], []
        for st in starts:
            keys = [st + pd.Timedelta(hours=offset - k) for k in range(n_back)]
            v = s.reindex(keys)
            vals.append(v.sum() if v.notna().all() and len(v) else np.nan)
            traces.append(bool(tr.reindex(keys, fill_value=False).any()))
        return np.array(vals), np.array(traces)

    out = cells.copy()
    out["during_in"], out["during_trace"] = window(1, 0)
    for n in (3, 6, 24):
        out[f"prev{n}h_in"], out[f"prev{n}h_trace"] = window(n, -1)
    return out
