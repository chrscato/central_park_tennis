import { useMemo, useState } from 'react'
import { FLAG_COLOR, RainScatter, type RainPoint } from '../components/anomalyChart'
import { Figure, Group, Readout } from '../components/common'
import { DayRain } from '../components/moreCharts'
import { BucketBars, RainTimeline } from '../components/weatherCharts'
import { DEFAULT_ANOMALY, dryRainouts, EXPLANATION_LABEL, mixedCalls, playedInRain, type AnomalyOptions, type Explanation } from '../lib/anomalies'
import type { Manifest, Overview } from '../lib/data'
import { hourLabel, longDate, num, pct } from '../lib/format'
import { href } from '../lib/url'
import { dayIndex, inches, rainoutByDailyBucket, rainoutByHourlyBucket, type BucketRow, type DailyWindow, type HourlyWindow, type WeatherData } from '../lib/weather'

const DAILY: DailyWindow[] = ['same', 'prev1', 'trail2', 'trail3']
const DAILY_TITLE: Record<DailyWindow, string> = { same: 'That day', prev1: 'Day before', trail2: '2 days before (total)', trail3: '3 days before (total)' }
const HOURLY: HourlyWindow[] = ['during', 'prev3h', 'prev6h', 'prev24h']
const HOURLY_TITLE: Record<HourlyWindow, string> = { during: 'During the hour', prev3h: '3 hours before', prev6h: '6 hours before', prev24h: '24 hours before' }

const sharedMax = (sets: BucketRow[][]) => Math.max(0.1, Math.ceil(Math.max(...sets.flat().map((r) => r.share ?? 0)) * 10) / 10)
const hourSpan = (hours: number[]) => (hours.length === 1 ? hourLabel(hours[0]) : `${hourLabel(hours[0])}–${hourLabel(hours[hours.length - 1])}`)

export function Weather({ manifest, overview, weather }: { manifest: Manifest; overview: Overview; weather: WeatherData }) {
  const available = weather.status === 'available'
  const years = useMemo(() => [...new Set(overview.daily.filter((d) => !d.post_cutoff).map((d) => Number(d.date.slice(0, 4))))], [overview])
  const [year, setYear] = useState(years[years.length - 1])
  const [opts, setOpts] = useState<AnomalyOptions>(DEFAULT_ANOMALY)
  const [show, setShow] = useState<Explanation | 'all'>('all')
  const [picked, setPicked] = useState<string | null>(null)

  const idx = useMemo(() => (available ? dayIndex(weather) : new Map()), [available, weather])
  const daily = useMemo(() => (available ? DAILY.map((w) => rainoutByDailyBucket(weather, overview.daily, w)) : []), [available, weather, overview])
  const hourly = useMemo(() => (available ? HOURLY.map((w) => rainoutByHourlyBucket(weather, w)) : []), [available, weather])
  const { rows, unknownCourtHours } = useMemo(() => (available ? dryRainouts(weather, opts) : { rows: [], unknownCourtHours: 0 }), [available, weather, opts])
  const mixed = useMemo(() => (available ? mixedCalls(weather) : []), [available, weather])
  const inRain = useMemo(() => (available ? playedInRain(weather, 0.05) : { courtHours: 0, dates: 0 }), [available, weather])

  const points = useMemo<RainPoint[]>(() => {
    if (!available) return []
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
  }, [available, weather, rows, idx])

  if (!available) return <div className="note">No weather data in this build{weather.reason ? `: ${weather.reason}` : ''}.</div>

  const prev = daily[1]
  const heavy = (i: number) => daily[i].find((r) => r.bucket === 'heavy')?.share ?? null
  const counts = { none: 0, later: 0, wet: 0 } as Record<Explanation, number>
  rows.forEach((r) => counts[r.explanation]++)
  const shown = show === 'all' ? rows : rows.filter((r) => r.explanation === show)
  const focus = picked ?? rows.find((r) => r.explanation === 'none')?.date ?? rows[0]?.date ?? null
  const focusRow = rows.find((r) => r.date === focus)
  const set = (k: keyof AnomalyOptions) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    if (Number.isFinite(v) && v >= 0) setOpts({ ...opts, [k]: v })
  }

  return (
    <>
      <Group title="How much rain closes the courts">
        <div className="readouts">
          <Readout label="No rain the day before" value={pct(prev.find((r) => r.bucket === 'dry')?.share, 0)} accent sub="of courts closed" />
          <Readout label="Heavy rain the day before" value={pct(heavy(1), 0)} accent sub="of courts closed" />
          <Readout label="Heavy rain that day" value={pct(heavy(0), 0)} sub="of courts closed" />
        </div>
      </Group>

      <div style={{ marginBottom: 30 }}>
        <Figure
          title="Share of courts closed, by how much it rained"
          sub={'Heavy = 0.50" or more. Central Park rain gauge.'}
        >
          <div className="cols-4">
            {DAILY.map((w, i) => (
              <div key={w}>
                <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
                  {DAILY_TITLE[w]}
                </div>
                <BucketBars rows={daily[i]} max={sharedMax(daily)} />
              </div>
            ))}
          </div>
        </Figure>
      </div>

      <Group title="Closed with little or no rain">
        <p style={{ maxWidth: 680 }}>
          Days when courts were rained out but the Central Park gauge showed almost no rain in the 24 hours before. Worth a closer look,
          though one gauge can miss a local shower.
        </p>
        <div className="readouts">
          <Readout label="Days" value={num(rows.length)} accent />
          <Readout label={EXPLANATION_LABEL.none} value={num(counts.none)} />
          <Readout label={EXPLANATION_LABEL.later} value={num(counts.later)} />
          <Readout label={EXPLANATION_LABEL.wet} value={num(counts.wet)} />
        </div>

      </Group>

      {focus && (
        <div style={{ marginBottom: 26 }}>
          <Figure
            title={`${longDate(focus)}, hour by hour`}
            sub={
              focusRow
                ? `${num(focusRow.rainedOut)} courts rained out ${hourSpan(focusRow.hours)} · ${EXPLANATION_LABEL[focusRow.explanation].toLowerCase()} · last 3 days: ${inches(focusRow.trail3)}`
                : undefined
            }
            source={<a href={href('courts', { date: focus })}>See every court that day</a>}
          >
            <DayRain weather={weather} date={focus} />
          </Figure>
        </div>
      )}

      <Group title="All days like this">
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="checks c4" style={{ flex: '1 1 420px', maxWidth: 560 }}>
            {(['all', 'none', 'later', 'wet'] as const).map((k) => (
              <label key={k}>
                <input type="radio" name="show" checked={show === k} onChange={() => setShow(k)} />
                <span>{k === 'all' ? 'All' : EXPLANATION_LABEL[k]}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="grid-wrap">
          <table className="dg">
            <thead>
              <tr>
                <th>Date</th>
                <th className="n">Courts closed</th>
                <th>Hours</th>
                <th className="n">Rain before</th>
                <th className="n">Rain after</th>
                <th className="n">Last 3 days</th>
                <th>Likely reason</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.date} style={r.date === focus ? { background: 'var(--hair-2)' } : undefined}>
                  <td>{longDate(r.date)}</td>
                  <td className="n">
                    <b>{num(r.rainedOut)}</b>
                  </td>
                  <td>{hourSpan(r.hours)}</td>
                  <td className="n">{r.rainBefore.toFixed(2)}"</td>
                  <td className="n">{r.rainAfter == null ? '—' : `${r.rainAfter.toFixed(2)}"`}</td>
                  <td className="n">{inches(r.trail3)}</td>
                  <td>
                    <span className={`tag ${r.explanation}`}>{EXPLANATION_LABEL[r.explanation]}</span>
                  </td>
                  <td>
                    <button className="btn small" type="button" onClick={() => { setPicked(r.date); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {unknownCourtHours > 0 && <div className="hint">{num(unknownCourtHours)} closed courts had gaps in the rain data and weren’t checked.</div>}
      </Group>


      <details className="grp">
        <summary className="fig-title" style={{ cursor: 'pointer' }}>
          Adjust how days are flagged
        </summary>
        <div className="field" style={{ maxWidth: 420, marginTop: 10 }}>
          <label htmlFor="a1">Little rain = under (in, 24 h before)</label>
          <input id="a1" type="number" step="0.01" min={0} value={opts.dryBefore} onChange={set('dryBefore')} />
          <label htmlFor="a2">At least (courts closed)</label>
          <input id="a2" type="number" min={1} value={opts.minCourtHours} onChange={set('minCourtHours')} />
          <label htmlFor="a3">“Rain came later” = 6 h after ≥ (in)</label>
          <input id="a3" type="number" step="0.01" min={0} value={opts.laterRain} onChange={set('laterRain')} />
          <label htmlFor="a4">“Wet from earlier” = 3 days before ≥ (in)</label>
          <input id="a4" type="number" step="0.05" min={0} value={opts.wetDays} onChange={set('wetDays')} />
        </div>
        <button className="btn small" type="button" style={{ marginTop: 8 }} onClick={() => setOpts(DEFAULT_ANOMALY)}>
          Reset
        </button>
      </details>

      <details className="grp">
        <summary className="fig-title" style={{ cursor: 'pointer' }}>
          Split decisions ({num(mixed.length)} days)
        </summary>
        <div className="fig-sub" style={{ marginTop: 6 }}>
          Hours where some courts were rained out while others were checked in. Surfaces may drain differently. Separately:{' '}
          {num(inRain.courtHours)} courts were played during an hour with 0.05"+ of rain.
        </div>
        <div className="grid-wrap">
          <table className="dg">
            <thead>
              <tr>
                <th>Date</th>
                <th className="n">Split hours</th>
                <th className="n">Closed</th>
                <th className="n">Checked in</th>
                <th className="n">Most rain in an hour</th>
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
                    <button className="btn small" type="button" onClick={() => { setPicked(r.date); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="grp">
        <summary className="fig-title" style={{ cursor: 'pointer' }}>
          More charts and sources
        </summary>
      <div style={{ margin: '12px 0 22px' }}>
        <Figure
          title="Every day: closures against rain"
          sub="Each dot is a day: rain that day and the day before vs. share of courts rained out"
          source="Sources: NYC Parks FOIL export; NOAA and IEM, Central Park."
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

        <div style={{ margin: '12px 0 22px' }}>
          <Figure title="Rain in the hours before a slot starts" sub="Share of courts rained out, by rain in the hours before" source="Source: IEM ASOS hourly, Central Park.">
            <div className="cols-4">
              {HOURLY.map((w, i) => (
                <div key={w}>
                  <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
                    {HOURLY_TITLE[w]}
                  </div>
                  <BucketBars rows={hourly[i]} max={sharedMax(hourly)} />
                </div>
              ))}
            </div>
          </Figure>
        </div>
        <Figure
          title="Day by day"
          sub={
            <span className="row" style={{ gap: 14 }}>
              Daily rain (top) and courts rained out (bottom)
              {years.map((y) => (
                <label className="check" key={y}>
                  <input type="radio" name="yr" checked={year === y} onChange={() => setYear(y)} />
                  {y}
                </label>
              ))}
            </span>
          }
        >
          <RainTimeline year={year} weather={idx} daily={overview.daily} />
        </Figure>
        <div className="hint" style={{ marginTop: 12 }}>
          Daily totals: NOAA daily summaries for USW00094728 (files in {weather.sources[0]?.units_in_file} units, converted), gaps filled from the NCEI data
          service. Hourly: IEM ASOS station NYC, read from each :51 report. Missing rain is never counted as dry. Data {manifest.data_version}.
        </div>
      </details>
    </>
  )
}
