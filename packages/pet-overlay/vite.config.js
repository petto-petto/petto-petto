import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' 로 두어야 Electron이 file://dist/index.html 을 로드할 때 자산 경로가 맞는다.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
