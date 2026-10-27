<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { PullCord } from '../src'

const light = ref(false)
const pulls = ref(0)

watchEffect(() => {
  document.body.classList.toggle('light', light.value)
})

function toggle() {
  light.value = !light.value
  pulls.value++
}
</script>

<template>
  <main>
    <h1>{{ light ? 'lights on' : 'lights off' }}</h1>
    <p>
      pull the cord — {{ pulls }} {{ pulls === 1 ? 'pull' : 'pulls' }}
    </p>
    <p><code>&lt;PullCord @pull="toggle" :pulled="light" /&gt;</code></p>
  </main>

  <PullCord @pull="toggle" :pulled="light" aria-label="Toggle theme" />
</template>
