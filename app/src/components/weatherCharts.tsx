import { useMemo, useState } from 'react'
import type { DailyCoverage } from '../lib/data'
import { longDate, MONTHS_LONG, num, pct } from '../lib/format'
import { BUCKET_LABEL, inches, type BucketRow, type DayWeather } from '../lib/weather'
import { niceTicks, Tooltip, topRounded, type Tip } from './charts'
import { useWidth } from './common'

/** Horizontal bars: recorded rained-out share per rainfall bucket. One series, text labels at bar ends. */
export function BucketBars({ rows, max }: { rows: BucketRow[]; max: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const labelW = 78
  const valueW = 40
  const bar = 14
  const gap = 10
  const shown = rows.filter((r) => r.units > 0 && r.bucket !== 'missing')
  const iw = Math.max(0, width - labelW - valueW)
  const height = shown.length * (bar + gap)
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Recorded rained-out share by rainfall">
          {shown.map((r, i) => {
            const y = i * (bar + gap)
            const w = r.share == null ? 0 : (Math.min(r.share, max) / max) * iw
            return (
              <g key={r.bucket}>
                <text x={0} y={y + bar / 2} dy="0.32em">
                  {BUCKET_SHORT[r.bucket]}
                </text>
                <rect x={labelW} y={y} width={iw} height={bar} fill="var(--hair-2)" />
                {w > 0 && <rect x={labelW} y={y} width={w} height={bar} fill="var(--st-rained-out)" />}
                <text x={labelW + iw + 6} y={y + bar / 2} dy="0.32em" className="num" style={{ fontWeight: 600, fill: 'var(--ink)' }}>
                  {pct(r.share, 0)}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

const BUCKET_SHORT: Record<string, string> = {
  dry: 'Dry',
  trace: 'Trace',
  light: '0.01–0.09"',
  moderate: '0.10–0.49"',
  heavy: '0.50"+',
  missing: 'No data',
}

export { BUCKET_LABEL }

/**
 * Two aligned daily column charts sharing one x-axis (never a dual y-axis):
 * rainfall on top, recorded rained-out court-hours below.
 */
export function RainTimeline({
  year,
  weather,
  daily,
}: {
  year: number
  weather: Map<string, DayWeather>
  daily: DailyCoverage[]
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const { days, rainMax, roMax, rainTicks, roTicks } = useMemo(() => {
    const cov = new Map(daily.filter((d) => !d.post_cutoff).map((d) => [d.date, d]))
    const inYear = [...cov.keys()].filter((d) => d.startsWith(String(year))).sort()
    if (!inYear.length) return { days: [], rainMax: 1, roMax: 1, rainTicks: [0], roTicks: [0] }
    const out: { date: string; w?: DayWeather; c?: DailyCoverage }[] = []
    const start = new Date(`${inYear[0].slice(0, 8)}01T00:00:00Z`)
    const end = new Date(`${inYear[inYear.length - 1]}T00:00:00Z`)
    for (let t = start.getTime(); t <= end.getTime(); t += 864e5) {
      const date = new Date(t).toISOString().slice(0, 10)
      out.push({ date, w: weather.get(date), c: cov.get(date) })
    }
    const rainTicks = niceTicks(Math.max(0.5, ...out.map((d) => d.w?.rain ?? 0)), 3)
    const roTicks = niceTicks(Math.max(10, ...out.map((d) => d.c?.['rained-out'] ?? 0)), 3)
    return { days: out, rainMax: rainTicks[rainTicks.length - 1], roMax: roTicks[roTicks.length - 1], rainTicks, roTicks }
  }, [year, weather, daily])

  const m = { l: 40, r: 8 }
  const panelH = 120
  const gapH = 34
  const height = panelH * 2 + gapH + 22
  const iw = Math.max(0, width - m.l - m.r)
  const slot = days.length ? iw / days.length : 0
  const bw = Math.max(1, Math.min(24, slot - 1))
  const y1 = (v: number) => panelH - (v / rainMax) * panelH
  const y2 = (v: number) => panelH - (v / roMax) * panelH

  const show = (i: number) => {
    const d = days[i]
    const w = d.w
    setTip({
      x: Math.min(Math.max(m.l + i * slot + slot / 2, 150), width - 150),
      y: panelH + 16,
      content: (
        <>
          <strong>{longDate(d.date)}</strong>
          <br />
          Rain that day: {inches(w?.rain, w?.trace)} · day before: {inches(w?.prev1, w?.prev1Trace)}
          <br />
          3 days before: {inches(w?.trail3, w?.trail3Trace)}
          {w?.source === 'iem-hourly-sum' && ' (from hourly obs)'}
          <br />
          {d.c ? `${num(d.c['rained-out'])} of ${num(d.c.recorded)} courts rained out` : 'No court records'}
        </>
      ),
    })
  }

  const monthStarts = days.map((d, i) => [d.date, i] as const).filter(([d]) => d.endsWith('-01'))

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setTip(null)}>
      {width > 0 && days.length > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Daily rainfall and courts rained out, ${year}`}>
          <defs>
            <pattern id="hatch-tl" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke="var(--hatch)" strokeWidth="1" />
            </pattern>
          </defs>
          <g transform={`translate(${m.l},0)`}>
            <text x={0} y={10} style={{ fontWeight: 700 }}>
              Rainfall (inches, Central Park)
            </text>
            <g transform="translate(0,16)">
              {rainTicks.map((v) => (
                <g key={v}>
                  <line className="gridline" x1={0} x2={iw} y1={y1(v)} y2={y1(v)} />
                  <text x={-6} y={y1(v)} dy="0.32em" textAnchor="end" className="num">
                    {v.toFixed(v < 1 ? 2 : 1)}
                  </text>
                </g>
              ))}
              {days.map((d, i) => {
                const x = i * slot + (slot - bw) / 2
                if (!d.w || d.w.rain == null) return <rect key={d.date} x={x} y={panelH - 6} width={bw} height={6} fill="url(#hatch-tl)" />
                if (d.w.rain <= 0) return null
                const h = Math.max(1, panelH - y1(Math.min(d.w.rain, rainMax)))
                return <path key={d.date} d={topRounded(x, panelH - h, bw, h, 0)} fill="var(--seq-5)" />
              })}
              <line className="axis-line" x1={0} x2={iw} y1={panelH} y2={panelH} />
            </g>
            <g transform={`translate(0,${panelH + gapH})`}>
              <text x={0} y={-6} style={{ fontWeight: 700 }}>
                Courts rained out
              </text>
              {roTicks.map((v) => (
                <g key={v}>
                  <line className="gridline" x1={0} x2={iw} y1={y2(v)} y2={y2(v)} />
                  <text x={-6} y={y2(v)} dy="0.32em" textAnchor="end" className="num">
                    {num(v)}
                  </text>
                </g>
              ))}
              {days.map((d, i) => {
                const v = d.c?.['rained-out'] ?? 0
                if (!v) return null
                const x = i * slot + (slot - bw) / 2
                const h = Math.max(1, panelH - y2(v))
                return <path key={d.date} d={topRounded(x, panelH - h, bw, h, 0)} fill="var(--st-rained-out)" />
              })}
              <line className="axis-line" x1={0} x2={iw} y1={panelH} y2={panelH} />
              {monthStarts.map(([date, i]) => (
                <text key={date} x={i * slot} y={panelH + 16}>
                  {MONTHS_LONG[Number(date.slice(5, 7)) - 1].slice(0, 3)}
                </text>
              ))}
            </g>
            {days.map((d, i) => (
              <rect key={d.date} x={i * slot} y={0} width={slot} height={height - 22} fill="transparent" onMouseMove={() => show(i)} />
            ))}
          </g>
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )
}
