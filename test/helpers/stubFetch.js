// -----------------------------------------------------------------------------
// Tests never touch the network: `fetch` is replaced by a router answering the
// GBFS feed named in the URL (or with a plain tile for OpenStreetMap), and
// recording every call.
// -----------------------------------------------------------------------------

import sharp from 'sharp';
import {
  stationInformationPayload,
  stationStatusPayload,
  vehicleTypesPayload,
} from './fixtures.js';

/** A plain 256 px tile, as OpenStreetMap serves them (PNG). */
export const TILE_PNG = await sharp({
  create: { width: 256, height: 256, channels: 3, background: '#f2efe9' },
})
  .png()
  .toBuffer();

/**
 * Replace the global fetch for the duration of a test.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, unknown | ((url: URL) => unknown)>} [overrides]
 *   per feed ('station_status'...): a payload, a function of the URL, an
 *   Error to throw, or `{ status }` for an HTTP error; 'tile' for the
 *   OpenStreetMap tiles (a Buffer, an Error or `{ status }`)
 * @returns {{ calls: URL[] }}
 */
export function stubFetch(t, overrides = {}) {
  const routes = {
    station_information: stationInformationPayload,
    vehicle_types: vehicleTypesPayload,
    tile: TILE_PNG,
    station_status: () => stationStatusPayload(),
    ...overrides,
  };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.host === 'tile.openstreetmap.org') {
      const tile = typeof routes.tile === 'function' ? routes.tile(url) : routes.tile;
      if (tile instanceof Error) throw tile;
      if (!Buffer.isBuffer(tile)) return new Response('error', { status: tile.status });
      return new Response(tile, { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
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
