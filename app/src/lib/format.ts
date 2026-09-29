export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const nf = new Intl.NumberFormat('en-US')
export const num = (n: number) => nf.format(n)
export const pct = (x: number | null | undefined, digits = 1) => (x == null ? '—' : `${(x * 100).toFixed(digits)}%`)

/** Minute of day -> "7:15 AM" */
export function clock(min: number | null | undefined): string {
  if (min == null || Number.isNaN(min)) return '—'
  const m = Math.round(min)
  const h24 = Math.floor(m / 60) % 24
  const mm = m % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
}

/** 17 -> "5 PM" */
export function hourLabel(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12} ${h < 12 ? 'AM' : 'PM'}`
}

/** "2025-04-02" -> "Wed 04/02/2025" */
export function longDate(date: string, withDow = true): string {
  const [y, m, d] = date.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${withDow ? WEEKDAYS[dow] + ' ' : ''}${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`
}

export const inList = (items: string[]) => items.join(', ')

/** [1,2,3,5,7,8] -> "1–3, 5, 7–8" */
export function ranges(nums: number[]): string {
  const s = [...nums].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < s.length; i++) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    out.push(j > i ? `${s[i]}–${s[j]}` : String(s[i]))
    i = j
  }
  return out.join(', ')
}
