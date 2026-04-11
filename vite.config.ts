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
  server: {
    // Project lives on Google Drive (G:\My Drive\...). Native file events from
    // chokidar hit EINVAL on partially-synced files and crash the dev server.
    // Use polling so the watcher never touches lstat on those bad paths.
    watch: {
      usePolling: true,
      interval: 600,
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/release/**',
        '**/renderer/**',
        '**/dist/**',
      ],
    },
  },
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
