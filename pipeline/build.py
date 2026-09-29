"""Build command: raw FOIL export -> private intermediates + sanitized public assets.

    python -m pipeline.build [--config config/pipeline.toml]
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
import tomllib
from pathlib import Path

import pandas as pd

from . import core, insights, publish, weather_payload

PIPELINE_VERSION = "0.1.0"
ROOT = Path(__file__).resolve().parents[1]

# Values reported in earlier conversational analysis. Recomputed, never trusted.
PRIOR_REPORTED = {
    "raw_rows": 159386,
    "unique_schedule_slots": 78423,
    "courts": 26,
    "reservation_date_min": "2025-04-01",
    "reservation_date_max": "2026-10-22",
    "latest_booking_or_cancellation_activity": "2026-09-22",
    "qualifying_successful_walkup_slots": 38264,
    "april_wednesday_6pm_slots": 90,
    "april_wednesday_6pm_dates": 7,
}


def _path(p: str) -> Path:
    q = Path(p)
    return q if q.is_absolute() else ROOT / q


def run(config_path: Path) -> int:
    cfg = tomllib.loads(config_path.read_text(encoding="utf-8"))
    csv_path = _path(cfg["inputs"]["reservations_csv"])
    dict_path = _path(cfg["inputs"]["data_dictionary"])
    cutoff = cfg["snapshot"]["historical_outcome_cutoff"]
    tz = cfg["time"]["timezone"]
    cohort_version = cfg["metrics"]["walkup_cohort_version"]
    processed = _path(cfg["outputs"]["processed_dir"])
    public_dir = _path(cfg["outputs"]["public_dir"])

    if not csv_path.exists():
        print(f"ERROR: input not found: {csv_path}\nPlace the FOIL CSV there or edit {config_path}.", file=sys.stderr)
        return 2

    built_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    sha = core.sha256_file(csv_path)
    print(f"[1/6] hashing + reading {csv_path.name} (sha256 {sha[:12]}…)")
    raw = core.read_raw(csv_path)

    print("[2/6] normalizing")
    norm = core.normalize(raw, tz=tz)

    print("[3/6] building validated slots")
    sb = core.build_slots(norm)
    slots = sb.slots

    print("[4/6] successful walkup cohort")
    cb = core.walkup_cohort(norm, slots, cutoff)
    timing = cb.timing
    groups = core.court_groups(norm, slots)
    hourly = core.coverage_hourly(slots, timing, groups["walkup"])
    daily = core.coverage_daily(slots, cutoff)

    ref = core.planner_reference(timing, month=4, weekday=2, hours=[18])

    latest_created = norm["created_local"].max()
    latest_cancel = norm["cancel_local"].max()
    latest_activity = max(x for x in [latest_created, latest_cancel] if pd.notna(x))
    recomputed = {
        "raw_rows": int(len(raw)),
        "unique_schedule_slots": int(raw["schedule_slot_id"].str.strip().nunique()),
        "courts": int(slots["court_num"].nunique()),
        "reservation_date_min": slots["date"].min(),
        "reservation_date_max": slots["date"].max(),
        "latest_booking_or_cancellation_activity": latest_activity.strftime("%Y-%m-%d"),
        "qualifying_successful_walkup_slots": int(len(timing)),
        "april_wednesday_6pm_slots": ref["slots"],
        "april_wednesday_6pm_dates": ref["dates"],
    }
    reconciliation = [
        {"property": k, "prior": PRIOR_REPORTED[k], "recomputed": recomputed[k], "match": PRIOR_REPORTED[k] == recomputed[k]}
        for k in PRIOR_REPORTED
    ]

    lead = timing["lead_minutes"]
    all_leads = (norm["res_local"] - norm["created_local"]).dt.total_seconds()
    profile = {
        "raw_rows": int(len(raw)),
        "exact_duplicate_rows": int(raw.drop(columns="row_number").duplicated().sum()),
        "unique_slot_ids": recomputed["unique_schedule_slots"],
        "validated_slots": int(len(slots)),
        "rows_per_slot": {"mean": round(float(slots["n_rows"].mean()), 3), "max": int(slots["n_rows"].max())},
        "schedule_status_slots": {k: int(v) for k, v in slots["status"].value_counts().items()},
        "method_rows": {k: int(v) for k, v in norm["method_n"].value_counts().items()},
        "player_status_rows": {k: int(v) for k, v in norm["player_status_n"].value_counts().items()},
        "permit_rows": {k: int(v) for k, v in norm["permit_n"].value_counts().items()},
        "action_rows": {(k or "(blank)"): int(v) for k, v in norm["action_n"].value_counts().items()},
        "rows_with_reason_present": int((raw["reason"].str.strip() != "").sum()),
        "distinct_reason_values": len(core.reason_strings(raw)),
        "rows_created_after_slot_start": int((all_leads < 0).sum()),
        "slot_start_hours": {str(k): int(v) for k, v in slots["hour"].value_counts().sort_index().items()},
        "slot_start_minutes_nonzero": int((slots["res_local"].dt.minute != 0).sum()),
        "dst_flags": {
            "reservation": {k: int(v) for k, v in norm["res_tz_flag"].value_counts().items()},
            "creation": {k: int(v) for k, v in norm["created_tz_flag"].value_counts().items()},
        },
        "latest_creation_timestamp": str(latest_created),
        "latest_cancellation_time": str(latest_cancel),
        "method_by_schedule_status_rows": {
            m: {s: int(n) for s, n in row.items() if n}
            for m, row in pd.crosstab(norm["method_n"], norm["status_n"]).iterrows()
        },
        "walkup_lead_minutes": {
            "p10": float(lead.quantile(0.1)),
            "p50": float(lead.quantile(0.5)),
            "p90": float(lead.quantile(0.9)),
        }
        if len(lead)
        else None,
    }

    data_version = f"{cfg['snapshot']['label']}-{sha[:8]}"
    manifest = {
        "app": "Central Park Tennis Watch",
        "pipeline_version": PIPELINE_VERSION,
        "data_version": data_version,
        "built_at_utc": built_at,
        "source": {
            "filename": csv_path.name,
            "sha256": sha,
            "bytes": csv_path.stat().st_size,
            "dictionary_filename": dict_path.name if dict_path.exists() else None,
            "dictionary_sha256": core.sha256_file(dict_path) if dict_path.exists() else None,
            "agency_extraction_time": cfg["inputs"].get("agency_extraction_time") or None,
            "extraction_time_status": "confirmed" if cfg["inputs"].get("agency_extraction_time") else "unconfirmed",
        },
        "snapshot": {
            "label": cfg["snapshot"]["label"],
            "historical_outcome_cutoff": cutoff,
            "cutoff_status": cfg["snapshot"]["cutoff_status"],
            "cutoff_rule": "reservation date strictly before cutoff counts as a historical outcome",
            "reservation_date_min": recomputed["reservation_date_min"],
            "reservation_date_max": recomputed["reservation_date_max"],
            "latest_activity": latest_activity.strftime("%Y-%m-%d %H:%M:%S"),
        },
        "timezone": {"assumed": tz, "status": "provisional", "note": "Source timestamps are naive; preserved as local clock times."},
        "profile": profile,
        "issues": sb.issues,
        "reconciliation": reconciliation,
        "cohort": {
            "version": cohort_version,
            "slot_ledger": cb.slot_ledger,
            "row_ledger": cb.row_ledger,
            "min_dates_for_planning_target": cfg["metrics"]["min_dates_for_planning_target"],
        },
        "reference_checks": [{"name": "april_wednesday_6pm", **ref}],
        "court_groups": groups,
    }

    print("[4b] weather")
    wcfg = cfg.get("weather", {})
    try:
        wx, wx_by_date = weather_payload.build(
            sorted(ROOT.glob(wcfg["lcd_glob"])),
            wcfg["lcd_units"],
            _path(wcfg["iem_csv"]),
            hourly,
            cutoff,
            slots["date"].min(),
            wcfg.get("dry_definition_version", "dry-v1"),
            _path(wcfg["ncei_cache_dir"]) if wcfg.get("ncei_fill") else None,
        )
        c, rc = wx["coverage"], wx["reconciliation"]
        print(f"  {c['days_covered']}/{c['days_total']} days covered {c['days_by_source']}; wet-day hourly/daily agreement {rc['wet_within_0_03_in']}")
        for w in wx["warnings"]:
            print(f"  WARNING: {w}", file=sys.stderr)
    except Exception as e:  # weather must never block the core explorer
        print(f"  weather unavailable: {e!r}", file=sys.stderr)
        wx, wx_by_date = {"status": "unavailable", "reason": str(e)}, {}
    manifest["weather"] = {k: wx.get(k) for k in ("status", "coverage", "reconciliation", "warnings")}

    print("[4c] insights")
    insight_payload = {
        "party_size": insights.party_sizes(norm, slots, cutoff, groups["walkup"]),
        "two_hour": insights.two_hour_bookings(norm, slots, cutoff),
        "partner_entry": insights.partner_entry(norm, slots, cutoff, groups["walkup"]),
    }

    print("[5/6] writing private intermediates")
    processed.mkdir(parents=True, exist_ok=True)
    slots.to_parquet(processed / "slots.parquet", index=False)
    timing.to_parquet(processed / "walkup_timing.parquet", index=False)
    sb.quarantine.to_parquet(processed / "quarantine.parquet", index=False)
    hourly.to_parquet(processed / "coverage_hourly.parquet", index=False)

    print("[6/6] writing + auditing public assets")
    staging = public_dir.with_name(public_dir.name + ".staging")
    publish.write_public(
        staging,
        manifest,
        publish.overview_payload(slots, daily, cutoff),
        publish.timing_payload(timing, hourly, cutoff, cohort_version, groups),
        publish.slot_partitions(norm, slots, timing, cutoff, wx_by_date),
        timing,
        daily,
        wx,
        insight_payload,
    )
    leaks = publish.audit_public(staging, core.reason_strings(raw))
    if leaks:
        print(f"ABORT: {len(leaks)} possible reason-text leaks; previous build kept.", file=sys.stderr)
        for f, _ in leaks[:10]:
            print(f"  in {f}", file=sys.stderr)
        return 1
    publish.promote(staging, public_dir)
    _write_profile_doc(manifest)

    print(f"\nDone. data_version={data_version}")
    for r in reconciliation:
        flag = "ok " if r["match"] else "DIFF"
        print(f"  [{flag}] {r['property']}: prior={r['prior']} recomputed={r['recomputed']}")
    return 0


def _write_profile_doc(m: dict) -> None:
    lines = [
        "# Data profile (generated)",
        "",
        f"Generated by `python -m pipeline.build` — pipeline {m['pipeline_version']}, data version `{m['data_version']}`, built {m['built_at_utc']}.",
        "Do not edit by hand.",
        "",
        "## Reconciliation with prior reported figures",
        "",
        "| Property | Prior | Recomputed | Match |",
        "| --- | --- | --- | --- |",
    ]
    lines += [f"| {r['property']} | {r['prior']} | {r['recomputed']} | {'yes' if r['match'] else '**no**'} |" for r in m["reconciliation"]]
    lines += ["", "## Successful walkup cohort — slot ledger", "", "| Step | Slots | Note |", "| --- | ---: | --- |"]
    lines += [f"| {s['step']} | {s['slots']:,} | {s['note']} |" for s in m["cohort"]["slot_ledger"]]
    lines += ["", "## Row ledger (rows attached to all-checkedin slots)", "", "| Rule | Rows |", "| --- | ---: |"]
    lines += [f"| {r['rule']} | {r['rows']:,} |" for r in m["cohort"]["row_ledger"]]
    p = m["profile"]
    lines += [
        "",
        "## Profile",
        "",
        f"- Raw rows: {p['raw_rows']:,}; exact duplicate rows: {p['exact_duplicate_rows']:,}",
        f"- Validated slots: {p['validated_slots']:,}; quarantined slot IDs: {m['issues']['quarantined_slot_ids']}",
        f"- Rows per slot: mean {p['rows_per_slot']['mean']}, max {p['rows_per_slot']['max']}",
        f"- Rows created after their slot start (any method): {p['rows_created_after_slot_start']:,}",
        f"- Rows with staff `reason` text present: {p['rows_with_reason_present']:,} ({p['distinct_reason_values']} distinct values; withheld)",
        f"- DST flags (reservation): {p['dst_flags']['reservation']}; (creation): {p['dst_flags']['creation']}",
        f"- Latest creation timestamp: {p['latest_creation_timestamp']}; latest cancellation time: {p['latest_cancellation_time']}",
        f"- Schedule status (slots): {p['schedule_status_slots']}",
        f"- Methods (rows): {p['method_rows']}",
        f"- Player status (rows): {p['player_status_rows']}",
        f"- Actions (rows): {p['action_rows']}",
        "",
        "## Reference check",
        "",
        f"`{m['reference_checks'][0]}`",
        "",
    ]
    (ROOT / "docs" / "data_profile.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default=str(ROOT / "config" / "pipeline.toml"))
    args = ap.parse_args()
    sys.exit(run(Path(args.config)))


if __name__ == "__main__":
    main()
