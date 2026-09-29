import { useMemo, useState } from 'react'
import type { PartnerStats } from '../lib/data'
import { hourLabel, longDate, num, pct } from '../lib/format'
import type { WeatherData } from '../lib/weather'
import { niceTicks, Tooltip, type Tip } from './charts'
import { useWidth } from './common'

/** Plain horizontal bars with the value written at the end. */
export function SimpleBars({ items, max, color = 'var(--accent)' }: { items: { label: string; value: number; display: string }[]; max?: number; color?: string }) {
  const m = max ?? Math.max(...items.map((i) => i.value), 1e-9)
  return (
    <div role="list">
      {items.map((i) => (
        <div role="listitem" key={i.label} style={{ display: 'grid', gridTemplateColumns: '92px minmax(0,1fr) 64px', alignItems: 'center', gap: 8, margin: '3px 0' }}>
          <span className="small">{i.label}</span>
          <span style={{ background: 'var(--hair-2)', height: 12 }}>
            <span style={{ display: 'block', height: '100%', width: `${(i.value / m) * 100}%`, background: color }} />
          </span>
          <span className="small num" style={{ fontWeight: 600, textAlign: 'right' }}>
            {i.display}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Partner-entry timing: earlier (left) → after start (right), with the 15-minute rule marked. */
export function PartnerHistogram({ stats, bins, ruleMinutes }: { stats: PartnerStats; bins: number[]; ruleMinutes: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  // stats.histogram = [< bins[0], [bins[i], bins[i+1]) ..., >= last]; reverse so earlier entries are on the left.
  const cols = useMemo(() => {
    const out: { label: string; lo: number; hi: number; n: number }[] = []
    const h = stats.histogram
    out.push({ label: `${bins[bins.length - 1]}+ min before`, lo: bins[bins.length - 1], hi: Infinity, n: h[h.length - 1] })
    for (let i = bins.length - 2; i >= 0; i--) out.push({ label: '', lo: bins[i], hi: bins[i + 1], n: h[i + 1] })
    out.push({ label: `${-bins[0]}+ min after start`, lo: -Infinity, hi: bins[0], n: h[0] })
    return out
  }, [stats, bins])
  const height = 240
  const m = { t: 18, r: 8, b: 30, l: 40 }
  const iw = Math.max(0, width - m.l - m.r)
  const ih = height - m.t - m.b
  const ticks = niceTicks(Math.max(...cols.map((c) => c.n), 1), 3)
  const yMax = ticks[ticks.length - 1]
  const slot = iw / cols.length
  const bw = Math.max(1, Math.min(22, slot - 2))
  const yOf = (v: number) => ih - (v / yMax) * ih
  // x position of a "minutes before start" value (boundary between columns)
  const xAt = (minutes: number) => {
    const i = cols.findIndex((c) => c.lo === minutes)
    return i < 0 ? null : (i + 1) * slot
  }
  const x0 = xAt(0)
  const xRule = xAt(ruleMinutes)
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="When partner records were entered relative to the slot start">
          <g transform={`translate(${m.l},${m.t})`}>
            {ticks.map((v) => (
              <g key={v}>
                <line className="gridline" x1={0} x2={iw} y1={yOf(v)} y2={yOf(v)} />
                <text x={-6} y={yOf(v)} dy="0.32em" textAnchor="end" className="num">
                  {num(v)}
                </text>
              </g>
            ))}
            {cols.map((c, i) => {
              const late = c.hi <= ruleMinutes
              return (
                <g key={i}>
                  <rect
                    x={i * slot + (slot - bw) / 2}
                    y={yOf(c.n)}
                    width={bw}
                    height={ih - yOf(c.n)}
                    fill={c.hi <= 0 ? 'var(--red)' : late ? '#d99a3d' : 'var(--accent)'}
                  />
                  <rect
                    x={i * slot}
                    y={0}
                    width={slot}
                    height={ih}
                    fill="transparent"
                    onMouseMove={() =>
                      setTip({
                        x: m.l + i * slot + slot / 2,
                        y: m.t + yOf(c.n),
                        content: (
                          <>
                            <strong>
                              {c.hi === Infinity
                                ? `${c.lo}+ min before start`
                                : c.lo === -Infinity
                                  ? `${-c.hi}+ min after start`
                                  : c.hi <= 0
                                    ? `${-c.hi}–${-c.lo} min after start`
                                    : `${c.lo}–${c.hi} min before start`}
                            </strong>
                            <br />
                            {num(c.n)} partner records ({pct(c.n / stats.n, 1)})
                          </>
                        ),
                      })
                    }
                  />
                </g>
              )
            })}
            <line className="axis-line" x1={0} x2={iw} y1={ih} y2={ih} />
            {xRule != null && (
              <g>
                <line x1={xRule} x2={xRule} y1={-8} y2={ih} stroke="var(--ink)" strokeDasharray="3 3" />
                <text x={xRule - 4} y={-8} textAnchor="end" style={{ fontWeight: 600, fill: 'var(--ink)' }}>
                  {ruleMinutes} min before
                </text>
              </g>
            )}
            {x0 != null && (
              <g>
                <line x1={x0} x2={x0} y1={-8} y2={ih} stroke="var(--ink)" />
                <text x={x0 + 4} y={-8} style={{ fontWeight: 600, fill: 'var(--ink)' }}>
                  Start
                </text>
              </g>
            )}
            <text x={0} y={ih + 18}>
              Earlier
            </text>
            <text x={iw} y={ih + 18} textAnchor="end">
              Later
            </text>
          </g>
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )
}

/**
 * One date, hour by hour: rain from noon the day before through the evening (top),
 * and what happened to that date's courts at each start hour (bottom). Shared time axis.
 */
export function DayRain({ weather, date }: { weather: WeatherData; date: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const data = useMemo(() => {
    const hr = weather.hourly_rain
    const hours: { key: string; day: 'prev' | 'this'; hour: number; rain: number | null; trace: boolean }[] = []
    const di = weather.daily.date.indexOf(date)
    if (hr) {
      const base = Date.parse(`${hr.start}T00:00:00Z`)
      const at = Date.parse(`${date}T00:00:00Z`)
      const offset = Math.round((at - base) / 3600e3)
      const traces = new Set(hr.trace_index)
      for (let k = -12; k < 21; k++) {
        const i = offset + k
        const hour = ((k % 24) + 24) % 24
        hours.push({ key: String(k), day: k < 0 ? 'prev' : 'this', hour, rain: i >= 0 && i < hr.values.length ? hr.values[i] : null, trace: traces.has(i) })
      }
    }
    const status = new Map<number, { rec: number; ro: number; ci: number }>()
    const c = weather.cells
    for (let i = 0; i < c.d.length; i++) {
      if (c.d[i] !== di) continue
      status.set(c.h[i], { rec: c.recorded[i], ro: c.rainedout[i], ci: c.checkedin[i] })
    }
    return { hours, status }
  }, [weather, date])

  const m = { l: 40, r: 8 }
  const panel = 110
  const gap = 36
  const height = panel * 2 + gap + 34
  const iw = Math.max(0, width - m.l - m.r)
  const n = data.hours.length
  const slot = n ? iw / n : 0
  const bw = Math.max(1, Math.min(18, slot - 2))
  const rainMax = niceTicks(Math.max(0.1, ...data.hours.map((h) => h.rain ?? 0)), 2)
  const rMax = rainMax[rainMax.length - 1]
  const courtMax = niceTicks(Math.max(4, ...[...data.status.values()].map((s) => s.rec)), 2)
  const cMax = courtMax[courtMax.length - 1]
  const y1 = (v: number) => panel - (v / rMax) * panel
  const y2 = (v: number) => panel - (v / cMax) * panel

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setTip(null)}>
      <div className="legend">
        <span className="legend-item">
          <span className="swatch" style={{ background: 'var(--accent)' }} /> Rain in the hour
        </span>
        <span className="legend-item">
          <span className="swatch" style={{ background: 'var(--st-rained-out)' }} /> Rained out
        </span>
        <span className="legend-item">
          <span className="swatch" style={{ background: 'var(--st-all-checkedin)' }} /> Checked in
        </span>
        <span className="legend-item">
          <span className="swatch" style={{ background: '#cfcac0' }} /> Other status
        </span>
      </div>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Hourly rain and court status around ${date}`}>
          <g transform={`translate(${m.l},0)`}>
            <text x={0} y={10} style={{ fontWeight: 600 }}>
              Rain per hour (in)
            </text>
            <g transform="translate(0,16)">
              {rainMax.map((v) => (
                <g key={v}>
                  <line className="gridline" x1={0} x2={iw} y1={y1(v)} y2={y1(v)} />
                  <text x={-6} y={y1(v)} dy="0.32em" textAnchor="end" className="num">
                    {v.toFixed(2)}
                  </text>
                </g>
              ))}
              {data.hours.map((h, i) => {
                const x = i * slot + (slot - bw) / 2
                if (h.rain == null) return <rect key={h.key} x={x} y={panel - 4} width={bw} height={4} fill="#cfcac0" />
                if (h.rain <= 0) return h.trace ? <rect key={h.key} x={x} y={panel - 2} width={bw} height={2} fill="var(--accent)" /> : null
                const hh = Math.max(1, panel - y1(Math.min(h.rain, rMax)))
                return <rect key={h.key} x={x} y={panel - hh} width={bw} height={hh} fill="var(--accent)" />
              })}
              <line className="axis-line" x1={0} x2={iw} y1={panel} y2={panel} />
              <line x1={12 * slot} x2={12 * slot} y1={-4} y2={panel + gap + panel} stroke="var(--ink)" strokeDasharray="2 3" />
              <text x={12 * slot + 4} y={-2} style={{ fontSize: 10 }}>
                Midnight
              </text>
            </g>
            <g transform={`translate(0,${16 + panel + gap})`}>
              <text x={0} y={-8} style={{ fontWeight: 600 }}>
                Courts by start hour, {longDate(date, false)}
              </text>
              {courtMax.map((v) => (
                <g key={v}>
                  <line className="gridline" x1={0} x2={iw} y1={y2(v)} y2={y2(v)} />
                  <text x={-6} y={y2(v)} dy="0.32em" textAnchor="end" className="num">
                    {num(v)}
                  </text>
                </g>
              ))}
              {data.hours.map((h, i) => {
                if (h.day !== 'this') return null
                const s = data.status.get(h.hour)
                if (!s) return null
                const x = i * slot + (slot - bw) / 2
                const other = Math.max(0, s.rec - s.ro - s.ci)
                let acc = 0
                return (
                  <g key={h.key}>
                    {(
                      [
                        [s.ro, 'var(--st-rained-out)'],
                        [s.ci, 'var(--st-all-checkedin)'],
                        [other, '#cfcac0'],
                      ] as const
                    ).map(([v, color], j) => {
                      if (!v) return null
                      const y = y2(acc + v)
                      const hh = y2(acc) - y
                      acc += v
                      return <rect key={j} x={x} y={y} width={bw} height={Math.max(0, hh - (j ? 1 : 0))} fill={color} />
                    })}
                  </g>
                )
              })}
              <line className="axis-line" x1={0} x2={iw} y1={panel} y2={panel} />
              {data.hours.map((h, i) =>
                h.hour % 3 === 0 ? (
                  <text key={h.key} x={i * slot + slot / 2} y={panel + 14} textAnchor="middle">
                    {hourLabel(h.hour)}
                  </text>
                ) : null,
              )}
            </g>
            {data.hours.map((h, i) => (
              <rect
                key={h.key}
                x={i * slot}
                y={0}
                width={slot}
                height={height - 20}
                fill="transparent"
                onMouseMove={() => {
                  const s = h.day === 'this' ? data.status.get(h.hour) : undefined
                  setTip({
                    x: Math.min(Math.max(m.l + i * slot + slot / 2, 110), width - 110),
                    y: 16 + panel,
                    content: (
                      <>
                        <strong>
                          {h.day === 'prev' ? 'Day before, ' : ''}
                          {hourLabel(h.hour)}
                        </strong>
                        <br />
                        Rain: {h.rain == null ? 'no data' : h.rain > 0 ? `${h.rain.toFixed(2)}"` : h.trace ? 'trace' : 'none'}
                        {s && (
                          <>
                            <br />
                            {num(s.ro)} rained out · {num(s.ci)} checked in · {num(s.rec)} recorded
                          </>
                        )}
                      </>
                    ),
                  })
                }}
              />
            ))}
          </g>
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )
}
