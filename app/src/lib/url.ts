// Hash-based routing + filter state, so the static build works on any host
// and every view is shareable by URL.

import { useEffect, useState } from 'react'

export type Route = 'overview' | 'planner' | 'courts' | 'weather' | 'methodology'
const ROUTES: Route[] = ['overview', 'planner', 'courts', 'weather', 'methodology']

export interface Location {
  route: Route
  params: URLSearchParams
  invalid: boolean
}

export function parseHash(hash: string): Location {
  const raw = hash.replace(/^#\/?/, '')
  const [path, query = ''] = raw.split('?')
  const route = (path || 'overview') as Route
  const ok = ROUTES.includes(route)
  return { route: ok ? route : 'overview', params: new URLSearchParams(query), invalid: !ok }
}

export function useLocation(): Location {
  const [loc, setLoc] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const on = () => setLoc(parseHash(window.location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return loc
}

export function href(route: Route, params?: URLSearchParams | Record<string, string>): string {
  const q = params ? new URLSearchParams(params as Record<string, string>).toString() : ''
  return `#/${route}${q ? '?' + q : ''}`
}

/** Replace the current URL's query without adding history entries. */
export function replaceParams(route: Route, params: URLSearchParams) {
  const next = href(route, params)
  if (window.location.hash !== next) window.history.replaceState(null, '', next)
}

/** Parse "1,2,3" into integers within [min,max]; returns null when anything is invalid. */
export function parseIntList(value: string | null, min: number, max: number): number[] | null {
  if (value == null || value === '') return null
  const parts = value.split(',').map((s) => Number(s))
  if (parts.some((n) => !Number.isInteger(n) || n < min || n > max)) return null
  return [...new Set(parts)].sort((a, b) => a - b)
}
