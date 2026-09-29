import { useEffect } from 'react'
import { LoadError, Loading, useAsync, ViewBoundary } from './components/common'
import { loadManifest, loadOverview, loadTiming, loadWeather } from './lib/data'
import { longDate } from './lib/format'
import { href, useLocation, type Route } from './lib/url'
import type { WeatherData } from './lib/weather'
import { Anomalies } from './views/Anomalies'
import { Courts } from './views/Courts'
import { Methodology } from './views/Methodology'
import { Outlook } from './views/Outlook'
import { Planner } from './views/Planner'
import { Weather } from './views/Weather'

const NAV: { route: Route; label: string }[] = [
  { route: 'planner', label: 'Booking times' },
  { route: 'outlook', label: 'Rain outlook' },
  { route: 'courts', label: 'Court records' },
  { route: 'weather', label: 'Rain vs. closures' },
  { route: 'anomalies', label: 'Anomalies' },
  { route: 'methodology', label: 'Methodology' },
]

const UNAVAILABLE: WeatherData = { status: 'unavailable', reason: 'weather.json not found' } as WeatherData

export default function App() {
  const loc = useLocation()
  const data = useAsync(() => Promise.all([loadManifest(), loadOverview(), loadTiming(), loadWeather().catch(() => UNAVAILABLE)]), [])
  const label = NAV.find((n) => n.route === loc.route)?.label ?? ''

  useEffect(() => {
    window.scrollTo(0, 0)
    document.title = `${label} · Central Park Tennis Watch`
  }, [label])

  const ready = data.status === 'ready' ? data.data : null
  const m = ready?.[0]

  return (
    <>
      <header className="masthead">
        <div className="brandline">
          <a className="wordmark" href={href('planner')}>
            Central Park Tennis Watch
          </a>
          <span className="tagline">Independent analysis of NYC Parks FOIL records · not affiliated with NYC Parks</span>
        </div>
        <nav className="nav" aria-label="Sections">
          {NAV.map((n) => (
            <a key={n.route} href={href(n.route)} aria-current={loc.route === n.route ? 'page' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        {m && ready && (
          <div className="meta">
            <span>
              <b>Historical records</b>, not live availability
            </span>
            <span>
              Outcomes {longDate(m.snapshot.reservation_date_min, false)}–{longDate(ready[1].cards.latest_outcome_date ?? m.snapshot.historical_outcome_cutoff, false)}
            </span>
            <span>Extraction date {m.source.extraction_time_status}</span>
            <span className="num">Data {m.data_version}</span>
          </div>
        )}
      </header>

      <main>
        {loc.invalid && <div className="note">Unknown page; showing booking times.</div>}
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
                case 'anomalies':
                  return <Anomalies manifest={manifest} weather={w} />
                case 'methodology':
                  return <Methodology manifest={manifest} />
                default:
                  return <Planner key="planner" manifest={manifest} timing={t} weather={w} params={loc.params} />
              }
            })()}
          </ViewBoundary>
        )}
      </main>
      <footer className="footer">
        Built from NYC Parks reservation records obtained under New York’s Freedom of Information Law, and NOAA/NWS weather data. Not
        affiliated with NYC Parks or any government agency or party. <a href={href('methodology')}>Methodology & corrections</a>
      </footer>
    </>
  )
}
