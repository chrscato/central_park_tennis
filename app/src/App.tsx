import { useEffect } from 'react'
import { LoadError, Loading, useAsync, ViewBoundary } from './components/common'
import { loadManifest, loadOverview, loadTiming, loadWeather } from './lib/data'
import { longDate } from './lib/format'
import { href, useLocation, type Route } from './lib/url'
import type { WeatherData } from './lib/weather'
import { Courts } from './views/Courts'
import { Methodology } from './views/Methodology'
import { Outlook } from './views/Outlook'
import { Planner } from './views/Planner'
import { Weather } from './views/Weather'

const NAV: { route: Route; label: string }[] = [
  { route: 'planner', label: 'Booking Times' },
  { route: 'outlook', label: 'Rain Outlook' },
  { route: 'courts', label: 'Court Records' },
  { route: 'weather', label: 'Weather' },
  { route: 'methodology', label: 'Methodology' },
]

const UNAVAILABLE: WeatherData = { status: 'unavailable', reason: 'weather.json not found' } as WeatherData

export default function App() {
  const loc = useLocation()
  const data = useAsync(() => Promise.all([loadManifest(), loadOverview(), loadTiming(), loadWeather().catch(() => UNAVAILABLE)]), [])
  const label = NAV.find((n) => n.route === loc.route)?.label ?? ''

  useEffect(() => {
    window.scrollTo(0, 0)
    document.title = `${label} - Central Park Tennis Watch`
  }, [label])

  const ready = data.status === 'ready' ? data.data : null
  const m = ready?.[0]

  return (
    <div className="desktop">
      <div className="window raised">
        <div className="titlebar">
          <span className="app-icon" aria-hidden="true" />
          <span className="title">Central Park Tennis Watch - [{label}]</span>
          <span className="ver">v0.1 · Independent · not affiliated with NYC Parks</span>
          <span className="wbtn raised" aria-hidden="true">_</span>
          <span className="wbtn raised" aria-hidden="true">□</span>
          <span className="wbtn raised" aria-hidden="true">×</span>
        </div>

        <nav className="tabs" aria-label="Sections">
          {NAV.map((n) => (
            <a key={n.route} href={href(n.route)} aria-current={loc.route === n.route ? 'page' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>

        <main className="tabpanel raised">
          {loc.invalid && <div className="note">Unknown page; showing Booking Times.</div>}
          {data.status === 'loading' && <Loading what="records" />}
          {data.status === 'error' && <LoadError error={data.error} />}
          {ready && (
            <ViewBoundary resetKey={loc.route}>
              {(() => {
                const [manifest, ov, t, w] = ready
                switch (loc.route) {
                  case 'outlook':
                    return <Outlook manifest={manifest} timing={t} weather={w} />
                  case 'courts':
                    return <Courts manifest={manifest} overview={ov} weather={w} params={loc.params} />
                  case 'weather':
                    return <Weather manifest={manifest} overview={ov} weather={w} />
                  case 'methodology':
                    return <Methodology manifest={manifest} />
                  default:
                    return <Planner key="planner" manifest={manifest} timing={t} weather={w} params={loc.params} />
                }
              })()}
            </ViewBoundary>
          )}
        </main>

        <footer className="statusbar">
          <span className="sunken grow">Historical records (FOIL) — not live court availability</span>
          {m && (
            <>
              <span className="sunken">
                Outcomes {longDate(m.snapshot.reservation_date_min, false)}–{longDate(ready![1].cards.latest_outcome_date ?? m.snapshot.historical_outcome_cutoff, false)}
              </span>
              <span className="sunken">Extraction date: {m.source.extraction_time_status}</span>
              <span className="sunken num">{m.data_version}</span>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
