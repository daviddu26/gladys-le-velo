import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { clearWalkingCache, estimateMinutes, formatWalk, walkingTimes } from '../src/api/walk.js';
import { NOW } from './helpers/fixtures.js';
import { stubFetch } from './helpers/stubFetch.js';

const HOUSE = { lat: 44.83803, lon: -0.58437 };
const STATIONS = [
  { id: '2', lat: 44.83784, lon: -0.59028 },
  { id: '3', lat: 44.840813, lon: -0.593233 },
];
const asked = (calls) => calls.filter((url) => url.host === 'api.transitous.org');

beforeEach(async () => {
  clearWalkingCache();
  await rm(join(process.env.VELO_DATA_DIR, 'walking.json'), { force: true });
});

test('the estimate: the straight line lengthened by 30 %, at 80 m a minute', () => {
  // 466 m → 606 m on the streets → 8 minutes.
  assert.equal(estimateMinutes(HOUSE, STATIONS[0]), 8);
  assert.equal(estimateMinutes(HOUSE, HOUSE), 1);
});

test('Transitous is asked once for every station, then the times are kept', async (t) => {
  const { calls } = stubFetch(t);
  const walks = await walkingTimes(HOUSE, STATIONS, { now: NOW });
  assert.deepEqual(walks, {
    2: { minutes: 7, exact: true },
    3: { minutes: 11, exact: true },
  });
  const [url] = asked(calls);
  assert.equal(url.pathname, '/api/v1/one-to-many');
  assert.equal(url.searchParams.get('mode'), 'WALK');
  assert.equal(url.searchParams.get('one'), '44.838030;-0.584370');
  assert.equal(url.searchParams.get('many'), '44.837840;-0.590280,44.840813;-0.593233');

  await walkingTimes(HOUSE, STATIONS, { now: NOW });
  // A restart: the file is enough.
  clearWalkingCache();
  await walkingTimes(HOUSE, STATIONS, { now: NOW });
  assert.equal(asked(calls).length, 1);

  // A new station: only it is asked.
  await walkingTimes(HOUSE, [...STATIONS, { id: '58', lat: 44.8256, lon: -0.5563 }], { now: NOW });
  assert.equal(asked(calls).length, 2);
  assert.equal(asked(calls)[1].searchParams.get('many'), '44.825600;-0.556300');
});

test('a house that moved asks again', async (t) => {
  const { calls } = stubFetch(t);
  await walkingTimes(HOUSE, STATIONS, { now: NOW });
  await walkingTimes({ lat: 44.84, lon: -0.58 }, STATIONS, { now: NOW });
  assert.equal(asked(calls).length, 2);
});

test('Transitous down: the estimate, and no new try before 10 minutes', async (t) => {
  const { calls } = stubFetch(t, { 'one-to-many': { status: 503 } });
  const walks = await walkingTimes(HOUSE, STATIONS, { now: NOW });
  assert.deepEqual(walks['2'], { minutes: 8, exact: false });
  await walkingTimes(HOUSE, STATIONS, { now: NOW + 60_000 });
  assert.equal(asked(calls).length, 1);
  await walkingTimes(HOUSE, STATIONS, { now: NOW + 11 * 60_000 });
  assert.equal(asked(calls).length, 2);
});

test('no path found: the estimate for that station only', async (t) => {
  stubFetch(t, { 'one-to-many': [{ duration: 400 }, {}] });
  const walks = await walkingTimes(HOUSE, STATIONS, { now: NOW });
  assert.deepEqual(walks['2'], { minutes: 7, exact: true });
  assert.equal(walks['3'].exact, false);
});

test('the words', () => {
  assert.equal(formatWalk({ minutes: 6, exact: true }, 'fr'), '6 min à pied');
  assert.equal(formatWalk({ minutes: 6, exact: false }, 'en'), '≈ 6 min walk');
});
