/// <reference types="@cloudflare/workers-types" />
// Pages Function — proxies /api/babyai/* to the BabyAI HF Space with
// the demo's HF_TOKEN attached server-side. Mirrors agicore-foundry's
// worker proxy, minus the telemetry + admin dashboard (out of scope
// for a tech demo).
//
// Why a proxy at all: lets the Bundle of Babies "just work" with no
// BYOK from the user. The HF token never reaches the browser. Demo
// users open the page and the AI responder is alive immediately.
//
// Deploy: Cloudflare Pages auto-runs everything under /functions as
// a Worker bound to the matching route. The HF_TOKEN secret is set
// on the Pages project (dashboard → Settings → Environment variables
// → encrypt the value).
//
// Smoke test after deploy:
//   curl https://<your-pages-host>/api/babyai/ping
//   → should return "pong" with 200. If it 404s or 405s, the
//     function isn't deployed yet — trigger a redeploy.

interface Env {
  HF_TOKEN: string;
}

const HF_SPACE_BASE = "https://novasynchris-babyai.hf.space";
const PROXY_PREFIX  = "/api/babyai";

// Same-origin requests carry no Origin header in some browsers but
// fetch() always sends one for CORS-relevant requests. Allowlist is
// the demo's own origins — adjust when the production domain lands.
// Curl / non-browser clients can still hit the endpoint; this is
// trivial abuse-prevention, not a security boundary.
const ALLOWED_ORIGINS = new Set([
  "https://andon.binary-blender.com",
  "https://andon-loop-demo.pages.dev",
  "http://localhost:5174",
  "http://localhost:4174",
]);

// ─── Method-specific handlers ───────────────────────────────────────────────
//
// Pages Functions resolve method-specific exports first, then fall
// back to `onRequest`. Being explicit removes any ambiguity about
// whether POST is supported — a generic `onRequest` has been observed
// to surface as 405 in some routing edge cases.

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  return proxyToHf(ctx);
};

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  // Tiny liveness probe: /api/babyai/ping → "pong". Confirms the
  // function is deployed before troubleshooting the POST path.
  const url = new URL(ctx.request.url);
  const suffix = url.pathname.slice(PROXY_PREFIX.length);
  if (suffix === "/ping") {
    return new Response("pong", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return proxyToHf(ctx);
};

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  const origin = request.headers.get("Origin");
  if (origin === null || !ALLOWED_ORIGINS.has(origin)) {
    // Same-origin requests can omit Origin; allow preflight in that case.
    return new Response(null, { status: 204 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin":  origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
      "Access-Control-Max-Age":       "86400",
      "Vary":                         "Origin",
    },
  });
};

// ─── The proxy itself ───────────────────────────────────────────────────────

async function proxyToHf(ctx: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const { request, env } = ctx;
  const url = new URL(request.url);

  const origin = request.headers.get("Origin");
  if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
    return new Response(`forbidden origin: ${origin}`, { status: 403 });
  }
  if (!env.HF_TOKEN) {
    return new Response("HF_TOKEN not configured on this deploy", { status: 503 });
  }

  const upstreamPath = url.pathname.slice(PROXY_PREFIX.length) + url.search;
  const upstreamUrl  = HF_SPACE_BASE + upstreamPath;

  const upstreamHeaders = new Headers();
  upstreamHeaders.set("Authorization", `Bearer ${env.HF_TOKEN}`);
  const ct = request.headers.get("Content-Type");
  if (ct) upstreamHeaders.set("Content-Type", ct);
  const accept = request.headers.get("Accept");
  if (accept) upstreamHeaders.set("Accept", accept);

  // Read the body to a string before forwarding. Passing request.body
  // (a ReadableStream) through fetch() can hit a duplex requirement
  // in some Workers runtime versions, surfacing as a generic 5xx or
  // an upstream that doesn't see the body. Buffering to text is safe
  // for the demo's payload sizes (a few KB max).
  let bodyText: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    bodyText = await request.text();
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method:  request.method,
      headers: upstreamHeaders,
      body:    bodyText,
    });
  } catch (e) {
    return new Response(
      `[proxy] upstream fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      { status: 502 },
    );
  }

  // Diagnostic body for upstream non-2xx — surfaces the upstream URL +
  // status + body to the browser instead of silently passing them
  // through, so it's obvious whether the 4xx/5xx is from upstream or
  // from this function.
  if (!upstream.ok) {
    const upstreamBody = await upstream.text();
    const diagnostic =
      `[proxy] upstream ${upstream.status} from ${upstreamUrl}\n` +
      `[proxy] upstream body: ${upstreamBody.slice(0, 1000)}`;
    return new Response(diagnostic, {
      status: upstream.status,
      headers: {
        "Content-Type":      "text/plain",
        "X-Upstream-Url":    upstreamUrl,
        "X-Upstream-Status": String(upstream.status),
      },
    });
  }

  const headers = new Headers(upstream.headers);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  headers.set("X-Upstream-Url",    upstreamUrl);
  headers.set("X-Upstream-Status", String(upstream.status));
  return new Response(upstream.body, {
    status:     upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
