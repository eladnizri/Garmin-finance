/* Cloudflare Worker — thin CORS proxy for the Garmin Personal API.
 *
 * Forwards requests from the PWA to apis.garmin.com, adding CORS headers.
 * The Bearer token travels in the Authorization header from the client;
 * the worker never stores or logs it.
 *
 * Deploy: wrangler deploy
 * Env: ALLOWED_ORIGIN (optional, defaults to '*')
 */

const GARMIN = 'https://apis.garmin.com';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return handleCors(request, env);

    const url = new URL(request.url);
    const target = url.pathname + url.search;

    const garminRes = await fetch(`${GARMIN}${target}`, {
      method: request.method,
      headers: passHeaders(request),
      body: request.method === 'POST' ? await request.text() : undefined,
    });

    const res = new Response(garminRes.body, {
      status: garminRes.status,
      statusText: garminRes.statusText,
      headers: garminRes.headers,
    });
    setCors(res, env);
    return res;
  },
};

function passHeaders(request) {
  const h = new Headers();
  for (const key of ['authorization', 'content-type', 'accept']) {
    const v = request.headers.get(key);
    if (v) h.set(key, v);
  }
  return h;
}

function handleCors(request, env) {
  const res = new Response(null, { status: 204 });
  setCors(res, env);
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
  res.headers.set('Access-Control-Max-Age', '86400');
  return res;
}

function setCors(res, env) {
  const origin = (env && env.ALLOWED_ORIGIN) || '*';
  res.headers.set('Access-Control-Allow-Origin', origin);
}
