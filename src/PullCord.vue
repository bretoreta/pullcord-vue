<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, type CSSProperties } from 'vue'
import { DEFAULT_CONFIG, type PullCordConfig } from './config'
import type { PullCordProps } from './types'

/*
 * PullCord — a ceiling pull-cord with a real rope (Vue port).
 *
 * Verlet rope (nodes + distance constraints, with frame-time correction).
 * GRAVITY makes it hang straight and is the restoring force; NO wind, so it
 * is still at rest and never swings forever, just settles.
 *
 *  - ENTRANCE: a CSS transform drops the whole rope + knob in from above on
 *    mount (see pullcord.css), once.
 *  - Then it's a normal rope: grab the knob (or click / Enter), it follows /
 *    swings, and fires `pull`; release and it settles under gravity + damping.
 *
 * One rAF loop steps the sim and writes the DOM via refs, and sleeps once still.
 * Pointer handling is native (pointerdown/move/up + capture) instead of a
 * gesture library, so the only runtime dependency is Vue itself.
 */

// ---- geometry (SVG units == px) ----
const W = 64
const ANCHOR_X = W / 2
const REST_Y = 176
const SVG_H = 340
const SEGMENTS = 16
const REST_SEG = REST_Y / SEGMENTS
const KNOB_R = 6.5
const HIT = 46
/** Pointer travel (px) before a press turns into a pull. */
const PAN_SLOP = 3

type RopeNode = { x: number; y: number; ox: number; oy: number; fixed: boolean }

function buildPath(p: RopeNode[]): string {
  let d = `M ${p[0].x.toFixed(1)} ${p[0].y.toFixed(1)}`
  for (let i = 1; i < p.length - 1; i++) {
    const xc = (p[i].x + p[i + 1].x) / 2
    const yc = (p[i].y + p[i + 1].y) / 2
    d += ` Q ${p[i].x.toFixed(1)} ${p[i].y.toFixed(1)} ${xc.toFixed(1)} ${yc.toFixed(1)}`
  }
  const n = p.length - 1
  d += ` L ${p[n].x.toFixed(1)} ${p[n].y.toFixed(1)}`
  return d
}

/** Nodes at full rest (straight hang). The drop-in entrance is a CSS transform
 *  on the wrapper; the Verlet sim is for grabbing/swinging. */
function makeNodes(): RopeNode[] {
  const arr: RopeNode[] = []
  for (let i = 0; i <= SEGMENTS; i++) {
    const y = REST_SEG * i
    arr.push({ x: ANCHOR_X, y, ox: ANCHOR_X, oy: y, fixed: i === 0 })
  }
  return arr
}

const INITIAL_PATH = buildPath(makeNodes())

const props = withDefaults(defineProps<PullCordProps>(), {
  pulled: false,
  ariaLabel: 'Pull the cord',
  noEntrance: false,
})

const emit = defineEmits<{ pull: [] }>()

defineOptions({ name: 'PullCord' })

// SVG ids are document-global, so every instance needs its own defs.
// useId() is SSR-safe: the server and client agree on the same value.
const uid = useId()
const gradientId = `pc-knob-${uid}`
const shadowId = `pc-knob-sh-${uid}`

const knobEl = ref<HTMLButtonElement | null>(null)
const cordEl = ref<SVGPathElement | null>(null)
const groupEl = ref<SVGGElement | null>(null)

// Reduced motion is read eagerly (SSR-safe) and kept fresh via matchMedia.
const prefersReduced =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null
const reduce = ref(prefersReduced?.matches ?? false)

// Merged fresh on every config change, and read inside the rAF loop, so prop
// changes apply to the very next frame.
const cfg = computed<PullCordConfig>(() => ({ ...DEFAULT_CONFIG, ...props.config }))

// Hot-path state: plain object, no reactivity needed (the sim writes the DOM).
const sim = {
  dragging: false,
  didDrag: false,
  clicked: false, // once-per-pull guard: the switch clicks a single time per pull
  targetX: ANCHOR_X,
  targetY: REST_Y,
}

const pts = makeNodes()

const drop = ref(!props.noEntrance)
// One-shot guard so the drop's physics handoff fires once, even though endDrop
// can be reached from both animationend and the fallback timeout.
let dropDone = props.noEntrance

let raf = 0
let running = false
let prevT = 0
let prevDt = 0
let mounted = false

function render() {
  const last = pts.length - 1
  cordEl.value?.setAttribute('d', buildPath(pts))
  groupEl.value?.setAttribute(
    'transform',
    `translate(${(pts[last].x - ANCHOR_X).toFixed(2)} ${(pts[last].y - REST_Y).toFixed(2)})`,
  )
}

function step(now: number) {
  const { gravity, damping, iterations, sleepVelocity } = cfg.value
  const last = pts.length - 1
  const dt = prevT ? Math.min(0.04, Math.max(0.004, (now - prevT) / 1000)) : 1 / 60
  prevT = now
  const tc = prevDt > 0 ? dt / prevDt : 1
  // damping is a per-frame retention tuned at 60fps. On a high-refresh display
  // it would be applied ~2x as often per second and over-damp into slow motion;
  // normalise it to real time so the feel is identical at any refresh rate.
  const velCoef = tc * Math.pow(damping, dt * 60)
  const accCoef = dt * dt

  pts[last].fixed = sim.dragging

  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]
    if (p.fixed) continue
    const vx = p.x - p.ox
    const vy = p.y - p.oy
    p.ox = p.x
    p.oy = p.y
    p.x += vx * velCoef
    p.y += vy * velCoef + gravity * accCoef
  }
  pts[0].x = ANCHOR_X
  pts[0].y = 0
  if (sim.dragging) {
    pts[last].ox = pts[last].x
    pts[last].oy = pts[last].y
    pts[last].x = sim.targetX
    pts[last].y = sim.targetY
  }
  for (let k = 0; k < iterations; k++) {
    for (let i = 0; i < last; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.hypot(dx, dy) || 0.0001
      const diff = ((REST_SEG - dist) / dist) * 0.5
      const ox = dx * diff
      const oy = dy * diff
      if (!a.fixed) {
        a.x -= ox
        a.y -= oy
      }
      if (!b.fixed) {
        b.x += ox
        b.y += oy
      }
    }
  }
  prevDt = dt
  render()

  let speed = 0
  for (let i = 1; i < pts.length; i++) speed += Math.abs(pts[i].x - pts[i].ox) + Math.abs(pts[i].y - pts[i].oy)
  // speed sums per-frame displacements (smaller at high refresh), so scale the
  // threshold by dt*60 too, else high-refresh frames would sleep prematurely.
  if (!sim.dragging && speed < sleepVelocity * dt * 60) {
    render()
    running = false
    return
  }
  raf = requestAnimationFrame(step)
}

function wake() {
  if (running || !mounted) return
  running = true
  prevT = 0
  prevDt = 0
  raf = requestAnimationFrame(step)
}

// The "click" itself.
function doToggle() {
  emit('pull')
}

// A click / keypress simulates a real pull: the switch clicks and the rope
// yanks down then retracts under physics.
function scriptedPull() {
  doToggle()
  if (reduce.value) return
  pts[pts.length - 1].oy -= 22 // downward yank -> the rope recoils + settles
  wake()
}

// ---- pointer gestures (replaces motion's onPan) ----
let pan: { id: number; x: number; y: number } | null = null

function onPointerDown(e: PointerEvent) {
  if (reduce.value) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  pan = { id: e.pointerId, x: e.clientX, y: e.clientY }
  sim.didDrag = false
  sim.clicked = false // arm the switch for this pull
  knobEl.value?.setPointerCapture?.(e.pointerId)
}

function applyPan(offsetX: number, offsetY: number) {
  const { stretchMax, stretchToggle } = cfg.value
  const rx = offsetX
  const ry = REST_Y + offsetY
  const dist = Math.hypot(rx, ry) || 0.0001
  const maxD = REST_Y + stretchMax
  const k = dist > maxD ? maxD / dist : 1
  sim.targetX = ANCHOR_X + rx * k
  sim.targetY = ry * k
  // The "click": fire once the moment the pull crosses the actuation depth, like
  // a real pull-chain detenting mid-pull. Clamp the depth below the travel so
  // the click always lands while the knob is still moving.
  const clickAt = Math.min(stretchToggle, stretchMax - 1)
  if (!sim.clicked && dist - REST_Y >= clickAt) {
    sim.clicked = true
    doToggle()
  }
}

function onPointerMove(e: PointerEvent) {
  if (!pan) return
  const dx = e.clientX - pan.x
  const dy = e.clientY - pan.y
  if (!sim.dragging) {
    if (Math.hypot(dx, dy) < PAN_SLOP) return
    sim.dragging = true
    sim.didDrag = true
    wake()
  }
  applyPan(dx, dy)
}

function endPan() {
  if (!pan) return
  pan = null
  if (!sim.dragging) return
  const { maxVelocity } = cfg.value
  sim.dragging = false
  const p = pts[pts.length - 1]
  const vx = p.x - p.ox
  const vy = p.y - p.oy
  const v = Math.hypot(vx, vy)
  if (v > maxVelocity) {
    const k = maxVelocity / v
    p.ox = p.x - vx * k
    p.oy = p.y - vy * k
  }
  // Release: the cord retracts and settles under physics. The switch already
  // clicked mid-pull (applyPan), so there is deliberately no toggle here.
  wake()
  requestAnimationFrame(() => {
    sim.didDrag = false
  })
}

function onClick(e: MouseEvent) {
  if (sim.didDrag) return
  if (e.detail === 0) return
  scriptedPull()
}

function onKeydown(e: KeyboardEvent) {
  if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
    e.preventDefault()
    scriptedPull()
  }
}

// Finish the entrance exactly once, then kick the rope so it whips and settles
// with physics instead of stopping dead like a rigid stick.
function endDrop() {
  if (dropDone) return
  dropDone = true
  drop.value = false
  if (reduce.value) return
  // The css fall ends fast and AT rest position; hand its downward momentum to
  // the rope so it overshoots + bounces back, plus a lateral component so it
  // swings, all as ONE continuous settle.
  pts[pts.length - 1].oy -= 13 // continue the fall -> a single overshoot + bounce
  pts[pts.length - 1].ox -= 6 // lateral -> the subtle waddle
  wake()
}

function onAnimationEnd(e: AnimationEvent) {
  if (e.animationName !== 'pullcord-drop') return
  endDrop()
}

let dropTimer: number | undefined
let removeMqListener: (() => void) | undefined

onMounted(() => {
  mounted = true
  if (prefersReduced) {
    const onChange = (e: MediaQueryListEvent) => {
      reduce.value = e.matches
    }
    prefersReduced.addEventListener?.('change', onChange)
    removeMqListener = () => prefersReduced.removeEventListener?.('change', onChange)
  }
  render() // paint the resting rope; the CSS entrance slides the whole thing in
  // Fallback in case animationend never fires (reduced motion, or a tab
  // backgrounded mid-drop).
  if (!props.noEntrance) dropTimer = window.setTimeout(endDrop, 1700)
})

onBeforeUnmount(() => {
  mounted = false
  cancelAnimationFrame(raf)
  removeMqListener?.()
  if (dropTimer !== undefined) window.clearTimeout(dropTimer)
})

const wrapperStyle: CSSProperties = {
  position: 'fixed',
  top: 'var(--pullcord-top, 0px)',
  right: 'var(--pullcord-right, 7rem)',
  zIndex: 'var(--pullcord-z, 5)',
  width: `${W}px`,
  height: `${SVG_H}px`,
  pointerEvents: 'none',
}

const knobStyle: CSSProperties = {
  position: 'absolute',
  left: `${ANCHOR_X - HIT / 2}px`,
  top: `${REST_Y - HIT / 2}px`,
  width: `${HIT}px`,
  height: `${HIT}px`,
  padding: '0',
  border: 'none',
  background: 'transparent',
  cursor: 'grab',
  touchAction: 'none',
  pointerEvents: 'auto',
}
</script>

<template>
  <div class="pullcord" :class="className" :style="wrapperStyle">
    <!-- inner wrapper carries the drop-in transform, so the OUTER wrapper keeps
         a clean z-index and can stay occluded by a top bar -->
    <div :class="['pullcord-inner', { 'pullcord-inner--drop': drop }]" @animationend="onAnimationEnd">
      <svg
        :viewBox="`0 0 ${W} ${SVG_H}`"
        :width="W"
        :height="SVG_H"
        aria-hidden="true"
        style="overflow: visible"
      >
        <defs>
          <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="100%" stop-color="#e7e7ec" />
          </linearGradient>
          <filter :id="shadowId" x="-70%" y="-70%" width="240%" height="240%">
            <feDropShadow dx="0" dy="1.4" stdDeviation="1.5" flood-color="rgba(0,0,0,0.32)" />
          </filter>
        </defs>

        <path
          ref="cordEl"
          :d="INITIAL_PATH"
          stroke="var(--pullcord-ink, rgba(127, 127, 127, 0.45))"
          :stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
          vector-effect="non-scaling-stroke"
        />

        <g ref="groupEl">
          <g :filter="`url(#${shadowId})`">
            <circle
              :cx="ANCHOR_X"
              :cy="REST_Y"
              :r="KNOB_R"
              :fill="`url(#${gradientId})`"
              stroke="rgba(0,0,0,0.10)"
              :stroke-width="0.5"
            />
          </g>
        </g>
      </svg>

      <button
        ref="knobEl"
        type="button"
        class="pullcord-knob"
        :aria-label="ariaLabel"
        :aria-pressed="pulled"
        :title="ariaLabel"
        :style="knobStyle"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="endPan"
        @pointercancel="endPan"
        @click="onClick"
        @keydown="onKeydown"
      />
    </div>
  </div>
</template>
