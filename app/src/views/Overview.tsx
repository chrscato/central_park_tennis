import { useMemo } from 'react'
import { Card, SourceLine, StatusLegend } from '../components/common'
import { CoverageCalendar, WeeklyStatusChart } from '../components/charts'
import type { Manifest, Overview as OverviewData, Timing } from '../lib/data'
import { clock, longDate, num, pct } from '../lib/format'
import { addDays, computePlanner } from '../lib/stats'
import { href } from '../lib/url'
import { dryDayRainouts, rainoutByDailyBucket, type WeatherData } from '../lib/weather'

export function Overview({
  manifest,
  overview,
  timing,
  weather,
}: {
  manifest: Manifest
  overview: OverviewData
  timing: Timing
  weather: WeatherData
}) {
  const c = overview.cards
  const rain = useMemo(() => {
    if (weather.status !== 'available') return null
    const rows = rainoutByDailyBucket(weather, overview.daily, 'prev1')
    const wet = rows.filter((r) => r.bucket === 'moderate' || r.bucket === 'heavy')
    const wetRec = wet.reduce((a, r) => a + r.recorded, 0)
    return {
      dry: rows.find((r) => r.bucket === 'dry')?.share ?? null,
      wet: wetRec ? wet.reduce((a, r) => a + r.rainedOut, 0) / wetRec : null,
      leads: dryDayRainouts(weather, overview.daily).length,
    }
  }, [weather, overview])
  const cutoff = manifest.snapshot.historical_outcome_cutoff

  // Supported observations, computed from the same public assets the planner uses.
  const evening = useMemo(
    () =>
      computePlanner(
        timing,
        { months: [4, 5, 6, 7, 8, 9, 10], weekdays: [1, 2, 3, 4, 5], years: [], hours: [17, 18, 19] },
        { firstDate: manifest.snapshot.reservation_date_min, cutoff, minDates: manifest.cohort.min_dates_for_planning_target },
      ),
    [timing, manifest, cutoff],
  )
  const gaps = useMemo(() => {
    const have = new Set(overview.daily.map((d) => d.date))
    let missingInSeason = 0
    for (let d = c.first_outcome_date!; d < cutoff; d = addDays(d, 1)) {
      const mo = Number(d.slice(5, 7))
      if (mo >= 4 && mo <= 10 && !have.has(d)) missingInSeason++
    }
    const thin = overview.daily.filter((d) => !d.post_cutoff && d.courts < 13).length
    return { missingInSeason, thin }
  }, [overview, c.first_outcome_date, cutoff])

  return (
    <>
      <section className="hero">
        <div className="kicker">Public courts. Public records. Clear answers.</div>
        <h1>Public courts, examined.</h1>
        <p className="lede">
          {num(manifest.profile.raw_rows)} reservation records from NYC Parks, obtained through a Freedom of Information
          Law request, covering Central Park’s {c.courts} tennis courts. Who gets to play, when courts are booked, and what the
          records leave out.
        </p>
        <div className="actions">
          <a className="btn primary" href={href('planner')}>
            Plan a walkup
          </a>
          <a className="btn" href={href('courts')}>
            Inspect court records
          </a>
        </div>
      </section>

      <div className="cards">
        <Card
          accent
          label="Recorded court-hours"
          value={<span>{num(c.recorded_court_hours)}</span>}
          note={`Distinct slot IDs, reservation dates before ${longDate(cutoff, false)}`}
        />
        <Card
          label="Share recorded “all checked in”"
          value={pct(c.checked_in_share)}
          note={`${num(c.status_counts['all-checkedin'])} of ${num(c.recorded_court_hours)} recorded court-hours. A recorded status, not verified play.`}
        />
        <Card
          label="Share recorded “rained out”"
          value={pct(c.rained_out_share)}
          note={`${num(c.status_counts['rained-out'])} of ${num(c.recorded_court_hours)} recorded court-hours`}
        />
        <Card label="Dates represented" value={num(c.represented_dates)} note={`${longDate(c.first_outcome_date!, false)} – ${longDate(c.latest_outcome_date!, false)}`} />
        <Card
          label="Latest outcome date included"
          value={<span style={{ fontSize: '1.5rem' }}>{longDate(c.latest_outcome_date!, false)}</span>}
          note={`Later reservations exist but are after the ${manifest.snapshot.cutoff_status} snapshot cutoff.`}
        />
      </div>

      <section className="panel" aria-labelledby="ev-h">
        <h2 id="ev-h">Questions the records can speak to</h2>
        <p className="sub">Each answer links to the view that shows the evidence and its denominator.</p>
        <div className="evidence">
          <a href={href('planner', { m: '4,5,6,7,8,9,10', dow: '1,2,3,4,5', h: '17,18,19' })}>
            <div className="q">How early are weekday evening courts booked?</div>
            <div className="a">
              For weekday 5–7 p.m. slots, half of {num(evening.slotCount)} qualifying successful walkup entries were made by{' '}
              <strong>{clock(evening.pooled.p50)}</strong> that morning, across {num(evening.days.length)} recorded dates.
            </div>
          </a>
          <a href="#coverage">
            <div className="q">Which dates have incomplete records?</div>
            <div className="a">
              {num(gaps.missingInSeason)} April–October dates before the cutoff have no records at all in this export, and{' '}
              {num(gaps.thin)} represented dates show fewer than half the courts. Missing is not the same as closed.
            </div>
          </a>
          <a href={href('methodology')}>
            <div className="q">How much of the export can be used for timing?</div>
            <div className="a">
              {num(manifest.cohort.slot_ledger.at(-1)!.slots)} slots have a qualifying successful walkup entry. Every exclusion
              is counted in the methodology ledger.
            </div>
          </a>
          <a href={href('weather')}>
            <div className="q">Do rain-outs line up with recorded rain?</div>
            <div className="a">
              {rain ? (
                <>
                  When the day before measured 0.10&quot; or more, <strong>{pct(rain.wet)}</strong> of recorded court-hours were rained
                  out, versus <strong>{pct(rain.dry)}</strong> after a dry day. {num(rain.leads)} dates show rain-outs with no rain
                  measured that day or the day before.
                </>
              ) : (
                'Weather data unavailable in this build.'
              )}
            </div>
          </a>
        </div>
      </section>

      <section className="panel" aria-labelledby="wk-h">
        <h2 id="wk-h">Recorded court-hours by week and schedule status</h2>
        <p className="sub">
          Unit: distinct validated slot IDs. Snapshot status at export time. Empty stretches mean no records in this export.
        </p>
        <StatusLegend />
        <WeeklyStatusChart weekly={overview.weekly} />
        <details>
          <summary>Table view</summary>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Week of</th>
                  <th className="n">All checked in</th>
                  <th className="n">Rained out</th>
                  <th className="n">Assigned</th>
                  <th className="n">In progress</th>
                  <th className="n">Unassigned</th>
                  <th className="n">Unbookable</th>
                </tr>
              </thead>
              <tbody>
                {overview.weekly.map((w) => (
                  <tr key={w.week_start}>
                    <td>{w.week_start}</td>
                    <td className="n">{num(w['all-checkedin'])}</td>
                    <td className="n">{num(w['rained-out'])}</td>
                    <td className="n">{num(w.assigned)}</td>
                    <td className="n">{num(w['booking-in-progress'])}</td>
                    <td className="n">{num(w.unassigned)}</td>
                    <td className="n">{num(w.unbookable)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <SourceLine manifest={manifest}>{`n = ${num(c.recorded_court_hours)} court-hours · filter: ${overview.filter}`}</SourceLine>
      </section>

      <section className="panel" id="coverage" aria-labelledby="cov-h">
        <h2 id="cov-h">Coverage calendar</h2>
        <p className="sub">
          Recorded court-hours per date. Hatched dates have no records in this export — that means “not present,” not “available,”
          “unused,” or “closed.” The export does not include a full inventory of bookable slots.
        </p>
        <CoverageCalendar daily={overview.daily} />
        <SourceLine manifest={manifest}>{`${num(overview.daily.length)} dates with any record`}</SourceLine>
      </section>
    </>
  )
}
