import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Needed for Solana wallet adapter
      include: ['buffer', 'crypto', 'stream', 'util', 'events', 'process'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  define: {
    'process.env': {},
  },
  resolve: {
    alias: {
      // Fix for some wallet adapter packages
      'stream': 'stream-browserify',
    },
  },
  server: {
    proxy: {
      // Proxy API calls to relayer in dev — eliminates CORS issues
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/claim': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/deposits': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/pool-info': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/info': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/debug': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Manual chunks for better caching and smaller initial load
    rollupOptions: {
      output: {
        manualChunks: {
          // Solana libraries - large but stable, cached well
          'solana': [
            '@solana/web3.js',
            '@solana/wallet-adapter-base',
            '@solana/wallet-adapter-react',
            '@solana/wallet-adapter-react-ui',
          ],
          // Animation and UI libraries
          'vendor-ui': [
            'framer-motion',
            'react-hot-toast',
            'qrcode.react',
          ],
          // React core
          'vendor-react': [
            'react',
            'react-dom',
          ],
        },
      },
    },
    // Increase warning limit since Solana libs are inherently large
    chunkSizeWarningLimit: 600,
  },
})
