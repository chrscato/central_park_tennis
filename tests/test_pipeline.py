"""Metric fixtures for the verification cases in guidelines §11."""

from __future__ import annotations

import json

import pandas as pd
import pytest

from pipeline import core, publish

CUTOFF = "2026-09-22"


def row(slot, court=1, start="2025-04-02 18:00:00", status="all-checkedin", created="2025-04-02 07:00:00",
        player="Checked in", method="walkup", permit="Permit", action="", cancel="", reason=""):
    return {
        "schedule_slot_id": str(slot),
        "court": f"Court {court}",
        "reservation_time_and_date": start,
        "schedule_status": status,
        "reason": reason,
        "creation_timestamp": created,
        "player_status": player,
        "method_of_reservation": method,
        "permit_type": permit,
        "action": action,
        "cancellation_time": cancel,
    }


def run(rows):
    raw = pd.DataFrame(rows, columns=core.REQUIRED_COLUMNS)
    raw.insert(0, "row_number", range(1, len(raw) + 1))
    norm = core.normalize(raw)
    sb = core.build_slots(norm)
    cb = core.walkup_cohort(norm, sb.slots, CUTOFF)
    return raw, norm, sb, cb


def earliest(cb, slot):
    t = cb.timing.set_index("slot_id")
    return t.loc[str(slot), "earliest_local"].strftime("%H:%M:%S")


BASE = [
    row(1, created="2025-04-02 07:00:00"),
    row(1, created="2025-04-02 07:00:00", method="second"),
    row(2, court=2, created="2025-04-02 06:45:00"),
    row(3, court=3, status="rained-out", player="Rained Out"),
]


def test_schema_validation_rejects_unexpected_columns():
    df = pd.DataFrame([row(1)]).drop(columns=["action"])
    with pytest.raises(core.SchemaError):
        core.validate_columns(df)


def test_duplicate_cancellation_rows_do_not_change_counts_or_timing():
    _, _, sb0, cb0 = run(BASE)
    dupes = [row(1, created="2025-04-02 07:00:00", action="cancel reservation", cancel="2025-04-02 09:00:00")] * 5
    _, _, sb1, cb1 = run(BASE + dupes)
    assert len(sb0.slots) == len(sb1.slots) == 3
    assert len(cb0.timing) == len(cb1.timing) == 2
    assert earliest(cb0, 1) == earliest(cb1, 1)
    assert cb0.timing["minute_of_day"].tolist() == cb1.timing["minute_of_day"].tolist()


def test_additional_players_cannot_change_first_walkup_time():
    extra = [row(1, created="2025-04-02 05:00:00", method=m) for m in ("second", "third", "fourth")]
    _, _, _, cb = run(BASE + extra)
    assert earliest(cb, 1) == "07:00:00"


def test_canceled_walkup_then_checked_in_walkup_uses_later_entry():
    rows = [
        row(9, created="2025-04-02 06:00:00", player="Canceled", action="cancel reservation", cancel="2025-04-02 06:30:00"),
        row(9, created="2025-04-02 08:10:00"),
    ]
    _, _, _, cb = run(rows)
    assert earliest(cb, 9) == "08:10:00"


def test_creation_after_start_is_excluded_and_counted():
    rows = [row(5, start="2025-04-02 18:00:00", created="2025-04-02 18:05:00")]
    _, _, _, cb = run(rows)
    assert cb.timing.empty
    ledger = {s["step"]: s["slots"] for s in cb.slot_ledger}
    assert ledger["Excluded: walkup rows only created after slot start"] == 1
    rl = {r["rule"]: r["rows"] for r in cb.row_ledger}
    assert rl["Excluded row: created after slot start"] == 1


def test_creation_on_different_date_is_excluded():
    _, _, _, cb = run([row(5, created="2025-04-01 18:05:00")])
    assert cb.timing.empty


def test_cutoff_excludes_future_outcomes():
    rows = BASE + [row(20, start="2026-09-22 10:00:00", created="2026-09-22 07:00:00")]
    _, _, sb, cb = run(rows)
    assert "20" in set(sb.slots["slot_id"])
    assert "20" not in set(cb.timing["slot_id"])
    ledger = {s["step"]: s["slots"] for s in cb.slot_ledger}
    assert ledger["Excluded: reservation date on/after historical cutoff"] == 1


def test_unresolved_status_never_counts_as_play():
    _, _, _, cb = run([row(7, status="assigned"), row(8, status="booking-in-progress")])
    assert cb.timing.empty


def test_conflicting_slot_is_quarantined_not_resolved():
    rows = [row(4, status="all-checkedin"), row(4, status="rained-out")] + BASE
    _, _, sb, cb = run(rows)
    assert "4" not in set(sb.slots["slot_id"])
    assert sb.issues["quarantined_slot_ids"] == 1
    assert "4" not in set(cb.timing["slot_id"])


def test_missing_cells_stay_missing_in_coverage():
    _, _, sb, cb = run(BASE)
    hourly = core.coverage_hourly(sb.slots, cb.timing)
    # only the one date/hour with records exists; nothing is filled in for absent hours
    assert hourly[["date", "hour"]].values.tolist() == [["2025-04-02", 18]]
    assert int(hourly["recorded"].iloc[0]) == 3


def test_shares_reconcile_to_denominator():
    _, _, sb, cb = run(BASE)
    daily = core.coverage_daily(sb.slots, CUTOFF)
    ov = publish.overview_payload(sb.slots, daily, CUTOFF)
    c = ov["cards"]
    assert sum(c["status_counts"].values()) == c["recorded_court_hours"] == 3
    assert c["checked_in_share"] == pytest.approx(2 / 3)


def test_public_payloads_exclude_reason_text(tmp_path):
    secret = "Staff note: private detail 12345"
    rows = BASE + [row(30, court=4, status="unbookable", reason=secret, player="Canceled")]
    raw, norm, sb, cb = run(rows)
    daily = core.coverage_daily(sb.slots, CUTOFF)
    hourly = core.coverage_hourly(sb.slots, cb.timing)
    stage = tmp_path / "data"
    publish.write_public(
        stage,
        {"test": True},
        publish.overview_payload(sb.slots, daily, CUTOFF),
        publish.timing_payload(cb.timing, hourly, CUTOFF, "v1"),
        publish.slot_partitions(norm, sb.slots, cb.timing, CUTOFF),
        cb.timing,
        daily,
    )
    assert publish.audit_public(stage, core.reason_strings(raw)) == []
    blob = "".join(p.read_text(encoding="utf-8") for p in stage.rglob("*") if p.is_file())
    assert secret not in blob and "reason" not in blob


def test_audit_detects_a_leak(tmp_path):
    (tmp_path / "x.json").write_text(json.dumps({"note": "Court resurfacing crew onsite"}))
    assert publish.audit_public(tmp_path, {"Court resurfacing crew onsite"})


def test_reason_equal_to_vocabulary_is_exempt():
    raw = pd.DataFrame([row(1, reason="waiting list", method="waiting list"), row(2, reason="broken net strap")])
    assert core.reason_strings(raw) == {"broken net strap"}


def test_dst_nonexistent_time_is_flagged_not_guessed():
    _, norm, _, _ = run([row(1, start="2026-03-08 02:30:00", created="2026-03-08 02:10:00")])
    assert norm["res_tz_flag"].iloc[0] == "dst-ambiguous-or-nonexistent"
