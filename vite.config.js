import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GRAPHS_DIR = path.resolve(__dirname, 'saved_graphs')

const safeName = (name) =>
  String(name || '').trim().replace(/[^A-Za-z0-9_\- ]/g, '').replace(/\s+/g, '_').slice(0, 80)

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks).toString('utf-8')
}

const send = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function savedGraphsPlugin() {
  return {
    name: 'saved-graphs-api',
    configureServer(server) {
      server.middlewares.use('/api/graphs', async (req, res) => {
        try {
          await fs.mkdir(GRAPHS_DIR, { recursive: true })
          const url = decodeURIComponent(req.url || '/')

          if (req.method === 'GET' && (url === '/' || url === '')) {
            const files = await fs.readdir(GRAPHS_DIR)
            const graphs = files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort()
            return send(res, 200, { graphs })
          }

          const m = url.match(/^\/([^/?]+)\/?$/)
          if (!m) return send(res, 404, { error: 'not found' })
          const name = safeName(m[1])
          if (!name) return send(res, 400, { error: 'invalid name' })
          const file = path.join(GRAPHS_DIR, `${name}.json`)

          if (req.method === 'GET') {
            try {
              const content = await fs.readFile(file, 'utf-8')
              return send(res, 200, JSON.parse(content))
            } catch {
              return send(res, 404, { error: 'not found' })
            }
          }
          if (req.method === 'PUT' || req.method === 'POST') {
            const body = await readBody(req)
            let parsed
            try { parsed = JSON.parse(body) } catch { return send(res, 400, { error: 'invalid json' }) }
            const payload = {
              name,
              algebra: typeof parsed.algebra === 'string' ? parsed.algebra : null,
              items: Array.isArray(parsed.items) ? parsed.items : [],
              hash: typeof parsed.hash === 'string' ? parsed.hash : null,
              savedAt: new Date().toISOString(),
            }
            await fs.writeFile(file, JSON.stringify(payload, null, 2))
            return send(res, 200, { name })
          }
          if (req.method === 'DELETE') {
            try { await fs.unlink(file) } catch {}
            return send(res, 200, { name })
          }
          send(res, 405, { error: 'method not allowed' })
        } catch (e) {
          send(res, 500, { error: String(e) })
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), savedGraphsPlugin()],
})
