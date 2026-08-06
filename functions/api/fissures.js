const FISSURES_URL = 'https://api.warframestat.us/pc/fissures'
const CACHE_TTL_SECONDS = 60

export async function onRequestGet(context) {
  const cacheKey = new Request(new URL('/api/fissures', context.request.url).toString(), {
    method: 'GET',
  })
  const cached = await caches.default.match(cacheKey)

  if (cached) {
    const response = new Response(cached.body, cached)
    response.headers.set('X-Cache-Status', 'HIT')
    return response
  }

  try {
    const upstream = await fetch(FISSURES_URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Eevee Warframe Relic Helper',
      },
    })

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Fissure data request failed with ${upstream.status}.` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    }

    const response = new Response(upstream.body, {
      status: 200,
      headers: {
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
        'Content-Type': 'application/json; charset=utf-8',
        'X-Cache-Status': 'MISS',
      },
    })

    context.waitUntil(caches.default.put(cacheKey, response.clone()))
    return response
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unable to load fissure data.',
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
}
