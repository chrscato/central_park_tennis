import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { LIGHT_FILLS, LoadError, Loading, SourceLine, StatusLegend, Swatch, statusColor, useAsync } from '../components/common'
import { loadDay, STATUS_CODE, STATUS_LABEL, STATUSES, type Manifest, type Overview, type SlotDetail } from '../lib/data'
import { hourLabel, longDate, num, shortHour } from '../lib/format'
import { replaceParams } from '../lib/url'
import { dayIndex, inches, type WeatherData } from '../lib/weather'

function Counts({ obj }: { obj: Record<string, number> }) {
  const entries = Object.entries(obj)
  if (!entries.length) return <span className="muted">none recorded</span>
  return <>{entries.map(([k, v]) => `${k} (${v})`).join(', ')}</>
}

export function Courts({
  manifest,
  overview,
  weather,
  params,
}: {
  manifest: Manifest
  overview: Overview
  weather: WeatherData
  params: URLSearchParams
}) {
  const wxIdx = useMemo(() => (weather.status === 'available' ? dayIndex(weather) : null), [weather])
  const dates = useMemo(() => overview.daily.map((d) => d.date), [overview])
  const requested = params.get('date')
  const fallback = overview.cards.latest_outcome_date ?? dates[dates.length - 1]
  const [date, setDate] = useState(requested && dates.includes(requested) ? requested : fallback)
  const [notice, setNotice] = useState<string | null>(
    requested && !dates.includes(requested) ? `No records in this export for ${requested}. Showing ${longDate(fallback)}.` : null,
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [focus, setFocus] = useState<[number, number]>([0, 0])
  const gridRef = useRef<HTMLTableElement>(null)

  useEffect(() => replaceParams('courts', new URLSearchParams({ date })), [date])
  const day = useAsync(() => loadDay(date), [date])
  useEffect(() => setSelected(null), [date])

  const idx = dates.indexOf(date)
  const go = (d: string) => {
    if (dates.includes(d)) {
      setDate(d)
      setNotice(null)
    } else {
      const next = dates.find((x) => x >= d) ?? dates[dates.length - 1]
      setNotice(`No records in this export for ${longDate(d)}. Showing the next date with records.`)
      setDate(next)
    }
  }

  const courts = useMemo(() => Array.from({ length: overview.cards.courts }, (_, i) => i + 1), [overview])
  const grid = useMemo(() => {
    if (day.status !== 'ready') return null
    const map = new Map<string, SlotDetail>()
    let lo = 7
    let hi = 19
    for (const s of day.data.slots) {
      map.set(`${s.court}|${s.hour}`, s)
      lo = Math.min(lo, s.hour)
      hi = Math.max(hi, s.hour)
    }
    const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<string, number>
    day.data.slots.forEach((s) => counts[s.status]++)
    return { map, hours, counts }
  }, [day])

  const onKey = (e: KeyboardEvent) => {
    if (!grid) return
    const [r, c] = focus
    const moves: Record<string, [number, number]> = {
      ArrowUp: [r - 1, c],
      ArrowDown: [r + 1, c],
      ArrowLeft: [r, c - 1],
      ArrowRight: [r, c + 1],
      Home: [r, 0],
      End: [r, grid.hours.length - 1],
    }
    const next = moves[e.key]
    if (!next) return
    e.preventDefault()
    const nr = Math.max(0, Math.min(courts.length - 1, next[0]))
    const nc = Math.max(0, Math.min(grid.hours.length - 1, next[1]))
    setFocus([nr, nc])
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-rc="${nr}-${nc}"]`)?.focus()
  }

  const sel = selected && grid ? grid.map.get(selected) : undefined
  const dayWx = wxIdx?.get(date)
  const [selCourt, selHour] = selected ? selected.split('|').map(Number) : [0, 0]

  return (
    <>
      <section className="hero">
        <div className="kicker">Court explorer</div>
        <h1>Follow the records.</h1>
        <p className="lede">
          Every recorded slot for one date: {overview.cards.courts} courts by hour. Select a cell for its sanitized record. Hatched
          cells have no record in this export.
        </p>
      </section>

      <section className="panel">
        <div className="court-toolbar">
          <button className="btn" type="button" disabled={idx <= 0} onClick={() => go(dates[idx - 1])} aria-label="Previous date with records">
            ← Prev
          </button>
          <label className="small" style={{ fontWeight: 700 }}>
            <span className="sr-only">Date</span>
            <input type="date" value={date} min={dates[0]} max={dates[dates.length - 1]} onChange={(e) => e.target.value && go(e.target.value)} />
          </label>
          <button className="btn" type="button" disabled={idx >= dates.length - 1} onClick={() => go(dates[idx + 1])} aria-label="Next date with records">
            Next →
          </button>
          <strong style={{ marginLeft: 8 }}>{longDate(date)}</strong>
        </div>
        {notice && <div className="callout" role="status">{notice}</div>}
        {day.status === 'ready' && day.data.post_cutoff && (
          <div className="callout">
            This date is on or after the snapshot cutoff ({manifest.snapshot.historical_outcome_cutoff}). Statuses show the state at
            export time and are not completed outcomes.
          </div>
        )}
        <StatusLegend includeMissing />
        {day.status === 'loading' && <Loading what="court records" />}
        {day.status === 'error' && <LoadError error={day.error} />}
        {grid && day.status === 'ready' && (
          <div className="court-layout">
            <div className="table-wrap">
              <table className="court-grid" ref={gridRef} onKeyDown={onKey} aria-label={`Recorded slots on ${longDate(date)}; rows are courts, columns are start hours`}>
                <thead>
                  <tr>
                    <th scope="col">Court</th>
                    {grid.hours.map((h) => (
                      <th scope="col" key={h} abbr={hourLabel(h)}>
                        {shortHour(h)}
                      </th>
                    ))}
                  </tr>
                  {day.data.weather && (
                    <tr>
                      <th scope="row" title="Central Park hourly gauge, observation ending :51 of each hour">
                        Rain
                      </th>
                      {grid.hours.map((h) => {
                        const obs = day.data.weather!.find((x) => x.hour === h)
                        const v = obs?.rain_in
                        const label = v == null ? 'no data' : v > 0 ? `${v.toFixed(2)}"` : obs?.trace ? 'T' : '0'
                        return (
                          <td key={h} title={`${hourLabel(h)}: ${v == null ? 'no rainfall data' : v > 0 ? `${v.toFixed(2)} in` : obs?.trace ? 'trace' : 'none measured'}`}>
                            <span
                              className="rain-cell"
                              style={{ background: v ? `color-mix(in srgb, var(--seq-5) ${Math.min(100, 25 + v * 300)}%, transparent)` : undefined }}
                            >
                              {v == null ? '·' : label.replace('0.', '.')}
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {courts.map((c, r) => (
                    <tr key={c}>
                      <th scope="row">{c}</th>
                      {grid.hours.map((h, ci) => {
                        const s = grid.map.get(`${c}|${h}`)
                        const key = `${c}|${h}`
                        const isFocus = focus[0] === r && focus[1] === ci
                        const label = s
                          ? `Court ${c}, ${hourLabel(h)}: ${STATUS_LABEL[s.status]}${s.walkup ? `, walkup entry ${s.walkup.time}` : ''}`
                          : `Court ${c}, ${hourLabel(h)}: no record in this export`
                        return (
                          <td key={h}>
                            <button
                              type="button"
                              data-rc={`${r}-${ci}`}
                              tabIndex={isFocus ? 0 : -1}
                              className={`cell${s ? (LIGHT_FILLS.has(s.status) ? ' light-fill' : '') : ' missing'}`}
                              style={s ? { background: statusColor(s.status) } : undefined}
                              aria-label={label}
                              aria-pressed={selected === key}
                              title={label}
                              onFocus={() => setFocus([r, ci])}
                              onClick={() => setSelected(selected === key ? null : key)}
                            >
                              {s ? STATUS_CODE[s.status] : '—'}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small muted">Arrow keys move between cells; Enter selects.</p>
            </div>

            <aside className="panel detail" aria-live="polite" style={{ marginBottom: 0 }}>
              {!selected ? (
                <>
                  <h3>Day summary</h3>
                  <dl>
                    <dt>Recorded court-hours</dt>
                    <dd className="num">{num(day.data.slots.length)}</dd>
                    {STATUSES.map((s) => (
                      <FragmentRow key={s} label={STATUS_LABEL[s]} value={num(grid.counts[s])} status={s} />
                    ))}
                    <dt>With a qualifying walkup entry</dt>
                    <dd className="num">{num(day.data.slots.filter((s) => s.walkup).length)}</dd>
                  </dl>
                  {dayWx && (
                    <>
                      <h3>Central Park rainfall</h3>
                      <dl>
                        <dt>This day</dt>
                        <dd>{inches(dayWx.rain, dayWx.trace)}</dd>
                        <dt>Day before</dt>
                        <dd>{inches(dayWx.prev1, dayWx.prev1Trace)}</dd>
                        <dt>2 days before</dt>
                        <dd>{inches(dayWx.trail2, dayWx.trail2Trace)}</dd>
                        <dt>3 days before</dt>
                        <dd>{inches(dayWx.trail3, dayWx.trail3Trace)}</dd>
                        {dayWx.tmax != null && (
                          <>
                            <dt>High</dt>
                            <dd>{Math.round(dayWx.tmax)}°F</dd>
                          </>
                        )}
                      </dl>
                    </>
                  )}
                  <p className="small muted">Select a cell to see its record.</p>
                </>
              ) : !sel ? (
                <>
                  <h3>
                    Court {selCourt}, {hourLabel(selHour)}
                  </h3>
                  <p>No record for this court and hour in this export.</p>
                  <p className="small muted">That does not mean the court was open, closed, available, or unused.</p>
                </>
              ) : (
                <>
                  <h3>
                    Court {sel.court}, {hourLabel(sel.hour)}
                  </h3>
                  <dl>
                    <dt>Recorded status</dt>
                    <dd>
                      <span className="pill">
                        <Swatch status={sel.status} /> {STATUS_LABEL[sel.status]}
                      </span>
                    </dd>
                    <dt>Slot ID</dt>
                    <dd className="num">{sel.id}</dd>
                    <dt>Export rows</dt>
                    <dd>
                      {sel.rows} <span className="muted small">(rows, not people or bookings)</span>
                    </dd>
                    <dt>Methods observed</dt>
                    <dd>
                      <Counts obj={sel.methods} />
                    </dd>
                    <dt>Player statuses</dt>
                    <dd>
                      <Counts obj={sel.player_statuses} />
                    </dd>
                    <dt>Permit types</dt>
                    <dd>
                      <Counts obj={sel.permits} />
                    </dd>
                    <dt>Recorded actions</dt>
                    <dd>
                      <Counts obj={sel.actions} />
                    </dd>
                    <dt>Qualifying walkup entry</dt>
                    <dd>
                      {sel.walkup ? (
                        <>
                          {sel.walkup.time} <span className="muted small">({Math.round(sel.walkup.lead_minutes)} min before start)</span>
                        </>
                      ) : (
                        <span className="muted">none</span>
                      )}
                    </dd>
                  </dl>
                  {Object.keys(sel.actions).length > 0 && (
                    <p className="small muted">
                      Cancellation and rebooking actions are listed as recorded. How they relate to each player record is ambiguous in
                      the export, so no timeline is shown.
                    </p>
                  )}
                  <p className="small muted">Staff notes are withheld from public views pending review.</p>
                </>
              )}
            </aside>
          </div>
        )}
        <SourceLine manifest={manifest}>{`Date partition slots/${date}.json`}</SourceLine>
      </section>
    </>
  )
}

function FragmentRow({ label, value, status }: { label: string; value: string; status: (typeof STATUSES)[number] }) {
  return (
    <>
      <dt>
        <span className="pill" style={{ fontWeight: 400 }}>
          <Swatch status={status} /> {label}
        </span>
      </dt>
      <dd className="num">{value}</dd>
    </>
  )
}
