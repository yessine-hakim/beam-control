import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

export default defineConfig({
  plugins: [
    react(),
    // npm workspaces hoist cesium to the repo root.
    cesium({
      cesiumBuildRootPath: '../node_modules/cesium/Build',
      cesiumBuildPath: '../node_modules/cesium/Build/Cesium/',
      devMinifyCesium: true,
    }),
  ],
  // One Cesium engine for everything: the viewer and our entities must share
  // WebGL context limits (web/package.json pins the matching widgets/engine pair).
  resolve: { dedupe: ['@cesium/engine', '@cesium/widgets'] },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  test: { include: ['src/**/*.test.ts'] },
});
