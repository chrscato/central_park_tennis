// Types and loaders for the sanitized public assets produced by `python -m pipeline.build`.

import type { WeatherData } from './weather'

export const STATUSES = [
  'all-checkedin',
  'rained-out',
  'assigned',
  'booking-in-progress',
  'unassigned',
  'unbookable',
] as const
export type Status = (typeof STATUSES)[number]

export const STATUS_LABEL: Record<Status, string> = {
  'all-checkedin': 'All checked in',
  'rained-out': 'Rained out',
  assigned: 'Assigned',
  'booking-in-progress': 'Booking in progress',
  unassigned: 'Unassigned',
  unbookable: 'Unbookable',
}

// Short text codes so status never relies on color alone.
export const STATUS_CODE: Record<Status, string> = {
  'all-checkedin': 'CI',
  'rained-out': 'RO',
  assigned: 'AS',
  'booking-in-progress': 'BP',
  unassigned: 'UA',
  unbookable: 'UB',
}

export interface LedgerStep {
  step: string
  slots: number
  note: string
}

export interface Manifest {
  app: string
  pipeline_version: string
  data_version: string
  built_at_utc: string
  source: {
    filename: string
    sha256: string
    bytes: number
    dictionary_filename: string | null
    dictionary_sha256: string | null
    agency_extraction_time: string | null
    extraction_time_status: 'confirmed' | 'unconfirmed'
  }
  snapshot: {
    label: string
    historical_outcome_cutoff: string
    cutoff_status: string
    cutoff_rule: string
    reservation_date_min: string
    reservation_date_max: string
    latest_activity: string
  }
  timezone: { assumed: string; status: string; note: string }
  profile: Record<string, unknown> & {
    raw_rows: number
    validated_slots: number
    exact_duplicate_rows: number
    rows_with_reason_present: number
    rows_created_after_slot_start: number
  }
  issues: Record<string, unknown> & { quarantined_slot_ids: number }
  reconciliation: { property: string; prior: string | number; recomputed: string | number; match: boolean }[]
  cohort: {
    version: string
    slot_ledger: LedgerStep[]
    row_ledger: { rule: string; rows: number }[]
    min_dates_for_planning_target: number
    quality_version?: string
    quality_ledger?: { rule: string; removed: number; unit: string; why: string }[]
    screened_slots?: number
    time_definition?: string
    freed_then_retaken?: number
  }
  reference_checks: {
    name: string
    month: number
    weekday_mon0: number
    hours: number[]
    slots: number
    dates: number
    pooled_p25_minute: number | null
    pooled_p50_minute: number | null
    pooled_p75_minute: number | null
  }[]
  public_files: { count: number; non_slot_files: string[] }
  court_groups?: { walkup: number[]; online: number[]; online_share: Record<string, number>; rule: string }
}

export type StatusCounts = Record<Status, number>

export interface DailyCoverage extends StatusCounts {
  date: string
  recorded: number
  courts: number
  hours: number
  first_hour: number
  last_hour: number
  post_cutoff: boolean
}

export interface Overview {
  unit: string
  filter: string
  cards: {
    recorded_court_hours: number
    status_counts: StatusCounts
    checked_in_share: number | null
    rained_out_share: number | null
    represented_dates: number
    first_outcome_date: string | null
    latest_outcome_date: string | null
    courts: number
  }
  weekly: ({ week_start: string } & StatusCounts)[]
  daily: DailyCoverage[]
}

export interface Timing {
  cohort_version: string
  unit: string
  dates: string[]
  slots: { d: number[]; h: number[]; m: number[]; c: number[]; r?: (number | null)[] }
  holidays?: string[]
  hourly: { d: number[]; h: number[]; recorded: number[]; checkedin: number[]; qualifying: number[]; recorded_wc?: number[]; qualifying_wc?: number[] }
  court_groups?: { walkup: number[]; online: number[]; online_share: Record<string, number>; rule: string }
}

export interface SlotDetail {
  id: string
  court: number
  hour: number
  status: Status
  rows: number
  methods: Record<string, number>
  player_statuses: Record<string, number>
  permits: Record<string, number>
  actions: Record<string, number>
  walkup: { time: string; lead_minutes: number } | null
}

export interface DayPartition {
  date: string
  post_cutoff: boolean
  slots: SlotDetail[]
  weather: { hour: number; rain_in: number | null; trace: boolean }[] | null
}

const BASE = `${import.meta.env.BASE_URL}data/`
const cache = new Map<string, Promise<unknown>>()

function load<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const p = fetch(BASE + path).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
      return r.json()
    })
    p.catch(() => cache.delete(path))
    cache.set(path, p)
  }
  return cache.get(path) as Promise<T>
}

export const loadManifest = () => load<Manifest>('manifest.json')
export const loadOverview = () => load<Overview>('overview.json')
export const loadTiming = () => load<Timing>('timing.json')
export const loadDay = (date: string) => load<DayPartition>(`slots/${date}.json`)
export const loadWeather = () => load<WeatherData>('weather.json')
export const loadInsights = () => load<Insights>('insights.json')

export interface Insights {
  party_size?: {
    counts: Record<string, number>
    counts_walkup_courts: Record<string, number>
    by_hour: { hour: number; singles: number; doubles: number; three: number; one: number }[]
    rule: string
  }
  two_hour?: {
    rule: string
    likely_pairs: number
    possible_pairs: number
    likely_with_doubles: number
    walkup_court_hours: number
    likely_share_of_walkup_hours: number | null
    likely_by_start_hour: Record<string, number>
  }
  partner_entry?: {
    bins: number[]
    rule_minutes: number
    second: PartnerStats
    fourth: PartnerStats
  }
}

export interface PartnerStats {
  n: number
  median: number | null
  p25: number | null
  p75: number | null
  share_15_or_more_before: number | null
  share_0_to_15_before: number | null
  share_after_start: number | null
  histogram: number[]
}
export const dataUrl = (path: string) => BASE + path
