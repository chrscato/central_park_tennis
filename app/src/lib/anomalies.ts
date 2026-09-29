// Records that don't line up with the rain gauge. Investigative leads, not
// findings: one gauge can miss local showers, and wet courts, maintenance or
// forecasts can explain a closure.

import { dayIndex, type WeatherData } from './weather'

export interface AnomalyOptions {
  dryBefore: number // max rain in the 24 h before + during the slot to count as "little rain"
  minCourtHours: number // min rained-out court-hours on the date to list it
  laterRain: number // rain in the 6 h after start that counts as "rain came later"
  wetDays: number // rain over the prior 3 days that counts as "wet from earlier days"
}

export const DEFAULT_ANOMALY: AnomalyOptions = { dryBefore: 0.05, minCourtHours: 10, laterRain: 0.05, wetDays: 0.25 }

export type Explanation = 'none' | 'later' | 'wet'
export const EXPLANATION_LABEL: Record<Explanation, string> = {
  none: 'No rain nearby',
  later: 'Rain came later',
  wet: 'Wet from earlier days',
}

export interface DryRainout {
  date: string
  rainedOut: number // court-hours rained out with little rain before
  recordedThatDay: number
  hours: number[]
  rainBefore: number // max rain in 24 h before + during, across those hours
  rainAfter: number | null // max rain in the 6 h after start
  sameDay: number | null
  trail3: number | null
  explanation: Explanation
}

/** Rained-out court-hours when little or no rain fell in the 24 hours before and during the slot. */
export function dryRainouts(w: WeatherData, o: AnomalyOptions = DEFAULT_ANOMALY): { rows: DryRainout[]; unknownCourtHours: number } {
  const c = w.cells
  const days = dayIndex(w)
  const byDate = new Map<string, DryRainout>()
  const recorded = new Map<string, number>()
  let unknown = 0
  for (let i = 0; i < c.d.length; i++) {
    const date = w.daily.date[c.d[i]]
    recorded.set(date, (recorded.get(date) ?? 0) + c.recorded[i])
    if (!c.rainedout[i]) continue
    const before = c.prev24h[i] == null || c.during[i] == null ? null : c.prev24h[i]! + c.during[i]!
    if (before == null) {
      unknown += c.rainedout[i]
      continue
    }
    if (before >= o.dryBefore) continue
    let r = byDate.get(date)
    if (!r) {
      const day = days.get(date)
      byDate.set(
        date,
        (r = { date, rainedOut: 0, recordedThatDay: 0, hours: [], rainBefore: 0, rainAfter: null, sameDay: day?.rain ?? null, trail3: day?.trail3 ?? null, explanation: 'none' }),
      )
    }
    r.rainedOut += c.rainedout[i]
    r.hours.push(c.h[i])
    r.rainBefore = Math.max(r.rainBefore, before)
    const after = c.next6h?.[i]
    if (after != null) r.rainAfter = Math.max(r.rainAfter ?? 0, after)
  }
  const rows = [...byDate.values()]
    .filter((r) => r.rainedOut >= o.minCourtHours)
    .map((r) => {
      r.recordedThatDay = recorded.get(r.date) ?? 0
      r.hours.sort((a, b) => a - b)
      r.explanation = (r.rainAfter ?? 0) >= o.laterRain ? 'later' : (r.trail3 ?? 0) >= o.wetDays ? 'wet' : 'none'
      return r
    })
    .sort((a, b) => b.rainedOut - a.rainedOut)
  return { rows, unknownCourtHours: unknown }
}

export interface MixedCall {
  date: string
  hours: number
  rainedOut: number
  checkedIn: number
  maxRainDuring: number | null
}

/** Hours where some courts were recorded rained out while others were recorded checked in. */
export function mixedCalls(w: WeatherData): MixedCall[] {
  const c = w.cells
  const by = new Map<string, MixedCall>()
  for (let i = 0; i < c.d.length; i++) {
    if (!(c.rainedout[i] > 0 && c.checkedin[i] > 0)) continue
    const date = w.daily.date[c.d[i]]
    let r = by.get(date)
    if (!r) by.set(date, (r = { date, hours: 0, rainedOut: 0, checkedIn: 0, maxRainDuring: null }))
    r.hours++
    r.rainedOut += c.rainedout[i]
    r.checkedIn += c.checkedin[i]
    if (c.during[i] != null) r.maxRainDuring = Math.max(r.maxRainDuring ?? 0, c.during[i]!)
  }
  return [...by.values()].sort((a, b) => b.hours - a.hours || b.rainedOut - a.rainedOut)
}

/** Court-hours recorded checked in while at least `threshold` inches fell that hour. */
export function playedInRain(w: WeatherData, threshold = 0.05): { courtHours: number; dates: number } {
  const c = w.cells
  let courtHours = 0
  const dates = new Set<number>()
  for (let i = 0; i < c.d.length; i++) {
    if (c.during[i] != null && c.during[i]! >= threshold && c.checkedin[i] > 0) {
      courtHours += c.checkedin[i]
      dates.add(c.d[i])
    }
  }
  return { courtHours, dates: dates.size }
}
