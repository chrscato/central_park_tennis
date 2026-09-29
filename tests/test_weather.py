"""Weather adapter fixtures (guidelines §8 and §11)."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from pipeline import weather

LCD_COLS = ["STATION", "DATE", "REPORT_TYPE", "DailyPrecipitation", "DailyMaximumDryBulbTemperature", "DailyMinimumDryBulbTemperature"]


def lcd_file(tmp_path, rows, name="lcd.csv"):
    df = pd.DataFrame(
        [{"STATION": "USW00094728", "DATE": f"{d}T00:00:00", "REPORT_TYPE": "SOD  ", "DailyPrecipitation": p,
          "DailyMaximumDryBulbTemperature": "25.0", "DailyMinimumDryBulbTemperature": "15.0"} for d, p in rows],
        columns=LCD_COLS,
    )
    path = tmp_path / name
    df.to_csv(path, index=False)
    return path


def iem_file(tmp_path, rows):
    df = pd.DataFrame([{"station": "NYC", "valid": v, "p01i": "0.00", "metar": m} for v, m in rows])
    path = tmp_path / "iem.csv"
    df.to_csv(path, index=False)
    return path


def test_metric_lcd_converts_to_hundredths_of_an_inch(tmp_path):
    d = weather.load_lcd_daily([lcd_file(tmp_path, [("2025-06-01", "2.5"), ("2025-06-02", "0.3"), ("2025-06-03", "T")])], "metric")
    assert d["rain_in"].tolist() == [0.10, 0.01, 0.0]
    assert d["trace"].tolist() == [False, False, True]
    assert d["tmax_f"].iloc[0] == 77.0


def test_unit_check_catches_imperial_misread(tmp_path):
    d = weather.load_lcd_daily([lcd_file(tmp_path, [("2025-06-01", "0.0")])], "imperial")
    assert weather.check_units(d, "imperial")  # 25 "F" max in June is implausible


def test_identical_files_are_deduplicated(tmp_path):
    a = lcd_file(tmp_path, [("2025-06-01", "1.0")], "a.csv")
    b = tmp_path / "a (1).csv"
    b.write_bytes(a.read_bytes())
    used, report = weather.dedupe_files([a, b])
    assert len(used) == 1
    assert [r["duplicate_of"] for r in report].count("a.csv") == 1


def daily(rows):
    lcd = pd.DataFrame(rows, columns=["date", "rain_in", "trace"])
    lcd["suspect"] = False
    lcd["tmax_f"] = np.nan
    lcd["tmin_f"] = np.nan
    lcd["source"] = "lcd-daily"
    return lcd


EMPTY_HOURLY = pd.DataFrame(columns=["date", "rain_in", "trace", "hours"])


def test_trailing_windows_exclude_the_day_itself():
    lcd = daily([("2025-06-01", 0.5, False), ("2025-06-02", 0.2, False), ("2025-06-03", 0.0, False), ("2025-06-04", 1.0, False)])
    d = weather.build_daily(lcd, EMPTY_HOURLY, "2025-06-01", "2025-06-04").set_index("date")
    assert d.loc["2025-06-04", "prev1_in"] == 0.0
    assert math.isclose(d.loc["2025-06-04", "trail2_in"], 0.2)
    assert math.isclose(d.loc["2025-06-04", "trail3_in"], 0.7)
    assert d.loc["2025-06-04", "rain_in"] == 1.0  # same day kept separately


def test_missing_day_makes_trailing_window_missing_not_zero():
    lcd = daily([("2025-06-01", 0.0, False), ("2025-06-03", 0.0, False)])  # 06-02 absent
    d = weather.build_daily(lcd, EMPTY_HOURLY, "2025-06-01", "2025-06-05").set_index("date")
    assert d.loc["2025-06-02", "source"] == "missing"
    assert math.isnan(d.loc["2025-06-02", "rain_in"])
    assert math.isnan(d.loc["2025-06-03", "prev1_in"])
    assert math.isnan(d.loc["2025-06-04", "trail2_in"])
    assert math.isnan(d.loc["2025-06-05", "trail3_in"])


def test_trace_survives_into_trailing_flags():
    lcd = daily([("2025-06-01", 0.0, True), ("2025-06-02", 0.0, False), ("2025-06-03", 0.0, False), ("2025-06-04", 0.0, False)])
    d = weather.build_daily(lcd, EMPTY_HOURLY, "2025-06-01", "2025-06-04").set_index("date")
    assert d.loc["2025-06-02", "prev1_trace"]
    assert d.loc["2025-06-04", "trail3_trace"]
    assert not d.loc["2025-06-04", "trail2_trace"]


def test_hourly_fallback_only_fills_days_lcd_lacks():
    lcd = daily([("2025-06-01", 0.3, False)])
    hd = pd.DataFrame({"date": ["2025-06-01", "2025-06-02"], "rain_in": [9.9, 0.05], "trace": [False, False], "hours": [24, 24]})
    d = weather.build_daily(lcd, hd, "2025-06-01", "2025-06-02").set_index("date")
    assert d.loc["2025-06-01", "rain_in"] == 0.3
    assert d.loc["2025-06-02", "source"] == "iem-hourly-sum"


def metar(ts_local, zhm, extra=""):
    return (ts_local, f"KNYC 01{zhm}Z AUTO 00000KT 10SM CLR 20/10 A3000 RMK AO2 {extra}".strip())


def test_metar_precip_parsing(tmp_path):
    path = iem_file(tmp_path, [
        metar("2025-06-01 10:51", "1451", "P0012"),
        metar("2025-06-01 11:51", "1551", "P0000"),
        metar("2025-06-01 12:51", "1651", "PNO"),
        metar("2025-06-01 13:51", "1751"),
        metar("2025-06-01 13:15", "1715", "P0003"),  # special report: not used for hourly totals
    ])
    h = weather.load_iem_hourly(path).set_index("hour")
    assert h.loc[10, "rain_in"] == 0.12
    assert h.loc[11, "rain_in"] == 0.0 and h.loc[11, "trace"]
    assert math.isnan(h.loc[12, "rain_in"])
    assert h.loc[13, "rain_in"] == 0.0 and not h.loc[13, "trace"]
    assert len(h) == 4


def test_pre_slot_windows_do_not_leak_slot_hour_rain(tmp_path):
    rows = [metar(f"2025-06-01 {h:02d}:51", f"{h + 4:02d}51", "P0050" if h == 14 else "") for h in range(0, 20)]
    grid = weather.hourly_grid(weather.load_iem_hourly(iem_file(tmp_path, rows)))
    cells = pd.DataFrame({"date": ["2025-06-01", "2025-06-01"], "hour": [14, 15]})
    f = weather.slot_hour_features(grid, cells).set_index("hour")
    assert f.loc[14, "during_in"] == 0.5
    assert f.loc[14, "prev3h_in"] == 0.0  # rain in the slot's own hour is not "before"
    assert f.loc[15, "prev3h_in"] == 0.5
    assert math.isnan(f.loc[14, "prev24h_in"])  # hours before midnight are missing -> missing


def test_missing_hour_makes_window_missing(tmp_path):
    rows = [metar(f"2025-06-01 {h:02d}:51", f"{h + 4:02d}51") for h in range(0, 20) if h != 12]
    grid = weather.hourly_grid(weather.load_iem_hourly(iem_file(tmp_path, rows)))
    f = weather.slot_hour_features(grid, pd.DataFrame({"date": ["2025-06-01"], "hour": [14]}))
    assert math.isnan(f["prev3h_in"].iloc[0])
    assert f["during_in"].iloc[0] == 0.0
