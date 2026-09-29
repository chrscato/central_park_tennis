import { useMemo, useState } from 'react'
import { Card, SourceLine } from '../components/common'
import { BucketBars, RainTimeline } from '../components/weatherCharts'
import type { Manifest, Overview } from '../lib/data'
import { longDate, num, pct } from '../lib/format'
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

  if (weather.status !== 'available') {
    return (
      <>
        <section className="hero">
          <div className="kicker">Weather and recorded disruption</div>
          <h1>Rain versus rain-outs.</h1>
        </section>
        <div className="callout" role="status">
          Weather data is unavailable in this build{weather.reason ? ` (${weather.reason})` : ''}. The rest of the site is unaffected.
        </div>
      </>
    )
  }

  const isDaily = (DAILY as string[]).includes(win)
  const rows = isDaily ? rainoutByDailyBucket(weather, overview.daily, win as DailyWindow) : rainoutByHourlyBucket(weather, win as HourlyWindow)
  const leads = dryDayRainouts(weather, overview.daily)
  const cov = weather.coverage
  const rc = weather.reconciliation
  const dryRow = rows.find((r) => r.bucket === 'dry')
  const wetRows = rows.filter((r) => r.bucket === 'moderate' || r.bucket === 'heavy')
  const wetShare = wetRows.reduce((a, r) => a + r.rainedOut, 0) / Math.max(1, wetRows.reduce((a, r) => a + r.recorded, 0))
  const label = isDaily ? DAILY_WINDOW_LABEL[win as DailyWindow] : HOURLY_WINDOW_LABEL[win as HourlyWindow]

  return (
    <>
      <section className="hero">
        <div className="kicker">Weather and recorded disruption</div>
        <h1>Rain versus rain-outs.</h1>
        <p className="lede">
          Central Park rain gauge readings set against recorded “rained out” court-hours — on the day, the day before, and the days
          leading up. A comparison of records, not a finding about why any court closed.
        </p>
      </section>

      <div className="cards">
        <Card accent label="Days with rainfall data" value={`${num(cov.days_covered)} / ${num(cov.days_total)}`} note={`${cov.daily_start} – ${cov.daily_end}; missing days stay missing`} />
        <Card label="Rained-out share after a dry day" value={pct(rainoutByDailyBucket(weather, overview.daily, 'prev1').find((r) => r.bucket === 'dry')?.share)} note="Previous day measured 0.00&quot;, no trace" />
        <Card label="…after 0.10&quot;+ the day before" value={pct(sharePrevWet(weather, overview))} note="Share of recorded court-hours" />
        <Card label="Hourly vs. daily gauge agreement" value={pct(rc.dry_wet_agreement, 1)} note={`Dry/wet agreement over ${num(rc.complete_days_compared)} complete days`} />
      </div>

      <section className="panel" aria-labelledby="bk-h">
        <h2 id="bk-h">Recorded rain-out share by rainfall</h2>
        <p className="sub">
          Share of recorded court-hours with status “rained out,” grouped by rainfall in the chosen window. Trailing windows exclude
          the day itself. Missing weather is its own group, never counted as dry.
        </p>
        <div className="controls" style={{ marginBottom: 12 }}>
          <fieldset>
            <legend>By day (Central Park daily total)</legend>
            <div className="chips">
              {DAILY.map((w) => (
                <label className="chip" key={w}>
                  <input type="radio" name="win" checked={win === w} onChange={() => setWin(w)} />
                  <span>{DAILY_WINDOW_LABEL[w]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>By slot hour (hourly gauge)</legend>
            <div className="chips">
              {HOURLY.map((w) => (
                <label className="chip" key={w}>
                  <input type="radio" name="win" checked={win === w} onChange={() => setWin(w)} />
                  <span>{HOURLY_WINDOW_LABEL[w]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <p className="statement" style={{ fontSize: '1rem' }}>
          {label}: when it was dry, {pct(dryRow?.share)} of recorded court-hours were rained out; with 0.10&quot; or more,{' '}
          {pct(wetShare)}.
        </p>
        <BucketBars rows={rows} unitLabel={isDaily ? 'Dates' : 'Date-hours'} />
        <SourceLine manifest={manifest}>
          {`${weather.definitions[isDaily ? (win === 'same' ? 'same_day' : win) : win === 'during' ? 'during' : 'prevNh']} · reservation dates before ${manifest.snapshot.historical_outcome_cutoff}`}
        </SourceLine>
      </section>

      <section className="panel" aria-labelledby="tl-h">
        <h2 id="tl-h">Day by day</h2>
        <div className="court-toolbar">
          <div className="chips" role="radiogroup" aria-label="Season">
            {years.map((y) => (
              <label className="chip" key={y}>
                <input type="radio" name="yr" checked={year === y} onChange={() => setYear(y)} />
                <span>{y}</span>
              </label>
            ))}
          </div>
          <span className="legend-item small">
            <span className="swatch missing" /> No rainfall data
          </span>
        </div>
        <RainTimeline year={year} weather={idx} daily={overview.daily} />
        <SourceLine manifest={manifest}>Two charts share the date axis; each has its own scale.</SourceLine>
      </section>

      <section className="panel" aria-labelledby="ld-h">
        <h2 id="ld-h">Rain-outs recorded on measured-dry days</h2>
        <p className="sub">
          Dates with rained-out records although the gauge measured 0.00&quot; with no trace on the day and the day before. These are
          leads to look into, not proof of an error: wet courts after earlier storms, local showers the gauge missed, maintenance,
          or recording practices can explain them.
        </p>
        {leads.length === 0 ? (
          <p>None in this export.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="n">Rained out</th>
                  <th className="n">Recorded court-hours</th>
                  <th className="n">Rain 3 days before</th>
                  <th>Records</th>
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
                      <a href={`#/courts?date=${l.date}`}>Court grid</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <SourceLine manifest={manifest}>{`${num(leads.length)} dates · dry definition ${weather.dry_definition}`}</SourceLine>
      </section>

      <section className="panel" aria-labelledby="src-h">
        <h2 id="src-h">Weather sources and checks</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Use</th>
                <th>Source</th>
                <th>Units in file</th>
                <th>Time basis</th>
                <th>Files</th>
              </tr>
            </thead>
            <tbody>
              {weather.sources.map((s) => (
                <tr key={s.role}>
                  <td>{s.role === 'daily' ? 'Daily totals' : 'Hourly (slot-level)'}</td>
                  <td>
                    {s.provider}
                    <br />
                    <span className="small muted">{s.station}</span>
                  </td>
                  <td>{s.units_in_file}</td>
                  <td>{s.time_basis}</td>
                  <td className="small">
                    {s.files.map((f) => (
                      <div key={f.filename}>
                        {f.filename}
                        {f.duplicate_of ? <span className="muted"> — identical to {f.duplicate_of}, skipped</span> : <span className="muted num"> · sha256 {f.sha256.slice(0, 12)}…</span>}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="small" style={{ marginTop: 12 }}>
          <li>Daily totals come from NOAA’s official daily summary (converted from millimetres; trace kept). The supplied NOAA file ends {cov.lcd_daily_last}; later days come from NOAA’s NCEI data service ({num(cov.days_by_source['ncei-daily-api'] ?? 0)} days), complete hourly sums ({num(cov.days_by_source['iem-hourly-sum'] ?? 0)}), or stay missing ({num(cov.days_by_source['missing'] ?? 0)}).</li>
          <li>Hourly rain is read from each routine :51 observation’s precipitation group; “P0000” is a trace, and a “PNO” (gauge not operating) hour is missing.</li>
          <li>Check: hourly sums regrouped to NOAA’s standard-time days agree with the daily totals within 0.03&quot; on {pct(rc.wet_within_0_03_in, 0)} of {num(rc.wet_days)} wet days.</li>
          <li>“During the slot” uses the observation ending at :51 of the start hour; “before start” windows only use observations that end before the slot begins, so later rain never leaks in.</li>
          <li>Rain the same day is known only afterwards; the planner’s weather filter uses only the day(s) before.</li>
        </ul>
        {weather.warnings.length > 0 && <div className="callout">{weather.warnings.join(' ')}</div>}
      </section>
    </>
  )
}

function sharePrevWet(weather: WeatherData, overview: Overview) {
  const rows = rainoutByDailyBucket(weather, overview.daily, 'prev1').filter((r) => r.bucket === 'moderate' || r.bucket === 'heavy')
  const rec = rows.reduce((a, r) => a + r.recorded, 0)
  return rec ? rows.reduce((a, r) => a + r.rainedOut, 0) / rec : null
}
