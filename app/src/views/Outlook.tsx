import { useMemo, useState } from 'react'
import { SourceLine, useAsync } from '../components/common'
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
  { label: 'Afternoon (1–4 p.m. starts)', hours: [13, 14, 15, 16], h: '13,14,15,16' },
  { label: 'Evening (5–7 p.m. starts)', hours: [17, 18, 19], h: '17,18,19' },
]

export function Outlook({ manifest, timing, weather }: { manifest: Manifest; timing: Timing; weather: WeatherData }) {
  const [attempt, setAttempt] = useState(0)
  const live = useAsync(() => fetchLiveRain(), [attempt])
  const [manual, setManual] = useState<string>('')
  const [today, setToday] = useState<TodayAssumption>('dry')

  const liveAmount = live.status === 'ready' ? (live.data.yesterday.total ?? live.data.yesterday.partialTotal) : null
  const manualAmount = manual.trim() === '' ? null : Number(manual)
  const manualValid = manualAmount != null && Number.isFinite(manualAmount) && manualAmount >= 0 && manualAmount < 15
  const amount = manualValid ? manualAmount : liveAmount
  const trace = !manualValid && live.status === 'ready' ? live.data.yesterday.trace : false
  const usingLive = !manualValid && liveAmount != null

  const available = weather.status === 'available'
  const o = useMemo(() => (available && amount != null ? outlook(weather, amount, trace, today) : null), [available, weather, amount, trace, today])

  // How much earlier walkup entries come on late-opening days (weekdays, all season).
  const walkup = useMemo(() => {
    if (!available) return []
    const opts = { firstDate: manifest.snapshot.reservation_date_min, cutoff: manifest.snapshot.historical_outcome_cutoff, minDates: 1 }
    return WINDOWS.map((w) => {
      const f = { months: SEASON, weekdays: WEEKDAYS, years: [], hours: w.hours }
      const late = computePlanner(timing, f, { ...opts, weather: combineTests(openingTest(weather, 'late')) })
      const normal = computePlanner(timing, f, { ...opts, weather: combineTests(openingTest(weather, 'normal')) })
      return { ...w, late, normal }
    })
  }, [available, weather, timing, manifest])

  if (!available) {
    return (
      <section className="panel">
        <h2>Rain outlook unavailable</h2>
        <p>This build has no weather data, so past rain-outs can’t be matched to rainfall.</p>
      </section>
    )
  }

  const small = o != null && o.dates.length < 10

  return (
    <>
      <section className="hero">
        <div className="kicker">Rain outlook</div>
        <h1>After the rain: when do courts come back?</h1>
        <p className="lede">
          Enter yesterday’s rain, or use the live Central Park gauge. See how recorded rain-outs played out by start hour on past
          days like it, and how much earlier afternoon and evening walkups were booked when mornings were washed out.
        </p>
      </section>

      <section className="panel" aria-labelledby="live-h">
        <h2 id="live-h">Yesterday’s rain at Central Park</h2>
        {live.status === 'loading' && <p className="muted">Checking the Central Park gauge (National Weather Service)…</p>}
        {live.status === 'error' && (
          <div className="callout">
            Couldn’t reach the National Weather Service ({live.error}). Enter rainfall manually below.{' '}
            <button className="btn" type="button" onClick={() => setAttempt((a) => a + 1)}>
              Retry
            </button>
          </div>
        )}
        {live.status === 'ready' && (
          <dl className="kv" style={{ marginBottom: 10 }}>
            <dt>Yesterday ({longDate(live.data.yesterday.date)})</dt>
            <dd>
              {inches(live.data.yesterday.partialTotal, live.data.yesterday.trace)}{' '}
              <span className="muted small">
                {live.data.yesterday.total == null
                  ? `— only ${live.data.yesterday.hoursPresent} of 24 hourly reports; total may be low`
                  : '— all 24 hourly reports'}
              </span>
            </dd>
            <dt>Today so far</dt>
            <dd>
              {inches(live.data.today.partialTotal, live.data.today.trace)}{' '}
              <span className="muted small">
                ({live.data.today.hoursPresent} of {live.data.today.hoursExpected} hours reported)
              </span>
            </dd>
            <dt>Latest report</dt>
            <dd className="small">
              {live.data.latestObservation ? new Date(live.data.latestObservation).toLocaleString('en-US', { timeZone: 'America/New_York' }) : '—'}
            </dd>
          </dl>
        )}
        <div className="inline-fields">
          <label>
            Or enter yesterday’s rain (inches)
            <input
              type="number"
              step="0.01"
              min={0}
              max={15}
              value={manual}
              placeholder={liveAmount != null ? liveAmount.toFixed(2) : '0.00'}
              onChange={(e) => setManual(e.target.value)}
            />
          </label>
          <fieldset>
            <legend className="field-label">Today</legend>
            <div className="chips">
              <label className="chip">
                <input type="radio" name="today" checked={today === 'dry'} onChange={() => setToday('dry')} />
                <span>Stays dry</span>
              </label>
              <label className="chip">
                <input type="radio" name="today" checked={today === 'any'} onChange={() => setToday('any')} />
                <span>Any weather</span>
              </label>
            </div>
          </fieldset>
        </div>
        <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
          {manualValid ? 'Using your entry.' : usingLive ? 'Using the live gauge.' : 'No rainfall value yet.'} “Stays dry” compares only past
          days with no measurable rain that day — check the forecast; this page can’t know today’s weather. NOAA’s archived daily
          summaries (NCEI) run about a week behind, so live readings come from the{' '}
          <a href={`${NWS_OBS_URL}/latest`} target="_blank" rel="noreferrer">
            NWS feed for the same gauge
          </a>
          .
        </p>
      </section>

      {o && (
        <section className="panel" aria-labelledby="ol-h">
          <h2 id="ol-h">
            On past days after {BUCKET_LABEL[o.bucket].toLowerCase()} of rain{today === 'dry' ? ' that then stayed dry' : ''}
          </h2>
          {o.dates.length === 0 ? (
            <p>No comparable days in these records.</p>
          ) : (
            <>
              <div className="cards">
                <div className="card accent">
                  <div className="label">First recorded play (median)</div>
                  <div className="value">{o.firstPlay.p50 == null ? '—' : hourLabel(Math.round(o.firstPlay.p50))}</div>
                  <div className="note">
                    Middle half of days: {o.firstPlay.p25 == null ? '—' : hourLabel(Math.floor(o.firstPlay.p25))}–
                    {o.firstPlay.p75 == null ? '—' : hourLabel(Math.ceil(o.firstPlay.p75))} · {num(o.firstPlay.n)} days
                    {o.firstPlay.noPlay ? ` (+${o.firstPlay.noPlay} with no recorded play)` : ''}
                  </div>
                </div>
                <div className="card">
                  <div className="label">Mornings mostly rained out</div>
                  <div className="value">{pct(o.lateShare, 0)}</div>
                  <div className="note">
                    {num(o.lateDates)} of {num(o.knownOpeningDates)} days: at least half of recorded 7–11 a.m. court-hours rained out
                  </div>
                </div>
                <div className="card">
                  <div className="label">Comparable days</div>
                  <div className="value">{num(o.dates.length)}</div>
                  <div className="note">{small ? 'Small sample — treat as rough' : 'Reservation dates before the cutoff'}</div>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data" aria-label="Recorded rained-out share by start hour">
                  <thead>
                    <tr>
                      <th>Start</th>
                      <th style={{ width: '50%' }}>Recorded court-hours rained out (0–100%)</th>
                      <th className="n">Share</th>
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
                            <div style={{ background: 'var(--rule-soft)', borderRadius: 3, height: 14 }}>
                              <div
                                style={{
                                  width: `${(h.share ?? 0) * 100}%`,
                                  background: 'var(--st-rained-out)',
                                  height: 14,
                                  borderRadius: '0 4px 4px 0',
                                }}
                              />
                            </div>
                          </td>
                          <td className="n">{pct(h.share, 0)}</td>
                          <td className="n">{num(h.recorded)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p className="small muted" style={{ marginTop: 8 }}>
                Share of recorded court-hours at each start time with status “rained out” on these {num(o.dates.length)} days. A
                historical frequency of recorded statuses, not an official closure schedule or a guarantee.
              </p>
            </>
          )}
          <SourceLine manifest={manifest}>{`Previous-day rain: NOAA daily summaries · recorded statuses: FOIL export`}</SourceLine>
        </section>
      )}

      <section className="panel" aria-labelledby="wk-h">
        <h2 id="wk-h">When mornings wash out, later courts go sooner</h2>
        <p className="sub">
          Weekday walkup entry times, April–October. Late-opening days are days when at least half of recorded 7–11 a.m. court-hours
          were rained out.
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Slots</th>
                <th className="n">Typical day’s median entry — late opening</th>
                <th className="n">— normal opening</th>
                <th className="n">Earlier by</th>
                <th className="n">Days (late / normal)</th>
                <th>Plan</th>
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
                      <strong>{clock(l)}</strong>
                    </td>
                    <td className="n">{clock(n)}</td>
                    <td className="n">{l != null && n != null ? `${Math.round(n - l)} min` : '—'}</td>
                    <td className="n">
                      {num(w.late.days.length)} / {num(w.normal.days.length)}
                    </td>
                    <td>
                      <a href={href('planner', { m: SEASON.join(','), dow: WEEKDAYS.join(','), h: w.h, y: 'all', open: 'late' })}>
                        Open in planner
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          “Typical day’s median” weights each date equally. These are recorded successful walkup entries — they show when courts were
          secured, not whether an arrival at a given time would have gotten one.
        </p>
      </section>
    </>
  )
}
