import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Group, LIGHT_FILLS, LoadError, Loading, StatusLegend, Swatch, statusColor, useAsync } from '../components/common'
import { loadDay, STATUS_CODE, STATUS_LABEL, STATUSES, type Manifest, type Overview, type SlotDetail } from '../lib/data'
import { hourLabel, longDate, num } from '../lib/format'
import { replaceParams } from '../lib/url'
import { dayIndex, inches, type WeatherData } from '../lib/weather'

/** "Walk-up" / "Online" / "Waiting list" from the booking methods of the first player. */
function bookedBy(methods: Record<string, number>): string {
  const first = Object.keys(methods).filter((m) => !['second', 'third', 'fourth'].includes(m))
  if (!first.length) return '—'
  const names: Record<string, string> = { walkup: 'Walk-up', online: 'Online', 'waiting list': 'Waiting list', 'repeat list': 'Repeat list', reservation: 'Reservation', 'reservation-phone': 'Phone' }
  return first.map((m) => names[m] ?? m).join(', ')
}

function players(methods: Record<string, number>): string {
  if (methods.fourth) return 'Doubles (4)'
  if (methods.third) return '3'
  if (methods.second) return 'Singles (2)'
  return '1 recorded'
}

function Counts({ obj }: { obj: Record<string, number> }) {
  const entries = Object.entries(obj)
  if (!entries.length) return <span className="muted">—</span>
  return <>{entries.map(([k, v]) => `${k} (${v})`).join(', ')}</>
}

export function Courts({ overview, weather, params }: { manifest: Manifest; overview: Overview; weather: WeatherData; params: URLSearchParams }) {
  const wxIdx = useMemo(() => (weather.status === 'available' ? dayIndex(weather) : null), [weather])
  const dates = useMemo(() => overview.daily.map((d) => d.date), [overview])
  const requested = params.get('date')
  const fallback = overview.cards.latest_outcome_date ?? dates[dates.length - 1]
  const [date, setDate] = useState(requested && dates.includes(requested) ? requested : fallback)
  const [notice, setNotice] = useState<string | null>(requested && !dates.includes(requested) ? `No records for ${requested}.` : null)
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
      setNotice(`No records for ${longDate(d, false)}; showing next date with records.`)
      setDate(dates.find((x) => x >= d) ?? dates[dates.length - 1])
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

  // Rows = start hours, columns = courts.
  const onKey = (e: KeyboardEvent) => {
    if (!grid) return
    const [r, c] = focus
    const moves: Record<string, [number, number]> = {
      ArrowUp: [r - 1, c],
      ArrowDown: [r + 1, c],
      ArrowLeft: [r, c - 1],
      ArrowRight: [r, c + 1],
      Home: [r, 0],
      End: [r, courts.length - 1],
    }
    const next = moves[e.key]
    if (!next) return
    e.preventDefault()
    const nr = Math.max(0, Math.min(grid.hours.length - 1, next[0]))
    const nc = Math.max(0, Math.min(courts.length - 1, next[1]))
    setFocus([nr, nc])
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-rc="${nr}-${nc}"]`)?.focus()
  }

  const sel = selected && grid ? grid.map.get(selected) : undefined
  const [selCourt, selHour] = selected ? selected.split('|').map(Number) : [0, 0]
  const dayWx = wxIdx?.get(date)
  const hourRain = (h: number) => day.status === 'ready' ? day.data.weather?.find((x) => x.hour === h) : undefined

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn" type="button" disabled={idx <= 0} onClick={() => go(dates[idx - 1])}>
          ◄ Prev
        </button>
        <input type="date" aria-label="Date" value={date} min={dates[0]} max={dates[dates.length - 1]} onChange={(e) => e.target.value && go(e.target.value)} />
        <button className="btn" type="button" disabled={idx >= dates.length - 1} onClick={() => go(dates[idx + 1])}>
          Next ►
        </button>
        <b style={{ marginLeft: 6 }}>{longDate(date)}</b>
        {day.status === 'ready' && day.data.post_cutoff && <span className="note" style={{ margin: 0 }}>After snapshot cutoff — status not final</span>}
      </div>
      {notice && <div className="note">{notice}</div>}
      <StatusLegend includeMissing />

      {day.status === 'loading' && <Loading what="court records" />}
      {day.status === 'error' && <LoadError error={day.error} />}
      {grid && day.status === 'ready' && (
        <div className="split right">
          <div className="grid-wrap tall">
            <table className="court-grid" ref={gridRef} onKeyDown={onKey} aria-label={`Recorded slots on ${longDate(date)}; rows are start times, columns are courts`}>
              <thead>
                <tr>
                  <th scope="col">Start</th>
                  {day.data.weather && (
                    <th scope="col" title="Central Park rain gauge, hour ending :51">
                      Rain
                    </th>
                  )}
                  {courts.map((c) => (
                    <th scope="col" key={c} abbr={`Court ${c}`}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.hours.map((h, r) => {
                  const obs = hourRain(h)
                  const v = obs?.rain_in
                  return (
                    <tr key={h}>
                      <th scope="row">{hourLabel(h)}</th>
                      {day.data.weather && (
                        <td title={v == null ? 'No rain data' : `${v.toFixed(2)} in`}>
                          <span className="rain-cell" style={v ? { background: `rgba(10,36,106,${Math.min(0.9, 0.2 + v * 3)})`, color: v > 0.1 ? '#fff' : '#000' } : undefined}>
                            {v == null ? '·' : v > 0 ? v.toFixed(2).replace(/^0/, '') : obs?.trace ? 'T' : '0'}
                          </span>
                        </td>
                      )}
                      {courts.map((c, ci) => {
                        const s = grid.map.get(`${c}|${h}`)
                        const key = `${c}|${h}`
                        const label = s
                          ? `Court ${c}, ${hourLabel(h)}: ${STATUS_LABEL[s.status]}${s.walkup ? `, walkup booked ${s.walkup.time}` : ''}`
                          : `Court ${c}, ${hourLabel(h)}: no record`
                        return (
                          <td key={c}>
                            <button
                              type="button"
                              data-rc={`${r}-${ci}`}
                              tabIndex={focus[0] === r && focus[1] === ci ? 0 : -1}
                              className={`cell${s ? (LIGHT_FILLS.has(s.status) ? ' light-fill' : '') : ' missing'}`}
                              style={s ? { background: statusColor(s.status) } : undefined}
                              aria-label={label}
                              aria-pressed={selected === key}
                              title={label}
                              onFocus={() => setFocus([r, ci])}
                              onClick={() => setSelected(selected === key ? null : key)}
                            >
                              {s ? STATUS_CODE[s.status] : ''}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <aside aria-live="polite">
            {!selected ? (
              <Group title="Day summary">
                <table className="kv">
                  <tbody>
                    <tr>
                      <th>Court-hours</th>
                      <td className="num">{num(day.data.slots.length)}</td>
                    </tr>
                    {STATUSES.map((s) => (
                      <tr key={s}>
                        <th>
                          <Swatch status={s} /> {STATUS_LABEL[s]}
                        </th>
                        <td className="num">{num(grid.counts[s])}</td>
                      </tr>
                    ))}
                    <tr>
                      <th>Walkup bookings</th>
                      <td className="num">{num(day.data.slots.filter((s) => s.walkup).length)}</td>
                    </tr>
                  </tbody>
                </table>
              </Group>
            ) : (
              <Group title={`Court ${sel?.court ?? selCourt} · ${hourLabel(sel?.hour ?? selHour)}`}>
                {!sel ? (
                  <p>No record in this export.</p>
                ) : (
                  <table className="kv">
                    <tbody>
                      <tr>
                        <th>Status</th>
                        <td>
                          <Swatch status={sel.status} /> {STATUS_LABEL[sel.status]}
                        </td>
                      </tr>
                      <tr>
                        <th>Booked</th>
                        <td style={{ whiteSpace: 'normal' }}>{bookedBy(sel.methods)}</td>
                      </tr>
                      <tr>
                        <th>Players</th>
                        <td>{players(sel.methods)}</td>
                      </tr>
                      <tr>
                        <th>Walk-up booked at</th>
                        <td>{sel.walkup ? sel.walkup.time : '—'}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
                {sel && (
                  <details className="small" style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer' }}>Record details</summary>
                    <table className="kv" style={{ marginTop: 4 }}>
                      <tbody>
                        <tr><th>Slot ID</th><td className="num">{sel.id}</td></tr>
                        <tr><th>Rows in the records</th><td>{sel.rows}</td></tr>
                        <tr><th>How booked</th><td style={{ whiteSpace: 'normal' }}><Counts obj={sel.methods} /></td></tr>
                        <tr><th>Player status</th><td style={{ whiteSpace: 'normal' }}><Counts obj={sel.player_statuses} /></td></tr>
                        <tr><th>Permits</th><td><Counts obj={sel.permits} /></td></tr>
                        <tr><th>Cancellations etc.</th><td style={{ whiteSpace: 'normal' }}><Counts obj={sel.actions} /></td></tr>
                      </tbody>
                    </table>
                  </details>
                )}
                <button className="btn small" type="button" style={{ marginTop: 6 }} onClick={() => setSelected(null)}>
                  Close
                </button>
              </Group>
            )}
            {dayWx && (
              <Group title="Rain (Central Park)">
                <table className="kv">
                  <tbody>
                    <tr>
                      <th>This day</th>
                      <td>{inches(dayWx.rain, dayWx.trace)}</td>
                    </tr>
                    <tr>
                      <th>Day before</th>
                      <td>{inches(dayWx.prev1, dayWx.prev1Trace)}</td>
                    </tr>
                    <tr>
                      <th>2 days before</th>
                      <td>{inches(dayWx.trail2, dayWx.trail2Trace)}</td>
                    </tr>
                    <tr>
                      <th>3 days before</th>
                      <td>{inches(dayWx.trail3, dayWx.trail3Trace)}</td>
                    </tr>
                    {dayWx.tmax != null && (
                      <tr>
                        <th>High</th>
                        <td>{Math.round(dayWx.tmax)}°F</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </Group>
            )}
            <div className="foot">Blank = no record for that court and hour (not necessarily closed). Tap a square for details.</div>
          </aside>
        </div>
      )}
    </>
  )
}
