import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' so the built site can be served from any sub-path or opened as static files.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
  plugins: [react()],
  test: {
    environment: 'node',
  },
});
