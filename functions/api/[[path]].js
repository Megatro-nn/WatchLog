// Cloudflare Pages Function. It sits between your website and TMDB so the secret
// TMDB key never appears in the browser. Every request to /api/tmdb/... lands here.

// Only these TMDB paths are allowed, so nobody can use your key for anything else.
const ALLOWED = [
  /^search\/(multi|movie|tv)$/,
  /^trending\/(all|movie|tv)\/(day|week)$/,
  /^(movie|tv)\/(popular|top_rated)$/,
  /^(movie|tv)\/\d+$/,
  /^tv\/\d+\/season\/\d+$/,
];
const ALLOWED_PARAMS = ['language', 'query', 'page', 'include_adult', 'append_to_response'];

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/tmdb\//, '');
  if (!ALLOWED.some((rule) => rule.test(path))) return json({ error: 'Not allowed' }, 404);

  const key = env.TMDB_KEY;
  if (!key) return json({ error: 'TMDB_KEY is not set on the server' }, 500);

  const target = new URL('https://api.themoviedb.org/3/' + path);
  for (const name of ALLOWED_PARAMS) {
    const value = url.searchParams.get(name);
    if (value === null) continue;
    if (name === 'append_to_response' && !/^[a-z_\/,]+$/.test(value)) continue;
    target.searchParams.set(name, value);
  }

  // TMDB gives two kinds of credentials. The long "Read Access Token" starts with eyJ
  // and goes in a header. The short "API Key" goes in the URL.
  const headers = { accept: 'application/json' };
  if (key.startsWith('eyJ')) headers.authorization = 'Bearer ' + key;
  else target.searchParams.set('api_key', key);

  let upstream;
  try {
    upstream = await fetch(target.toString(), { headers, cf: { cacheTtl: 3600, cacheEverything: true } });
  } catch (err) {
    return json({ error: 'Could not reach TMDB' }, 502);
  }

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': upstream.ok ? 'public, max-age=300' : 'no-store',
    },
  });
}
