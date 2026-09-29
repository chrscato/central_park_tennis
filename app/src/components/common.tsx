import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { STATUS_LABEL, STATUSES, type Manifest, type Status } from '../lib/data'

export type Async<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: T }

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, setState] = useState<Async<T>>({ status: 'loading' })
  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    fn().then(
      (data) => live && setState({ status: 'ready', data }),
      (e: unknown) => live && setState({ status: 'error', error: String(e) }),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(ref.current)
    setW(ref.current.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export const statusColor = (s: Status) => `var(--st-${s})`
// Fills light enough that white text would fail contrast get dark text instead.
export const LIGHT_FILLS = new Set<Status>(['assigned', 'booking-in-progress'])

export function Swatch({ status }: { status: Status }) {
  return <span className="swatch" style={{ background: statusColor(status) }} aria-hidden="true" />
}

export function StatusLegend({ includeMissing = false, statuses = STATUSES }: { includeMissing?: boolean; statuses?: readonly Status[] }) {
  return (
    <div className="legend" role="list" aria-label="Status legend">
      {statuses.map((s) => (
        <span className="legend-item" role="listitem" key={s}>
          <Swatch status={s} />
          {STATUS_LABEL[s]}
        </span>
      ))}
      {includeMissing && (
        <span className="legend-item" role="listitem">
          <span className="swatch missing" aria-hidden="true" />
          Not in this export
        </span>
      )}
    </div>
  )
}

export function Loading({ what }: { what: string }) {
  return <p className="muted" role="status">Loading {what}…</p>
}

export function LoadError({ error }: { error: string }) {
  return (
    <div className="callout" role="alert">
      Could not load data ({error}). Generated assets may be missing — run <code>python -m pipeline.build</code>.
    </div>
  )
}

export function SourceLine({ manifest, children }: { manifest?: Manifest; children?: ReactNode }) {
  return (
    <div className="source-line">
      {children}
      {children && ' · '}
      Source: NYC Parks FOIL export{manifest ? ` · data ${manifest.data_version}` : ''} ·{' '}
      <a href="#/methodology">Methodology</a>
    </div>
  )
}

export function Card({ label, value, note, accent }: { label: string; value: ReactNode; note?: ReactNode; accent?: boolean }) {
  return (
    <div className={`card${accent ? ' accent' : ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  )
}
