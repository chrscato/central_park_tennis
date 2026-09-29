import { Group } from '../components/common'
import { dataUrl, type Manifest } from '../lib/data'
import { longDate, num } from '../lib/format'

const CANNOT_ANSWER = [
  'Your odds of getting a court (no failed attempts or queue data)',
  'When anyone arrived or checked in (timestamps are booking entry times)',
  'Whether an unrecorded slot was open, closed, or empty',
  'Whether recorded play happened, or why a court was rained out',
  'Revenue, cost, or waste',
  'Who booked (no player identifiers)',
]

const RECORDS_NEEDED = [
  'Full slot inventory incl. never-booked slots and program blocks',
  'Export join logic, stable anonymous IDs, timezone, extraction time',
  'Status definitions and timestamped transitions',
  'Waitlist arrivals, unsuccessful attempts, queue positions',
  'Closure/reopening and maintenance logs',
]

const CHANGELOG = [['2026-09-29', 'First release: planner, court records, weather, rain outlook.']]

export function Methodology({ manifest: m }: { manifest: Manifest }) {
  const p = m.profile
  return (
    <>
      <div className="cols-2">
        <Group title="Source">
          <table className="kv">
            <tbody>
              <tr><th>Data version</th><td className="num">{m.data_version}</td></tr>
              <tr><th>Pipeline</th><td>{m.pipeline_version} · built {m.built_at_utc}</td></tr>
              <tr><th>File</th><td>{m.source.filename} ({num(m.source.bytes)} bytes)</td></tr>
              <tr><th>SHA-256</th><td className="num" style={{ wordBreak: 'break-all' }}>{m.source.sha256}</td></tr>
              <tr><th>Dictionary</th><td>{m.source.dictionary_filename ?? '—'}</td></tr>
              <tr><th>Extraction time</th><td>{m.source.agency_extraction_time ?? <b>Unknown (not supplied)</b>}</td></tr>
              <tr><th>Reservations</th><td>{longDate(m.snapshot.reservation_date_min, false)} – {longDate(m.snapshot.reservation_date_max, false)}</td></tr>
              <tr><th>Latest activity</th><td>{m.snapshot.latest_activity}</td></tr>
              <tr><th>Outcome cutoff</th><td>Before {longDate(m.snapshot.historical_outcome_cutoff, false)} ({m.snapshot.cutoff_status})</td></tr>
              <tr><th>Timezone</th><td>{m.timezone.assumed} ({m.timezone.status})</td></tr>
            </tbody>
          </table>
        </Group>
        <Group title="FOIL request">
          <table className="kv">
            <tbody>
              <tr><th>Submitted</th><td className="muted">Unknown</td></tr>
              <tr><th>Acknowledged</th><td className="muted">Unknown</td></tr>
              <tr><th>Produced</th><td className="muted">Unknown</td></tr>
              <tr><th>Received</th><td className="muted">Unknown</td></tr>
            </tbody>
          </table>
          <div className="hint">Filled in only from actual correspondence.</div>
          <div style={{ marginTop: 8 }}>
            <b>Downloads</b>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              <li><a href={dataUrl('downloads/walkup_timing_v1.csv')} download>walkup_timing_v1.csv</a> — one row per qualifying court-hour</li>
              <li><a href={dataUrl('downloads/coverage_daily_v1.csv')} download>coverage_daily_v1.csv</a> — court-hours by status per date</li>
              <li><a href={dataUrl('manifest.json')}>manifest.json</a> — provenance and ledgers</li>
            </ul>
          </div>
        </Group>
      </div>

      <div className="cols-2">
        <Group title={`Walkup booking cohort (${m.cohort.version})`}>
          <div className="grid-wrap sunken">
            <table className="dg">
              <thead><tr><th>Step</th><th className="n">Court-hours</th></tr></thead>
              <tbody>
                {m.cohort.slot_ledger.map((s) => (
                  <tr key={s.step}><td>{s.step}</td><td className="n">{num(s.slots)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hint">
            Per checked-in court-hour: earliest walkup booking made that day, before start. Excludes 2nd–4th players, online, phone,
            waitlist. Percentiles: linear interpolation. Benchmark suppressed under {m.cohort.min_dates_for_planning_target} dates.
          </div>
        </Group>
        <Group title="Checks against earlier analysis">
          <div className="grid-wrap sunken">
            <table className="dg">
              <thead><tr><th>Figure</th><th className="n">Earlier</th><th className="n">Now</th><th>OK</th></tr></thead>
              <tbody>
                {m.reconciliation.map((r) => (
                  <tr key={r.property}>
                    <td>{r.property.replaceAll('_', ' ')}</td>
                    <td className="n">{typeof r.prior === 'number' ? num(r.prior) : r.prior}</td>
                    <td className="n">{typeof r.recomputed === 'number' ? num(r.recomputed) : r.recomputed}</td>
                    <td>{r.match ? 'Yes' : 'NO'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <table className="kv" style={{ marginTop: 6 }}>
            <tbody>
              <tr><th>Rows → court-hours</th><td>{num(p.raw_rows)} → {num(p.validated_slots)}</td></tr>
              <tr><th>Quarantined slot IDs</th><td>{num(m.issues.quarantined_slot_ids)}</td></tr>
              <tr><th>Rows with staff notes</th><td>{num(p.rows_with_reason_present)} (withheld)</td></tr>
            </tbody>
          </table>
        </Group>
      </div>

      <div className="cols-2">
        <Group title="Cannot be answered from these records">
          <ul style={{ margin: 0, paddingLeft: 18 }}>{CANNOT_ANSWER.map((t) => <li key={t}>{t}</li>)}</ul>
        </Group>
        <Group title="Records still needed">
          <ul style={{ margin: 0, paddingLeft: 18 }}>{RECORDS_NEEDED.map((t) => <li key={t}>{t}</li>)}</ul>
        </Group>
      </div>

      <Group title="Change log">
        <table className="kv">
          <tbody>
            {CHANGELOG.map(([d, t]) => (
              <tr key={d}><th>{d}</th><td>{t}</td></tr>
            ))}
            <tr><th>Corrections</th><td className="muted">Contact to be set before launch</td></tr>
          </tbody>
        </table>
      </Group>
    </>
  )
}
