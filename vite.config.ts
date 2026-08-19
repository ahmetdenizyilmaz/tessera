import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

// Build stamp so the app can show exactly which build is running — the version
// alone never changes between rebuilds, so the short git hash is what tells a
// promoted stable build apart from an older one.
const pkgVersion = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')).version;
let gitHash = 'nogit';
try {
  gitHash = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
} catch {
  // not a git checkout — leave the placeholder
}
const buildTime = new Date().toISOString();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __BUILD_HASH__: JSON.stringify(gitHash),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    hmr: {
      port: 1421,
    },
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          pixi: ['pixi.js'],
          recharts: ['recharts'],
          highlight: ['react-syntax-highlighter', 'highlight.js'],
          xterm: [
            '@xterm/xterm',
            '@xterm/addon-fit',
            '@xterm/addon-search',
            '@xterm/addon-serialize',
            '@xterm/addon-web-links',
          ],
        },
      },
    },
  },
});
