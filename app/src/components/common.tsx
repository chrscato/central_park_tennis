import { Component, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
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

/** True while the media query matches (e.g. phone-sized screens). */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

/** Width of an element, tracked across resizes and re-attached if the element changes. */
export function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [el])
  return [setEl, w]
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
    <section className={`grp${className ? ' ' + className : ''}`}>
      <h3>{title}</h3>
      {children}
    </section>
  )
}

/** Chart/table with title, one-line subtitle (units, filter) and source line. */
export function Figure({ title, sub, source, children }: { title: ReactNode; sub?: ReactNode; source?: ReactNode; children: ReactNode }) {
  return (
    <figure style={{ margin: 0 }}>
      <div className="fig-title">{title}</div>
      {sub && <div className="fig-sub">{sub}</div>}
      {children}
      {source && <figcaption className="fig-source">{source}</figcaption>}
    </figure>
  )
}

export function Readout({ label, value, sub, accent, off }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean; off?: boolean }) {
  return (
    <div className={`readout${off ? ' off' : ''}`}>
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
