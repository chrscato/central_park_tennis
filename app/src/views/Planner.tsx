import { useEffect, useMemo, useState } from 'react'
import { CurvesChart, TimeHistogram } from '../components/charts'
import { Group, Readout } from '../components/common'
import type { Manifest, Timing } from '../lib/data'
import { clock, hourLabel, inList, longDate, MONTHS, num, WEEKDAYS } from '../lib/format'
import { combineTests, OPENING_FILTER, openingTest, type OpeningFilter } from '../lib/outlook'
import { alarmMinute, computePlanner, DEFAULT_FILTER, type PlannerFilter } from '../lib/stats'
import { href, parseIntList, replaceParams } from '../lib/url'
import { PLANNER_WEATHER, plannerWeatherTest, type PlannerWeather, type WeatherData } from '../lib/weather'

const SEASON_MONTHS = [4, 5, 6, 7, 8, 9, 10]
const DAYS = [1, 2, 3, 4, 5, 6, 0]
const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
const BIN = 15

interface Personal {
  prep: number
  travel: number
  buffer: number
  share: boolean
}

function readState(params: URLSearchParams, years: number[]) {
  const invalid: string[] = []
  const pick = (key: string, min: number, max: number, fallback: number[], label: string) => {
    if (!params.has(key)) return fallback
    const v = parseIntList(params.get(key), min, max)
    if (v === null) invalid.push(label)
    return v ?? fallback
  }
  const filter: PlannerFilter = {
    months: pick('m', 1, 12, DEFAULT_FILTER.months, 'month'),
    weekdays: pick('dow', 0, 6, DEFAULT_FILTER.weekdays, 'day'),
    years: params.get('y') === 'all' || !params.has('y') ? [] : pick('y', Math.min(...years), Math.max(...years), [], 'season'),
    hours: pick('h', 0, 23, DEFAULT_FILTER.hours, 'start time'),
  }
  const n = (key: string, fallback: number) => {
    const raw = params.get(key)
    if (raw == null) return fallback
    const v = Number(raw)
    if (!Number.isFinite(v) || v < 0 || v > 600) {
      invalid.push(key)
      return fallback
    }
    return Math.round(v)
  }
  const personal: Personal = { prep: n('prep', 20), travel: n('travel', 30), buffer: n('buf', 0), share: params.get('share') === '1' }
  const bench = params.get('bench') !== '0'
  const enumParam = <T extends string>(key: string, allowed: Record<string, string>, label: string): T | 'any' => {
    const raw = params.get(key)
    if (raw == null) return 'any'
    if (raw in allowed) return raw as T
    invalid.push(label)
    return 'any'
  }
  const wx = enumParam<PlannerWeather>('wx', PLANNER_WEATHER, 'weather') as PlannerWeather
  const open = enumParam<OpeningFilter>('open', OPENING_FILTER, 'opening') as OpeningFilter
  return { filter, personal, bench, wx, open, invalid }
}

function toParams(f: PlannerFilter, bench: boolean, p: Personal, wx: PlannerWeather, open: OpeningFilter): URLSearchParams {
  const q = new URLSearchParams()
  q.set('m', f.months.join(','))
  q.set('dow', f.weekdays.join(','))
  q.set('y', f.years.length ? f.years.join(',') : 'all')
  q.set('h', f.hours.join(','))
  if (wx !== 'any') q.set('wx', wx)
  if (open !== 'any') q.set('open', open)
  if (!bench) q.set('bench', '0')
  if (p.share) {
    q.set('share', '1')
    q.set('prep', String(p.prep))
    q.set('travel', String(p.travel))
    q.set('buf', String(p.buffer))
  }
  return q
}

const toggle = (list: number[], v: number) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v].sort((a, b) => a - b))

function Checks({ options, selected, onChange, label, cols }: { options: number[]; selected: number[]; onChange: (v: number[]) => void; label: (v: number) => string; cols: number }) {
  return (
    <div className={`checks c${cols}`}>
      {options.map((o) => (
        <label key={o}>
          <input type="checkbox" checked={selected.includes(o)} onChange={() => onChange(toggle(selected, o))} />
          {label(o)}
        </label>
      ))}
    </div>
  )
}

export function Planner({ manifest, timing, weather, params }: { manifest: Manifest; timing: Timing; weather: WeatherData; params: URLSearchParams }) {
  const years = useMemo(() => [...new Set(timing.dates.map((d) => Number(d.slice(0, 4))))], [timing])
  const initial = useMemo(() => readState(params, years), []) // eslint-disable-line react-hooks/exhaustive-deps
  const wxAvailable = weather.status === 'available'
  const [filter, setFilter] = useState(initial.filter)
  const [bench, setBench] = useState(initial.bench)
  const [personal, setPersonal] = useState(initial.personal)
  const [wx, setWx] = useState<PlannerWeather>(wxAvailable ? initial.wx : 'any')
  const [open, setOpen] = useState<OpeningFilter>(wxAvailable ? initial.open : 'any')
  const [copied, setCopied] = useState(false)

  useEffect(() => replaceParams('planner', toParams(filter, bench, personal, wx, open)), [filter, bench, personal, wx, open])

  const minDates = manifest.cohort.min_dates_for_planning_target
  const cutoff = manifest.snapshot.historical_outcome_cutoff
  const test = useMemo(
    () => (wxAvailable ? combineTests(plannerWeatherTest(weather, wx), openingTest(weather, open)) : undefined),
    [weather, wx, open, wxAvailable],
  )
  const r = useMemo(
    () => computePlanner(timing, filter, { firstDate: manifest.snapshot.reservation_date_min, cutoff, minDates, binMinutes: BIN, weather: test }),
    [timing, filter, manifest, cutoff, minDates, test],
  )

  const incomplete = !filter.months.length || !filter.weekdays.length || !filter.hours.length
  const target = r.planningTarget.suppressed ? null : r.planningTarget.minute
  const alarm = target == null ? null : alarmMinute(target, personal.prep, personal.travel, personal.buffer)
  const limited = r.days.length < minDates
  const query = [
    inList(filter.weekdays.map((d) => WEEKDAYS[d])),
    inList(filter.months.map((m) => MONTHS[m - 1])),
    inList(filter.hours.map(hourLabel)),
    filter.years.length ? filter.years.join(', ') : 'All seasons',
    wx !== 'any' ? PLANNER_WEATHER[wx] : null,
    open !== 'any' ? OPENING_FILTER[open] : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  const setP = (k: keyof Personal) => (e: React.ChangeEvent<HTMLInputElement>) => setPersonal({ ...personal, [k]: Math.max(0, Number(e.target.value) || 0) })

  return (
    <div className="split">
      {/* ---------------- query pane ---------------- */}
      <aside>
        <Group title="Month">
          <Checks cols={4} options={SEASON_MONTHS} selected={filter.months} onChange={(months) => setFilter({ ...filter, months })} label={(m) => MONTHS[m - 1]} />
        </Group>
        <Group title="Day">
          <Checks cols={4} options={DAYS} selected={filter.weekdays} onChange={(weekdays) => setFilter({ ...filter, weekdays })} label={(d) => WEEKDAYS[d]} />
        </Group>
        <Group title="Court start time">
          <Checks cols={3} options={HOURS} selected={filter.hours} onChange={(hours) => setFilter({ ...filter, hours })} label={hourLabel} />
        </Group>
        <Group title="Season">
          <div className="checks c3">
            <label>
              <input type="radio" name="season" checked={!filter.years.length} onChange={() => setFilter({ ...filter, years: [] })} />
              All
            </label>
            {years.map((y) => (
              <label key={y}>
                <input type="radio" name="season" checked={filter.years.length === 1 && filter.years[0] === y} onChange={() => setFilter({ ...filter, years: [y] })} />
                {y}
              </label>
            ))}
          </div>
        </Group>
        <Group title="Conditions">
          <div className="field">
            <label htmlFor="wx">Rain before</label>
            <select id="wx" disabled={!wxAvailable} value={wx} onChange={(e) => setWx(e.target.value as PlannerWeather)}>
              {Object.entries(PLANNER_WEATHER).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <label htmlFor="open">Mornings</label>
            <select id="open" disabled={!wxAvailable} value={open} onChange={(e) => setOpen(e.target.value as OpeningFilter)}>
              {Object.entries(OPENING_FILTER).map(([k, v]) => (
                <option key={k} value={k}>
                  {k === 'late' ? 'Rained out (late opening)' : v}
                </option>
              ))}
            </select>
          </div>
          <div className="hint">Late opening = 50%+ of 7–11 AM courts rained out.</div>
        </Group>
        <div className="row">
          <button className="btn" type="button" onClick={copyLink}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              setFilter(DEFAULT_FILTER)
              setWx('any')
              setOpen('any')
            }}
          >
            Reset
          </button>
        </div>
        <label className="check small" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={personal.share} onChange={(e) => setPersonal({ ...personal, share: e.target.checked })} />
          Include my times in link
        </label>
      </aside>

      {/* ---------------- results pane ---------------- */}
      <section aria-label="Results">
        {initial.invalid.length > 0 && <div className="note">Invalid link filters reset: {inList(initial.invalid)}.</div>}
        <div className="small" style={{ marginBottom: 6 }}>
          <b>Query:</b> {query}
        </div>

        {incomplete ? (
          <div className="note">Select at least one month, day, and start time.</div>
        ) : r.slotCount === 0 ? (
          <div className="note">No qualifying walkup bookings for this query.</div>
        ) : (
          <>
            <div className="readouts">
              <Readout label="Half booked by" value={clock(r.pooled.p50)} accent sub={`${num(r.slotCount)} slots`} />
              <Readout label="25% booked by" value={clock(r.pooled.p25)} />
              <Readout label="75% booked by" value={clock(r.pooled.p75)} />
              <Readout label="Typical day (median)" value={clock(r.dayWeighted.p50)} sub={`${clock(r.dayWeighted.p25)}–${clock(r.dayWeighted.p75)}`} />
              <Readout label="Dates" value={num(r.days.length)} sub={limited ? 'Limited sample' : `of ${num(r.days.length + r.zeroQualifyingDates.length)} with records`} />
            </div>
            {limited && (
              <div className="note">
                Limited sample: {r.days.length} dates (min {minDates} for a benchmark).{' '}
                {filter.weekdays.length < 5 && (
                  <button className="btn small" type="button" onClick={() => setFilter({ ...filter, weekdays: [1, 2, 3, 4, 5] })}>
                    Use Mon–Fri
                  </button>
                )}{' '}
                {filter.months.length < SEASON_MONTHS.length && (
                  <button
                    className="btn small"
                    type="button"
                    onClick={() => {
                      const set = new Set(filter.months)
                      filter.months.forEach((m) => [m - 1, m + 1].forEach((x) => SEASON_MONTHS.includes(x) && set.add(x)))
                      setFilter({ ...filter, months: [...set].sort((a, b) => a - b) })
                    }}
                  >
                    Add adjacent months
                  </button>
                )}
              </div>
            )}

            <div className="cols-2" style={{ marginTop: 8 }}>
              <Group title="Share of each day's bookings made by time">
                <div className="chart-frame sunken">
                  <CurvesChart result={r} showTarget={bench} />
                </div>
              </Group>
              <Group title={`Bookings per ${BIN} minutes (all dates)`}>
                <div className="chart-frame sunken">
                  <TimeHistogram bins={r.histogram} binMinutes={BIN} />
                </div>
              </Group>
            </div>

            <Group title="Benchmark & alarm">
              <div className="row" style={{ alignItems: 'stretch' }}>
                <div style={{ minWidth: 150 }}>
                  <Readout
                    label="Arrive by (benchmark)"
                    value={bench ? (target == null ? 'n/a' : clock(target)) : 'hidden'}
                    off={!bench || target == null}
                    sub={bench && target == null ? `Needs ${minDates}+ dates` : undefined}
                  />
                </div>
                <div className="field" style={{ alignSelf: 'center' }}>
                  <label htmlFor="prep">Get ready (min)</label>
                  <input id="prep" type="number" min={0} max={600} value={personal.prep} onChange={setP('prep')} />
                  <label htmlFor="travel">Travel (min)</label>
                  <input id="travel" type="number" min={0} max={600} value={personal.travel} onChange={setP('travel')} />
                  <label htmlFor="buf">Buffer (min)</label>
                  <input id="buf" type="number" min={0} max={600} value={personal.buffer} onChange={setP('buffer')} />
                </div>
                <div style={{ minWidth: 150 }}>
                  <Readout label="Set alarm for" value={alarm == null || !bench ? '—' : clock(alarm)} accent off={alarm == null || !bench} />
                </div>
              </div>
              <label className="check small" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={bench} onChange={(e) => setBench(e.target.checked)} />
                Show benchmark (25th pct of each day's 25th-pct booking time, rounded down to 15 min)
              </label>
            </Group>

            <Group title={`Dates (${num(r.days.length)})`}>
              <div className="grid-wrap sunken">
                <table className="dg">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="n">Slots</th>
                      <th className="n">First</th>
                      <th className="n">25%</th>
                      <th className="n">Median</th>
                      <th className="n">Last</th>
                      <th>Grid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.days.map((d) => (
                      <tr key={d.date}>
                        <td>{longDate(d.date)}</td>
                        <td className="n">{d.times.length}</td>
                        <td className="n">{clock(d.times[0])}</td>
                        <td className="n">{clock(d.p25)}</td>
                        <td className="n">{clock(d.p50)}</td>
                        <td className="n">{clock(d.times[d.times.length - 1])}</td>
                        <td>
                          <a href={href('courts', { date: d.date })}>Open</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(r.zeroQualifyingDates.length > 0 || r.noRecordDates.length > 0 || r.weatherUnknownDates.length > 0 || r.weatherExcludedDates > 0) && (
                <details className="small" style={{ marginTop: 4 }}>
                  <summary>
                    Excluded: {r.zeroQualifyingDates.length} no walkup booking · {r.noRecordDates.length} not in export
                    {test ? ` · ${r.weatherExcludedDates} filtered · ${r.weatherUnknownDates.length} no weather data` : ''}
                  </summary>
                  {r.zeroQualifyingDates.length > 0 && <p>No walkup booking: {r.zeroQualifyingDates.map((d) => longDate(d, false)).join(', ')}</p>}
                  {r.noRecordDates.length > 0 && <p>Not in export: {r.noRecordDates.map((d) => longDate(d, false)).join(', ')}</p>}
                  {r.weatherUnknownDates.length > 0 && <p>No weather data: {r.weatherUnknownDates.map((d) => longDate(d, false)).join(', ')}</p>}
                </details>
              )}
            </Group>
          </>
        )}
        <div className="foot">
          Times = earliest same-day walkup booking per checked-in court, {timing.cohort_version}, dates before {longDate(cutoff, false)}. Successful
          bookings only — not the odds of getting a court. <a href={href('methodology')}>Method</a>
        </div>
      </section>
    </div>
  )
}
