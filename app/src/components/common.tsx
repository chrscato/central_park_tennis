import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { STATUS_LABEL, STATUSES, type Status } from '../lib/data'

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

export function StatusLegend({ includeMissing = false }: { includeMissing?: boolean }) {
  return (
    <div className="legend" role="list" aria-label="Status legend">
      {STATUSES.map((s) => (
        <span className="legend-item" role="listitem" key={s}>
          <Swatch status={s} />
          {STATUS_LABEL[s]}
        </span>
      ))}
      {includeMissing && (
        <span className="legend-item" role="listitem">
          <span className="swatch missing" aria-hidden="true" />
          No record
        </span>
      )}
    </div>
  )
}

export function Group({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <fieldset className={`group${className ? ' ' + className : ''}`}>
      <legend>{title}</legend>
      {children}
    </fieldset>
  )
}

export function Readout({ label, value, sub, accent, off }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean; off?: boolean }) {
  return (
    <div className={`readout sunken${off ? ' off' : ''}`}>
      <div className="k">{label}</div>
      <div className={`v${accent ? ' accent' : ''}`}>{value}</div>
      {sub != null && <div className="s">{sub}</div>}
    </div>
  )
}

/** Keeps one broken view from blanking the whole app. */
export class ViewBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: string | null; key: string }> {
  state = { error: null as string | null, key: this.props.resetKey }
  static getDerivedStateFromError(e: unknown) {
    return { error: String(e) }
  }
  static getDerivedStateFromProps(p: { resetKey: string }, s: { error: string | null; key: string }) {
    return p.resetKey !== s.key ? { error: null, key: p.resetKey } : null
  }
  render() {
    if (this.state.error)
      return (
        <div className="note err" role="alert">
          This view failed to load: {this.state.error}
        </div>
      )
    return this.props.children
  }
}

export function Loading({ what }: { what: string }) {
  return (
    <p className="muted" role="status">
      Loading {what}…
    </p>
  )
}

export function LoadError({ error }: { error: string }) {
  return (
    <div className="note err" role="alert">
      Could not load data ({error}). Run <code>python -m pipeline.build</code>.
    </div>
  )
}
