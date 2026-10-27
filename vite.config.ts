import { copyFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [
    vue(),
    {
      // the stylesheet ships alongside, imported by consumers via 'pullcord-vue/pullcord.css'
      name: 'pullcord-copy-css',
      closeBundle() {
        copyFileSync('pullcord.css', 'dist/pullcord.css')
      },
    },
  ],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: ['vue'],
    },
    sourcemap: true,
  },
})
