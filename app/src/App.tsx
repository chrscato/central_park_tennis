import { useEffect } from 'react'
import { LoadError, Loading, useAsync, ViewBoundary } from './components/common'
import { Logo } from './components/Logo'
import { loadInsights, loadManifest, loadOverview, loadTiming, loadWeather, type Insights as InsightsData } from './lib/data'
import { longDate } from './lib/format'
import { href, useLocation, type Route } from './lib/url'
import type { WeatherData } from './lib/weather'
import { Courts } from './views/Courts'
import { Insights } from './views/Insights'
import { Methodology } from './views/Methodology'
import { Outlook } from './views/Outlook'
import { Planner } from './views/Planner'
import { Weather } from './views/Weather'

const NAV: { route: Route; label: string }[] = [
  { route: 'planner', label: 'When to go' },
  { route: 'outlook', label: 'After rain' },
  { route: 'weather', label: 'Rain & closures' },
  { route: 'courts', label: 'Court history' },
  { route: 'insights', label: 'Insights' },
  { route: 'methodology', label: 'About the data' },
]

const UNAVAILABLE: WeatherData = { status: 'unavailable', reason: 'weather.json not found' } as WeatherData

export default function App() {
  const loc = useLocation()
  const data = useAsync(() => Promise.all([loadManifest(), loadOverview(), loadTiming(), loadWeather().catch(() => UNAVAILABLE), loadInsights().catch(() => ({}) as InsightsData)]), [])
  const label = NAV.find((n) => n.route === loc.route)?.label ?? ''

  useEffect(() => {
    window.scrollTo(0, 0)
    document.title = `${label} · Central Park Tennis Watch`
  }, [label])

  const ready = data.status === 'ready' ? data.data : null
  const m = ready?.[0]

  return (
    <>
      <header>
        <div className="masthead">
          <div className="brandline">
            <Logo className="logo" />
            <a className="wordmark" href={href('planner')}>
              Central Park Tennis Watch
              <small>Independent guide built from public records · not affiliated with NYC Parks</small>
            </a>
          </div>
        </div>
        <div className="navbar">
          <nav className="nav" aria-label="Sections">
            {NAV.map((n) => (
              <a key={n.route} href={href(n.route)} aria-current={loc.route === n.route ? 'page' : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
        </div>
        {m && ready && (
          <div className="meta">
            <span>
              <b>Past records</b>, not live court availability
            </span>
            <span>
              {longDate(m.snapshot.reservation_date_min, false)}–{longDate(ready[1].cards.latest_outcome_date ?? m.snapshot.historical_outcome_cutoff, false)}
            </span>
            <span>Extraction date {m.source.extraction_time_status}</span>
            <span className="num">Data {m.data_version}</span>
          </div>
        )}
      </header>

      <main>
        {loc.invalid && <div className="note">Unknown page; showing When to go.</div>}
        {data.status === 'loading' && <Loading what="records" />}
        {data.status === 'error' && <LoadError error={data.error} />}
        {ready && (
          <ViewBoundary resetKey={loc.route}>
            {(() => {
              const [manifest, ov, t, w, ins] = ready
              switch (loc.route) {
                case 'outlook':
                  return <Outlook manifest={manifest} timing={t} weather={w} />
                case 'courts':
                  return <Courts manifest={manifest} overview={ov} weather={w} params={loc.params} />
                case 'weather':
                  return <Weather manifest={manifest} overview={ov} weather={w} />
                case 'insights':
                  return <Insights manifest={manifest} insights={ins} />
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
