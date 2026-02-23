import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

const CIRCUITS_BUILD = path.resolve(__dirname, '../circuits/build')

/** Serve circuits/build at /circuits/build so board_commit.wasm and resolve_shot artifacts load in dev. */
function serveCircuitsBuild() {
  return {
    name: 'serve-circuits-build',
    configureServer(server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/circuits/build/')) return next()
        const subPath = decodeURIComponent(req.url.slice('/circuits/build/'.length).split('?')[0])
        const filePath = path.resolve(CIRCUITS_BUILD, subPath)
        if (!filePath.startsWith(path.resolve(CIRCUITS_BUILD)) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          return next()
        }
        const ext = path.extname(filePath)
        const ct = ext === '.wasm' ? 'application/wasm' : ext === '.json' ? 'application/json' : 'application/javascript'
        res.setHeader('Content-Type', ct)
        res.setHeader('Cache-Control', 'no-cache')
        fs.createReadStream(filePath).pipe(res)
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), serveCircuitsBuild()],
  // Load .env files from the parent directory (repo root)
  envDir: '..',
  define: {
    global: 'globalThis'
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      buffer: path.resolve(__dirname, './node_modules/buffer/')
    },
    dedupe: ['@stellar/stellar-sdk']
  },
  optimizeDeps: {
    include: ['@stellar/stellar-sdk', '@stellar/stellar-sdk/contract', '@stellar/stellar-sdk/rpc', 'buffer'],
    esbuildOptions: {
      define: {
        global: 'globalThis'
      }
    }
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true
    }
  },
  server: {
    port: 3000,
    open: true,
    fs: { allow: [path.resolve(__dirname, '..')] }
  }
})
