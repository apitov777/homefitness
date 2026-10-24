import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        name: 'Homefitness — dieta da família',
        short_name: 'Homefitness',
        description: 'Refeições, metas e exames da família',
        lang: 'pt-BR',
        display: 'standalone',
        id: '.',
        start_url: '.',
        scope: '.',
        orientation: 'portrait',
        categories: ['health', 'food', 'lifestyle'],
        // Android: link de convite aberto com o app instalado cai no app que já está aberto.
        launch_handler: { client_mode: ['navigate-existing', 'auto'] },
        background_color: '#f6f5f1',
        theme_color: '#2f6b4f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // O app abre offline; os dados vêm sempre do Supabase.
        navigateFallback: 'index.html',
        importScripts: ['push-sw.js'],
        globPatterns: ['**/*.{js,css,html,png,svg}'],
      },
    }),
  ],
})
