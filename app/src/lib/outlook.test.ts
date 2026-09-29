import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseMetarPrecip, parseObservations, summarizeDay, toLocal } from './live'
import { combineTests, outlook } from './outlook'
import type { WeatherData } from './weather'

describe('live METAR parsing (same rules as the pipeline)', () => {
  it('reads the P group, trace, PNO and missing reports', () => {
    expect(parseMetarPrecip('KNYC 291851Z AUTO 10SM RA OVC035 RMK AO2 P0012 T0206')).toEqual({ rain: 0.12, trace: false })
    expect(parseMetarPrecip('KNYC 291851Z AUTO RMK AO2 P0000')).toEqual({ rain: 0, trace: true })
    expect(parseMetarPrecip('KNYC 291851Z AUTO RMK AO2 SLP150')).toEqual({ rain: 0, trace: false })
    expect(parseMetarPrecip('KNYC 291851Z AUTO RMK AO2 PNO')).toEqual({ rain: null, trace: false })
    expect(parseMetarPrecip('')).toEqual({ rain: null, trace: false })
    expect(parseMetarPrecip(null)).toEqual({ rain: null, trace: false })
  })

  it('converts UTC to New York local time across DST', () => {
    expect(toLocal('2026-07-10T10:51:00+00:00')).toEqual({ date: '2026-07-10', hour: 6, minute: 51 })
    expect(toLocal('2026-01-10T03:51:00+00:00')).toEqual({ date: '2026-01-09', hour: 22, minute: 51 })
  })

  it('keeps routine :51 reports only and dedupes by hour', () => {
    const f = (ts: string, raw: string) => ({ properties: { timestamp: ts, rawMessage: raw } })
    const hours = parseObservations([
      f('2026-09-28T14:51:00+00:00', 'X RMK AO2 P0005'),
      f('2026-09-28T14:51:00+00:00', 'X RMK AO2 P0005'),
      f('2026-09-28T15:10:00+00:00', 'SPECI RMK AO2 P0003'),
      f('2026-09-28T15:51:00+00:00', 'X RMK AO2 P0010'),
    ])
    expect(hours.map((h) => [h.date, h.hour, h.rain])).toEqual([
      ['2026-09-28', 10, 0.05],
      ['2026-09-28', 11, 0.1],
    ])
  })

  it('reports a day total only when every hour is present', () => {
    const hours = Array.from({ length: 24 }, (_, h) => ({ date: '2026-09-28', hour: h, rain: h === 5 ? 0.3 : 0, trace: false }))
    expect(summarizeDay(hours, '2026-09-28', 24).total).toBe(0.3)
    const gap = hours.map((h) => (h.hour === 3 ? { ...h, rain: null } : h))
    const d = summarizeDay(gap, '2026-09-28', 24)
    expect(d.total).toBeNull()
    expect(d.partialTotal).toBe(0.3)
    expect(d.hoursPresent).toBe(23)
  })
})

describe('combineTests', () => {
  it('any "no" wins, then "unknown"', () => {
    const ok = () => 'ok' as const
    const no = () => 'no' as const
    const unk = () => 'unknown' as const
    expect(combineTests()).toBeUndefined()
    expect(combineTests(ok, undefined)!('x')).toBe('ok')
    expect(combineTests(ok, unk)!('x')).toBe('unknown')
    expect(combineTests(unk, no)!('x')).toBe('no')
  })
})

const dataDir = fileURLToPath(new URL('../../public/data/', import.meta.url))
const has = existsSync(dataDir + 'weather.json')
describe.skipIf(!has)('outlook on generated data', () => {
  const w: WeatherData = has ? JSON.parse(readFileSync(dataDir + 'weather.json', 'utf8')) : (null as never)
  it('dry day after 0.50"+ of rain: mornings mostly rained out, play resumes around noon', () => {
    const o = outlook(w, 0.62, false, 'dry')
    expect(o.bucket).toBe('heavy')
    expect(o.dates.length).toBe(19) // matches the pipeline-side analysis
    expect(o.firstPlay.p50).toBe(12)
    expect(o.lateShare!).toBeGreaterThan(0.8)
    const h8 = o.hours.find((h) => h.hour === 8)!
    const h18 = o.hours.find((h) => h.hour === 18)!
    expect(h8.share!).toBeGreaterThan(h18.share!)
  })
  it('dry day after a dry day: courts open at 7 a.m.', () => {
    const o = outlook(w, 0, false, 'dry')
    expect(o.firstPlay.p50).toBe(7)
    expect(o.lateShare!).toBeLessThan(0.05)
  })
})
