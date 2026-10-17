import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    envPrefix: ['VITE_', 'NETWORK_MODE'],
    plugins: [react()],
    resolve: {
      alias: [
        { find: '@', replacement: path.resolve(__dirname, './src') },
        { find: /^tone$/, replacement: path.resolve(__dirname, './src/lib/daw/tone.ts') },
      ],
    },
    server: {
      port: 3001,
      proxy: {
        '/api': {
          target: (env.VITE_API_URL || 'http://api.rawchunks.space').replace(/^https:\/\/api\.rawchunks\.space/, 'http://api.rawchunks.space'),
          changeOrigin: true,
          secure: false,
          timeout: 120000,
          proxyTimeout: 120000,
        },
      },
    },
  };
});
