// -----------------------------------------------------------------------------
// Tests never touch the network: `fetch` is replaced by a router answering the
// GBFS feed named in the URL, and recording every call.
// -----------------------------------------------------------------------------

import {
  stationInformationPayload,
  stationStatusPayload,
  vehicleTypesPayload,
} from './fixtures.js';

/**
 * Replace the global fetch for the duration of a test.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, unknown | ((url: URL) => unknown)>} [overrides]
 *   per feed ('station_status'...): a payload, a function of the URL, an
 *   Error to throw, or `{ status }` for an HTTP error
 * @returns {{ calls: URL[] }}
 */
export function stubFetch(t, overrides = {}) {
  const routes = {
    station_information: stationInformationPayload,
    vehicle_types: vehicleTypesPayload,
    station_status: () => stationStatusPayload(),
    ...overrides,
  };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const feed = url.pathname
      .split('/')
      .pop()
      .replace(/\.json$/, '');
    if (!(feed in routes)) return new Response('not found', { status: 404 });
    const route = routes[feed];
    const payload = typeof route === 'function' ? route(url) : route;
    if (payload instanceof Error) throw payload;
    if (payload && typeof payload === 'object' && 'status' in payload && !('data' in payload)) {
      return new Response('error', { status: payload.status });
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { calls };
}
