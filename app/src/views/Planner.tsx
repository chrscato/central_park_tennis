import { useEffect, useMemo, useState } from 'react'
import { CurvesChart, TimeHistogram } from '../components/charts'
import { SourceLine } from '../components/common'
import type { Manifest, Timing } from '../lib/data'
import { clock, hourLabel, listJoin, longDate, MONTHS, MONTHS_LONG, num, shortHour, WEEKDAYS, WEEKDAYS_LONG } from '../lib/format'
import { alarmMinute, computePlanner, DEFAULT_FILTER, type PlannerFilter } from '../lib/stats'
import { parseIntList, replaceParams } from '../lib/url'
import { PLANNER_WEATHER, plannerWeatherTest, type PlannerWeather, type WeatherData } from '../lib/weather'

const SEASON_MONTHS = [4, 5, 6, 7, 8, 9, 10]
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
    weekdays: pick('dow', 0, 6, DEFAULT_FILTER.weekdays, 'day of week'),
    years: params.get('y') === 'all' || !params.has('y') ? [] : pick('y', Math.min(...years), Math.max(...years), [], 'season'),
    hours: pick('h', 0, 23, DEFAULT_FILTER.hours, 'start time'),
  }
  const num = (key: string, fallback: number) => {
    const raw = params.get(key)
    if (raw == null) return fallback
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0 || n > 600) {
      invalid.push(key)
      return fallback
    }
    return Math.round(n)
  }
  const personal: Personal = {
    prep: num('prep', 20),
    travel: num('travel', 30),
    buffer: num('buf', 0),
    share: params.get('share') === '1',
  }
  const bench = params.get('bench') !== '0'
  let wx: PlannerWeather = 'any'
  const rawWx = params.get('wx')
  if (rawWx != null) {
    if (rawWx in PLANNER_WEATHER) wx = rawWx as PlannerWeather
    else invalid.push('weather')
  }
  return { filter, personal, bench, wx, invalid }
}

function toParams(f: PlannerFilter, bench: boolean, p: Personal, wx: PlannerWeather): URLSearchParams {
  const q = new URLSearchParams()
  q.set('m', f.months.join(','))
  q.set('dow', f.weekdays.join(','))
  q.set('y', f.years.length ? f.years.join(',') : 'all')
  q.set('h', f.hours.join(','))
  if (wx !== 'any') q.set('wx', wx)
  if (!bench) q.set('bench', '0')
  if (p.share) {
    q.set('share', '1')
    q.set('prep', String(p.prep))
    q.set('travel', String(p.travel))
    q.set('buf', String(p.buffer))
  }
  return q
}

function toggle(list: number[], v: number) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v].sort((a, b) => a - b)
}

function Chips({
  legend,
  options,
  selected,
  onChange,
  label,
}: {
  legend: string
  options: number[]
  selected: number[]
  onChange: (v: number[]) => void
  label: (v: number) => string
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="chips">
        {options.map((o) => (
          <label className="chip" key={o}>
            <input type="checkbox" checked={selected.includes(o)} onChange={() => onChange(toggle(selected, o))} />
            <span>{label(o)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function Planner({
  manifest,
  timing,
  weather,
  params,
}: {
  manifest: Manifest
  timing: Timing
  weather: WeatherData
  params: URLSearchParams
}) {
  const years = useMemo(() => [...new Set(timing.dates.map((d) => Number(d.slice(0, 4))))], [timing])
  const initial = useMemo(() => readState(params, years), []) // eslint-disable-line react-hooks/exhaustive-deps
  const wxAvailable = weather.status === 'available'
  const [filter, setFilter] = useState(initial.filter)
  const [bench, setBench] = useState(initial.bench)
  const [personal, setPersonal] = useState(initial.personal)
  const [wx, setWx] = useState<PlannerWeather>(wxAvailable ? initial.wx : 'any')
  const [copied, setCopied] = useState(false)

  useEffect(() => replaceParams('planner', toParams(filter, bench, personal, wx)), [filter, bench, personal, wx])

  const minDates = manifest.cohort.min_dates_for_planning_target
  const wxTest = useMemo(() => (wxAvailable ? plannerWeatherTest(weather, wx) : undefined), [weather, wx, wxAvailable])
  const r = useMemo(
    () =>
      computePlanner(timing, filter, {
        firstDate: manifest.snapshot.reservation_date_min,
        cutoff: manifest.snapshot.historical_outcome_cutoff,
        minDates,
        binMinutes: BIN,
        weather: wxTest,
      }),
    [timing, filter, manifest, minDates, wxTest],
  )
  const wxTxt = wx === 'any' ? '' : ` · ${PLANNER_WEATHER[wx].toLowerCase()}`

  const incomplete = !filter.months.length || !filter.weekdays.length || !filter.hours.length
  const monthsTxt = listJoin(filter.months.map((m) => MONTHS_LONG[m - 1]))
  const daysTxt = listJoin(filter.weekdays.map((d) => WEEKDAYS_LONG[d] + 's'))
  const hoursTxt = listJoin(filter.hours.map(hourLabel))
  const yearsTxt = filter.years.length ? filter.years.join(' & ') : 'all seasons'
  const target = r.planningTarget.suppressed ? null : r.planningTarget.minute
  const alarm = target == null ? null : alarmMinute(target, personal.prep, personal.travel, personal.buffer)
  const cutoff = manifest.snapshot.historical_outcome_cutoff

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const broaden = (
    <div className="actions" style={{ marginTop: 8 }}>
      {filter.weekdays.length < 5 && (
        <button className="btn" type="button" onClick={() => setFilter({ ...filter, weekdays: [1, 2, 3, 4, 5] })}>
          Broaden to all weekdays
        </button>
      )}
      {filter.months.length < SEASON_MONTHS.length && (
        <button
          className="btn"
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
      {filter.years.length > 0 && (
        <button className="btn" type="button" onClick={() => setFilter({ ...filter, years: [] })}>
          Use all seasons
        </button>
      )}
    </div>
  )

  return (
    <>
      <section className="hero">
        <div className="kicker">Walkup planner</div>
        <h1>When are the courts actually booked?</h1>
        <p className="lede">
          Pick when you want to play. See when comparable successful walkup reservations were entered on past dates — and work
          back to when you’d need to leave. Historical records only; this is not live court availability.
        </p>
      </section>

      {initial.invalid.length > 0 && (
        <div className="callout" role="alert">
          Some filters in this link were invalid ({listJoin(initial.invalid)}) and were reset to defaults.
        </div>
      )}

      <section className="panel" aria-labelledby="f-h">
        <h2 id="f-h">When do you want to play?</h2>
        <div className="controls" style={{ marginTop: 10 }}>
          <Chips legend="Month" options={SEASON_MONTHS} selected={filter.months} onChange={(months) => setFilter({ ...filter, months })} label={(m) => MONTHS[m - 1]} />
          <Chips legend="Day of week" options={[1, 2, 3, 4, 5, 6, 0]} selected={filter.weekdays} onChange={(weekdays) => setFilter({ ...filter, weekdays })} label={(d) => WEEKDAYS[d]} />
          <Chips legend="Slot start time" options={HOURS} selected={filter.hours} onChange={(hours) => setFilter({ ...filter, hours })} label={shortHour} />
          <fieldset>
            <legend>Season</legend>
            <div className="chips">
              <label className="chip">
                <input type="radio" name="season" checked={!filter.years.length} onChange={() => setFilter({ ...filter, years: [] })} />
                <span>All</span>
              </label>
              {years.map((y) => (
                <label className="chip" key={y}>
                  <input type="radio" name="season" checked={filter.years.length === 1 && filter.years[0] === y} onChange={() => setFilter({ ...filter, years: [y] })} />
                  <span>{y}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>
              <label htmlFor="wx">Weather before the day</label>
            </legend>
            <select id="wx" disabled={!wxAvailable} value={wx} onChange={(e) => setWx(e.target.value as PlannerWeather)} aria-describedby="wx-note">
              {Object.entries(PLANNER_WEATHER).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <p id="wx-note" className="small muted" style={{ marginTop: 4 }}>
              {wxAvailable
                ? 'Central Park gauge, days before play only — what you could know that morning. Dates without weather data are left out and listed.'
                : 'Weather data unavailable in this build.'}
            </p>
          </fieldset>
        </div>
        <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
          No records exist in this export for November–March. Selected slot start times: {hoursTxt || 'none'}
        </p>
      </section>

      {incomplete ? (
        <div className="callout" role="status">
          Select at least one month, day of week, and slot start time.
        </div>
      ) : r.slotCount === 0 ? (
        <section className="panel">
          <h2>No qualifying records for this selection</h2>
          <p>
            No qualifying successful walkup entries were recorded for {daysTxt} in {monthsTxt} ({yearsTxt}{wxTxt}) at {hoursTxt}. That does
            not mean courts were free or unused — only that this export contains no matching successful walkup entry.
          </p>
          {broaden}
        </section>
      ) : (
        <>
          <section className="panel" aria-labelledby="r-h">
            <div className="result-hero">
              <div>
                <h2 id="r-h" className="sr-only">
                  Result
                </h2>
                <p className="small muted" style={{ marginBottom: 4 }}>
                  {daysTxt} in {monthsTxt} · {yearsTxt} · slots starting {hoursTxt}
                  {wxTxt}
                </p>
                <div className="big-number">{clock(r.pooled.p50)}</div>
                <p className="statement">
                  On these {num(r.days.length)} recorded date{r.days.length === 1 ? '' : 's'}, half of {num(r.slotCount)} qualifying
                  successful walkup entries were made by {clock(r.pooled.p50)}
                </p>
                <dl className="kv">
                  <dt>Earliest quarter by</dt>
                  <dd>{clock(r.pooled.p25)}</dd>
                  <dt>Three quarters by</dt>
                  <dd>{clock(r.pooled.p75)}</dd>
                  <dt>Typical date’s median</dt>
                  <dd>
                    {clock(r.dayWeighted.p50)} <span className="muted small">(middle 50% of dates: {clock(r.dayWeighted.p25)}–{clock(r.dayWeighted.p75)})</span>
                  </dd>
                </dl>
                <p className="small muted" style={{ marginTop: 8 }}>
                  The first three figures pool every qualifying slot, so busy dates count more. “Typical date” weights each date
                  equally. These describe reservations that succeeded — not your chance of getting a court.
                </p>
              </div>

              <div className={`target${target == null ? ' suppressed' : ''}`}>
                <div className="t-label">Planning benchmark</div>
                <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '4px 0 8px' }}>
                  <input type="checkbox" checked={bench} onChange={(e) => setBench(e.target.checked)} /> Show benchmark
                </label>
                {!bench ? (
                  <p className="small muted">Benchmark hidden. Descriptive times at left are unaffected.</p>
                ) : target == null ? (
                  <>
                    <p style={{ fontWeight: 700, marginBottom: 4 }}>Not shown — limited sample</p>
                    <p className="small">
                      {r.planningTarget.suppressed && r.planningTarget.reason} A benchmark needs at least {minDates} dates. The
                      descriptive times still apply to the dates shown.
                    </p>
                    {broaden}
                  </>
                ) : (
                  <>
                    <div className="big-number" style={{ fontSize: '2.6rem' }}>
                      {clock(target)}
                    </div>
                    <p className="small">
                      Method: find each date’s 25th-percentile entry time, take the 25th percentile of those, round down to 15
                      minutes. An intentionally early benchmark from {num(r.days.length)} dates — not a forecast or a guarantee.
                    </p>
                    <div className="inline-fields" style={{ marginTop: 8 }}>
                      <label>
                        Get ready (min)
                        <input type="number" min={0} max={600} value={personal.prep} onChange={(e) => setPersonal({ ...personal, prep: Math.max(0, Number(e.target.value) || 0) })} />
                      </label>
                      <label>
                        Travel (min)
                        <input type="number" min={0} max={600} value={personal.travel} onChange={(e) => setPersonal({ ...personal, travel: Math.max(0, Number(e.target.value) || 0) })} />
                      </label>
                      <label>
                        Queue buffer (min)
                        <input type="number" min={0} max={600} value={personal.buffer} onChange={(e) => setPersonal({ ...personal, buffer: Math.max(0, Number(e.target.value) || 0) })} />
                      </label>
                    </div>
                    <p style={{ marginTop: 10, marginBottom: 2 }}>
                      Set an alarm for <strong style={{ fontSize: '1.3rem' }}>{clock(alarm)}</strong>
                    </p>
                    <p className="small muted">
                      = {clock(target)} − {personal.prep} min get ready − {personal.travel} min travel − {personal.buffer} min
                      buffer. All three are your assumptions.
                    </p>
                  </>
                )}
              </div>
            </div>
            <div className="actions" style={{ marginTop: 14 }}>
              <button className="btn" type="button" onClick={copyLink}>
                {copied ? 'Link copied' : 'Copy link to these filters'}
              </button>
              <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={personal.share} onChange={(e) => setPersonal({ ...personal, share: e.target.checked })} />
                Include my get-ready/travel/buffer times in the link
              </label>
            </div>
            <SourceLine manifest={manifest}>
              {`Cohort ${timing.cohort_version} · n = ${num(r.slotCount)} slots on ${num(r.days.length)} dates · reservation dates before ${longDate(cutoff, false)}`}
            </SourceLine>
          </section>

          <section className="panel" aria-labelledby="sample-h">
            <h2 id="sample-h">What’s in this sample</h2>
            <div className="cards" style={{ marginBottom: 8 }}>
              <div className="card">
                <div className="label">Qualifying slots</div>
                <div className="value">{num(r.slotCount)}</div>
                <div className="note">One per slot: its earliest qualifying walkup entry</div>
              </div>
              <div className="card">
                <div className="label">Dates with qualifying entries</div>
                <div className="value">{num(r.days.length)}</div>
                <div className="note">{r.days.length < minDates ? 'Limited sample' : 'Each is a curve below'}</div>
              </div>
              <div className="card">
                <div className="label">Dates with records, none qualifying</div>
                <div className="value">{num(r.zeroQualifyingDates.length)}</div>
                <div className="note">Unknown for timing; not drawn as zero</div>
              </div>
              <div className="card">
                <div className="label">Matching dates not in export</div>
                <div className="value">{num(r.noRecordDates.length)}</div>
                <div className="note">No records at these hours</div>
              </div>
              {wx !== 'any' && (
                <div className="card">
                  <div className="label">Dates left out by weather filter</div>
                  <div className="value">{num(r.weatherExcludedDates + r.weatherUnknownDates.length)}</div>
                  <div className="note">
                    {num(r.weatherExcludedDates)} didn’t match; {num(r.weatherUnknownDates.length)} had no weather data
                  </div>
                </div>
              )}
            </div>
            {r.days.length < minDates && (
              <div className="callout">
                Limited sample: {r.days.length} date{r.days.length === 1 ? '' : 's'}. Times above describe these dates only.
              </div>
            )}
            {(r.zeroQualifyingDates.length > 0 || r.noRecordDates.length > 0 || r.weatherUnknownDates.length > 0) && (
              <details>
                <summary>List excluded and missing dates</summary>
                {r.weatherUnknownDates.length > 0 && (
                  <p className="small">
                    <strong>No weather data (left out, not assumed dry):</strong> {r.weatherUnknownDates.map((d) => longDate(d)).join('; ')}
                  </p>
                )}
                {r.zeroQualifyingDates.length > 0 && (
                  <p className="small">
                    <strong>Records but no qualifying walkup entry:</strong> {r.zeroQualifyingDates.map((d) => longDate(d)).join('; ')}
                  </p>
                )}
                {r.noRecordDates.length > 0 && (
                  <p className="small">
                    <strong>Not in this export at the selected hours:</strong> {r.noRecordDates.map((d) => longDate(d)).join('; ')}
                  </p>
                )}
              </details>
            )}
          </section>

          <div className="grid-2">
            <section className="panel" aria-labelledby="curve-h">
              <h2 id="curve-h">Daily booking curves</h2>
              <p className="sub">
                For each date: the share of that day’s qualifying entries made by each clock time. It is not a count of courts
                left.
              </p>
              <CurvesChart result={r} showTarget={bench} />
              <SourceLine manifest={manifest}>{`${num(r.days.length)} dates, each weighted equally`}</SourceLine>
            </section>
            <section className="panel" aria-labelledby="hist-h">
              <h2 id="hist-h">When entries were made</h2>
              <p className="sub">Qualifying entries per {BIN}-minute window, all dates pooled.</p>
              <TimeHistogram bins={r.histogram} binMinutes={BIN} />
              <SourceLine manifest={manifest}>{`n = ${num(r.slotCount)} slots`}</SourceLine>
            </section>
          </div>

          <section className="panel" aria-labelledby="tbl-h">
            <h2 id="tbl-h">Every comparable date</h2>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="n">Qualifying slots</th>
                    <th className="n">First entry</th>
                    <th className="n">25th pct</th>
                    <th className="n">Median</th>
                    <th className="n">Last entry</th>
                    <th>Records</th>
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
                        <a href={`#/courts?date=${d.date}`}>Court grid</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="panel" aria-labelledby="def-h">
        <h2 id="def-h">What counts as a qualifying entry</h2>
        <ol className="small">
          <li>Reservation date before {longDate(cutoff, false)} (the {manifest.snapshot.cutoff_status} snapshot boundary).</li>
          <li>The slot’s recorded status is “all checked in.”</li>
          <li>A record with method “walkup” and player status “Checked in.” Additional players (second/third/fourth) and online, phone, waiting-list and repeat-list entries are excluded.</li>
          <li>Entered on the same calendar day as the slot, at or before its start time (times read as {manifest.timezone.assumed}, provisional).</li>
          <li>Per slot, the earliest such entry. This may not be the first reservation ever made for that slot.</li>
        </ol>
        <p className="small muted">
          Creation timestamps record when a booking was entered — not when anyone joined a line or checked in. The export contains
          no record of people who arrived and did not get a court.
        </p>
      </section>
    </>
  )
}
