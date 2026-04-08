import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { version } from './package.json'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  base: './',
  build: {
    outDir: 'renderer',
    // Split large dependencies into separate chunks for better caching
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three/')) return 'three'
          if (id.includes('@react-three/fiber') || id.includes('@react-three/drei')) return 'r3f'
          if (id.includes('postprocessing') || id.includes('@react-three/postprocessing')) return 'postprocessing'
        },
      },
    },
    sourcemap: false,
  },
})
