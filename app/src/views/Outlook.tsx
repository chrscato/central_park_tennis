import { useMemo, useState } from 'react'
import { Group, Readout, useAsync } from '../components/common'
import type { Manifest, Timing } from '../lib/data'
import { clock, hourLabel, num, pct } from '../lib/format'
import { fetchLiveRain } from '../lib/live'
import { combineTests, openingTest, outlook, type OutlookWindow, type TodayAssumption } from '../lib/outlook'
import { computePlanner } from '../lib/stats'
import { href } from '../lib/url'
import { inches, type Bucket, type WeatherData } from '../lib/weather'

const WEEKDAYS = [1, 2, 3, 4, 5]
const SEASON = [4, 5, 6, 7, 8, 9, 10]
const RAIN_WORDS: Record<Bucket, string> = {
  dry: 'no rain',
  trace: 'a sprinkle',
  light: 'light rain (under 0.10")',
  moderate: 'steady rain (0.10–0.49")',
  heavy: 'heavy rain (0.50"+)',
  missing: 'unknown rain',
}
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
      const f = { months: SEASON, weekdays: WEEKDAYS, years: [], hours: w.hours, courts: 'walkup' as const }
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
        <Group title="How much rain?">
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
              Central Park, live · today so far {inches(live.data.today.partialTotal, live.data.today.trace)}
              {liveWin && liveWin.total == null && ' · * a few hourly readings missing'}
            </div>
          )}
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="manual">Or type inches</label>
            <input id="manual" type="number" step="0.01" min={0} max={30} value={manual} placeholder={liveAmount?.toFixed(2) ?? '0.00'} onChange={(e) => setManual(e.target.value)} />
          </div>
          {manualValid && <div className="hint">Using your number.</div>}
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

        </Group>
      </aside>

      <section>
        {o && (
          <Group title={`After ${RAIN_WORDS[o.bucket]} ${win === 'prev1' ? 'yesterday' : `in the last ${win === 'trail2' ? '2' : '3'} days`}${today === 'dry' ? ', if today stays dry' : ''}`}>
            {o.dates.length === 0 ? (
              <p>No comparable days.</p>
            ) : (
              <>
                <div className="readouts" style={{ marginBottom: 8 }}>
                  <Readout
                    label="Courts back by"
                    value={o.firstPlay.p50 == null ? '—' : hourLabel(Math.round(o.firstPlay.p50))}
                    accent
                    sub={`Range ${o.firstPlay.p25 == null ? '—' : hourLabel(Math.floor(o.firstPlay.p25))}–${o.firstPlay.p75 == null ? '—' : hourLabel(Math.ceil(o.firstPlay.p75))}`}
                  />
                  <Readout label="Mornings closed" value={pct(o.lateShare, 0)} sub={`${num(o.lateDates)} of ${num(o.knownOpeningDates)} days`} />

                </div>
                <div className="grid-wrap tall">
                  <table className="dg">
                    <thead>
                      <tr>
                        <th>Court time</th>
                        <th style={{ width: '60%' }}>Rained out</th>
                        <th className="n" />
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
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Group>
        )}

        <Group title="When mornings close, later courts go faster">
          <div className="grid-wrap">
            <table className="dg">
              <thead>
                <tr>
                  <th>Courts</th>
                  <th className="n">Rainy morning</th>
                  <th className="n">Normal day</th>
                  <th className="n">Faster by</th>
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
                      <td>
                        <a href={href('planner', { m: SEASON.join(','), dow: WEEKDAYS.join(','), h: w.h, y: 'all', open: 'late' })}>See times</a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="hint">Time half the courts were gone, weekdays.</div>
        </Group>
        <div className="foot">Past records, not a forecast or official closure notice.</div>
      </section>
    </div>
  )
}
