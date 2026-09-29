// Walkup planner computations. Pure functions; see stats.test.ts.
//
// Everything here describes *observed successful* reservations (cohort
// successful-walkup-v1). Nothing estimates the chance that an arriving person
// gets a court.

import type { Timing } from './data'

/** Hyndman–Fan type 7 quantile (linear interpolation) of an ascending array. */
export function quantile(sorted: number[], p: number): number | null {
  const n = sorted.length
  if (n === 0) return null
  const h = (n - 1) * p
  const lo = Math.floor(h)
  const hi = Math.min(lo + 1, n - 1)
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo])
}

/** Number of values <= t in an ascending array. */
export function countAtOrBefore(sorted: number[], t: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export const floorTo = (m: number, step: number) => Math.floor(m / step) * step

export interface DateMeta {
  date: string
  year: number
  month: number // 1–12
  dow: number // 0 = Sunday
}

export function dateMeta(date: string): DateMeta {
  const [y, m, d] = date.split('-').map(Number)
  return { date, year: y, month: m, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export interface PlannerFilter {
  months: number[]
  weekdays: number[]
  years: number[] // empty = all years
  hours: number[] // slot start hours (24h)
}

export const DEFAULT_FILTER: PlannerFilter = { months: [4], weekdays: [3], years: [], hours: [17, 18] }

export interface DaySeries {
  date: string
  times: number[] // ascending minute-of-day of qualifying entries
  p25: number
  p50: number
}

export interface PlannerResult {
  slotCount: number
  pooled: { p25: number | null; p50: number | null; p75: number | null }
  days: DaySeries[]
  dayWeighted: { p25: number | null; p50: number | null; p75: number | null } // of daily medians
  zeroQualifyingDates: string[] // recorded slots in window but no qualifying entry
  noRecordDates: string[] // matching calendar dates with no recorded slots in window
  weatherExcludedDates: number // calendar-matching dates with records that fail the weather condition
  weatherUnknownDates: string[] // calendar-matching dates with records but no weather data
  curve: { grid: number[]; median: number[]; lo: number[]; hi: number[] } | null
  histogram: { start: number; count: number }[]
  planningTarget: { minute: number; suppressed: false } | { minute: null; suppressed: true; reason: string }
}

export interface PlannerOptions {
  firstDate: string // first date covered by the export
  cutoff: string // historical outcome cutoff (exclusive)
  minDates: number
  curveStep?: number
  binMinutes?: number
  /** Optional per-date weather condition. 'unknown' dates are excluded and reported, never guessed. */
  weather?: (date: string) => 'ok' | 'no' | 'unknown'
}

const metaCache = new WeakMap<Timing, DateMeta[]>()
function metas(t: Timing): DateMeta[] {
  let m = metaCache.get(t)
  if (!m) {
    m = t.dates.map(dateMeta)
    metaCache.set(t, m)
  }
  return m
}

export function matchesDate(meta: DateMeta, f: PlannerFilter): boolean {
  return (
    f.months.includes(meta.month) &&
    f.weekdays.includes(meta.dow) &&
    (f.years.length === 0 || f.years.includes(meta.year))
  )
}

export function computePlanner(t: Timing, f: PlannerFilter, opts: PlannerOptions): PlannerResult {
  const meta = metas(t)
  const hourSet = new Set(f.hours)
  const calendarOk = meta.map((m) => matchesDate(m, f))
  const wx = meta.map((m, i) => (calendarOk[i] && opts.weather ? opts.weather(m.date) : 'ok'))
  const dateOk = calendarOk.map((ok, i) => ok && wx[i] === 'ok')

  const perDate = new Map<number, number[]>()
  const pooledTimes: number[] = []
  const { d, h, m } = t.slots
  for (let k = 0; k < d.length; k++) {
    if (!dateOk[d[k]] || !hourSet.has(h[k])) continue
    pooledTimes.push(m[k])
    let arr = perDate.get(d[k])
    if (!arr) perDate.set(d[k], (arr = []))
    arr.push(m[k])
  }
  pooledTimes.sort((a, b) => a - b)

  const recordedByDate = new Map<number, number>()
  const weatherExcluded = new Set<number>()
  const weatherUnknown = new Set<number>()
  const hr = t.hourly
  for (let k = 0; k < hr.d.length; k++) {
    const di = hr.d[k]
    if (!calendarOk[di] || !hourSet.has(hr.h[k]) || !hr.recorded[k]) continue
    if (wx[di] === 'no') weatherExcluded.add(di)
    else if (wx[di] === 'unknown') weatherUnknown.add(di)
    else recordedByDate.set(di, (recordedByDate.get(di) ?? 0) + hr.recorded[k])
  }

  const days: DaySeries[] = [...perDate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([di, times]) => {
      times.sort((a, b) => a - b)
      return { date: t.dates[di], times, p25: quantile(times, 0.25)!, p50: quantile(times, 0.5)! }
    })

  const zeroQualifyingDates: string[] = []
  for (const [di, n] of recordedByDate) if (n > 0 && !perDate.has(di)) zeroQualifyingDates.push(t.dates[di])
  zeroQualifyingDates.sort()

  // Calendar dates in the export's span that match the filter but have no records in the window.
  const noRecordDates: string[] = []
  const index = new Map(t.dates.map((x, i) => [x, i]))
  if (f.hours.length) {
    for (let day = opts.firstDate; day < opts.cutoff; day = addDays(day, 1)) {
      if (!matchesDate(dateMeta(day), f)) continue
      const i = index.get(day)
      if (i !== undefined && (weatherExcluded.has(i) || weatherUnknown.has(i))) continue
      if (i === undefined || !recordedByDate.get(i)) noRecordDates.push(day)
    }
  }

  const medians = days.map((x) => x.p50).sort((a, b) => a - b)
  const dayWeighted = { p25: quantile(medians, 0.25), p50: quantile(medians, 0.5), p75: quantile(medians, 0.75) }

  let planningTarget: PlannerResult['planningTarget']
  if (days.length < opts.minDates) {
    planningTarget = {
      minute: null,
      suppressed: true,
      reason: `Limited sample: ${days.length} qualifying date${days.length === 1 ? '' : 's'} (fewer than ${opts.minDates}).`,
    }
  } else {
    const p25s = days.map((x) => x.p25).sort((a, b) => a - b)
    planningTarget = { minute: floorTo(quantile(p25s, 0.25)!, 15), suppressed: false }
  }

  return {
    slotCount: pooledTimes.length,
    pooled: { p25: quantile(pooledTimes, 0.25), p50: quantile(pooledTimes, 0.5), p75: quantile(pooledTimes, 0.75) },
    days,
    dayWeighted,
    zeroQualifyingDates,
    noRecordDates,
    weatherExcludedDates: weatherExcluded.size,
    weatherUnknownDates: [...weatherUnknown].sort((a, b) => a - b).map((i) => t.dates[i]),
    curve: days.length ? dailyCurveBand(days, opts.curveStep ?? 5) : null,
    histogram: histogram(pooledTimes, opts.binMinutes ?? 15),
    planningTarget,
  }
}

/** Median and IQR across days of F_d(t) = share of that day's entries made by t (each day weighted equally). */
export function dailyCurveBand(days: DaySeries[], step: number) {
  const all = days.flatMap((x) => [x.times[0], x.times[x.times.length - 1]])
  const start = floorTo(Math.min(...all), step) - step
  const end = floorTo(Math.max(...all), step) + 2 * step
  const grid: number[] = []
  const median: number[] = []
  const lo: number[] = []
  const hi: number[] = []
  for (let t = start; t <= end; t += step) {
    const vals = days.map((x) => countAtOrBefore(x.times, t) / x.times.length).sort((a, b) => a - b)
    grid.push(t)
    median.push(quantile(vals, 0.5)!)
    lo.push(quantile(vals, 0.25)!)
    hi.push(quantile(vals, 0.75)!)
  }
  return { grid, median, lo, hi }
}

export function histogram(sorted: number[], bin: number) {
  if (!sorted.length) return []
  const out: { start: number; count: number }[] = []
  const first = floorTo(sorted[0], bin)
  const last = floorTo(sorted[sorted.length - 1], bin)
  for (let s = first; s <= last; s += bin) out.push({ start: s, count: 0 })
  for (const v of sorted) out[(floorTo(v, bin) - first) / bin].count++
  return out
}

/** Alarm = planning target − (preparation + travel + queue buffer). Wraps across midnight. */
export function alarmMinute(target: number, prep: number, travel: number, buffer: number): number {
  const v = target - prep - travel - buffer
  return ((v % 1440) + 1440) % 1440
}
