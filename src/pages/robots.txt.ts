/*
  /robots.txt — the route. Every argument lives in `lib/robots.ts`; this file
  only turns a request into a response.

  ⚠ NO CACHE HEADER, AND THAT IS A CHOICE. The body depends on the request's
  own host, and a shared cache keyed on path alone could hand the `.blog`
  answer to a `.vercel.app` request — which is the exact defect this route
  exists to close, arriving through the CDN instead. It is two lines of text
  generated with no database read; there is nothing here worth caching.
*/
import type { APIRoute } from 'astro';
import { robotsBody } from '../lib/robots';

export const GET: APIRoute = ({ url }) =>
  new Response(robotsBody(url.host, url.origin), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
