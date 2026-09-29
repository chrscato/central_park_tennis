// Weather joins. Rain is compared with *recorded* statuses; nothing here
// establishes why a slot was rained out.

import type { DailyCoverage } from './data'

export interface WeatherData {
  status: 'available' | 'unavailable'
  reason?: string
  dry_definition: string
  definitions: Record<string, string>
  sources: {
    role: string
    provider: string
    station: string
    units_in_file: string
    time_basis: string
    files: { filename: string; sha256: string; bytes: number; duplicate_of: string | null }[]
  }[]
  coverage: {
    daily_start: string
    daily_end: string
    lcd_daily_last: string
    hourly_first: string
    hourly_last: string
    days_by_source: Record<string, number>
    days_covered: number
    days_total: number
    ncei_gap_fill?: { url?: string; retrieved_at?: string; from_cache?: boolean; last_date?: string | null; error?: string } | null
  }
  reconciliation: {
    complete_days_compared: number
    wet_days: number
    wet_within_0_03_in: number | null
    dry_wet_agreement: number | null
    largest_differences: { date: string; hourly_sum_in: number; lcd_daily_in: number }[]
    basis: string
  }
  warnings: string[]
  daily: {
    date: string[]
    rain: (number | null)[]
    trace: boolean[]
    source: string[]
    prev1: (number | null)[]
    prev1_trace: boolean[]
    trail2: (number | null)[]
    trail2_trace: boolean[]
    trail3: (number | null)[]
    trail3_trace: boolean[]
    tmax_f: (number | null)[]
    tmin_f: (number | null)[]
  }
  cells: {
    d: number[]
    h: number[]
    recorded: number[]
    checkedin: number[]
    rainedout: number[]
    during: (number | null)[]
    during_trace: boolean[]
    prev3h: (number | null)[]
    prev3h_trace: boolean[]
    prev6h: (number | null)[]
    prev6h_trace: boolean[]
    prev24h: (number | null)[]
    prev24h_trace: boolean[]
    next6h?: (number | null)[]
  }
}

export const BUCKETS = ['dry', 'trace', 'light', 'moderate', 'heavy', 'missing'] as const
export type Bucket = (typeof BUCKETS)[number]
export const BUCKET_LABEL: Record<Bucket, string> = {
  dry: 'Dry (0.00")',
  trace: 'Trace only',
  light: '0.01–0.09"',
  moderate: '0.10–0.49"',
  heavy: '0.50" or more',
  missing: 'No weather data',
}

/** Missing never counts as dry; a trace is kept separate from measured rain. */
export function bucketOf(amount: number | null | undefined, trace: boolean): Bucket {
  if (amount == null || Number.isNaN(amount)) return 'missing'
  if (amount >= 0.5) return 'heavy'
  if (amount >= 0.1) return 'moderate'
  if (amount >= 0.01) return 'light'
  return trace ? 'trace' : 'dry'
}

export type DailyWindow = 'same' | 'prev1' | 'trail2' | 'trail3'
export const DAILY_WINDOW_LABEL: Record<DailyWindow, string> = {
  same: 'Same day',
  prev1: 'Previous day',
  trail2: '2 days before',
  trail3: '3 days before',
}
export type HourlyWindow = 'during' | 'prev3h' | 'prev6h' | 'prev24h'
export const HOURLY_WINDOW_LABEL: Record<HourlyWindow, string> = {
  during: 'During the slot hour',
  prev3h: '3 hours before start',
  prev6h: '6 hours before start',
  prev24h: '24 hours before start',
}

export interface DayWeather {
  rain: number | null
  trace: boolean
  source: string
  prev1: number | null
  prev1Trace: boolean
  trail2: number | null
  trail2Trace: boolean
  trail3: number | null
  trail3Trace: boolean
  tmax: number | null
}

export function dayIndex(w: WeatherData): Map<string, DayWeather> {
  const d = w.daily
  return new Map(
    d.date.map((date, i) => [
      date,
      {
        rain: d.rain[i],
        trace: d.trace[i],
        source: d.source[i],
        prev1: d.prev1[i],
        prev1Trace: d.prev1_trace[i],
        trail2: d.trail2[i],
        trail2Trace: d.trail2_trace[i],
        trail3: d.trail3[i],
        trail3Trace: d.trail3_trace[i],
        tmax: d.tmax_f[i],
      },
    ]),
  )
}

export function windowValue(day: DayWeather | undefined, win: DailyWindow): [number | null, boolean] {
  if (!day) return [null, false]
  switch (win) {
    case 'same':
      return [day.rain, day.trace]
    case 'prev1':
      return [day.prev1, day.prev1Trace]
    case 'trail2':
      return [day.trail2, day.trail2Trace]
    case 'trail3':
      return [day.trail3, day.trail3Trace]
  }
}

export interface BucketRow {
  bucket: Bucket
  units: number // dates (daily) or date-hour cells (hourly)
  recorded: number
  rainedOut: number
  share: number | null
}

function finish(acc: Map<Bucket, BucketRow>): BucketRow[] {
  return BUCKETS.map((b) => {
    const r = acc.get(b) ?? { bucket: b, units: 0, recorded: 0, rainedOut: 0, share: null }
    return { ...r, share: r.recorded ? r.rainedOut / r.recorded : null }
  })
}

function add(acc: Map<Bucket, BucketRow>, b: Bucket, recorded: number, rainedOut: number) {
  const r = acc.get(b) ?? { bucket: b, units: 0, recorded: 0, rainedOut: 0, share: null }
  r.units++
  r.recorded += recorded
  r.rainedOut += rainedOut
  acc.set(b, r)
}

/** Recorded rained-out share of recorded court-hours, grouped by a daily rain window. */
export function rainoutByDailyBucket(w: WeatherData, daily: DailyCoverage[], win: DailyWindow): BucketRow[] {
  const idx = dayIndex(w)
  const acc = new Map<Bucket, BucketRow>()
  for (const d of daily) {
    if (d.post_cutoff) continue
    const [v, t] = windowValue(idx.get(d.date), win)
    add(acc, bucketOf(v, t), d.recorded, d['rained-out'])
  }
  return finish(acc)
}

/** Same, at the date x start-hour level using hourly rain before/during the slot. */
export function rainoutByHourlyBucket(w: WeatherData, win: HourlyWindow): BucketRow[] {
  const c = w.cells
  const vals = c[win]
  const traces = c[`${win}_trace` as const]
  const acc = new Map<Bucket, BucketRow>()
  for (let i = 0; i < c.d.length; i++) add(acc, bucketOf(vals[i], traces[i]), c.recorded[i], c.rainedout[i])
  return finish(acc)
}

export interface Lead {
  date: string
  rainedOut: number
  recorded: number
  trail3: number | null
  trail3Trace: boolean
}

/** Dates with recorded rain-outs although the same day AND previous day measured dry (no trace). */
export function dryDayRainouts(w: WeatherData, daily: DailyCoverage[]): Lead[] {
  const idx = dayIndex(w)
  return daily
    .filter((d) => !d.post_cutoff && d['rained-out'] > 0)
    .flatMap((d) => {
      const day = idx.get(d.date)
      if (!day) return []
      if (bucketOf(day.rain, day.trace) !== 'dry' || bucketOf(day.prev1, day.prev1Trace) !== 'dry') return []
      return [{ date: d.date, rainedOut: d['rained-out'], recorded: d.recorded, trail3: day.trail3, trail3Trace: day.trail3Trace }]
    })
    .sort((a, b) => b.rainedOut - a.rainedOut)
}

// Planner weather filters use only information available the morning of play.
export const PLANNER_WEATHER = {
  any: 'Any weather',
  'prev1-dry': 'Previous day dry',
  'prev1-wet': 'Rain the previous day (0.01"+)',
  'trail3-dry': 'Dry all 3 days before',
  'trail3-wet': 'Rain in the 3 days before (0.10"+)',
} as const
export type PlannerWeather = keyof typeof PLANNER_WEATHER

export function plannerWeatherTest(w: WeatherData, key: PlannerWeather): ((date: string) => 'ok' | 'no' | 'unknown') | undefined {
  if (key === 'any') return undefined
  const idx = dayIndex(w)
  return (date) => {
    const day = idx.get(date)
    const [v, t] = key.startsWith('prev1') ? windowValue(day, 'prev1') : windowValue(day, 'trail3')
    const b = bucketOf(v, t)
    if (b === 'missing') return 'unknown'
    switch (key) {
      case 'prev1-dry':
      case 'trail3-dry':
        return b === 'dry' ? 'ok' : 'no'
      case 'prev1-wet':
        return v! >= 0.01 ? 'ok' : 'no'
      case 'trail3-wet':
        return v! >= 0.1 ? 'ok' : 'no'
    }
  }
}

export const inches = (v: number | null | undefined, trace = false) =>
  v == null ? 'no data' : v === 0 ? (trace ? 'trace' : '0.00"') : `${v.toFixed(2)}"`
