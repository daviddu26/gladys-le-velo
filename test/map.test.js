import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { validateWidgetImage } from '@gladysassistant/integration-sdk';
import { fitView, HEIGHT, project, renderMap, WIDTH } from '../src/map.js';
import './helpers/fixtures.js';
import { stubFetch } from './helpers/stubFetch.js';

const HOUSE = { lat: 44.83803, lon: -0.58437 };
const STATIONS = [
  { lat: 44.83784, lon: -0.59028, color: 'success', parts: [{ icon: 'bike', text: '7' }] },
  {
    lat: 44.840813,
    lon: -0.593233,
    color: 'warning',
    parts: [
      { icon: 'bike', text: '2' },
      { icon: 'bolt', text: '1' },
    ],
  },
];

const tilesDir = () => join(process.env.VELO_DATA_DIR, 'tiles');
const tileCalls = (calls) => calls.filter((url) => url.host === 'tile.openstreetmap.org');

beforeEach(async () => {
  await rm(tilesDir(), { recursive: true, force: true });
});

test('projection: Bordeaux at zoom 17 is in tile 65323', () => {
  const { x } = project(HOUSE, 17);
  assert.equal(Math.floor(x / 256), 65323);
});

test('the view fits every point with room for the pills', () => {
  const points = [HOUSE, ...STATIONS];
  const view = fitView(points);
  assert.ok(view.zoom >= 12 && view.zoom <= 17);
  for (const point of points) {
    const p = project(point, view.zoom);
    const x = p.x - view.left;
    const y = p.y - view.top;
    assert.ok(x >= 90 && x <= WIDTH - 90, `x ${x}`);
    assert.ok(y >= 80 && y <= HEIGHT - 35, `y ${y}`);
  }
  // Far apart points: a smaller zoom.
  assert.ok(fitView([HOUSE, { lat: 44.88, lon: -0.52 }]).zoom < view.zoom);
});

test('the map is a JPEG Gladys accepts; the tiles are downloaded once', async (t) => {
  const { calls } = stubFetch(t);
  const image = await renderMap({ house: HOUSE, stations: STATIONS });
  assert.deepEqual(validateWidgetImage(image.toString('base64')), []);
  const meta = await sharp(image).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', WIDTH, HEIGHT]);
  const downloads = tileCalls(calls).length;
  assert.ok(downloads >= 4 && downloads <= 12, `${downloads} tiles`);
  assert.equal((await readdir(tilesDir())).length, downloads);

  await renderMap({ house: HOUSE, stations: STATIONS });
  assert.equal(tileCalls(calls).length, downloads);
  // The User-Agent names the integration, as OpenStreetMap asks.
  const [, init] = globalThis.fetch.mock.calls.find(
    (call) => new URL(String(call.arguments[0])).host === 'tile.openstreetmap.org',
  ).arguments;
  assert.match(init.headers['User-Agent'], /^gladys-le-velo\//);
});

test('without tiles, the map is still drawn, on a plain background', async (t) => {
  stubFetch(t, { tile: { status: 403 } });
  const image = await renderMap({ house: null, stations: STATIONS });
  assert.deepEqual(validateWidgetImage(image.toString('base64')), []);
});
