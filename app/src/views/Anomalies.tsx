import { useMemo, useState } from 'react'
import { FLAG_COLOR, RainScatter, type RainPoint } from '../components/anomalyChart'
import { Figure, Group, Readout } from '../components/common'
import type { Manifest } from '../lib/data'
import { hourLabel, longDate, num } from '../lib/format'
import { DEFAULT_ANOMALY, dryRainouts, EXPLANATION_LABEL, mixedCalls, playedInRain, type AnomalyOptions, type Explanation } from '../lib/anomalies'
import { href } from '../lib/url'
import { dayIndex, inches, type WeatherData } from '../lib/weather'

const hourSpan = (hours: number[]) => (hours.length === 1 ? hourLabel(hours[0]) : `${hourLabel(hours[0])}–${hourLabel(hours[hours.length - 1])}`)

export function Anomalies({ manifest, weather }: { manifest: Manifest; weather: WeatherData }) {
  const [opts, setOpts] = useState<AnomalyOptions>(DEFAULT_ANOMALY)
  const [show, setShow] = useState<Explanation | 'all'>('all')
  const available = weather.status === 'available'

  const { rows, unknownCourtHours } = useMemo(() => (available ? dryRainouts(weather, opts) : { rows: [], unknownCourtHours: 0 }), [available, weather, opts])
  const mixed = useMemo(() => (available ? mixedCalls(weather) : []), [available, weather])
  const inRain = useMemo(() => (available ? playedInRain(weather, 0.05) : { courtHours: 0, dates: 0 }), [available, weather])

  // Date-level points for the scatter: rain on the day + the day before vs share rained out.
  const points = useMemo<RainPoint[]>(() => {
    if (!available) return []
    const idx = dayIndex(weather)
    const flagged = new Map(rows.map((r) => [r.date, r.explanation]))
    const agg = new Map<string, { rec: number; ro: number }>()
    const c = weather.cells
    for (let i = 0; i < c.d.length; i++) {
      const date = weather.daily.date[c.d[i]]
      const a = agg.get(date) ?? { rec: 0, ro: 0 }
      a.rec += c.recorded[i]
      a.ro += c.rainedout[i]
      agg.set(date, a)
    }
    return [...agg.entries()].flatMap(([date, a]) => {
      const day = idx.get(date)
      if (!day || day.rain == null || day.prev1 == null || !a.rec) return []
      return [{ date, rain: day.rain + day.prev1, share: a.ro / a.rec, recorded: a.rec, flag: flagged.get(date) ?? null }]
    })
  }, [available, weather, rows])

  if (!available) return <div className="note">No weather data in this build.</div>

  const counts = { none: 0, later: 0, wet: 0 } as Record<Explanation, number>
  rows.forEach((r) => counts[r.explanation]++)
  const shown = show === 'all' ? rows : rows.filter((r) => r.explanation === show)
  const set = (k: keyof AnomalyOptions) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    if (Number.isFinite(v) && v >= 0) setOpts({ ...opts, [k]: v })
  }

  return (
    <div className="split">
      <aside>
        <Group title="Flag a rain-out when">
          <div className="field">
            <label htmlFor="a1">Rain 24 h before under</label>
            <span>
              <input id="a1" type="number" step="0.01" min={0} value={opts.dryBefore} onChange={set('dryBefore')} /> in
            </span>
            <label htmlFor="a2">Court-hours at least</label>
            <input id="a2" type="number" min={1} value={opts.minCourtHours} onChange={set('minCourtHours')} />
          </div>
        </Group>
        <Group title="Explain it as">
          <div className="field">
            <label htmlFor="a3">Rain later: 6 h after ≥</label>
            <span>
              <input id="a3" type="number" step="0.01" min={0} value={opts.laterRain} onChange={set('laterRain')} /> in
            </span>
            <label htmlFor="a4">Wet: prior 3 days ≥</label>
            <span>
              <input id="a4" type="number" step="0.05" min={0} value={opts.wetDays} onChange={set('wetDays')} /> in
            </span>
          </div>
        </Group>
        <Group title="Show">
          <div className="checks c2">
            {(['all', 'none', 'later', 'wet'] as const).map((k) => (
              <label key={k}>
                <input type="radio" name="show" checked={show === k} onChange={() => setShow(k)} />
                <span>{k === 'all' ? 'All' : EXPLANATION_LABEL[k]}</span>
              </label>
            ))}
          </div>
        </Group>
        <button className="btn" type="button" onClick={() => setOpts(DEFAULT_ANOMALY)}>
          Reset
        </button>
      </aside>

      <section>
        <Group title="Rained out with little rain">
          <div className="readouts">
            <Readout label="Dates flagged" value={num(rows.length)} accent sub={`${num(rows.reduce((a, r) => a + r.rainedOut, 0))} court-hours`} />
            <Readout label={EXPLANATION_LABEL.none} value={num(counts.none)} sub="no rain before, after, or in prior 3 days" />
            <Readout label={EXPLANATION_LABEL.later} value={num(counts.later)} sub="closed ahead of rain" />
            <Readout label={EXPLANATION_LABEL.wet} value={num(counts.wet)} sub="courts may still be drying" />
          </div>
        </Group>

        <div style={{ marginBottom: 26 }}>
          <Figure
            title="Rain-outs against rainfall"
            sub="Each dot is a date: rain on the day and the day before (square-root scale) vs. share of recorded court-hours rained out"
            source="Sources: NYC Parks FOIL export; NOAA daily summaries and IEM hourly observations, Central Park."
          >
            <div className="legend">
              {(['none', 'later', 'wet'] as const).map((k) => (
                <span className="legend-item" key={k}>
                  <span className="swatch" style={{ background: FLAG_COLOR[k], borderRadius: '50%' }} />
                  {EXPLANATION_LABEL[k]}
                </span>
              ))}
              <span className="legend-item">
                <span className="swatch" style={{ background: '#c9c3b8', borderRadius: '50%' }} />
                Not flagged
              </span>
            </div>
            <RainScatter points={points} />
          </Figure>
        </div>

        <Group title={`Flagged dates${show === 'all' ? '' : ` — ${EXPLANATION_LABEL[show]}`}`}>
          <div className="grid-wrap">
            <table className="dg">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="n">Rained out</th>
                  <th className="n">Of court-hours</th>
                  <th>Hours</th>
                  <th className="n">Rain 24 h before</th>
                  <th className="n">Rain 6 h after</th>
                  <th className="n">Prior 3 days</th>
                  <th>Likely explanation</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.date}>
                    <td>{longDate(r.date)}</td>
                    <td className="n">
                      <b>{num(r.rainedOut)}</b>
                    </td>
                    <td className="n">{num(r.recordedThatDay)}</td>
                    <td>{hourSpan(r.hours)}</td>
                    <td className="n">{r.rainBefore.toFixed(2)}"</td>
                    <td className="n">{r.rainAfter == null ? '—' : `${r.rainAfter.toFixed(2)}"`}</td>
                    <td className="n">{inches(r.trail3)}</td>
                    <td>
                      <span className={`tag ${r.explanation}`}>{EXPLANATION_LABEL[r.explanation]}</span>
                    </td>
                    <td>
                      <a href={href('courts', { date: r.date })}>Grid</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hint">
            Counts rained-out court-hours where the Central Park gauge recorded under {opts.dryBefore.toFixed(2)}" in the 24 hours before and
            during the slot. {unknownCourtHours ? `${num(unknownCourtHours)} rained-out court-hours had gaps in the rain data and are not judged. ` : ''}
            These are leads, not errors: one gauge can miss local showers.
          </div>
        </Group>

        <Group title="Split decisions">
          <div className="fig-sub">Hours where some courts were recorded rained out while others were checked in. Surfaces may drain differently.</div>
          <div className="grid-wrap">
            <table className="dg">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="n">Hours</th>
                  <th className="n">Rained out</th>
                  <th className="n">Checked in</th>
                  <th className="n">Max rain in an hour</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {mixed.slice(0, 25).map((r) => (
                  <tr key={r.date}>
                    <td>{longDate(r.date)}</td>
                    <td className="n">{r.hours}</td>
                    <td className="n">{num(r.rainedOut)}</td>
                    <td className="n">{num(r.checkedIn)}</td>
                    <td className="n">{r.maxRainDuring == null ? '—' : `${r.maxRainDuring.toFixed(2)}"`}</td>
                    <td>
                      <a href={href('courts', { date: r.date })}>Grid</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hint">
            {num(mixed.length)} dates with split hours; top 25 shown. Check: {num(inRain.courtHours)} court-hours were recorded checked in during an hour
            with 0.05"+ of rain.
          </div>
        </Group>
        <div className="foot">Data {manifest.data_version}. Recorded statuses, not official closure notices.</div>
      </section>
    </div>
  )
}
