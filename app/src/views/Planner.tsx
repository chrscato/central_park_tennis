import { useEffect, useMemo, useState } from 'react'
import { CurvesChart, TimeHistogram } from '../components/charts'
import { Figure, Group, Readout, useMediaQuery } from '../components/common'
import type { Manifest, Timing } from '../lib/data'
import { clock, hourLabel, inList, longDate, MONTHS, MONTHS_LONG, num, ranges, WEEKDAYS, WEEKDAYS_LONG } from '../lib/format'
import { combineTests, OPENING_FILTER, openingTest, type OpeningFilter } from '../lib/outlook'
import { alarmMinute, computePlanner, dateMeta, DEFAULT_FILTER, type PlannerFilter } from '../lib/stats'
import { toLocal } from '../lib/live'
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
    courts: params.get('c') === 'all' ? 'all' : 'walkup',
    holidays: params.get('hol') === '1',
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
  if (f.courts === 'all') q.set('c', 'all')
  if (f.holidays) q.set('hol', '1')
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
          <span>{label(o)}</span>
        </label>
      ))}
    </div>
  )
}

/** Tomorrow in New York, mapped onto the season covered by the records. */
function tomorrowInNY(holidays: string[]) {
  const date = toLocal(new Date(Date.now() + 24 * 3600 * 1000)).date
  const meta = dateMeta(date)
  const month = meta.month < 4 ? 4 : meta.month > 10 ? 10 : meta.month
  return { date, dow: meta.dow, month, inSeason: month === meta.month, holiday: holidays.includes(date) || isLikelyHoliday(date) }
}

/** Fixed-date and Monday holidays in the tennis season (covers years beyond the records). */
function isLikelyHoliday(date: string): boolean {
  const { month, dow } = dateMeta(date)
  const day = Number(date.slice(8, 10))
  if (date.endsWith('-06-19') || date.endsWith('-07-04')) return true
  if (dow === 1 && month === 5 && day > 24) return true // Memorial Day
  if (dow === 1 && month === 9 && day <= 7) return true // Labor Day
  if (dow === 1 && month === 10 && day >= 8 && day <= 14) return true // Columbus / Indigenous Peoples' Day
  return false
}

/** "Wednesdays in April" / "Weekdays in April, May" */
function describe(f: PlannerFilter): string {
  const wd = f.weekdays
  const days =
    wd.length === 7
      ? 'Any day'
      : wd.length === 5 && [1, 2, 3, 4, 5].every((d) => wd.includes(d))
        ? 'Weekdays'
        : wd.length === 2 && wd.includes(0) && wd.includes(6)
          ? 'Weekends'
          : wd.map((d) => WEEKDAYS_LONG[d] + 's').join(', ')
  const months = f.months.length === SEASON_MONTHS.length ? 'the season' : f.months.map((m) => MONTHS_LONG[m - 1]).join(', ')
  return `${days} in ${months}`
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
  const [drawer, setDrawer] = useState(false)
  const [tomorrowNote, setTomorrowNote] = useState<string | null>(null)
  const isMobile = useMediaQuery('(max-width: 900px)')
  const tomorrow = useMemo(() => tomorrowInNY(timing.holidays ?? []), [timing])
  const applyTomorrow = () => {
    setFilter({ ...filter, weekdays: [tomorrow.dow], months: [tomorrow.month], holidays: tomorrow.holiday })
    setTomorrowNote(
      tomorrow.inSeason
        ? tomorrow.holiday
          ? 'Tomorrow is a public holiday, so holidays are included.'
          : null
        : `Tomorrow is outside the April–October season in these records; showing ${MONTHS_LONG[tomorrow.month - 1]} instead.`,
    )
    setDrawer(false)
  }
  const tomorrowLabel = `Tomorrow · ${WEEKDAYS[tomorrow.dow]} ${Number(tomorrow.date.slice(5, 7))}/${Number(tomorrow.date.slice(8, 10))}`

  useEffect(() => replaceParams('planner', toParams(filter, bench, personal, wx, open)), [filter, bench, personal, wx, open])

  const minDates = manifest.cohort.min_dates_for_planning_target
  const cutoff = manifest.snapshot.historical_outcome_cutoff
  const test = useMemo(() => (wxAvailable ? combineTests(plannerWeatherTest(weather, wx), openingTest(weather, open)) : undefined), [weather, wx, open, wxAvailable])
  const r = useMemo(
    () => computePlanner(timing, filter, { firstDate: manifest.snapshot.reservation_date_min, cutoff, minDates, binMinutes: BIN, weather: test }),
    [timing, filter, manifest, cutoff, minDates, test],
  )

  const walkupCourts = timing.court_groups?.walkup ?? []
  const onlineCourts = timing.court_groups?.online ?? []
  const incomplete = !filter.months.length || !filter.weekdays.length || !filter.hours.length
  const target = r.planningTarget.suppressed ? null : r.planningTarget.minute
  const alarm = target == null ? null : alarmMinute(target, personal.prep, personal.travel, personal.buffer)
  const limited = r.days.length < minDates
  const courtText = filter.courts === 'all' ? 'all courts' : 'walk-up courts'

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

  const summaryText = incomplete
    ? 'Choose court time, day and month'
    : `${filter.weekdays.map((d) => WEEKDAYS[d]).join(', ')} · ${filter.months.map((m) => MONTHS[m - 1]).join(', ')} · ${filter.hours.map(hourLabel).join(', ')}`

  const filters = (
    <>
      <Group title="Court time">
        <Checks cols={3} options={HOURS} selected={filter.hours} onChange={(hours) => setFilter({ ...filter, hours })} label={hourLabel} />
      </Group>
      <Group title="Day">
        <Checks cols={4} options={DAYS} selected={filter.weekdays} onChange={(weekdays) => setFilter({ ...filter, weekdays })} label={(d) => WEEKDAYS[d]} />
      </Group>
      <Group title="Month">
        <Checks cols={4} options={SEASON_MONTHS} selected={filter.months} onChange={(months) => setFilter({ ...filter, months })} label={(m) => MONTHS[m - 1]} />
      </Group>
      <Group title="Courts">
        <div className="checks c2">
          <label>
            <input type="radio" name="courts" checked={filter.courts !== 'all'} onChange={() => setFilter({ ...filter, courts: 'walkup' })} />
            <span>Walk-up</span>
          </label>
          <label>
            <input type="radio" name="courts" checked={filter.courts === 'all'} onChange={() => setFilter({ ...filter, courts: 'all' })} />
            <span>All</span>
          </label>
        </div>
        {onlineCourts.length > 0 && <div className="hint">Courts {ranges(onlineCourts)} are mostly booked online, so they’re left out by default.</div>}
      </Group>
      <details>
        <summary className="small" style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--ink-2)', marginBottom: 8 }}>
          More filters
        </summary>
        <Group title="Season">
          <div className="checks c3">
            <label>
              <input type="radio" name="season" checked={!filter.years.length} onChange={() => setFilter({ ...filter, years: [] })} />
              <span>All</span>
            </label>
            {years.map((y) => (
              <label key={y}>
                <input type="radio" name="season" checked={filter.years.length === 1 && filter.years[0] === y} onChange={() => setFilter({ ...filter, years: [y] })} />
                <span>{y}</span>
              </label>
            ))}
          </div>
        </Group>
        <Group title="Weather">
          <div className="field">
            <label htmlFor="wx">Rain before</label>
            <select id="wx" disabled={!wxAvailable} value={wx} onChange={(e) => setWx(e.target.value as PlannerWeather)}>
              {Object.entries(PLANNER_WEATHER).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <label htmlFor="hol">Holidays</label>
            <label className="check small" style={{ margin: 0 }}>
              <input id="hol" type="checkbox" checked={!!filter.holidays} onChange={(e) => setFilter({ ...filter, holidays: e.target.checked })} />
              Include
            </label>
            <label htmlFor="open">Mornings</label>
            <select id="open" disabled={!wxAvailable} value={open} onChange={(e) => setOpen(e.target.value as OpeningFilter)}>
              <option value="any">Any</option>
              <option value="late">Closed by rain</option>
              <option value="normal">Open as usual</option>
            </select>
          </div>
        </Group>
      </details>
      <div className="row" style={{ marginTop: 8 }}>
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
</>
  )

  return (
    <div className="split">
      {isMobile ? (
        <div className="mobile-filters">
          <div className="row">
            <button className="btn primary" type="button" onClick={applyTomorrow}>
              {tomorrowLabel}
            </button>
            <button className="btn" type="button" onClick={copyLink}>
              {copied ? 'Copied' : 'Share'}
            </button>
          </div>
          <details className="filter-drawer" open={drawer} onToggle={(e) => setDrawer((e.target as HTMLDetailsElement).open)}>
            <summary>
              <span className="filter-summary">{summaryText}</span>
              <span className="filter-change">{drawer ? 'Done' : 'Change'}</span>
            </summary>
            <div className="filter-body">{filters}</div>
          </details>
        </div>
      ) : (
        <aside>
          <button className="btn primary" type="button" style={{ width: '100%', marginBottom: 14 }} onClick={applyTomorrow}>
            {tomorrowLabel}
          </button>
          {filters}
        </aside>
      )}

      <section aria-label="Results">
        {initial.invalid.length > 0 && <div className="note">Some link settings were invalid and were reset: {inList(initial.invalid)}.</div>}
        {tomorrowNote && <div className="note">{tomorrowNote}</div>}

        {incomplete ? (
          <div className="note">Pick at least one court time, day, and month.</div>
        ) : r.slotCount === 0 ? (
          <div className="note">No walk-up bookings in the records for this choice.</div>
        ) : (
          <>
            <Group title={`${describe(filter)}, ${inList(filter.hours.map(hourLabel))} courts`}>
              <p style={{ fontSize: 16, maxWidth: 720 }}>
                On past days like this, half of the {courtText} were taken by <b>{clock(r.pooled.p50)}</b> and three in four by <b>{clock(r.pooled.p75)}</b>.
                On a typical day the last one went at <b>{clock(r.latest.last.p50)}</b>.
                {r.freed.count > 0 && (
                  <>
                    {' '}
                    Some come back: {num(r.freed.count)} ({Math.round((r.freed.count / r.slotCount) * 100)}%) were freed by a cancellation or no-show and
                    taken again, usually around <b>{clock(r.freed.retakeMedian)}</b>.
                  </>
                )}
              </p>
              <div className="readouts">
                <Readout label="Half taken by" value={clock(r.pooled.p50)} accent />
                <Readout label="Three in four taken by" value={clock(r.pooled.p75)} />
                <Readout label="Last one taken (typical day)" value={clock(r.latest.last.p50)} />
                <Readout label="Based on" value={`${num(r.days.length)} days`} sub={`${num(r.slotCount)} walk-up bookings`} />
              </div>
              {limited && (
                <div className="note">
                  Only {r.days.length} days match, so treat these as rough.{' '}
                  {filter.weekdays.length < 5 && (
                    <button className="btn small" type="button" onClick={() => setFilter({ ...filter, weekdays: [1, 2, 3, 4, 5] })}>
                      Include all weekdays
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
                      Add nearby months
                    </button>
                  )}
                </div>
              )}
            </Group>

            <Group title="Plan your morning">
              <div className="row" style={{ alignItems: 'flex-end', gap: 24 }}>
                <div className="readouts" style={{ marginBottom: 0 }}>
                  <Readout
                    label="Be in line by"
                    value={bench ? (target == null ? 'Not enough data' : clock(target)) : 'Hidden'}
                    off={!bench || target == null}
                    sub={bench && target == null ? `Needs ${minDates}+ days` : 'Errs on the early side'}
                  />
                  <Readout label="Set your alarm for" value={alarm == null || !bench ? '—' : clock(alarm)} accent off={alarm == null || !bench} />
                </div>
                <div className="row">
                  <label className="small">
                    Get ready <input type="number" min={0} max={600} value={personal.prep} onChange={setP('prep')} /> min
                  </label>
                  <label className="small">
                    Travel <input type="number" min={0} max={600} value={personal.travel} onChange={setP('travel')} /> min
                  </label>
                  <label className="small">
                    Extra buffer <input type="number" min={0} max={600} value={personal.buffer} onChange={setP('buffer')} /> min
                  </label>
                </div>
              </div>
              <div className="hint">“Be in line by” would have put you ahead of the early rush on most past days. It isn’t a guarantee.</div>
              <label className="check small" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={personal.share} onChange={(e) => setPersonal({ ...personal, share: e.target.checked })} />
                Include my times when I copy the link
              </label>
            </Group>

            <div className="cols-2" style={{ marginBottom: 26 }}>
              <Figure title="How fast each day’s courts went" sub="Share of the day’s walk-up bookings made by each time" source="Each grey line is one day; blue is the middle day.">
                <CurvesChart result={r} showTarget={bench} />
              </Figure>
              <Figure title="When bookings were made" sub={`Walk-up bookings per ${BIN} minutes, all matching days`} source="Source: NYC Parks FOIL records.">
                <TimeHistogram bins={r.histogram} binMinutes={BIN} />
              </Figure>
            </div>

            <details className="grp">
              <summary className="fig-title" style={{ cursor: 'pointer' }}>
                More numbers & every day
              </summary>
              <div className="readouts" style={{ margin: '12px 0' }}>
                <Readout label="A quarter taken by" value={clock(r.pooled.p25)} />
                <Readout label="Typical day’s midpoint" value={clock(r.dayWeighted.p50)} sub={`${clock(r.dayWeighted.p25)}–${clock(r.dayWeighted.p75)}`} />
                <Readout label="Last five began (typical day)" value={clock(r.latest.fifthLast.p50)} sub={`${num(r.latest.fifthLast.n)} days with 5+`} />
                <Readout label="Last one taken, range" value={`${clock(r.latest.last.p25)}–${clock(r.latest.last.p75)}`} />
              </div>
              <label className="check small" style={{ marginBottom: 10 }}>
                <input type="checkbox" checked={bench} onChange={(e) => setBench(e.target.checked)} />
                Show “be in line by” (each day’s first-quarter time; the early quarter of those days; rounded down to 15 min)
              </label>
              <div className="grid-wrap">
                <table className="dg">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th className="n">Bookings</th>
                      <th className="n">First</th>
                      <th className="n">Half by</th>
                      <th className="n">Last</th>
                      <th>Last five</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {r.days.map((d) => (
                      <tr key={d.date}>
                        <td>{longDate(d.date)}</td>
                        <td className="n">{d.times.length}</td>
                        <td className="n">{clock(d.times[0])}</td>
                        <td className="n">{clock(d.p50)}</td>
                        <td className="n">
                          <b>{clock(d.last)}</b>
                        </td>
                        <td className="muted num">{d.lastFive.map((m) => clock(m)).join(' · ')}</td>
                        <td>
                          <a href={href('courts', { date: d.date })}>Courts</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(r.zeroQualifyingDates.length > 0 || r.noRecordDates.length > 0 || r.weatherUnknownDates.length > 0) && (
                <p className="hint">
                  Not counted: {r.zeroQualifyingDates.length} days with no walk-up booking at these times, {r.noRecordDates.length} days missing from the records
                  {test ? `, ${r.weatherExcludedDates} filtered out by weather, ${r.weatherUnknownDates.length} without weather data` : ''}.
                </p>
              )}
            </details>
          </>
        )}
        <div className="foot">
          From NYC Parks records of walk-up bookings that went ahead ({courtText}
          {filter.courts !== 'all' && walkupCourts.length ? `: ${ranges(walkupCourts)}` : ''}). Shows when courts were taken on past days, not your odds
          today. <a href={href('methodology')}>How this works</a>
        </div>
      </section>
    </div>
  )
}
