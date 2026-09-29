import { useMemo, useState } from 'react'
import { Figure, Group, Readout } from '../components/common'
import { BUCKET_LABEL, BucketBars, RainTimeline } from '../components/weatherCharts'
import type { Manifest, Overview } from '../lib/data'
import { longDate, num, pct } from '../lib/format'
import { href } from '../lib/url'
import {
  BUCKETS,
  DAILY_WINDOW_LABEL,
  dayIndex,
  HOURLY_WINDOW_LABEL,
  rainoutByDailyBucket,
  rainoutByHourlyBucket,
  type BucketRow,
  type DailyWindow,
  type HourlyWindow,
  type WeatherData,
} from '../lib/weather'

const DAILY: DailyWindow[] = ['same', 'prev1', 'trail2', 'trail3']
const DAILY_TITLE: Record<DailyWindow, string> = { same: 'That day', prev1: 'Day before', trail2: '2 days before (total)', trail3: '3 days before (total)' }
const HOURLY: HourlyWindow[] = ['during', 'prev3h', 'prev6h', 'prev24h']
const HOURLY_TITLE: Record<HourlyWindow, string> = { during: 'During the hour', prev3h: '3 hours before', prev6h: '6 hours before', prev24h: '24 hours before' }

const sharedMax = (sets: BucketRow[][]) => Math.max(0.1, Math.ceil(Math.max(...sets.flat().map((r) => r.share ?? 0)) * 10) / 10)

export function Weather({ manifest, overview, weather }: { manifest: Manifest; overview: Overview; weather: WeatherData }) {
  const years = useMemo(() => [...new Set(overview.daily.filter((d) => !d.post_cutoff).map((d) => Number(d.date.slice(0, 4))))], [overview])
  const [year, setYear] = useState(years[years.length - 1])
  const available = weather.status === 'available'
  const idx = useMemo(() => (available ? dayIndex(weather) : new Map()), [available, weather])
  const daily = useMemo(() => (available ? DAILY.map((w) => rainoutByDailyBucket(weather, overview.daily, w)) : []), [available, weather, overview])
  const hourly = useMemo(() => (available ? HOURLY.map((w) => rainoutByHourlyBucket(weather, w)) : []), [available, weather])

  if (!available) return <div className="note">No weather data in this build{weather.reason ? `: ${weather.reason}` : ''}.</div>

  const cov = weather.coverage
  const rc = weather.reconciliation
  const prev = daily[1]
  const wet = prev.filter((r) => r.bucket === 'moderate' || r.bucket === 'heavy')
  const wetShare = wet.reduce((a, r) => a + r.rainedOut, 0) / Math.max(1, wet.reduce((a, r) => a + r.recorded, 0))
  const heavy = (i: number) => daily[i].find((r) => r.bucket === 'heavy')?.share ?? null
  const headline =
    heavy(0) != null && heavy(1) != null
      ? `After 0.50"+ of rain the day before, ${pct(heavy(1), 0)} of court-hours were rained out; after 0.50"+ the same day, ${pct(heavy(0), 0)}`
      : 'Rained-out share by rainfall'
  const dMax = sharedMax(daily)
  const hMax = sharedMax(hourly)

  return (
    <>
      <Group title="How much rain closes the courts">
        <div className="readouts">
          <Readout label="Rained out after a dry day" value={pct(prev.find((r) => r.bucket === 'dry')?.share)} accent sub="share of court-hours" />
          <Readout label={'After 0.10"+ the day before'} value={pct(wetShare)} accent sub="share of court-hours" />
          <Readout label="Days with rain data" value={`${num(cov.days_covered)} / ${num(cov.days_total)}`} sub={`${longDate(cov.daily_start, false)}–${longDate(cov.daily_end, false)}`} />
          <Readout label="Gauge cross-check" value={pct(rc.wet_within_0_03_in, 0)} sub={`of ${num(rc.wet_days)} wet days agree within 0.03"`} />
        </div>
      </Group>

      <div style={{ marginBottom: 26 }}>
        <Figure
          title={headline}
          sub="Share of recorded court-hours rained out, by Central Park rainfall over each window. Windows before a date exclude the date itself."
          source="Sources: NYC Parks FOIL export; NOAA daily summaries, station USW00094728."
        >
          <div className="cols-4">
            {DAILY.map((w, i) => (
              <div key={w}>
                <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
                  {DAILY_TITLE[w]}
                </div>
                <BucketBars rows={daily[i]} max={dMax} />
              </div>
            ))}
          </div>
        </Figure>
      </div>

      <div style={{ marginBottom: 26 }}>
        <Figure
          title="…and rain in the hours before a slot starts"
          sub="Share of recorded court-hours rained out, by hourly rainfall relative to the slot start"
          source="Source: IEM ASOS hourly observations, station NYC (Central Park). Hours with gaps are excluded."
        >
          <div className="cols-4">
            {HOURLY.map((w, i) => (
              <div key={w}>
                <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
                  {HOURLY_TITLE[w]}
                </div>
                <BucketBars rows={hourly[i]} max={hMax} />
              </div>
            ))}
          </div>
        </Figure>
      </div>

      <Group title="The numbers">
        <div className="grid-wrap">
          <table className="dg">
            <thead>
              <tr>
                <th>Rainfall</th>
                {DAILY.map((w) => (
                  <th key={w} className="n">
                    {DAILY_WINDOW_LABEL[w]}
                  </th>
                ))}
                {HOURLY.map((w) => (
                  <th key={w} className="n">
                    {HOURLY_WINDOW_LABEL[w]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {BUCKETS.map((b) => (
                <tr key={b}>
                  <td>{BUCKET_LABEL[b]}</td>
                  {[...daily, ...hourly].map((set, i) => {
                    const r = set.find((x) => x.bucket === b)!
                    return (
                      <td key={i} className="n" title={`${num(r.rainedOut)} of ${num(r.recorded)} court-hours · ${num(r.units)} ${i < 4 ? 'dates' : 'date-hours'}`}>
                        {r.units ? pct(r.share, 0) : '—'}
                        <span className="muted small"> {r.units ? `(${num(r.units)})` : ''}</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hint">Share of recorded court-hours rained out. In brackets: dates (daily windows) or date-hours (hourly windows). Missing rain is never counted as dry.</div>
      </Group>

      <div style={{ marginBottom: 26 }}>
        <Figure
          title="Day by day"
          sub={
            <span className="row" style={{ gap: 14 }}>
              Daily rainfall (top) and recorded rained-out court-hours (bottom), {year}
              {years.map((y) => (
                <label className="check" key={y}>
                  <input type="radio" name="yr" checked={year === y} onChange={() => setYear(y)} />
                  {y}
                </label>
              ))}
            </span>
          }
          source={
            <>
              Days that don’t line up are listed under <a href={href('anomalies')}>Anomalies</a>.
            </>
          }
        >
          <RainTimeline year={year} weather={idx} daily={overview.daily} />
        </Figure>
      </div>

      <Group title="Sources">
        <div className="grid-wrap">
          <table className="dg">
            <thead>
              <tr>
                <th>Use</th>
                <th>Source</th>
                <th>Units</th>
                <th>Time basis</th>
                <th>Files</th>
              </tr>
            </thead>
            <tbody>
              {weather.sources.map((s) => (
                <tr key={s.role}>
                  <td>{s.role === 'daily' ? 'Daily' : 'Hourly'}</td>
                  <td className="wrap">
                    {s.provider} · {s.station}
                  </td>
                  <td>{s.units_in_file}</td>
                  <td>{s.time_basis}</td>
                  <td className="wrap">{s.files.map((f) => (f.duplicate_of ? `${f.filename} (duplicate, skipped)` : f.filename)).join('; ')}</td>
                </tr>
              ))}
              {cov.days_by_source['ncei-daily-api'] ? (
                <tr>
                  <td>Daily (gap fill)</td>
                  <td className="wrap">NOAA NCEI Access Data Service</td>
                  <td>inches</td>
                  <td>LST day</td>
                  <td>
                    {num(cov.days_by_source['ncei-daily-api'])} days after {longDate(cov.lcd_daily_last, false)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="foot">Data {manifest.data_version}.</div>
      </Group>
    </>
  )
}
