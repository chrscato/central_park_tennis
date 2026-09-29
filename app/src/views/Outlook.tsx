import { useMemo, useState } from 'react'
import { Group, Readout, useAsync } from '../components/common'
import type { Manifest, Timing } from '../lib/data'
import { clock, hourLabel, longDate, num, pct } from '../lib/format'
import { fetchLiveRain, NWS_OBS_URL } from '../lib/live'
import { combineTests, openingTest, outlook, type TodayAssumption } from '../lib/outlook'
import { computePlanner } from '../lib/stats'
import { href } from '../lib/url'
import { BUCKET_LABEL, inches, type WeatherData } from '../lib/weather'

const WEEKDAYS = [1, 2, 3, 4, 5]
const SEASON = [4, 5, 6, 7, 8, 9, 10]
const WINDOWS = [
  { label: '1–4 PM courts', hours: [13, 14, 15, 16], h: '13,14,15,16' },
  { label: '5–7 PM courts', hours: [17, 18, 19], h: '17,18,19' },
]

export function Outlook({ manifest, timing, weather }: { manifest: Manifest; timing: Timing; weather: WeatherData }) {
  const [attempt, setAttempt] = useState(0)
  const live = useAsync(() => fetchLiveRain(), [attempt])
  const [manual, setManual] = useState('')
  const [today, setToday] = useState<TodayAssumption>('dry')

  const liveAmount = live.status === 'ready' ? (live.data.yesterday.total ?? live.data.yesterday.partialTotal) : null
  const manualAmount = manual.trim() === '' ? null : Number(manual)
  const manualValid = manualAmount != null && Number.isFinite(manualAmount) && manualAmount >= 0 && manualAmount < 15
  const amount = manualValid ? manualAmount : liveAmount
  const trace = !manualValid && live.status === 'ready' ? live.data.yesterday.trace : false

  const available = weather.status === 'available'
  const o = useMemo(() => (available && amount != null ? outlook(weather, amount, trace, today) : null), [available, weather, amount, trace, today])

  const walkup = useMemo(() => {
    if (!available) return []
    const opts = { firstDate: manifest.snapshot.reservation_date_min, cutoff: manifest.snapshot.historical_outcome_cutoff, minDates: 1 }
    return WINDOWS.map((w) => {
      const f = { months: SEASON, weekdays: WEEKDAYS, years: [], hours: w.hours }
      return {
        ...w,
        late: computePlanner(timing, f, { ...opts, weather: combineTests(openingTest(weather, 'late')) }),
        normal: computePlanner(timing, f, { ...opts, weather: combineTests(openingTest(weather, 'normal')) }),
      }
    })
  }, [available, weather, timing, manifest])

  if (!available) return <div className="note">No weather data in this build.</div>

  return (
    <div className="split">
      <aside>
        <Group title="Yesterday's rain">
          {live.status === 'loading' && <p className="muted">Reading gauge…</p>}
          {live.status === 'error' && (
            <div className="note err">
              NWS feed unavailable.{' '}
              <button className="btn small" type="button" onClick={() => setAttempt((a) => a + 1)}>
                Retry
              </button>
            </div>
          )}
          {live.status === 'ready' && (
            <table className="kv" style={{ marginBottom: 6 }}>
              <tbody>
                <tr>
                  <th>{longDate(live.data.yesterday.date)}</th>
                  <td>
                    <b>{inches(live.data.yesterday.partialTotal, live.data.yesterday.trace)}</b>
                  </td>
                </tr>
                <tr>
                  <th>Hourly reports</th>
                  <td>
                    {live.data.yesterday.hoursPresent}/24{live.data.yesterday.total == null && <span style={{ color: 'var(--red)' }}> (may be low)</span>}
                  </td>
                </tr>
                <tr>
                  <th>Today so far</th>
                  <td>{inches(live.data.today.partialTotal, live.data.today.trace)}</td>
                </tr>
                <tr>
                  <th>Last report</th>
                  <td>
                    {live.data.latestObservation
                      ? new Date(live.data.latestObservation).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          <div className="field">
            <label htmlFor="manual">Override (in)</label>
            <input id="manual" type="number" step="0.01" min={0} max={15} value={manual} placeholder={liveAmount?.toFixed(2) ?? '0.00'} onChange={(e) => setManual(e.target.value)} />
          </div>
          <div className="hint">
            Source: {manualValid ? 'manual entry' : 'NWS KNYC (Central Park) live'} ·{' '}
            <a href={`${NWS_OBS_URL}/latest`} target="_blank" rel="noreferrer">
              feed
            </a>
          </div>
        </Group>
        <Group title="Today">
          <label className="check">
            <input type="radio" name="today" checked={today === 'dry'} onChange={() => setToday('dry')} />
            Stays dry
          </label>
          <label className="check">
            <input type="radio" name="today" checked={today === 'any'} onChange={() => setToday('any')} />
            Any weather
          </label>
          <div className="hint">Check the forecast; this is your assumption.</div>
        </Group>
      </aside>

      <section>
        {o && (
          <Group title={`Past days after ${BUCKET_LABEL[o.bucket]} rain${today === 'dry' ? ', then dry' : ''} (${num(o.dates.length)} days)`}>
            {o.dates.length === 0 ? (
              <p>No comparable days.</p>
            ) : (
              <>
                <div className="readouts" style={{ marginBottom: 8 }}>
                  <Readout
                    label="Courts back (median)"
                    value={o.firstPlay.p50 == null ? '—' : hourLabel(Math.round(o.firstPlay.p50))}
                    accent
                    sub={`Range ${o.firstPlay.p25 == null ? '—' : hourLabel(Math.floor(o.firstPlay.p25))}–${o.firstPlay.p75 == null ? '—' : hourLabel(Math.ceil(o.firstPlay.p75))}`}
                  />
                  <Readout label="Mornings rained out" value={pct(o.lateShare, 0)} sub={`${num(o.lateDates)} of ${num(o.knownOpeningDates)} days`} />
                  <Readout label="Sample" value={num(o.dates.length)} sub={o.dates.length < 10 ? 'Small — rough guide' : 'days'} />
                </div>
                <div className="grid-wrap tall sunken">
                  <table className="dg">
                    <thead>
                      <tr>
                        <th>Start</th>
                        <th style={{ width: '55%' }}>Rained out (0–100%)</th>
                        <th className="n">%</th>
                        <th className="n">Court-hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.hours
                        .filter((h) => h.hour >= 7 && h.hour <= 19)
                        .map((h) => (
                          <tr key={h.hour}>
                            <td>{hourLabel(h.hour)}</td>
                            <td>
                              <div className="bar">
                                <span style={{ width: `${(h.share ?? 0) * 100}%` }} />
                              </div>
                            </td>
                            <td className="n">{pct(h.share, 0)}</td>
                            <td className="n">{num(h.recorded)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Group>
        )}

        <Group title="When mornings are rained out, later courts go sooner (weekdays)">
          <div className="grid-wrap sunken">
            <table className="dg">
              <thead>
                <tr>
                  <th>Courts</th>
                  <th className="n">Late-opening day</th>
                  <th className="n">Normal day</th>
                  <th className="n">Earlier by</th>
                  <th className="n">Days</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {walkup.map((w) => {
                  const l = w.late.dayWeighted.p50
                  const n = w.normal.dayWeighted.p50
                  return (
                    <tr key={w.label}>
                      <td>{w.label}</td>
                      <td className="n">
                        <b>{clock(l)}</b>
                      </td>
                      <td className="n">{clock(n)}</td>
                      <td className="n">{l != null && n != null ? `${Math.round(n - l)} min` : '—'}</td>
                      <td className="n">
                        {num(w.late.days.length)} / {num(w.normal.days.length)}
                      </td>
                      <td>
                        <a href={href('planner', { m: SEASON.join(','), dow: WEEKDAYS.join(','), h: w.h, y: 'all', open: 'late' })}>Plan</a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="hint">Median walkup booking time on a typical day. Late opening = 50%+ of 7–11 AM courts rained out.</div>
        </Group>
        <div className="foot">Recorded statuses, not official closure notices. Past frequencies, not a forecast.</div>
      </section>
    </div>
  )
}
