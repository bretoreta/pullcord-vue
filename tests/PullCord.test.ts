import { describe, expect, it, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, h } from 'vue'
import { PullCord } from '../src'

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms))

/** jsdom's HTMLElement#click() produces a detail === 0 event, which the
 *  component (correctly) treats as keyboard/synthetic rather than a pointer
 *  click. Real pointer clicks carry detail >= 1. */
function click(el: Element, detail = 1) {
  el.dispatchEvent(new MouseEvent('click', { detail, bubbles: true, cancelable: true }))
}

function restoreMatchMedia() {
  // @ts-expect-error -- deleting the stub restores jsdom's undefined matchMedia
  delete window.matchMedia
}

afterEach(() => {
  restoreMatchMedia()
  vi.restoreAllMocks()
})

describe('PullCord (vue)', () => {
  it('renders an accessible knob and mirrors `pulled` to aria-pressed', async () => {
    const wrapper = mount(PullCord, { props: { ariaLabel: 'Toggle theme' } })
    const knob = wrapper.get('.pullcord-knob')

    expect(knob.attributes('aria-label')).toBe('Toggle theme')
    expect(knob.attributes('title')).toBe('Toggle theme')
    expect(knob.attributes('type')).toBe('button')
    expect(knob.attributes('aria-pressed')).toBe('false')

    await wrapper.setProps({ pulled: true })
    expect(knob.attributes('aria-pressed')).toBe('true')

    wrapper.unmount()
  })

  it('emits `pull` on a pointer click', async () => {
    const wrapper = mount(PullCord, { props: { noEntrance: true } })
    click(wrapper.get('.pullcord-knob').element)
    await nextTick()

    expect(wrapper.emitted('pull')).toHaveLength(1)
    wrapper.unmount()
  })

  it('supports the React-style onPull prop', async () => {
    const onPull = vi.fn()
    const wrapper = mount(PullCord, { props: { noEntrance: true, onPull } })

    click(wrapper.get('.pullcord-knob').element)
    await nextTick()

    expect(onPull).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('ignores keyboard-synthesized clicks and handles Enter / Space itself', async () => {
    const wrapper = mount(PullCord, { props: { noEntrance: true } })
    const knob = wrapper.get('.pullcord-knob')

    // browsers fire a detail === 0 click after Enter; it must not double-fire
    click(knob.element, 0)
    expect(wrapper.emitted('pull')).toBeUndefined()

    await knob.trigger('keydown', { key: 'Enter' })
    await knob.trigger('keydown', { key: ' ' })
    await knob.trigger('keydown', { key: 'Enter', repeat: true })

    expect(wrapper.emitted('pull')).toHaveLength(2)
    wrapper.unmount()
  })

  it('fires once mid-pull when the drag crosses the detent, not on release', async () => {
    const wrapper = mount(PullCord, {
      props: { noEntrance: true, config: { stretchToggle: 20, stretchMax: 26 } },
    })
    const knob = wrapper.get('.pullcord-knob')

    await knob.trigger('pointerdown', { pointerId: 1, clientX: 500, clientY: 100, button: 0 })
    // below the detent: nothing yet
    await knob.trigger('pointermove', { pointerId: 1, clientX: 500, clientY: 110 })
    expect(wrapper.emitted('pull')).toBeUndefined()

    // past the detent: one click, mid-pull
    await knob.trigger('pointermove', { pointerId: 1, clientX: 500, clientY: 140 })
    expect(wrapper.emitted('pull')).toHaveLength(1)

    // keep pulling: still just the one click for this pull
    await knob.trigger('pointermove', { pointerId: 1, clientX: 500, clientY: 190 })
    await knob.trigger('pointermove', { pointerId: 1, clientX: 500, clientY: 40 })
    expect(wrapper.emitted('pull')).toHaveLength(1)

    // releasing never toggles
    await knob.trigger('pointerup', { pointerId: 1 })
    expect(wrapper.emitted('pull')).toHaveLength(1)

    wrapper.unmount()
  })

  it('swallows the click that follows a drag', async () => {
    const wrapper = mount(PullCord, { props: { noEntrance: true } })
    const knob = wrapper.get('.pullcord-knob')

    await knob.trigger('pointerdown', { pointerId: 1, clientX: 500, clientY: 100, button: 0 })
    await knob.trigger('pointermove', { pointerId: 1, clientX: 500, clientY: 106 })
    await knob.trigger('pointerup', { pointerId: 1 })
    click(knob.element)

    expect(wrapper.emitted('pull')).toBeUndefined()
    wrapper.unmount()
  })

  it('disables pulling (not clicking) under prefers-reduced-motion', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    })

    const wrapper = mount(PullCord, { props: { noEntrance: true } })
    const knob = wrapper.get('.pullcord-knob')

    await knob.trigger('pointerdown', { pointerId: 1, clientX: 500, clientY: 100, button: 0 })
    await knob.trigger('pointermove', { pointerId: 1, clientX: 500, clientY: 160 })
    expect(wrapper.emitted('pull')).toBeUndefined()

    click(knob.element)
    expect(wrapper.emitted('pull')).toHaveLength(1)

    wrapper.unmount()
  })

  it('runs the entrance by default and skips it with noEntrance', async () => {
    const animated = mount(PullCord)
    expect(animated.get('.pullcord-inner').classes()).toContain('pullcord-inner--drop')

    // animationend hands over to the physics and removes the class for good
    await animated.get('.pullcord-inner').trigger('animationend', { animationName: 'pullcord-drop' })
    expect(animated.get('.pullcord-inner').classes()).not.toContain('pullcord-inner--drop')
    animated.unmount()

    const still = mount(PullCord, { props: { noEntrance: true } })
    expect(still.get('.pullcord-inner').classes()).not.toContain('pullcord-inner--drop')
    still.unmount()
  })

  it('animates the rope away from rest after a pull', async () => {
    const wrapper = mount(PullCord, { props: { noEntrance: true } })
    const restPath = wrapper.get('path').attributes('d')

    click(wrapper.get('.pullcord-knob').element)
    await tick(50)

    expect(wrapper.get('path').attributes('d')).not.toBe(restPath)
    wrapper.unmount()
  })

  it('gives each instance its own SVG defs ids', () => {
    // one app, two cords: ids must stay unique so one cord's gradient never
    // hijacks the other's knob
    const wrapper = mount({
      render: () => h('div', [h(PullCord, { noEntrance: true }), h(PullCord, { noEntrance: true })]),
    })

    const gradients = wrapper.findAll('linearGradient')
    const filters = wrapper.findAll('filter')
    const circles = wrapper.findAll('circle')
    const idA = { gradient: gradients[0].attributes('id'), filter: filters[0].attributes('id') }
    const idB = { gradient: gradients[1].attributes('id'), filter: filters[1].attributes('id') }

    expect(idA.gradient).not.toBe(idB.gradient)
    expect(idA.filter).not.toBe(idB.filter)
    // and the shapes actually reference their own instance's defs
    expect(circles[0].attributes('fill')).toBe(`url(#${idA.gradient})`)
    expect(circles[1].attributes('fill')).toBe(`url(#${idB.gradient})`)

    wrapper.unmount()
  })

  it('merges config overrides with the defaults, live', async () => {
    const wrapper = mount(PullCord, { props: { noEntrance: true, config: { stretchToggle: 4 } } })
    const knob = wrapper.get('.pullcord-knob')

    await knob.trigger('pointerdown', { pointerId: 1, clientX: 500, clientY: 100, button: 0 })
    await knob.trigger('pointermove', { pointerId: 1, clientX: 500, clientY: 106 })
    expect(wrapper.emitted('pull')).toHaveLength(1)

    wrapper.unmount()
  })
})
