import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { dryRainouts, mixedCalls, playedInRain } from './anomalies'
import type { WeatherData } from './weather'

type Cell = { date: string; h: number; rec: number; ro: number; ci: number; during: number | null; prev24h: number | null; next6h: number | null }

function wx(cells: Cell[], trail3: Record<string, number | null> = {}): WeatherData {
  const dates = [...new Set(cells.map((c) => c.date))].sort()
  const di = new Map(dates.map((d, i) => [d, i]))
  const col = <K extends keyof Cell>(k: K) => cells.map((c) => c[k])
  return {
    status: 'available',
    daily: {
      date: dates,
      rain: dates.map(() => 0),
      trace: dates.map(() => false),
      source: dates.map(() => 'lcd-daily'),
      prev1: dates.map(() => 0),
      prev1_trace: dates.map(() => false),
      trail2: dates.map(() => 0),
      trail2_trace: dates.map(() => false),
      trail3: dates.map((d) => (d in trail3 ? trail3[d] : 0)),
      trail3_trace: dates.map(() => false),
      tmax_f: dates.map(() => null),
      tmin_f: dates.map(() => null),
    },
    cells: {
      d: cells.map((c) => di.get(c.date)!),
      h: col('h'),
      recorded: col('rec'),
      rainedout: col('ro'),
      checkedin: col('ci'),
      during: col('during'),
      during_trace: cells.map(() => false),
      prev3h: col('prev24h'),
      prev3h_trace: cells.map(() => false),
      prev6h: col('prev24h'),
      prev6h_trace: cells.map(() => false),
      prev24h: col('prev24h'),
      prev24h_trace: cells.map(() => false),
      next6h: col('next6h'),
    },
  } as unknown as WeatherData
}

const cell = (p: Partial<Cell>): Cell => ({ date: '2025-06-01', h: 10, rec: 12, ro: 12, ci: 0, during: 0, prev24h: 0, next6h: 0, ...p })

describe('dryRainouts', () => {
  it('lists rain-outs with little rain before and explains them', () => {
    const w = wx(
      [
        cell({ date: '2025-06-01' }), // no rain anywhere
        cell({ date: '2025-06-02', next6h: 0.4 }), // storm later
        cell({ date: '2025-06-03' }), // wet from earlier days
        cell({ date: '2025-06-04', prev24h: 0.3 }), // rained before: expected, not listed
        cell({ date: '2025-06-05', ro: 3 }), // below minimum court-hours
      ],
      { '2025-06-03': 1.2 },
    )
    const { rows } = dryRainouts(w)
    expect(rows.map((r) => [r.date, r.explanation])).toEqual([
      ['2025-06-01', 'none'],
      ['2025-06-02', 'later'],
      ['2025-06-03', 'wet'],
    ])
  })

  it('never treats missing rain as dry', () => {
    const { rows, unknownCourtHours } = dryRainouts(wx([cell({ prev24h: null })]))
    expect(rows).toEqual([])
    expect(unknownCourtHours).toBe(12)
  })
})

describe('mixedCalls / playedInRain', () => {
  it('finds hours with both statuses and check-ins during rain', () => {
    const w = wx([cell({ ro: 3, ci: 5, during: 0.08 }), cell({ h: 11, ro: 0, ci: 8, during: 0.2 })])
    expect(mixedCalls(w)).toEqual([{ date: '2025-06-01', hours: 1, rainedOut: 3, checkedIn: 5, maxRainDuring: 0.08 }])
    expect(playedInRain(w, 0.05)).toEqual({ courtHours: 13, dates: 1 })
  })
})

const dataDir = fileURLToPath(new URL('../../public/data/', import.meta.url))
const has = existsSync(dataDir + 'weather.json')
describe.skipIf(!has)('generated data', () => {
  it('matches the pipeline-side exploration', () => {
    const w: WeatherData = JSON.parse(readFileSync(dataDir + 'weather.json', 'utf8'))
    const { rows } = dryRainouts(w)
    expect(rows.length).toBe(31) // dates with 10+ rained-out court-hours and < 0.05" in the prior 24 h
    expect(rows[0].date).toBe('2025-07-03')
  })
})
