import { defineConfig, loadEnv } from 'vite';

/**
 * Cesium's runtime assets are staged into public/cesium by
 * scripts/sync-cesium.mjs (postinstall + prebuild), and index.html points
 * CESIUM_BASE_URL at that path. Nothing bundler-specific is required.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = process.env.PROXY_ORIGIN || env.PROXY_ORIGIN || 'http://127.0.0.1:8787';
  const apiProxy = { '/api': { target: proxyTarget, changeOrigin: true, ws: true } };

  return {
    server: {
      port: Number(env.PORT_WEB || 4173),
      strictPort: false,
      proxy: apiProxy,
    },
    preview: {
      port: Number(env.PORT_WEB || 4173),
      proxy: apiProxy,
    },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 4096,
      sourcemap: mode !== 'production',
    },
  };
});
