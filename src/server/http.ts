import 'server-only';

import { NotFound } from './store';

/** Runs a route handler body, turning thrown errors into JSON responses. */
export async function respond(fn: () => unknown | Promise<unknown>): Promise<Response> {
  try {
    const result = await fn();
    return result instanceof Response ? result : Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const status = e instanceof NotFound || (e as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400;
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
