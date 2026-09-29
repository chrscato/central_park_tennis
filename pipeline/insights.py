"""Derived insights: party size, inferred 2-hour bookings, partner entry timing.

All inferred from row-level records; none of these are fields in the export.
Outputs are aggregate counts only (no slot IDs, no free text).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .core import ADDITIONAL_PLAYER_METHODS

PARTNER_BINS = list(range(-30, 91, 5))  # minutes before start, 5-min bins; ends are overflow


def _first_player(rows: pd.DataFrame) -> pd.DataFrame:
    fp = rows[~rows["method_n"].isin(ADDITIONAL_PLAYER_METHODS)]
    return fp.sort_values("created_local").drop_duplicates("slot_id")[["slot_id", "method_n", "created_local"]]


def party_sizes(norm: pd.DataFrame, slots: pd.DataFrame, cutoff: str, walkup_courts: list[int]) -> dict:
    """Checked-in court-hours by number of checked-in player records (2 = singles, 4 = doubles)."""
    ci = slots[(slots["status"] == "all-checkedin") & (slots["date"] < cutoff)]
    rows = norm[norm["slot_id"].isin(ci["slot_id"]) & (norm["player_status_n"] == "checked in")]
    roles = rows.groupby("slot_id")["method_n"].agg(set)

    def kind(s: set) -> str:
        if "fourth" in s:
            return "doubles"
        if "third" in s:
            return "three"
        if "second" in s:
            return "singles"
        return "one"

    k = roles.map(kind).rename("kind").to_frame().join(ci.set_index("slot_id")[["hour", "court_num"]])
    k["group"] = np.where(k["court_num"].isin(walkup_courts), "walkup", "online")
    by_hour = k.groupby(["hour", "kind"]).size().unstack(fill_value=0)
    for col in ("singles", "doubles", "three", "one"):
        if col not in by_hour:
            by_hour[col] = 0
    return {
        "unit": "checked-in court-hours before cutoff",
        "counts": {c: int(v) for c, v in k["kind"].value_counts().items()},
        "counts_walkup_courts": {c: int(v) for c, v in k.loc[k["group"] == "walkup", "kind"].value_counts().items()},
        "by_hour": [
            {"hour": int(h), **{c: int(r[c]) for c in ("singles", "doubles", "three", "one")}} for h, r in by_hour.sort_index().iterrows()
        ],
        "rule": "doubles = a 4th-player record checked in; singles = a 2nd but no 3rd/4th; one = no partner record",
    }


def two_hour_bookings(norm: pd.DataFrame, slots: pd.DataFrame, cutoff: str, tol_seconds: int = 60) -> dict:
    """Infer 2-hour walk-up bookings: the same court in consecutive hours where the
    first player's and the second player's records were each created within
    `tol_seconds` of each other ("likely"), or only the first player's ("possible")."""
    s = slots[slots["date"] < cutoff][["slot_id", "court_num", "res_local", "hour", "status"]]
    fp = _first_player(norm[norm["slot_id"].isin(s["slot_id"])])
    sec = (
        norm[norm["method_n"] == "second"].sort_values("created_local").drop_duplicates("slot_id")[["slot_id", "created_local"]]
        .rename(columns={"created_local": "sec"})
    )
    dbl = set(norm.loc[norm["method_n"] == "fourth", "slot_id"])
    s = s.merge(fp, on="slot_id", how="left").merge(sec, on="slot_id", how="left").sort_values(["court_num", "res_local"])
    g = s.groupby("court_num")
    for c in ("res_local", "created_local", "sec", "method_n", "slot_id"):
        s["p_" + c] = g[c].shift(1)
    tol = pd.Timedelta(seconds=tol_seconds)
    adj = (s["res_local"] - s["p_res_local"]) == pd.Timedelta(hours=1)
    walk = (s["method_n"] == "walkup") & (s["p_method_n"] == "walkup")
    first_same = (s["created_local"] - s["p_created_local"]).abs() <= tol
    second_same = (s["sec"] - s["p_sec"]).abs() <= tol
    possible = adj & walk & first_same
    likely = possible & second_same
    involves_doubles = s["slot_id"].isin(dbl) | s["p_slot_id"].isin(dbl)
    walk_hours = int((s["method_n"] == "walkup").sum())
    start_hours = (s.loc[likely, "hour"] - 1).value_counts().sort_index()
    return {
        "rule": f"same court, consecutive hours, both walk-up; first-player records created within {tol_seconds}s (possible), and second-player records too (likely)",
        "likely_pairs": int(likely.sum()),
        "possible_pairs": int(possible.sum()),
        "likely_with_doubles": int((likely & involves_doubles).sum()),
        "walkup_court_hours": walk_hours,
        "likely_share_of_walkup_hours": round(2 * int(likely.sum()) / walk_hours, 4) if walk_hours else None,
        "likely_by_start_hour": {int(h): int(v) for h, v in start_hours.items()},
    }


def partner_entry(norm: pd.DataFrame, slots: pd.DataFrame, cutoff: str, walkup_courts: list[int]) -> dict:
    """When the 2nd (singles) and 4th (doubles) player records were entered, in minutes
    before the slot start, for checked-in walk-up bookings on walk-up courts.
    Entry time of the record — not a verified arrival or check-in time."""
    ci = slots[(slots["status"] == "all-checkedin") & (slots["date"] < cutoff) & slots["court_num"].isin(walkup_courts)]
    fp = _first_player(norm[norm["slot_id"].isin(ci["slot_id"])])
    walk_slots = set(fp.loc[fp["method_n"] == "walkup", "slot_id"])
    rows = norm[norm["slot_id"].isin(walk_slots) & norm["method_n"].isin(["second", "fourth"]) & (norm["player_status_n"] == "checked in")]
    rows = rows.merge(ci[["slot_id", "res_local"]].rename(columns={"res_local": "slot_start"}), on="slot_id")
    rows = rows.sort_values("created_local").drop_duplicates(["slot_id", "method_n"])
    mins = (rows["slot_start"] - rows["created_local"]).dt.total_seconds() / 60
    out: dict = {
        "unit": "minutes before slot start that the partner's record was entered",
        "bins": PARTNER_BINS,
        "rule_minutes": 15,
    }
    for role in ("second", "fourth"):
        m = mins[rows["method_n"] == role].dropna()
        edges = [-np.inf] + PARTNER_BINS + [np.inf]
        hist = pd.cut(m, edges, right=False).value_counts(sort=False).astype(int).tolist()
        out[role] = {
            "n": int(len(m)),
            "median": round(float(m.median()), 1) if len(m) else None,
            "p25": round(float(m.quantile(0.25)), 1) if len(m) else None,
            "p75": round(float(m.quantile(0.75)), 1) if len(m) else None,
            "share_15_or_more_before": round(float((m >= 15).mean()), 4) if len(m) else None,
            "share_0_to_15_before": round(float(((m >= 0) & (m < 15)).mean()), 4) if len(m) else None,
            "share_after_start": round(float((m < 0).mean()), 4) if len(m) else None,
            "histogram": hist,  # [< first bin, bins..., >= last bin]
        }
    return out
