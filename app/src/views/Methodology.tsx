import { SourceLine } from '../components/common'
import { dataUrl, type Manifest } from '../lib/data'
import { longDate, num } from '../lib/format'

const CANNOT_ANSWER = [
  'Whether a person arriving at a given time would get a court. The export records successful bookings only — no failed attempts, queue arrivals, or waiting times.',
  'When anyone physically joined the line or checked in. Creation timestamps record when a booking was entered.',
  'Whether a court was open, closed, or empty when it has no record. The export is not a full slot inventory.',
  'Whether recorded “all checked in” play actually happened, or why a slot was rained out.',
  'Revenue, cost, or waste. Nothing in this export supports a dollar figure.',
  'Which individuals booked courts. No stable anonymous player or booking identifiers are included, and none are inferred.',
]

const RECORDS_NEEDED = [
  'Complete slot inventory, including never-booked slots, opening hours, and program or maintenance blocks.',
  'How the export was joined; stable anonymous booking and action identifiers; timestamp timezone and exact extraction time.',
  'Definitions of each status and timestamped status transitions; first-player arrival and second-player check-in events if recorded.',
  'Waiting-list arrival, assignment and departure; unsuccessful attempts; queue positions where available.',
  'Court closure and reopening logs, surface information, and maintenance records.',
  'For any fiscal reporting: actual operating expenditures, staffing, fee receipts, and defined accounting periods — kept separate from reservation metrics.',
]

const CHANGELOG = [
  { date: '2026-09-29', text: 'First draft: verified data foundation (P0); overview, walkup planner and court explorer (P1); Central Park rainfall with previous-day and trailing 2-/3-day windows (P2).' },
]

export function Methodology({ manifest: m }: { manifest: Manifest }) {
  const p = m.profile
  return (
    <>
      <section className="hero">
        <div className="kicker">FOIL and methodology</div>
        <h1>How every number is made.</h1>
        <p className="lede">
          Sources, checksums, assumptions, exclusions, and the limits of what these records can show. Every figure on this site
          traces to the rows below.
        </p>
      </section>

      <section className="panel" aria-labelledby="src-h">
        <h2 id="src-h">Source and version</h2>
        <div className="table-wrap">
          <table className="data">
            <tbody>
              <tr><th>Data version</th><td className="num">{m.data_version}</td></tr>
              <tr><th>Pipeline version</th><td>{m.pipeline_version}</td></tr>
              <tr><th>Built</th><td>{m.built_at_utc} (UTC)</td></tr>
              <tr><th>Source file</th><td>{m.source.filename} ({num(m.source.bytes)} bytes)</td></tr>
              <tr><th>SHA-256</th><td className="num" style={{ wordBreak: 'break-all' }}>{m.source.sha256}</td></tr>
              <tr><th>Data dictionary</th><td>{m.source.dictionary_filename ?? 'not supplied'}{m.source.dictionary_sha256 && <><br /><span className="num small" style={{ wordBreak: 'break-all' }}>{m.source.dictionary_sha256}</span></>}</td></tr>
              <tr><th>Agency extraction time</th><td>{m.source.agency_extraction_time ?? <strong>Unknown — not supplied by the agency</strong>}</td></tr>
              <tr><th>Reservation dates in export</th><td>{longDate(m.snapshot.reservation_date_min, false)} – {longDate(m.snapshot.reservation_date_max, false)}</td></tr>
              <tr><th>Latest booking/cancellation activity</th><td>{m.snapshot.latest_activity}</td></tr>
              <tr><th>Historical outcome cutoff</th><td>{longDate(m.snapshot.historical_outcome_cutoff, false)} ({m.snapshot.cutoff_status}) — {m.snapshot.cutoff_rule}. The date of the latest activity in the export, treated as an apparent snapshot boundary.</td></tr>
              <tr><th>Timezone</th><td>{m.timezone.assumed} ({m.timezone.status}). {m.timezone.note}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="foil-h">
        <h2 id="foil-h">Request timeline</h2>
        <div className="table-wrap">
          <table className="data">
            <tbody>
              <tr><th>Request submitted</th><td className="muted">Unknown — not yet documented</td></tr>
              <tr><th>Agency acknowledgement</th><td className="muted">Unknown — not yet documented</td></tr>
              <tr><th>Records produced</th><td className="muted">Unknown — not yet documented</td></tr>
              <tr><th>Records received by this project</th><td className="muted">Unknown — not yet documented</td></tr>
            </tbody>
          </table>
        </div>
        <p className="small muted">Dates will be added only from actual correspondence.</p>
      </section>

      <section className="panel" aria-labelledby="rec-h">
        <h2 id="rec-h">Checks against earlier analysis</h2>
        <p className="sub">Figures reported in earlier analysis were recomputed from the source file, not copied.</p>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Property</th><th className="n">Earlier</th><th className="n">Recomputed</th><th>Match</th></tr></thead>
            <tbody>
              {m.reconciliation.map((r) => (
                <tr key={r.property}>
                  <td>{r.property.replaceAll('_', ' ')}</td>
                  <td className="n">{typeof r.prior === 'number' ? num(r.prior) : r.prior}</td>
                  <td className="n">{typeof r.recomputed === 'number' ? num(r.recomputed) : r.recomputed}</td>
                  <td>{r.match ? '✓ yes' : '✗ no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="led-h">
        <h2 id="led-h">Successful walkup cohort ({m.cohort.version})</h2>
        <p className="sub">Slot-level exclusion ledger. Each step’s count is in slots (court-hours).</p>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Step</th><th className="n">Slots</th><th>Note</th></tr></thead>
            <tbody>
              {m.cohort.slot_ledger.map((s) => (
                <tr key={s.step}><td>{s.step}</td><td className="n">{num(s.slots)}</td><td className="small muted">{s.note}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <details>
          <summary>Row-level ledger</summary>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Rule</th><th className="n">Rows</th></tr></thead>
              <tbody>
                {m.cohort.row_ledger.map((r) => (
                  <tr key={r.rule}><td>{r.rule}</td><td className="n">{num(r.rows)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="small" style={{ marginTop: 10 }}>
          Planning benchmark (optional): each date’s 25th-percentile entry time; the 25th percentile of those across dates; rounded
          down to 15 minutes. Suppressed below {m.cohort.min_dates_for_planning_target} dates — a product guardrail, not a
          statistical confidence guarantee. Percentiles use linear interpolation (Hyndman–Fan type 7).
        </p>
      </section>

      <section className="panel" aria-labelledby="dq-h">
        <h2 id="dq-h">Data quality</h2>
        <ul className="small">
          <li>{num(p.raw_rows)} rows → {num(p.validated_slots)} validated slots. A row is not a booking, player, or court-hour; multiple players and cancellation actions multiply rows.</li>
          <li>{num(m.issues.quarantined_slot_ids)} slot IDs quarantined for mapping to more than one court, start time, or status.</li>
          <li>{num(p.exact_duplicate_rows)} exact duplicate rows.</li>
          <li>{num(p.rows_created_after_slot_start)} rows (any method) were created after their slot’s start time.</li>
          <li>{num(p.rows_with_reason_present)} rows carry staff free-text notes. These are withheld from every public view, file and download.</li>
        </ul>
      </section>

      <section className="panel" aria-labelledby="dl-h">
        <h2 id="dl-h">Downloads</h2>
        <ul>
          <li><a href={dataUrl('downloads/walkup_timing_v1.csv')} download>walkup_timing_v1.csv</a> — one row per qualifying slot: date, weekday, hour, court_num, slot_start_local, earliest_qualifying_walkup_local, lead_minutes.</li>
          <li><a href={dataUrl('downloads/coverage_daily_v1.csv')} download>coverage_daily_v1.csv</a> — one row per date with records: recorded slots, courts, hours, and counts by schedule status; post_cutoff flag.</li>
          <li><a href={dataUrl('manifest.json')}>manifest.json</a> — this page’s provenance, ledgers and profile in machine-readable form.</li>
        </ul>
        <p className="small muted">Sanitized aggregates only. The raw export is not published.</p>
      </section>

      <div className="grid-2">
        <section className="panel" aria-labelledby="ca-h">
          <h2 id="ca-h">What the records cannot answer</h2>
          <ul className="small">{CANNOT_ANSWER.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
        <section className="panel" aria-labelledby="rn-h">
          <h2 id="rn-h">Records still needed</h2>
          <ul className="small">{RECORDS_NEEDED.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
      </div>

      <section className="panel" aria-labelledby="cx-h">
        <h2 id="cx-h">Corrections and change log</h2>
        <p className="small">
          Corrections contact: <em>to be set by the site owner before launch.</em>
        </p>
        <ul className="small">{CHANGELOG.map((c) => <li key={c.date}><strong>{c.date}</strong> — {c.text}</li>)}</ul>
        <SourceLine manifest={m} />
      </section>
    </>
  )
}
