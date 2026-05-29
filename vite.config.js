import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tmpdir } from 'os';
import { join } from 'path';

export default defineConfig({
  // GitHub Pages の公開先 https://moyorieki.github.io/srpg1/ に合わせる
  base: '/srpg1/',
  plugins: [react()],
  server: { port: 3000 },
  cacheDir: join(tmpdir(), 'srpg-proto-vite'),
});
