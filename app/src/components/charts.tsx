// Hand-built SVG charts. Specs: 2px lines, <=24px bars with 4px rounded data-ends,
// 2px surface gaps between stacked segments, hairline recessive grid, hover tooltips.

import { useMemo, useState, type ReactNode } from 'react'
import { STATUS_LABEL, STATUSES, type DailyCoverage, type Overview } from '../lib/data'
import { clock, longDate, MONTHS_LONG, num, pct, WEEKDAYS } from '../lib/format'
import { addDays, dateMeta, type PlannerResult } from '../lib/stats'
import { statusColor, useWidth } from './common'

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
/* Weekly recorded status composition                                  */
/* ------------------------------------------------------------------ */

export function WeeklyStatusChart({ weekly }: { weekly: Overview['weekly'] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const height = 240
  const m = { t: 10, r: 8, b: 26, l: 44 }
  const iw = Math.max(0, width - m.l - m.r)
  const ih = height - m.t - m.b

  const { weeks, t0, span, yMax, ticks } = useMemo(() => {
    const weeks = weekly.map((w) => ({ ...w, total: STATUSES.reduce((a, s) => a + w[s], 0), t: Date.parse(w.week_start) }))
    const t0 = weeks[0]?.t ?? 0
    const t1 = (weeks[weeks.length - 1]?.t ?? 0) + 7 * 864e5
    const yMax = Math.max(1, ...weeks.map((w) => w.total))
    const ticks = niceTicks(yMax)
    return { weeks, t0, span: t1 - t0 || 1, yMax: ticks[ticks.length - 1], ticks }
  }, [weekly])

  const xOf = (t: number) => ((t - t0) / span) * iw
  const weekW = (7 * 864e5 / span) * iw
  const bw = Math.max(1, Math.min(24, weekW - 2))
  const yOf = (v: number) => ih - (v / yMax) * ih

  // Month labels at the 1st of each month that has records; runs of empty weeks become a gap note.
  const { monthTicks, gaps } = useMemo(() => {
    const months = [...new Set(weeks.map((w) => w.week_start.slice(0, 7)))]
    const monthTicks: { t: number; label: string }[] = []
    for (const ym of months) {
      const t = Date.parse(`${ym}-01`)
      if (t < t0) continue
      const mm = Number(ym.slice(5, 7))
      const first = monthTicks.length === 0 || mm === 4
      monthTicks.push({ t, label: `${MONTHS_LONG[mm - 1].slice(0, 3)}${first ? ' ' + ym.slice(0, 4) : ''}` })
    }
    const gaps: { from: number; to: number }[] = []
    for (let i = 1; i < weeks.length; i++) {
      if (weeks[i].t - weeks[i - 1].t > 21 * 864e5) gaps.push({ from: weeks[i - 1].t + 7 * 864e5, to: weeks[i].t })
    }
    return { monthTicks, gaps }
  }, [weeks, t0])
  const minLabelGap = 44

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Stacked weekly columns of recorded court-hours by schedule status">
          <g transform={`translate(${m.l},${m.t})`}>
            {ticks.map((v) => (
              <g key={v}>
                <line className="gridline" x1={0} x2={iw} y1={yOf(v)} y2={yOf(v)} />
                <text x={-6} y={yOf(v)} dy="0.32em" textAnchor="end" className="num">
                  {num(v)}
                </text>
              </g>
            ))}
            {weeks.map((w) => {
              const x = xOf(w.t) + (weekW - bw) / 2
              let acc = 0
              const present = STATUSES.filter((s) => w[s] > 0)
              const top = present[present.length - 1]
              return (
                <g key={w.week_start}>
                  {present.map((s) => {
                    const y0 = yOf(acc)
                    acc += w[s]
                    const y1 = yOf(acc)
                    const h = Math.max(0, y0 - y1 - (s === top ? 0 : 2))
                    const y = s === top ? y1 : y1 + 2
                    return s === top ? (
                      <path key={s} d={topRounded(x, y, bw, h, 4)} fill={statusColor(s)} />
                    ) : (
                      <rect key={s} x={x} y={y} width={bw} height={h} fill={statusColor(s)} />
                    )
                  })}
                  <rect
                    x={xOf(w.t)}
                    y={0}
                    width={weekW}
                    height={ih}
                    fill="transparent"
                    onMouseMove={() =>
                      setTip({
                        x: m.l + xOf(w.t) + weekW / 2,
                        y: m.t + yOf(w.total),
                        content: (
                          <>
                            <strong>Week of {longDate(w.week_start, false)}</strong>
                            <br />
                            {num(w.total)} recorded court-hours
                            {STATUSES.filter((s) => w[s]).map((s) => (
                              <div key={s}>
                                <span className="sw" style={{ background: statusColor(s) }} />
                                {STATUS_LABEL[s]}: {num(w[s])} ({pct(w[s] / w.total)})
                              </div>
                            ))}
                          </>
                        ),
                      })
                    }
                    onMouseLeave={() => setTip(null)}
                  />
                </g>
              )
            })}
            {gaps.map((g) =>
              xOf(g.to) - xOf(g.from) > 90 ? (
                <text key={g.from} x={(xOf(g.from) + xOf(g.to)) / 2} y={ih / 2} textAnchor="middle">
                  No records in this export
                </text>
              ) : null,
            )}
            <line className="axis-line" x1={0} x2={iw} y1={ih} y2={ih} />
            {monthTicks.map((mt, i) => {
              const x = xOf(mt.t)
              const prev = monthTicks[i - 1]
              if (prev && x - xOf(prev.t) < minLabelGap) return null
              return (
                <text key={mt.t} x={x} y={ih + 16}>
                  {mt.label}
                </text>
              )
            })}
          </g>
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Coverage calendar                                                   */
/* ------------------------------------------------------------------ */

const COVERAGE_BINS = [
  { min: 1, label: '1–99' },
  { min: 100, label: '100–174' },
  { min: 175, label: '175–249' },
  { min: 250, label: '250–299' },
  { min: 300, label: '300+' },
]
const binOf = (n: number) => COVERAGE_BINS.reduce((b, bin, i) => (n >= bin.min ? i : b), 0)

export function CoverageCalendar({ daily }: { daily: DailyCoverage[] }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const byDate = useMemo(() => new Map(daily.map((d) => [d.date, d])), [daily])

  // Months with records, with runs of empty months collapsed into a note.
  const blocks = useMemo(() => {
    const first = daily[0].date.slice(0, 7)
    const last = daily[daily.length - 1].date.slice(0, 7)
    const has = new Set(daily.map((d) => d.date.slice(0, 7)))
    const out: ({ kind: 'month'; ym: string } | { kind: 'gap'; from: string; to: string })[] = []
    let [y, mo] = first.split('-').map(Number)
    while (`${y}-${String(mo).padStart(2, '0')}` <= last) {
      const ym = `${y}-${String(mo).padStart(2, '0')}`
      if (has.has(ym)) out.push({ kind: 'month', ym })
      else {
        const prev = out[out.length - 1]
        if (prev?.kind === 'gap') prev.to = ym
        else out.push({ kind: 'gap', from: ym, to: ym })
      }
      mo++
      if (mo > 12) {
        mo = 1
        y++
      }
    }
    return out
  }, [daily])

  const cell = 16
  const gap = 2

  return (
    <div className="chart">
      <div className="legend" aria-label="Calendar legend">
        {COVERAGE_BINS.map((b, i) => (
          <span className="legend-item" key={b.label}>
            <span className="swatch" style={{ background: `var(--seq-${i + 1})` }} />
            {b.label}
          </span>
        ))}
        <span className="legend-item">
          <span className="swatch missing" />
          No records in export
        </span>
        <span className="legend-item">
          <span className="swatch" style={{ outline: '2px dashed var(--red)', outlineOffset: -2 }} />
          After snapshot cutoff
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {blocks.map((b) =>
          b.kind === 'gap' ? (
            <div key={b.from} className="small muted" style={{ alignSelf: 'center', maxWidth: 140, borderLeft: '3px solid var(--rule)', paddingLeft: 8 }}>
              {labelYm(b.from)}
              {b.to !== b.from ? ` – ${labelYm(b.to)}` : ''}: no records in this export
            </div>
          ) : (
            <MonthGrid key={b.ym} ym={b.ym} byDate={byDate} cell={cell} gap={gap} setTip={setTip} />
          ),
        )}
      </div>
      <Tooltip tip={tip} />
    </div>
  )
}

const labelYm = (ym: string) => `${MONTHS_LONG[Number(ym.slice(5)) - 1].slice(0, 3)} ${ym.slice(0, 4)}`

function MonthGrid({
  ym,
  byDate,
  cell,
  gap,
  setTip,
}: {
  ym: string
  byDate: Map<string, DailyCoverage>
  cell: number
  gap: number
  setTip: (t: Tip | null) => void
}) {
  const first = `${ym}-01`
  const startDow = dateMeta(first).dow
  const days: string[] = []
  for (let d = first; d.startsWith(ym); d = addDays(d, 1)) days.push(d)
  const rows = Math.ceil((startDow + days.length) / 7)
  const w = 7 * (cell + gap)
  const h = rows * (cell + gap) + 16
  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="small" style={{ fontWeight: 700, marginBottom: 2 }}>
        {labelYm(ym)}
      </figcaption>
      <svg width={w} height={h} role="img" aria-label={`Coverage for ${labelYm(ym)}`} style={{ position: 'relative' }}>
        <defs>
          <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--hatch)" strokeWidth="1.2" />
          </pattern>
        </defs>
        {WEEKDAYS.map((wd, i) => (
          <text key={wd} x={i * (cell + gap) + cell / 2} y={10} textAnchor="middle" style={{ fontSize: 9 }}>
            {wd[0]}
          </text>
        ))}
        {days.map((d, i) => {
          const pos = startDow + i
          const x = (pos % 7) * (cell + gap)
          const y = 14 + Math.floor(pos / 7) * (cell + gap)
          const rec = byDate.get(d)
          const onMove = (e: React.MouseEvent) => {
            const box = (e.currentTarget.closest('.chart') as HTMLElement).getBoundingClientRect()
            const r = (e.currentTarget as SVGElement).getBoundingClientRect()
            setTip({
              x: r.left - box.left + cell / 2,
              y: r.top - box.top,
              content: rec ? (
                <>
                  <strong>{longDate(d)}</strong>
                  <br />
                  {num(rec.recorded)} recorded court-hours · {rec.courts} courts · {rec.hours} hours
                  {rec.post_cutoff && (
                    <>
                      <br />
                      After snapshot cutoff — outcomes not final
                    </>
                  )}
                </>
              ) : (
                <>
                  <strong>{longDate(d)}</strong>
                  <br />
                  No records in this export (not “closed” or “unused”)
                </>
              ),
            })
          }
          return (
            <rect
              key={d}
              x={x}
              y={y}
              width={cell}
              height={cell}
              rx={3}
              fill={rec ? `var(--seq-${binOf(rec.recorded) + 1})` : 'url(#hatch)'}
              stroke={rec?.post_cutoff ? 'var(--red)' : 'none'}
              strokeWidth={rec?.post_cutoff ? 1.5 : 0}
              strokeDasharray={rec?.post_cutoff ? '3 2' : undefined}
              onMouseMove={onMove}
              onMouseLeave={() => setTip(null)}
            />
          )
        })}
      </svg>
    </figure>
  )
}

/* ------------------------------------------------------------------ */
/* Daily booking curves                                                */
/* ------------------------------------------------------------------ */

export function CurvesChart({ result, showTarget }: { result: PlannerResult; showTarget: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const curve = result.curve
  const height = 280
  const m = { t: 12, r: 12, b: 28, l: 40 }
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
          <span className="line-key" style={{ borderColor: 'var(--hatch)', borderTopWidth: 1 }} />
          Individual dates ({result.days.length})
        </span>
        <span className="legend-item">
          <span className="line-key" style={{ borderColor: 'var(--seq-4)' }} />
          Median across dates
        </span>
        <span className="legend-item">
          <span className="swatch" style={{ background: 'var(--seq-3)', opacity: 0.25 }} />
          Middle 50% of dates
        </span>
        {target != null && (
          <span className="legend-item">
            <span className="line-key" style={{ borderColor: 'var(--red)' }} />
            Planning benchmark
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
            <path d={band} fill="var(--seq-3)" opacity={0.18} />
            {result.days.map((d) => (
              <path key={d.date} d={stepPath(d.times)} fill="none" stroke="var(--hatch)" strokeWidth={1} opacity={0.8} />
            ))}
            <path d={line(curve.median)} fill="none" stroke="var(--seq-4)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {target != null && target >= x0 && target <= x1 && (
              <g>
                <line x1={xOf(target)} x2={xOf(target)} y1={0} y2={ih} stroke="var(--red)" strokeWidth={2} />
                <text x={xOf(target) + 4} y={10} style={{ fill: 'var(--ink)', fontWeight: 700 }}>
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
                <circle cx={xOf(curve.grid[hi])} cy={yOf(curve.median[hi])} r={4.5} fill="var(--seq-4)" stroke="var(--surface)" strokeWidth={2} />
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
                Median date: {pct(curve.median[hi], 0)} of that day’s entries
                <br />
                Middle 50% of dates: {pct(curve.lo[hi], 0)}–{pct(curve.hi[hi], 0)}
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
  const height = 200
  const m = { t: 10, r: 8, b: 28, l: 40 }
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
                  {b.count > 0 && <path d={topRounded(x, yOf(b.count), bw, h, 4)} fill="var(--seq-3)" />}
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
                            {num(b.count)} qualifying slot{b.count === 1 ? '' : 's'}
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
