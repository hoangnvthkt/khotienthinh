import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const serviceWorkerSource = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

const runFetch = async (request: Request, response: Response) => {
  const handlers = new Map<string, (event: any) => void>();
  const cache = { put: vi.fn(async () => undefined) };
  const caches = {
    keys: vi.fn(async () => []),
    open: vi.fn(async () => cache),
    match: vi.fn(async () => undefined),
  };
  const fetch = vi.fn(async () => response);

  runInNewContext(serviceWorkerSource, {
    URL,
    Response,
    caches,
    console,
    fetch,
    self: {
      addEventListener: (eventName: string, handler: (event: any) => void) => handlers.set(eventName, handler),
      clients: { claim: vi.fn(), matchAll: vi.fn(async () => []) },
      location: { origin: 'https://vioo.test' },
    },
  });

  let responsePromise: Promise<Response> | undefined;
  handlers.get('fetch')?.({
    request,
    respondWith: (promise: Promise<Response>) => {
      responsePromise = promise;
    },
  });

  await responsePromise;
  await Promise.resolve();
  await Promise.resolve();

  return { cache, fetch };
};

describe('service worker asset cache', () => {
  it('does not cache HTML returned for a JavaScript asset URL', async () => {
    const result = await runFetch(
      new Request('https://vioo.test/assets/index-stale.js'),
      new Response('<!doctype html><html><body>App</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );

    expect(result.fetch).toHaveBeenCalledTimes(1);
    expect(result.cache.put).not.toHaveBeenCalled();
  });
});
