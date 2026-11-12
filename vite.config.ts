import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true,
    // Runtime files and Office temporary files are not frontend source. Watching
    // them can crash Windows fs.watch when Word locks a file during rendering.
    watch: {
      ignored: ['**/data/**', '**/test-results/**', '**/playwright-report/**'],
      // Editors/formatters can truncate a file before writing its replacement.
      // Wait for the final contents so HMR cannot cache an empty stylesheet.
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 50 },
    },
    // Preserve the browser's host so the API can enforce same-origin writes.
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001',
        changeOrigin: false,
      },
    },
  },
  build: { chunkSizeWarningLimit: 1000 },
});
