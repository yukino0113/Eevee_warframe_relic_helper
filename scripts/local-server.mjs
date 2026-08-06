import { createServer } from 'vite'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const port = Number(process.env.PORT ?? 5173)
const appData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
const inventoryPath = join(appData, 'AlecaFrame', 'lastData.dat')
const fissuresUrl = 'https://api.warframestat.us/pc/fissures'
const fissuresCacheTtlMs = 60_000
let fissuresCache

const localInventoryPlugin = {
  name: 'local-alecaframe-inventory',
  configureServer(server) {
    server.middlewares.use('/api/fissures', async (request, response, next) => {
      if (request.method !== 'GET') {
        next()
        return
      }

      try {
        const now = Date.now()
        if (fissuresCache && fissuresCache.expiresAt > now) {
          response.statusCode = 200
          response.setHeader('Cache-Control', 'public, max-age=60')
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('X-Cache-Status', 'HIT')
          response.end(fissuresCache.contents)
          return
        }

        const upstream = await fetch(fissuresUrl, { headers: { Accept: 'application/json' } })
        if (!upstream.ok) throw new Error(`Fissure data request failed with ${upstream.status}.`)
        const contents = await upstream.text()
        fissuresCache = { contents, expiresAt: now + fissuresCacheTtlMs }
        response.statusCode = 200
        response.setHeader('Cache-Control', 'public, max-age=60')
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('X-Cache-Status', 'MISS')
        response.end(contents)
      } catch (error) {
        response.statusCode = 502
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to load fissure data.' }))
      }
    })

    server.middlewares.use('/api/local-inventory', (request, response, next) => {
      if (request.method !== 'GET') {
        next()
        return
      }

      try {
        const file = statSync(inventoryPath)
        const contents = readFileSync(inventoryPath)
        response.statusCode = 200
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Content-Type', 'application/octet-stream')
        response.setHeader('Content-Length', String(contents.byteLength))
        response.setHeader('X-Inventory-Name', 'lastData.dat')
        response.setHeader('X-Inventory-Last-Modified', String(file.mtimeMs))
        response.end(contents)
      } catch {
        response.statusCode = 404
        response.end()
      }
    })
  },
}

const server = await createServer({
  plugins: [localInventoryPlugin],
  server: { host: 'localhost', port },
})

await server.listen()
server.printUrls()
