import { useMemo, useState } from 'react'
import { Group, Readout, useAsync } from '../components/common'
import type { Manifest, Timing } from '../lib/data'
import { clock, hourLabel, num, pct } from '../lib/format'
import { fetchLiveRain, NWS_OBS_URL } from '../lib/live'
import { combineTests, openingTest, outlook, type OutlookWindow, type TodayAssumption } from '../lib/outlook'
import { computePlanner } from '../lib/stats'
import { href } from '../lib/url'
import { BUCKET_LABEL, inches, type WeatherData } from '../lib/weather'

const WEEKDAYS = [1, 2, 3, 4, 5]
const SEASON = [4, 5, 6, 7, 8, 9, 10]
const WINDOW_LABEL: Record<OutlookWindow, string> = { prev1: 'Yesterday', trail2: 'Last 2 days', trail3: 'Last 3 days' }
const WINDOWS = [
  { label: '1–4 PM courts', hours: [13, 14, 15, 16], h: '13,14,15,16' },
  { label: '5–7 PM courts', hours: [17, 18, 19], h: '17,18,19' },
]

export function Outlook({ manifest, timing, weather }: { manifest: Manifest; timing: Timing; weather: WeatherData }) {
  const [attempt, setAttempt] = useState(0)
  const live = useAsync(() => fetchLiveRain(), [attempt])
  const [manual, setManual] = useState('')
  const [today, setToday] = useState<TodayAssumption>('dry')

  const [win, setWin] = useState<OutlookWindow>('prev1')

  const liveWin = live.status === 'ready' ? (win === 'prev1' ? live.data.yesterday : win === 'trail2' ? live.data.trail2 : live.data.trail3) : null
  const liveAmount = liveWin ? (liveWin.total ?? liveWin.partialTotal) : null
  const manualAmount = manual.trim() === '' ? null : Number(manual)
  const manualValid = manualAmount != null && Number.isFinite(manualAmount) && manualAmount >= 0 && manualAmount < 30
  const amount = manualValid ? manualAmount : liveAmount
  const trace = !manualValid && liveWin ? liveWin.trace : false

  const available = weather.status === 'available'
  const o = useMemo(() => (available && amount != null ? outlook(weather, amount, trace, today, win) : null), [available, weather, amount, trace, today, win])

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
        <Group title="Rain at Central Park">
          {live.status === 'loading' && <p className="muted small">Reading the gauge…</p>}
          {live.status === 'error' && (
            <div className="note err">
              NWS feed unavailable.{' '}
              <button className="btn small" type="button" onClick={() => setAttempt((a) => a + 1)}>
                Retry
              </button>
            </div>
          )}
          <div className="checks" style={{ gridTemplateColumns: '1fr' }}>
            {(['prev1', 'trail2', 'trail3'] as const).map((k) => {
              const lw = live.status === 'ready' ? (k === 'prev1' ? live.data.yesterday : k === 'trail2' ? live.data.trail2 : live.data.trail3) : null
              return (
                <label key={k}>
                  <input type="radio" name="win" checked={win === k} onChange={() => setWin(k)} />
                  <span style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px' }}>
                    <span>{WINDOW_LABEL[k]}</span>
                    <b className="num">
                      {lw ? inches(lw.partialTotal, lw.trace) : '—'}
                      {lw && lw.total == null ? '*' : ''}
                    </b>
                  </span>
                </label>
              )
            })}
          </div>
          {live.status === 'ready' && (
            <div className="hint">
              Today so far {inches(live.data.today.partialTotal, live.data.today.trace)} · last report{' '}
              {live.data.latestObservation
                ? new Date(live.data.latestObservation).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
                : '—'}
              {liveWin && liveWin.total == null && ` · *${liveWin.hoursPresent} of ${liveWin.hoursExpected} hourly reports; may be low`}
            </div>
          )}
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="manual">Or enter (in)</label>
            <input id="manual" type="number" step="0.01" min={0} max={30} value={manual} placeholder={liveAmount?.toFixed(2) ?? '0.00'} onChange={(e) => setManual(e.target.value)} />
          </div>
          <div className="hint">
            {manualValid ? `Using your ${WINDOW_LABEL[win].toLowerCase()} figure.` : 'Live: NWS station KNYC.'}{' '}
            <a href={`${NWS_OBS_URL}/latest`} target="_blank" rel="noreferrer">
              Feed
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
          <Group title={`After ${BUCKET_LABEL[o.bucket]} ${win === 'prev1' ? 'the day before' : `over the ${win === 'trail2' ? '2' : '3'} days before`}${today === 'dry' ? ', then a dry day' : ''}`}>
            <div className="fig-sub">{num(o.dates.length)} comparable days in the records</div>
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
                <div className="grid-wrap tall">
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
          <div className="grid-wrap">
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
