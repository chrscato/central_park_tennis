import { useState } from 'react'
import { Figure, Group, Readout } from '../components/common'
import { PartnerHistogram, SimpleBars } from '../components/moreCharts'
import type { Insights as InsightsData, Manifest } from '../lib/data'
import { hourLabel, num, pct } from '../lib/format'

export function Insights({ manifest, insights }: { manifest: Manifest; insights: InsightsData }) {
  const [role, setRole] = useState<'second' | 'fourth'>('second')
  const ps = insights.party_size
  const th = insights.two_hour
  const pe = insights.partner_entry
  if (!ps || !th || !pe) return <div className="note">Insights aren’t available in this build. Run the pipeline.</div>

  const c = ps.counts_walkup_courts
  const total = Object.values(c).reduce((a, b) => a + b, 0)
  const byHour = ps.by_hour.filter((h) => h.hour >= 7 && h.hour <= 19)
  const peakDoubles = [...byHour].sort((a, b) => b.doubles - a.doubles).slice(0, 3).map((h) => hourLabel(h.hour))
  const topStart = Object.entries(th.likely_by_start_hour).sort((a, b) => b[1] - a[1])[0]
  const st = pe[role]

  return (
    <>
      <Group title="Singles or doubles?">
        <div className="readouts">
          <Readout label="Singles (2 players)" value={pct((c.singles ?? 0) / total, 0)} accent sub={`${num(c.singles ?? 0)} court-hours`} />
          <Readout label="Doubles (4 players)" value={pct((c.doubles ?? 0) / total, 1)} sub={`${num(c.doubles ?? 0)} court-hours`} />
          <Readout label="Only one player recorded" value={pct((c.one ?? 0) / total, 1)} sub={`${num(c.one ?? 0)} court-hours`} />
        </div>
        <div style={{ marginTop: 14, maxWidth: 560 }}>
          <Figure
            title={`Doubles cluster early: most at ${peakDoubles.join(', ')}`}
            sub="Doubles court-hours by start time, walk-up and online courts"
            source="Counted from player records: a 4th player checked in = doubles."
          >
            <SimpleBars items={byHour.map((h) => ({ label: hourLabel(h.hour), value: h.doubles, display: num(h.doubles) }))} />
          </Figure>
        </div>
      </Group>

      <Group title="Two-hour bookings">
        <div className="readouts">
          <Readout label="Likely 2-hour bookings" value={num(th.likely_pairs)} accent sub={`${pct(th.likely_share_of_walkup_hours, 1)} of walk-up court-hours`} />
          <Readout label="With doubles" value={pct(th.likely_with_doubles / Math.max(1, th.likely_pairs), 0)} sub={`${num(th.likely_with_doubles)} of them`} />
          <Readout label="Most common start" value={topStart ? hourLabel(Number(topStart[0])) : '—'} sub={topStart ? `${num(topStart[1])} bookings` : undefined} />
          <Readout label="Possible (looser match)" value={num(th.possible_pairs)} />
        </div>
        <div style={{ marginTop: 14, maxWidth: 560 }}>
          <Figure
            title="Two-hour bookings mostly start at opening"
            sub="Likely 2-hour walk-up bookings by first hour"
            source="Inferred: same court, back-to-back hours, first and second player entered within 60 seconds of each other for both hours. There is no booking ID in the records."
          >
            <SimpleBars
              items={Object.entries(th.likely_by_start_hour)
                .map(([h, v]) => ({ label: `${hourLabel(Number(h))}–${hourLabel(Number(h) + 2)}`, value: v, display: num(v) }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 8)}
            />
          </Figure>
        </div>
      </Group>

      <Group title="When partners check in">
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="checks c2" style={{ width: 300 }}>
            <label>
              <input type="radio" name="role" checked={role === 'second'} onChange={() => setRole('second')} />
              <span>2nd player (singles)</span>
            </label>
            <label>
              <input type="radio" name="role" checked={role === 'fourth'} onChange={() => setRole('fourth')} />
              <span>4th player (doubles)</span>
            </label>
          </div>
        </div>
        <div className="readouts">
          <Readout label="Typical entry" value={st.median == null ? '—' : `${Math.round(st.median)} min`} accent sub="before the court time" />
          <Readout label={`${pe.rule_minutes}+ min early`} value={pct(st.share_15_or_more_before, 0)} sub="meets the 15-minute rule" />
          <Readout label={`Inside ${pe.rule_minutes} min`} value={pct(st.share_0_to_15_before, 0)} sub="entered after the cutoff" />
          <Readout label="After start" value={pct(st.share_after_start, 1)} sub={`of ${num(st.n)} partners`} />
        </div>
        <div style={{ marginTop: 14 }}>
          <Figure
            title={`Most partners are entered ${Math.round(st.p25 ?? 0)}–${Math.round(st.p75 ?? 0)} minutes before the hour`}
            sub="When the partner’s record was entered, relative to the court time. Walk-up bookings on walk-up courts."
            source="This is when the record was entered, which may differ from when the player arrived. Source: NYC Parks FOIL export."
          >
            <PartnerHistogram stats={st} bins={pe.bins} ruleMinutes={pe.rule_minutes} />
          </Figure>
        </div>
      </Group>
      <div className="foot">
        Checked-in court-hours before {manifest.snapshot.historical_outcome_cutoff}. Walk-up courts: {manifest.court_groups?.walkup.join(', ')}.
      </div>
    </>
  )
}
