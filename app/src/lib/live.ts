// Recent Central Park rainfall from the National Weather Service API
// (station KNYC — the same Central Park ASOS gauge used historically).
// No key needed; the API allows browser requests. Precipitation is read from
// each routine :51 METAR's P group exactly as the pipeline does:
//   Pxxxx = hundredths of an inch in the hour ending at the observation,
//   P0000 = trace, no P group = none that hour, PNO or no METAR = missing.

export const NWS_OBS_URL = 'https://api.weather.gov/stations/KNYC/observations'

export interface LiveHour {
  date: string // local America/New_York date of the hour's end
  hour: number // local hour of the :51 observation
  rain: number | null
  trace: boolean
}

export interface LiveDay {
  date: string
  total: number | null // null unless all hours present
  partialTotal: number
  trace: boolean
  hoursPresent: number
  hoursExpected: number
}

export interface LiveRain {
  fetchedAt: string
  latestObservation: string | null
  hours: LiveHour[]
  yesterday: LiveDay
  today: LiveDay
}

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function toLocal(iso: string | Date): { date: string; hour: number; minute: number } {
  const parts = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) }
}

export function parseMetarPrecip(raw: string | null | undefined): { rain: number | null; trace: boolean } {
  if (!raw || !raw.trim()) return { rain: null, trace: false }
  if (/\bPNO\b/.test(raw)) return { rain: null, trace: false }
  const m = raw.match(/\sP(\d{4})\b/)
  if (!m) return { rain: 0, trace: false }
  return { rain: Number(m[1]) / 100, trace: m[1] === '0000' }
}

interface NwsFeature {
  properties: {
    timestamp: string
    rawMessage?: string | null
    precipitationLastHour?: { unitCode?: string; value: number | null } | null
  }
}

/** METAR first; if the feed omitted the raw METAR, use its decoded hourly value (mm). */
function observationPrecip(p: NwsFeature['properties']): { rain: number | null; trace: boolean } {
  if (p.rawMessage && p.rawMessage.trim()) return parseMetarPrecip(p.rawMessage)
  const v = p.precipitationLastHour?.value
  if (v == null) return { rain: null, trace: false }
  const inches = p.precipitationLastHour?.unitCode?.endsWith(':mm') ? v / 25.4 : v
  return { rain: Math.round(inches * 100) / 100, trace: false }
}

export function parseObservations(features: NwsFeature[]): LiveHour[] {
  const byKey = new Map<string, LiveHour>()
  for (const f of features) {
    const loc = toLocal(f.properties.timestamp)
    if (loc.minute !== 51) continue // routine hourly reports only; specials would double count
    const { rain, trace } = observationPrecip(f.properties)
    byKey.set(`${loc.date}|${loc.hour}`, { date: loc.date, hour: loc.hour, rain, trace })
  }
  return [...byKey.values()].sort((a, b) => (a.date === b.date ? a.hour - b.hour : a.date < b.date ? -1 : 1))
}

export function summarizeDay(hours: LiveHour[], date: string, expected: number): LiveDay {
  const hs = hours.filter((h) => h.date === date)
  const present = hs.filter((h) => h.rain != null)
  const partialTotal = Math.round(present.reduce((a, h) => a + (h.rain ?? 0), 0) * 100) / 100
  return {
    date,
    total: present.length >= expected ? partialTotal : null,
    partialTotal,
    trace: hs.some((h) => h.trace),
    hoursPresent: present.length,
    hoursExpected: expected,
  }
}

export async function fetchLiveRain(now = new Date()): Promise<LiveRain> {
  const start = new Date(now.getTime() - 60 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const res = await fetch(`${NWS_OBS_URL}?start=${encodeURIComponent(start)}`, { headers: { Accept: 'application/geo+json' } })
  if (!res.ok) throw new Error(`NWS API HTTP ${res.status}`)
  const body = (await res.json()) as { features: NwsFeature[] }
  const hours = parseObservations(body.features ?? [])
  const today = toLocal(now)
  const y = new Date(now.getTime() - 24 * 3600 * 1000)
  const yesterday = toLocal(y).date
  const latest = body.features?.length ? body.features.map((f) => f.properties.timestamp).sort().at(-1)! : null
  return {
    fetchedAt: now.toISOString(),
    latestObservation: latest,
    hours,
    yesterday: summarizeDay(hours, yesterday, 24),
    // Hours completed so far today: observations end at :51, so hour H is done after H:51.
    today: summarizeDay(hours, today.date, today.minute >= 51 ? today.hour + 1 : today.hour),
  }
}
