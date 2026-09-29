import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Manifest, Timing } from './data'
import { alarmMinute, computePlanner, dailyCurveBand, floorTo, quantile } from './stats'
import { parseIntList } from './url'

/** Build a Timing fixture from [date, hour, minuteOfDay] triples plus optional recorded-only cells. */
function fixture(slots: [string, number, number][], recordedOnly: [string, number, number][] = []): Timing {
  const dates = [...new Set([...slots.map((s) => s[0]), ...recordedOnly.map((s) => s[0])])].sort()
  const idx = new Map(dates.map((x, i) => [x, i]))
  const cells = new Map<string, { recorded: number; qualifying: number }>()
  for (const [dt, h] of slots) {
    const k = `${dt}|${h}`
    const c = cells.get(k) ?? { recorded: 0, qualifying: 0 }
    c.recorded++
    c.qualifying++
    cells.set(k, c)
  }
  for (const [dt, h, n] of recordedOnly) {
    const k = `${dt}|${h}`
    const c = cells.get(k) ?? { recorded: 0, qualifying: 0 }
    c.recorded += n
    cells.set(k, c)
  }
  const hourly = { d: [] as number[], h: [] as number[], recorded: [] as number[], checkedin: [] as number[], qualifying: [] as number[] }
  for (const [k, c] of cells) {
    const [dt, h] = k.split('|')
    hourly.d.push(idx.get(dt)!)
    hourly.h.push(Number(h))
    hourly.recorded.push(c.recorded)
    hourly.checkedin.push(c.qualifying)
    hourly.qualifying.push(c.qualifying)
  }
  return {
    cohort_version: 'test',
    unit: 'test',
    dates,
    slots: { d: slots.map((s) => idx.get(s[0])!), h: slots.map((s) => s[1]), m: slots.map((s) => s[2]), c: slots.map(() => 1) },
    hourly,
  }
}

// April 2025 Wednesdays: 2, 9, 16, 23, 30
const OPTS = { firstDate: '2025-04-01', cutoff: '2025-05-01', minDates: 3 }
const APR_WED = { months: [4], weekdays: [3], years: [], hours: [18] }

describe('quantile', () => {
  it('uses linear interpolation (type 7)', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75)
    expect(quantile([7], 0.9)).toBe(7)
    expect(quantile([], 0.5)).toBeNull()
  })
})

describe('computePlanner', () => {
  it('day-weighted results differ from pooled results on an imbalanced fixture', () => {
    const busy: [string, number, number][] = Array.from({ length: 10 }, () => ['2025-04-02', 18, 360])
    const t = fixture([...busy, ['2025-04-09', 18, 540], ['2025-04-16', 18, 540]])
    const r = computePlanner(t, APR_WED, OPTS)
    expect(r.slotCount).toBe(12)
    expect(r.pooled.p50).toBe(360) // dominated by the busy day
    expect(r.dayWeighted.p50).toBe(540) // each day counts once
    expect(r.days).toHaveLength(3)
  })

  it('suppresses the planning target below the minimum number of dates', () => {
    const t = fixture([['2025-04-02', 18, 400], ['2025-04-09', 18, 420]])
    const r = computePlanner(t, APR_WED, OPTS)
    expect(r.planningTarget.suppressed).toBe(true)
    expect(r.planningTarget.minute).toBeNull()
    // descriptive values still shown
    expect(r.pooled.p50).toBe(410)
  })

  it('planning target = 25th pct of daily 25th pcts, floored to 15 minutes', () => {
    const t = fixture([
      ['2025-04-02', 18, 400], ['2025-04-02', 18, 500],
      ['2025-04-09', 18, 420], ['2025-04-09', 18, 520],
      ['2025-04-16', 18, 440], ['2025-04-16', 18, 540],
    ])
    const r = computePlanner(t, APR_WED, OPTS)
    // daily p25s: 425, 445, 465 -> p25 = 435 -> floor15 = 435 (7:15)
    expect(r.planningTarget).toEqual({ minute: 435, suppressed: false })
  })

  it('reports dates with records but no qualifying entry, and dates absent from the export, separately', () => {
    const t = fixture([['2025-04-02', 18, 400]], [['2025-04-09', 18, 4]])
    const r = computePlanner(t, APR_WED, OPTS)
    expect(r.days.map((d) => d.date)).toEqual(['2025-04-02'])
    expect(r.zeroQualifyingDates).toEqual(['2025-04-09'])
    expect(r.noRecordDates).toEqual(['2025-04-16', '2025-04-23', '2025-04-30'])
  })

  it('combines hour windows from slot-level data rather than averaging percentiles', () => {
    const t = fixture([['2025-04-02', 17, 300], ['2025-04-02', 18, 400], ['2025-04-02', 18, 500]])
    const both = computePlanner(t, { ...APR_WED, hours: [17, 18] }, OPTS)
    expect(both.slotCount).toBe(3)
    expect(both.pooled.p50).toBe(400)
  })

  it('ignores other months, weekdays and years', () => {
    const t = fixture([['2025-04-03', 18, 1], ['2025-05-07', 18, 2], ['2026-04-01', 18, 3], ['2025-04-02', 18, 4]])
    const r = computePlanner(t, { ...APR_WED, years: [2025] }, { ...OPTS, cutoff: '2026-05-01' })
    expect(r.slotCount).toBe(1)
  })
})

describe('latest bookings', () => {
  it('reports each day’s last and 5th-from-last booking, weighting days equally', () => {
    const d1: [string, number, number][] = [400, 410, 420, 430, 440, 450].map((m) => ['2025-04-02', 18, m])
    const d2: [string, number, number][] = [500, 900].map((m) => ['2025-04-09', 18, m])
    const r = computePlanner(fixture([...d1, ...d2]), APR_WED, OPTS)
    expect(r.days[0].last).toBe(450)
    expect(r.days[0].lastFive).toEqual([410, 420, 430, 440, 450])
    expect(r.days[1].lastFive).toEqual([500, 900])
    expect(r.latest.last.p50).toBe(675) // median of 450 and 900
    expect(r.latest.fifthLast).toEqual({ p50: 410, n: 1 }) // only day 1 has 5+ bookings
  })
})

describe('dailyCurveBand', () => {
  it('each curve runs from 0 to 1 and the median is monotone', () => {
    const band = dailyCurveBand(
      [
        { date: 'a', times: [400, 410, 500], p25: 0, p50: 0, last: 500, lastFive: [] },
        { date: 'b', times: [420], p25: 0, p50: 0, last: 420, lastFive: [] },
      ],
      5,
    )
    expect(band.median[0]).toBe(0)
    expect(band.median[band.median.length - 1]).toBe(1)
    for (let i = 1; i < band.median.length; i++) expect(band.median[i]).toBeGreaterThanOrEqual(band.median[i - 1])
  })
})

describe('helpers', () => {
  it('alarm arithmetic wraps midnight', () => {
    expect(alarmMinute(390, 20, 30, 15)).toBe(325)
    expect(alarmMinute(30, 20, 30, 0)).toBe(1420)
  })
  it('floorTo', () => expect(floorTo(449, 15)).toBe(435))
  it('rejects invalid URL filters', () => {
    expect(parseIntList('4,4,3', 1, 12)).toEqual([3, 4])
    expect(parseIntList('13', 1, 12)).toBeNull()
    expect(parseIntList('x', 1, 12)).toBeNull()
  })
})

// Acceptance check (P1): the planner reproduces the pipeline's April/Wednesday/6 p.m. reference.
const dataDir = fileURLToPath(new URL('../../public/data/', import.meta.url))
const hasData = existsSync(dataDir + 'timing.json')
describe.skipIf(!hasData)('pipeline reference', () => {
  it('April / Wednesday / 6 p.m. matches pipeline output', () => {
    const t: Timing = JSON.parse(readFileSync(dataDir + 'timing.json', 'utf8'))
    const m: Manifest = JSON.parse(readFileSync(dataDir + 'manifest.json', 'utf8'))
    const ref = m.reference_checks.find((r) => r.name === 'april_wednesday_6pm')!
    const r = computePlanner(
      t,
      { months: [ref.month], weekdays: [(ref.weekday_mon0 + 1) % 7], years: [], hours: ref.hours },
      { firstDate: m.snapshot.reservation_date_min, cutoff: m.snapshot.historical_outcome_cutoff, minDates: m.cohort.min_dates_for_planning_target },
    )
    expect(r.slotCount).toBe(ref.slots)
    expect(r.days.length).toBe(ref.dates)
    expect(r.pooled.p25).toBeCloseTo(ref.pooled_p25_minute!, 6)
    expect(r.pooled.p50).toBeCloseTo(ref.pooled_p50_minute!, 6)
    expect(r.pooled.p75).toBeCloseTo(ref.pooled_p75_minute!, 6)
    // 7 dates < 10: limited-sample state
    expect(r.planningTarget.suppressed).toBe(true)
  })
})
