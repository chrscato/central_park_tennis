import { useMemo, useState } from 'react'
import { Group, Readout } from '../components/common'
import { BucketBars, RainTimeline } from '../components/weatherCharts'
import type { Manifest, Overview } from '../lib/data'
import { longDate, num, pct } from '../lib/format'
import { href } from '../lib/url'
import {
  DAILY_WINDOW_LABEL,
  dayIndex,
  dryDayRainouts,
  HOURLY_WINDOW_LABEL,
  inches,
  rainoutByDailyBucket,
  rainoutByHourlyBucket,
  type DailyWindow,
  type HourlyWindow,
  type WeatherData,
} from '../lib/weather'

type Win = DailyWindow | HourlyWindow
const DAILY: DailyWindow[] = ['same', 'prev1', 'trail2', 'trail3']
const HOURLY: HourlyWindow[] = ['during', 'prev3h', 'prev6h', 'prev24h']

export function Weather({ manifest, overview, weather }: { manifest: Manifest; overview: Overview; weather: WeatherData }) {
  const [win, setWin] = useState<Win>('prev1')
  const years = useMemo(() => [...new Set(overview.daily.filter((d) => !d.post_cutoff).map((d) => Number(d.date.slice(0, 4))))], [overview])
  const [year, setYear] = useState(years[years.length - 1])
  const idx = useMemo(() => (weather.status === 'available' ? dayIndex(weather) : new Map()), [weather])

  if (weather.status !== 'available') return <div className="note">No weather data in this build{weather.reason ? `: ${weather.reason}` : ''}.</div>

  const isDaily = (DAILY as string[]).includes(win)
  const rows = isDaily ? rainoutByDailyBucket(weather, overview.daily, win as DailyWindow) : rainoutByHourlyBucket(weather, win as HourlyWindow)
  const leads = dryDayRainouts(weather, overview.daily)
  const cov = weather.coverage
  const rc = weather.reconciliation
  const prev = rainoutByDailyBucket(weather, overview.daily, 'prev1')
  const wet = prev.filter((r) => r.bucket === 'moderate' || r.bucket === 'heavy')
  const wetShare = wet.reduce((a, r) => a + r.rainedOut, 0) / Math.max(1, wet.reduce((a, r) => a + r.recorded, 0))

  return (
    <>
      <div className="readouts" style={{ marginBottom: 8 }}>
        <Readout label="Rained out after dry day" value={pct(prev.find((r) => r.bucket === 'dry')?.share)} accent sub="Previous day 0.00&quot;" />
        <Readout label={'Rained out after 0.10"+'} value={pct(wetShare)} accent sub="Previous day" />
        <Readout label="Days with rain data" value={`${num(cov.days_covered)}/${num(cov.days_total)}`} sub={`${longDate(cov.daily_start, false)}–${longDate(cov.daily_end, false)}`} />
        <Readout label="Gauge cross-check" value={pct(rc.wet_within_0_03_in, 0)} sub={`wet days within 0.03" (n=${num(rc.wet_days)})`} />
      </div>

      <div className="split">
        <aside>
          <Group title="Rain window">
            <div className="small" style={{ marginBottom: 2 }}>
              <b>Daily total</b>
            </div>
            {DAILY.map((w) => (
              <label className="check" key={w}>
                <input type="radio" name="win" checked={win === w} onChange={() => setWin(w)} />
                {DAILY_WINDOW_LABEL[w]}
              </label>
            ))}
            <div className="small" style={{ margin: '6px 0 2px' }}>
              <b>Hourly (per court-hour)</b>
            </div>
            {HOURLY.map((w) => (
              <label className="check" key={w}>
                <input type="radio" name="win" checked={win === w} onChange={() => setWin(w)} />
                {HOURLY_WINDOW_LABEL[w]}
              </label>
            ))}
          </Group>
        </aside>
        <Group title={`Share of court-hours rained out, by rain — ${isDaily ? DAILY_WINDOW_LABEL[win as DailyWindow] : HOURLY_WINDOW_LABEL[win as HourlyWindow]}`}>
          <BucketBars rows={rows} unitLabel={isDaily ? 'Dates' : 'Date-hours'} />
        </Group>
      </div>

      <Group title="Daily rain vs. rained-out court-hours">
        <div className="row" style={{ marginBottom: 4 }}>
          {years.map((y) => (
            <label className="check" key={y} style={{ marginRight: 8 }}>
              <input type="radio" name="yr" checked={year === y} onChange={() => setYear(y)} />
              {y}
            </label>
          ))}
        </div>
        <div className="chart-frame sunken">
          <RainTimeline year={year} weather={idx} daily={overview.daily} />
        </div>
      </Group>

      <Group title={`Rain-outs on measured-dry days (${num(leads.length)}) — day and day before 0.00"`}>
        <div className="grid-wrap sunken">
          <table className="dg">
            <thead>
              <tr>
                <th>Date</th>
                <th className="n">Rained out</th>
                <th className="n">Court-hours</th>
                <th className="n">Rain 3 days before</th>
                <th>Grid</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.date}>
                  <td>{longDate(l.date)}</td>
                  <td className="n">{num(l.rainedOut)}</td>
                  <td className="n">{num(l.recorded)}</td>
                  <td className="n">{inches(l.trail3, l.trail3Trace)}</td>
                  <td>
                    <a href={href('courts', { date: l.date })}>Open</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hint">Leads, not errors: wet courts from earlier storms, local showers, or maintenance can explain these.</div>
      </Group>

      <Group title="Sources">
        <div className="grid-wrap sunken">
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
                  <td>
                    {s.provider} · {s.station}
                  </td>
                  <td>{s.units_in_file}</td>
                  <td>{s.time_basis}</td>
                  <td>
                    {s.files
                      .map((f) => (f.duplicate_of ? `${f.filename} (duplicate, skipped)` : f.filename))
                      .join('; ')}
                  </td>
                </tr>
              ))}
              {cov.days_by_source['ncei-daily-api'] ? (
                <tr>
                  <td>Daily (gap fill)</td>
                  <td>NOAA NCEI Access Data Service</td>
                  <td>inches</td>
                  <td>LST day</td>
                  <td>{num(cov.days_by_source['ncei-daily-api'])} days after {longDate(cov.lcd_daily_last, false)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="hint">Missing rain is never counted as dry. Trailing windows exclude the day itself. Data {manifest.data_version}.</div>
      </Group>
    </>
  )
}
