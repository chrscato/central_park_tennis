import { useState } from 'react'
import { EXPLANATION_LABEL, type Explanation } from '../lib/anomalies'
import { longDate, num, pct } from '../lib/format'
import { Tooltip, type Tip } from './charts'
import { useWidth } from './common'

export interface RainPoint {
  date: string
  rain: number // inches on the day + the day before
  share: number // recorded court-hours rained out
  recorded: number
  flag: Explanation | null
}

export const FLAG_COLOR: Record<Explanation, string> = { none: 'var(--red)', later: '#0f5499', wet: '#8c877d' }

const X_TICKS = [0, 0.1, 0.25, 0.5, 1, 2, 4]

/** Dates as dots: rain (square-root scale) vs share rained out. Flagged dates coloured by explanation. */
export function RainScatter({ points }: { points: RainPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const height = 300
  const m = { t: 10, r: 12, b: 28, l: 40 }
  const iw = Math.max(0, width - m.l - m.r)
  const ih = height - m.t - m.b
  const xMax = Math.max(1, ...points.map((p) => p.rain))
  const ticks = X_TICKS.filter((t) => t <= xMax * 1.05)
  const xOf = (v: number) => (Math.sqrt(Math.min(v, xMax)) / Math.sqrt(xMax)) * iw
  const yOf = (v: number) => ih - v * ih
  const rank = (p: RainPoint) => (p.flag == null ? 0 : p.flag === 'none' ? 3 : 1)
  const sorted = [...points].sort((a, b) => rank(a) - rank(b)) // flagged on top

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Days by rain versus share of courts rained out">
          <g transform={`translate(${m.l},${m.t})`}>
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <g key={v}>
                <line className="gridline" x1={0} x2={iw} y1={yOf(v)} y2={yOf(v)} />
                <text x={-6} y={yOf(v)} dy="0.32em" textAnchor="end" className="num">
                  {v * 100}%
                </text>
              </g>
            ))}
            <line className="axis-line" x1={0} x2={iw} y1={ih} y2={ih} />
            {ticks.map((t) => (
              <text key={t} x={xOf(t)} y={ih + 16} textAnchor="middle" className="num">
                {t === 0 ? '0"' : `${t}"`}
              </text>
            ))}
            {sorted.map((p) => (
              <circle
                key={p.date}
                cx={xOf(p.rain)}
                cy={yOf(p.share)}
                r={p.flag ? 4.5 : 3}
                fill={p.flag ? FLAG_COLOR[p.flag] : '#c9c3b8'}
                fillOpacity={p.flag ? 0.9 : 0.6}
                stroke="#fff"
                strokeWidth={1}
                onMouseMove={() =>
                  setTip({
                    x: m.l + xOf(p.rain),
                    y: m.t + yOf(p.share),
                    content: (
                      <>
                        <strong>{longDate(p.date)}</strong>
                        <br />
                        {pct(p.share, 0)} of {num(p.recorded)} courts rained out
                        <br />
                        Rain that day + day before: {p.rain.toFixed(2)}"
                        {p.flag && (
                          <>
                            <br />
                            Flagged: {EXPLANATION_LABEL[p.flag]}
                          </>
                        )}
                      </>
                    ),
                  })
                }
              />
            ))}
          </g>
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )
}
