// "After the rain" outlook: how recorded rain-outs and recorded play resumed on
// past days that followed a given amount of rain. Historical frequencies of
// *recorded* statuses only — not official closure decisions, and not a
// probability that any person gets a court.

import { bucketOf, dayIndex, windowValue, type Bucket, type WeatherData } from './weather'
import { quantile } from './stats'

export const MORNING_HOURS = [7, 8, 9, 10, 11]
export const LATE_OPEN_THRESHOLD = 0.5 // share of recorded morning court-hours rained out
export const MIN_MORNING_RECORDS = 5

export type Opening = 'late' | 'normal' | 'unknown'

export interface DayCondition {
  date: string
  morningRecorded: number
  morningRainedOut: number
  opening: Opening
  firstPlayHour: number | null // earliest start hour with >= 1 court-hour recorded "all checked in"
}

const condCache = new WeakMap<WeatherData, Map<string, DayCondition>>()

/** Per-date morning rain-out share and first recorded play, from date x hour cells. */
export function dayConditions(w: WeatherData): Map<string, DayCondition> {
  const hit = condCache.get(w)
  if (hit) return hit
  const c = w.cells
  const out = new Map<string, DayCondition>()
  for (let i = 0; i < c.d.length; i++) {
    const date = w.daily.date[c.d[i]]
    if (!date) continue
    let dc = out.get(date)
    if (!dc) out.set(date, (dc = { date, morningRecorded: 0, morningRainedOut: 0, opening: 'unknown', firstPlayHour: null }))
    if (MORNING_HOURS.includes(c.h[i])) {
      dc.morningRecorded += c.recorded[i]
      dc.morningRainedOut += c.rainedout[i]
    }
    if (c.checkedin[i] > 0 && (dc.firstPlayHour == null || c.h[i] < dc.firstPlayHour)) dc.firstPlayHour = c.h[i]
  }
  for (const dc of out.values()) {
    dc.opening =
      dc.morningRecorded < MIN_MORNING_RECORDS ? 'unknown' : dc.morningRainedOut / dc.morningRecorded >= LATE_OPEN_THRESHOLD ? 'late' : 'normal'
  }
  condCache.set(w, out)
  return out
}

export type TodayAssumption = 'dry' | 'any'

export interface HourRow {
  hour: number
  recorded: number
  rainedOut: number
  share: number | null
  dates: number
}

export type OutlookWindow = 'prev1' | 'trail2' | 'trail3'

export interface OutlookResult {
  window: OutlookWindow
  bucket: Bucket
  dates: string[]
  hours: HourRow[]
  lateShare: number | null
  lateDates: number
  knownOpeningDates: number
  firstPlay: { p25: number | null; p50: number | null; p75: number | null; n: number; noPlay: number }
}

/**
 * Past dates whose rain over the chosen window (previous day, or the 2 / 3 days
 * before) falls in the same bucket as `rain`, optionally restricted to dates with
 * no measurable rain that day.
 */
export function outlook(w: WeatherData, rain: number, trace: boolean, today: TodayAssumption, window: OutlookWindow = 'prev1'): OutlookResult {
  const bucket = bucketOf(rain, trace)
  const idx = dayIndex(w)
  const cond = dayConditions(w)
  const dates = new Set<string>()
  for (const [date, day] of idx) {
    if (!cond.has(date)) continue
    const [v, t] = windowValue(day, window)
    if (bucketOf(v, t) !== bucket) continue
    if (today === 'dry' && (day.rain == null || day.rain > 0)) continue
    dates.add(date)
  }

  const c = w.cells
  const byHour = new Map<number, HourRow & { ds: Set<string> }>()
  for (let i = 0; i < c.d.length; i++) {
    const date = w.daily.date[c.d[i]]
    if (!dates.has(date)) continue
    const h = c.h[i]
    let r = byHour.get(h)
    if (!r) byHour.set(h, (r = { hour: h, recorded: 0, rainedOut: 0, share: null, dates: 0, ds: new Set() }))
    r.recorded += c.recorded[i]
    r.rainedOut += c.rainedout[i]
    r.ds.add(date)
  }
  const hours = [...byHour.values()]
    .sort((a, b) => a.hour - b.hour)
    .map(({ ds, ...r }) => ({ ...r, dates: ds.size, share: r.recorded ? r.rainedOut / r.recorded : null }))

  const conds = [...dates].map((d) => cond.get(d)!)
  const known = conds.filter((x) => x.opening !== 'unknown')
  const late = known.filter((x) => x.opening === 'late').length
  const firsts = conds.map((x) => x.firstPlayHour).filter((x): x is number => x != null).sort((a, b) => a - b)

  return {
    window,
    bucket,
    dates: [...dates].sort(),
    hours,
    lateShare: known.length ? late / known.length : null,
    lateDates: late,
    knownOpeningDates: known.length,
    firstPlay: {
      p25: quantile(firsts, 0.25),
      p50: quantile(firsts, 0.5),
      p75: quantile(firsts, 0.75),
      n: firsts.length,
      noPlay: conds.length - firsts.length,
    },
  }
}

export const OPENING_FILTER = {
  any: 'Any opening',
  late: 'Late-opening days (mornings mostly rained out)',
  normal: 'Normal-opening days',
} as const
export type OpeningFilter = keyof typeof OPENING_FILTER

export function openingTest(w: WeatherData, key: OpeningFilter): ((date: string) => 'ok' | 'no' | 'unknown') | undefined {
  if (key === 'any') return undefined
  const cond = dayConditions(w)
  return (date) => {
    const o = cond.get(date)?.opening ?? 'unknown'
    if (o === 'unknown') return 'unknown'
    return o === key ? 'ok' : 'no'
  }
}

/** Combine optional per-date tests: all must be 'ok'; any 'unknown' (without a 'no') is unknown. */
export function combineTests(
  ...tests: (((date: string) => 'ok' | 'no' | 'unknown') | undefined)[]
): ((date: string) => 'ok' | 'no' | 'unknown') | undefined {
  const active = tests.filter((t): t is (date: string) => 'ok' | 'no' | 'unknown' => !!t)
  if (!active.length) return undefined
  return (date) => {
    let unknown = false
    for (const t of active) {
      const r = t(date)
      if (r === 'no') return 'no'
      if (r === 'unknown') unknown = true
    }
    return unknown ? 'unknown' : 'ok'
  }
}
