// Hand-built SVG charts. Specs: 2px lines, <=24px bars with 4px rounded data-ends,
// 2px surface gaps between stacked segments, hairline recessive grid, hover tooltips.

import { useState, type ReactNode } from 'react'
import { clock, num, pct } from '../lib/format'
import type { PlannerResult } from '../lib/stats'
import { useWidth } from './common'

export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const out: number[] = []
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v)
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step)
  return out
}

/** Rect with only the top corners rounded (data-end), square at the baseline. */
export function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

export interface Tip {
  x: number
  y: number
  content: ReactNode
}

export function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.content}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Daily booking curves                                                */
/* ------------------------------------------------------------------ */

export function CurvesChart({ result, showTarget }: { result: PlannerResult; showTarget: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const curve = result.curve
  const height = 300
  const m = { t: 12, r: 12, b: 26, l: 38 }
  const iw = Math.max(0, width - m.l - m.r)
  const ih = height - m.t - m.b
  if (!curve) return null
  const x0 = curve.grid[0]
  const x1 = curve.grid[curve.grid.length - 1]
  const xOf = (t: number) => ((t - x0) / (x1 - x0 || 1)) * iw
  const yOf = (v: number) => ih - v * ih

  const stepPath = (times: number[]) => {
    const n = times.length
    let d = `M0,${yOf(0)}`
    times.forEach((t, i) => {
      d += `H${xOf(t)}V${yOf((i + 1) / n)}`
    })
    return d + `H${iw}`
  }
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${xOf(curve.grid[i])},${yOf(v)}`).join('')
  const band =
    curve.hi.map((v, i) => `${i ? 'L' : 'M'}${xOf(curve.grid[i])},${yOf(v)}`).join('') +
    curve.lo
      .map((v, i) => [xOf(curve.grid[i]), yOf(v)] as const)
      .reverse()
      .map(([x, y]) => `L${x},${y}`)
      .join('') +
    'Z'

  const hourTicks: number[] = []
  const span = x1 - x0
  const stepH = span > 12 * 60 ? 180 : span > 6 * 60 ? 120 : 60
  for (let t = Math.ceil(x0 / stepH) * stepH; t <= x1; t += stepH) hourTicks.push(t)
  const target = showTarget && !result.planningTarget.suppressed ? result.planningTarget.minute : null
  const hi = hover == null ? null : hover

  return (
    <div className="chart" ref={ref}>
      <div className="legend">
        <span className="legend-item">
          <span className="line-key" style={{ borderColor: '#9a9a9a', borderTopWidth: 1 }} />
          Each date ({result.days.length})
        </span>
        <span className="legend-item">
          <span className="line-key" style={{ borderColor: 'var(--seq-4)' }} />
          Median date
        </span>
        <span className="legend-item">
          <span className="swatch" style={{ background: '#b9cde8' }} />
          Middle 50%
        </span>
        {target != null && (
          <span className="legend-item">
            <span className="line-key" style={{ borderColor: 'var(--red)' }} />
            Benchmark
          </span>
        )}
      </div>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Daily cumulative share of qualifying successful walkup entries by clock time"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const px = e.clientX - r.left - m.l
            if (px < 0 || px > iw) return setHover(null)
            const i = Math.round((px / iw) * (curve.grid.length - 1))
            setHover(Math.max(0, Math.min(curve.grid.length - 1, i)))
          }}
        >
          <g transform={`translate(${m.l},${m.t})`}>
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <g key={v}>
                <line className="gridline" x1={0} x2={iw} y1={yOf(v)} y2={yOf(v)} />
                <text x={-6} y={yOf(v)} dy="0.32em" textAnchor="end" className="num">
                  {v * 100}%
                </text>
              </g>
            ))}
            <path d={band} fill="#b9cde8" opacity={0.7} />
            {result.days.map((d) => (
              <path key={d.date} d={stepPath(d.times)} fill="none" stroke="#9a9a9a" strokeWidth={1} opacity={0.75} />
            ))}
            <path d={line(curve.median)} fill="none" stroke="var(--seq-4)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {target != null && target >= x0 && target <= x1 && (
              <g>
                <line x1={xOf(target)} x2={xOf(target)} y1={0} y2={ih} stroke="var(--red)" strokeWidth={2} />
                <text x={xOf(target) + 4} y={10} style={{ fontWeight: 700 }}>
                  {clock(target)}
                </text>
              </g>
            )}
            <line className="axis-line" x1={0} x2={iw} y1={ih} y2={ih} />
            {hourTicks.map((t) => (
              <text key={t} x={xOf(t)} y={ih + 18} textAnchor="middle">
                {clock(t).replace(':00', '')}
              </text>
            ))}
            {hi != null && (
              <g pointerEvents="none">
                <line x1={xOf(curve.grid[hi])} x2={xOf(curve.grid[hi])} y1={0} y2={ih} stroke="var(--ink-2)" strokeWidth={1} />
                <circle cx={xOf(curve.grid[hi])} cy={yOf(curve.median[hi])} r={4.5} fill="var(--seq-4)" stroke="#fff" strokeWidth={2} />
              </g>
            )}
          </g>
        </svg>
      )}
      {hi != null && (
        <Tooltip
          tip={{
            x: m.l + xOf(curve.grid[hi]),
            y: m.t + yOf(curve.median[hi]),
            content: (
              <>
                <strong>By {clock(curve.grid[hi])}</strong>
                <br />
                Median date: {pct(curve.median[hi], 0)} booked
                <br />
                Middle 50%: {pct(curve.lo[hi], 0)}–{pct(curve.hi[hi], 0)}
              </>
            ),
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Distribution of entry times (pooled)                                */
/* ------------------------------------------------------------------ */

export function TimeHistogram({ bins, binMinutes }: { bins: { start: number; count: number }[]; binMinutes: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const height = 300
  const m = { t: 12, r: 8, b: 26, l: 38 }
  const iw = Math.max(0, width - m.l - m.r)
  const ih = height - m.t - m.b
  if (!bins.length) return null
  const ticks = niceTicks(Math.max(...bins.map((b) => b.count)), 3)
  const yMax = ticks[ticks.length - 1]
  const slot = iw / bins.length
  const bw = Math.max(1, Math.min(24, slot - 2))
  const yOf = (v: number) => ih - (v / yMax) * ih
  const pxPerHour = slot * (60 / binMinutes)
  const labelHours = [1, 2, 3, 4, 6].find((h) => h * pxPerHour >= 50) ?? 6
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Histogram of qualifying entry times">
          <g transform={`translate(${m.l},${m.t})`}>
            {ticks.map((v) => (
              <g key={v}>
                <line className="gridline" x1={0} x2={iw} y1={yOf(v)} y2={yOf(v)} />
                <text x={-6} y={yOf(v)} dy="0.32em" textAnchor="end" className="num">
                  {num(v)}
                </text>
              </g>
            ))}
            {bins.map((b, i) => {
              const x = i * slot + (slot - bw) / 2
              const h = ih - yOf(b.count)
              return (
                <g key={b.start}>
                  {b.count > 0 && <path d={topRounded(x, yOf(b.count), bw, h, 0)} fill="var(--seq-3)" />}
                  <rect
                    x={i * slot}
                    y={0}
                    width={slot}
                    height={ih}
                    fill="transparent"
                    onMouseMove={() =>
                      setTip({
                        x: m.l + i * slot + slot / 2,
                        y: m.t + yOf(b.count),
                        content: (
                          <>
                            <strong>
                              {clock(b.start)}–{clock(b.start + binMinutes - 1)}
                            </strong>
                            <br />
                            {num(b.count)} slot{b.count === 1 ? '' : 's'} booked
                          </>
                        ),
                      })
                    }
                    onMouseLeave={() => setTip(null)}
                  />
                  {b.start % (labelHours * 60) === 0 && (
                    <text x={i * slot} y={ih + 18} textAnchor="middle">
                      {clock(b.start).replace(':00', '')}
                    </text>
                  )}
                </g>
              )
            })}
            <line className="axis-line" x1={0} x2={iw} y1={ih} y2={ih} />
          </g>
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )
}
