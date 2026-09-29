/** Original mark: a green tennis ball. Deliberately unlike any official NYC Parks logo. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" role="img" aria-label="Central Park Tennis Watch">
      <circle cx="24" cy="24" r="22" fill="var(--brand)" />
      <path d="M8.5 9.5 C 18 16, 18 32, 8.5 38.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M39.5 9.5 C 30 16, 30 32, 39.5 38.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}
