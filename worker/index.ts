/// <reference types="@cloudflare/workers-types" />
// Demo worker. Two jobs:
//   1. /api/babyai/*  → proxy to https://novasynchris-babyai.hf.space*
//                       with HF_TOKEN attached server-side. Same shape
//                       as agicore-foundry's worker, minus telemetry.
//   2. everything else → ASSETS binding (Vite-built SPA in ./dist)
//
// Why this exists alongside functions/api/babyai/[[path]].ts:
// the project can deploy two ways. As a Cloudflare Pages project, the
// Pages Function handles the proxy and this worker is unused. As a
// Cloudflare Worker (with the ASSETS binding for the SPA), this
// worker handles the proxy and the functions/ directory is unused.
// Both reach the same upstream with the same shape; the chosen
// deployment model decides which file is live.

interface Env {
  ASSETS:   { fetch: (request: Request) => Promise<Response> };
  HF_TOKEN: string;
}

const HF_SPACE_BASE = "https://novasynchris-babyai.hf.space";
const PROXY_PREFIX  = "/api/babyai";

const ALLOWED_ORIGINS = new Set([
  "https://andon.binary-blender.com",
  "https://andon-loop-demo.chrisbender999.workers.dev",
  "https://andon-loop-demo.pages.dev",
  "http://localhost:5174",
  "http://localhost:4174",
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === PROXY_PREFIX || url.pathname.startsWith(PROXY_PREFIX + "/")) {
      return handleProxy(request, env, url);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleProxy(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") return preflight(request);

  // Tiny liveness probe — GET /api/babyai/ping → "pong". Confirms the
  // worker is reachable before troubleshooting the POST path.
  const suffix = url.pathname.slice(PROXY_PREFIX.length);
  if (request.method === "GET" && suffix === "/ping") {
    return new Response("pong", { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  const origin = request.headers.get("Origin");
  if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
    return new Response(`forbidden origin: ${origin}`, { status: 403 });
  }
  if (!env.HF_TOKEN) {
    return new Response("HF_TOKEN not configured on this deploy", { status: 503 });
  }

  const upstreamPath = suffix + url.search;
  const upstreamUrl  = HF_SPACE_BASE + upstreamPath;

  const upstreamHeaders = new Headers();
  upstreamHeaders.set("Authorization", `Bearer ${env.HF_TOKEN}`);
  const ct = request.headers.get("Content-Type");
  if (ct) upstreamHeaders.set("Content-Type", ct);
  const accept = request.headers.get("Accept");
  if (accept) upstreamHeaders.set("Accept", accept);

  // Buffer body to a string before forwarding — passing request.body
  // (a ReadableStream) through fetch() can hit a duplex requirement
  // in some Workers runtime versions, surfacing as upstream not seeing
  // the body. Demo payloads are a few KB max.
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

  // Diagnostic body for upstream non-2xx — surfaces where the failure
  // came from so the browser sees a useful error instead of an opaque
  // pass-through.
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

function preflight(request: Request): Response {
  const origin = request.headers.get("Origin");
  if (origin === null || !ALLOWED_ORIGINS.has(origin)) {
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
}
