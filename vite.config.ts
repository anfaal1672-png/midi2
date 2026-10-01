import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readdirSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/** LICENSES/ 配下を dist/LICENSES/ に出力する（About 画面からリンク） */
function licenses(): Plugin {
  return {
    name: 'copy-licenses',
    generateBundle() {
      for (const f of readdirSync('LICENSES')) {
        this.emitFile({ type: 'asset', fileName: `LICENSES/${f}`, source: readFileSync(`LICENSES/${f}`) });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    preact(),
    licenses(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,json,mid}'],
        globIgnores: ['soundfonts/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        id: '/',
        name: 'MIDI Studio Player',
        short_name: 'MIDI Player',
        description: 'ブラウザだけで動く高機能 MIDI プレイヤー / Advanced in-browser MIDI player',
        lang: 'ja',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        background_color: '#0e1116',
        theme_color: '#0e1116',
        categories: ['music', 'entertainment'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        file_handlers: [
          {
            action: '/',
            accept: {
              'audio/midi': ['.mid', '.midi', '.smf', '.kar'],
              'audio/x-midi': ['.mid', '.midi'],
              'audio/rmid': ['.rmi'],
            },
          },
        ],
        share_target: {
          action: '/share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [
              { name: 'files', accept: ['audio/midi', 'audio/x-midi', '.mid', '.midi', '.kar', '.rmi'] },
            ],
          },
        },
      } as any,
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  worker: { format: 'es' },
});
