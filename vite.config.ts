import process from 'node:process';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const host = process.env.TAURI_DEV_HOST;
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  server: {
    port: mode === 'acceptance' ? 1422 : 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/shared/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
      exclude: [
        'src/main.tsx',
        'src/**/*.d.ts',
        'src/shared/test/**',
        'src/modules/workspace/services/workspaceAdapters.ts',
      ],
    },
  },
}));
