import { useEffect } from 'react'
import { LoadError, Loading, useAsync, ViewBoundary } from './components/common'
import { loadManifest, loadOverview, loadTiming, loadWeather } from './lib/data'
import { longDate } from './lib/format'
import { href, useLocation, type Route } from './lib/url'
import { Courts } from './views/Courts'
import { Methodology } from './views/Methodology'
import { Outlook } from './views/Outlook'
import { Overview } from './views/Overview'
import { Planner } from './views/Planner'
import { Weather } from './views/Weather'

const NAV: { route: Route; label: string }[] = [
  { route: 'overview', label: 'Overview' },
  { route: 'planner', label: 'Walkup planner' },
  { route: 'outlook', label: 'Rain outlook' },
  { route: 'courts', label: 'Court records' },
  { route: 'weather', label: 'Weather' },
  { route: 'methodology', label: 'FOIL & methodology' },
]

export default function App() {
  const loc = useLocation()
  const data = useAsync(() => Promise.all([loadManifest(), loadOverview(), loadTiming(), loadWeather().catch(() => ({ status: 'unavailable' as const, reason: 'weather.json not found' }) as never)]), [])

  useEffect(() => {
    window.scrollTo(0, 0)
    const label = NAV.find((n) => n.route === loc.route)?.label
    document.title = `${label} · Central Park Tennis Watch`
  }, [loc.route])

  const manifest = data.status === 'ready' ? data.data[0] : undefined
  const latestOutcome = data.status === 'ready' ? data.data[1].cards.latest_outcome_date : null

  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <div className="brand">
            <a href={href('overview')} className="brand-name">
              Central Park <span>Tennis</span> Watch
            </a>
            <span className="brand-tag">Independent. Not affiliated with NYC Parks or any government agency or party.</span>
          </div>
          <nav className="nav" aria-label="Sections">
            {NAV.map((n) => (
              <a key={n.route} href={href(n.route)} aria-current={loc.route === n.route ? 'page' : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      {manifest && (
        <div className="banner" role="note">
          <span>
            <span className="tag">Historical</span>
            <strong>Records, not live availability.</strong>
          </span>
          <span>
            Reservation outcomes {longDate(manifest.snapshot.reservation_date_min, false)} –{' '}
            {latestOutcome ? longDate(latestOutcome, false) : '—'} (cutoff {manifest.snapshot.historical_outcome_cutoff})
          </span>
          <span>
            Extraction date: <strong>{manifest.source.extraction_time_status}</strong> (latest activity{' '}
            {manifest.snapshot.latest_activity.slice(0, 10)})
          </span>
          <a href={href('methodology')}>Data {manifest.data_version}</a>
        </div>
      )}

      <main id="main">
        {loc.invalid && (
          <div className="callout" role="alert">
            That page doesn’t exist. Showing the overview.
          </div>
        )}
        {data.status === 'loading' && <Loading what="records" />}
        {data.status === 'error' && <LoadError error={data.error} />}
        {data.status === 'ready' && (
          <ViewBoundary resetKey={loc.route}>
          {(() => {
            const [m, ov, t, w] = data.data
            switch (loc.route) {
              case 'planner':
                return <Planner key="planner" manifest={m} timing={t} weather={w} params={loc.params} />
              case 'outlook':
                return <Outlook manifest={m} timing={t} weather={w} />
              case 'courts':
                return <Courts manifest={m} overview={ov} weather={w} params={loc.params} />
              case 'weather':
                return <Weather manifest={m} overview={ov} weather={w} />
              case 'methodology':
                return <Methodology manifest={m} />
              default:
                return <Overview manifest={m} overview={ov} timing={t} weather={w} />
            }
          })()}
          </ViewBoundary>
        )}
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <p>
            Central Park Tennis Watch is an independent project built from public records obtained under New York’s Freedom of
            Information Law. It is not affiliated with, endorsed by, or speaking for NYC Parks, the City of New York, or any
            political party or government entity.
          </p>
          <p>
            Historical records only. Nothing here predicts or guarantees court availability.{' '}
            {manifest && (
              <>
                Data {manifest.data_version} · built {manifest.built_at_utc.slice(0, 10)} ·{' '}
              </>
            )}
            <a href={href('methodology')}>Methodology & corrections</a>
          </p>
        </div>
      </footer>
    </>
  )
}
