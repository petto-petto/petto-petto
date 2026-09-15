import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

// base './' 로 두어야 Electron이 file://dist/index.html 을 로드할 때 자산 경로가 맞는다.
export default defineConfig({
  plugins: [react()],
  base: './',
  // 앱 renderer의 에셋을 단일 원본으로 사용한다. Vite가 개발 서버와 dist에 그대로 제공한다.
  publicDir: resolve(import.meta.dirname, '../../apps/desktop/renderer/assets'),
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
