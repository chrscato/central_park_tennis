import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Overview, Timing } from './data'
import { computePlanner } from './stats'
import { bucketOf, dryDayRainouts, plannerWeatherTest, rainoutByDailyBucket, rainoutByHourlyBucket, type WeatherData } from './weather'

describe('bucketOf', () => {
  it('never treats missing as dry and keeps trace separate', () => {
    expect(bucketOf(null, false)).toBe('missing')
    expect(bucketOf(0, false)).toBe('dry')
    expect(bucketOf(0, true)).toBe('trace')
    expect(bucketOf(0.01, false)).toBe('light')
    expect(bucketOf(0.1, false)).toBe('moderate')
    expect(bucketOf(0.5, false)).toBe('heavy')
  })
})

function wx(days: [string, number | null, boolean, number | null][]): WeatherData {
  return {
    status: 'available',
    daily: {
      date: days.map((d) => d[0]),
      rain: days.map((d) => d[1]),
      trace: days.map((d) => d[2]),
      source: days.map(() => 'lcd-daily'),
      prev1: days.map((d) => d[3]),
      prev1_trace: days.map(() => false),
      trail2: days.map(() => null),
      trail2_trace: days.map(() => false),
      trail3: days.map(() => null),
      trail3_trace: days.map(() => false),
      tmax_f: days.map(() => null),
      tmin_f: days.map(() => null),
    },
  } as unknown as WeatherData
}

describe('planner weather filter', () => {
  it('excludes failing dates and reports unknown-weather dates instead of guessing', () => {
    const t: Timing = {
      cohort_version: 't',
      unit: 't',
      dates: ['2025-04-02', '2025-04-09', '2025-04-16'],
      slots: { d: [0, 1, 2], h: [18, 18, 18], m: [400, 410, 420], c: [1, 1, 1] },
      hourly: { d: [0, 1, 2], h: [18, 18, 18], recorded: [1, 1, 1], checkedin: [1, 1, 1], qualifying: [1, 1, 1] },
    }
    const w = wx([
      ['2025-04-02', 0, false, 0], // prev day dry
      ['2025-04-09', 0, false, 0.4], // prev day wet
      ['2025-04-16', 0, false, null], // prev day unknown
    ])
    const r = computePlanner(
      t,
      { months: [4], weekdays: [3], years: [], hours: [18] },
      { firstDate: '2025-04-01', cutoff: '2025-04-20', minDates: 1, weather: plannerWeatherTest(w, 'prev1-dry') },
    )
    expect(r.days.map((d) => d.date)).toEqual(['2025-04-02'])
    expect(r.weatherExcludedDates).toBe(1)
    expect(r.weatherUnknownDates).toEqual(['2025-04-16'])
    expect(r.noRecordDates).toEqual([])
  })
})

describe('dry-day rain-out leads', () => {
  it('requires measured dry on the day and the day before', () => {
    const w = wx([
      ['2025-06-01', 0, false, 0],
      ['2025-06-02', 0, true, 0], // trace same day -> not a lead
      ['2025-06-03', null, false, 0], // missing -> not a lead
    ])
    const daily = ['2025-06-01', '2025-06-02', '2025-06-03'].map((date) => ({ date, recorded: 10, 'rained-out': 4, post_cutoff: false }))
    expect(dryDayRainouts(w, daily as never).map((l) => l.date)).toEqual(['2025-06-01'])
  })
})

const dataDir = fileURLToPath(new URL('../../public/data/', import.meta.url))
const has = existsSync(dataDir + 'weather.json')
describe.skipIf(!has)('generated weather assets', () => {
  const w: WeatherData = has ? JSON.parse(readFileSync(dataDir + 'weather.json', 'utf8')) : (null as never)
  const ov: Overview = has ? JSON.parse(readFileSync(dataDir + 'overview.json', 'utf8')) : (null as never)
  it('daily bucket denominators reconcile to recorded court-hours', () => {
    for (const win of ['same', 'prev1', 'trail2', 'trail3'] as const) {
      const rows = rainoutByDailyBucket(w, ov.daily, win)
      expect(rows.reduce((a, r) => a + r.recorded, 0)).toBe(ov.cards.recorded_court_hours)
      expect(rows.reduce((a, r) => a + r.rainedOut, 0)).toBe(ov.cards.status_counts['rained-out'])
    }
  })
  it('hourly bucket denominators reconcile to recorded court-hours', () => {
    const rows = rainoutByHourlyBucket(w, 'prev3h')
    expect(rows.reduce((a, r) => a + r.recorded, 0)).toBe(ov.cards.recorded_court_hours)
  })
})
