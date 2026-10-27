import type { PullCordConfig } from './config'

export interface PullCordProps {
  /** Fired once per pull, the moment the pull crosses the actuation depth
   *  (like a real pull-chain detenting mid-pull), and on click / Enter.
   *
   *  Vue users can also listen to the `pull` event: `<PullCord @pull="..." />`.
   *  Both spellings work; the event is emitted either way. */
  onPull?: () => void
  /** Reflected as aria-pressed on the knob (e.g. true when your light is on). */
  pulled?: boolean
  /** Accessible name for the knob button. */
  ariaLabel?: string
  /** Skip the drop-in entrance and start at rest. */
  noEntrance?: boolean
  /** Partial physics overrides, merged over the defaults. */
  config?: Partial<PullCordConfig>
  /** Extra class on the fixed wrapper (position with --pullcord-top / --pullcord-right). */
  className?: string
}
