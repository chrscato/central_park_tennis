/** Site logo (owner-supplied image in app/public/logo.jpg). */
export function Logo({ className }: { className?: string }) {
  return <img className={className} src={`${import.meta.env.BASE_URL}logo.jpg`} alt="" width={46} height={46} />
}
