# pullcord-vue

A ceiling pull-cord for **Vue 3**. The rope is a real verlet sim (nodes + distance
constraints), so it hangs under gravity, swings when you grab it and settles back
on its own. I use it as a theme switch.

This is a port of [`pullcord`](https://github.com/mortspace/pullcord) by
[@mortspace](https://github.com/mortspace). The physics, geometry, timing and CSS
are carried over unchanged; the React + `motion` plumbing is replaced with plain
Vue and native pointer events.

Everything runs in a single `requestAnimationFrame` loop that writes the DOM
through template refs, and the loop goes to sleep once the rope stops moving.
So an idle cord costs basically nothing.

## install

```bash
bun add pullcord-vue
# or: npm install pullcord-vue / pnpm add pullcord-vue / yarn add pullcord-vue
```

`vue >= 3.5` is a peer dependency (the port uses `useId()` for collision-free SVG
ids). No other runtime dependencies.

## usage

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { PullCord } from 'pullcord-vue'
import 'pullcord-vue/pullcord.css'

const dark = ref(true)
</script>

<template>
  <PullCord @pull="dark = !dark" :pulled="!dark" aria-label="Toggle theme" />
</template>
```

Mount it anywhere, it fixes itself to the top of the viewport. `pull` fires when
the pull crosses the detent depth — like a real pull-chain it clicks mid-pull,
not on release. Click and <kbd>Enter</kbd> work too, so it's keyboard friendly.

React-style props still work if you're porting an app, so the same options can
be passed as `:on-pull="fn"`:

```vue
<PullCord :on-pull="toggle" :pulled="light" />
```

`@pull` and `:on-pull` are two spellings of the same handler; pass one, not both.

## props

| prop          | type                          | default           | what it does                                                     |
| ------------- | ----------------------------- | ----------------- | ---------------------------------------------------------------- |
| `pulled`      | `boolean`                     | `false`           | mirrored to `aria-pressed` on the knob (e.g. "light is on")       |
| `ariaLabel`   | `string`                      | `'Pull the cord'` | accessible name for the knob button                              |
| `noEntrance`  | `boolean`                     | `false`           | skip the drop-in entrance and start at rest                      |
| `config`      | `Partial<PullCordConfig>`     | `{}`              | physics overrides, merged over the defaults, read every frame    |
| `className`   | `string`                      | —                 | extra class on the fixed wrapper (React-style alias)             |
| `onPull`      | `() => void`                  | —                 | React-style alias for the `pull` event                           |

Plain `class` works too — Vue merges it onto the fixed wrapper.

### events

| event  | payload | when                                                                                       |
| ------ | ------- | ------------------------------------------------------------------------------------------ |
| `pull` | —       | once per pull, the moment the pull crosses the actuation depth, and on click / <kbd>Enter</kbd> |

## the feel

All the physics knobs sit on the `config` prop and get read fresh every frame, so
you can change them live:

```vue
<PullCord
  :config="{
    gravity: 1250,   // hang tension / fall speed
    damping: 0.94,   // higher = snappier retract
    iterations: 20,  // rope stiffness
    stretchMax: 26,  // how deep you can pull
  }"
/>
```

The full list (actuation depth, velocity cap, sleep threshold…) lives in
[`src/config.ts`](src/config.ts) — every field has a comment.

## where it hangs

CSS vars on any ancestor:

```css
:root {
  --pullcord-top: 0px;
  --pullcord-right: 7rem;
  --pullcord-z: 5;
  --pullcord-ink: rgba(255, 255, 255, 0.24);
}
```

Respects `prefers-reduced-motion` (the drop-in and the pull gesture are
disabled; click / keyboard still toggle). MIT.

## differences from the React original

Same geometry (`64 × 340` viewBox), same rest length, same verlet solver, same
`damping` normalisation for high-refresh displays, same entrance curve and
fallback timer, same CSS file — the rope feels identical.

What changed:

- **No `motion` dependency.** Panning is `pointerdown` / `pointermove` /
  `pointerup` with pointer capture, plus a 3px slop before a press becomes a
  pull. `prefers-reduced-motion` is a `matchMedia` listener instead of
  `useReducedMotion`.
- **Per-instance SVG ids.** The original hard-codes `#pc-knob` / `#pc-knob-sh`;
  this port derives them from `useId()`, so two cords on one page can't steal
  each other's gradient and filter.
- **Vue lifecycle.** The rAF loop, entrance fallback timer and media-query
  listener are torn down in `onBeforeUnmount`.
- **`pull` event** replaces the `onPull` prop (which is still accepted).

## development

```bash
bun install
bun run dev        # demo app at http://localhost:5173
bun run test       # vitest + @vue/test-utils (jsdom)
bun run typecheck  # vue-tsc --noEmit
bun run build      # dist/index.js + dist/*.d.ts + dist/pullcord.css
```

## credits

Original component, physics and design: [pullcord](https://github.com/mortspace/pullcord)
MIT © iisac. This Vue port is MIT as well — see [LICENSE](LICENSE).
