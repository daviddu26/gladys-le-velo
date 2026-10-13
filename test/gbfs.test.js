import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  clearStatusCache,
  fetchStatus,
  kindOfType,
  loadDirectory,
  localizedText,
  parseStatus,
  parseStations,
  parseVehicleTypes,
  searchStations,
  setDirectory,
  stationsNear,
} from '../src/api/gbfs.js';
import { VeloApiError } from '../src/api/http.js';
import {
  MERIADECK_HOUSE,
  NOW,
  stationInformationPayload,
  stationStatusPayload,
  vehicleTypesPayload,
} from './helpers/fixtures.js';
import { stubFetch } from './helpers/stubFetch.js';

const KINDS = parseVehicleTypes(vehicleTypesPayload());

beforeEach(async () => {
  await rm(join(process.env.VELO_DATA_DIR, 'directory.json'), { force: true });
  setDirectory(null);
  clearStatusCache();
});

test('texts: GBFS 3 translations and GBFS 2 strings', () => {
  assert.equal(localizedText([{ text: 'Meriadeck', language: 'fr' }]), 'Meriadeck');
  assert.equal(
    localizedText([
      { text: 'Station', language: 'en' },
      { text: 'Gare', language: 'fr' },
    ]),
    'Gare',
  );
  assert.equal(localizedText(' Meriadeck '), 'Meriadeck');
  assert.equal(localizedText(undefined), '');
});

test('the kind of a bike comes from its propulsion, not its (wrong) name', () => {
  assert.deepEqual(KINDS, { classic: 'mechanical', electric: 'electric' });
  assert.equal(kindOfType({ vehicle_type_id: 'x', propulsion_type: 'electric' }), 'electric');
  assert.equal(kindOfType({ vehicle_type_id: 'vae' }), 'electric');
  assert.equal(kindOfType({ vehicle_type_id: 'classic' }), 'mechanical');
});

test('stations: id, name, address, position, capacity; no position, no station', () => {
  const stations = parseStations(stationInformationPayload());
  assert.deepEqual(Object.keys(stations), ['1', '2', '3', '58']);
  assert.deepEqual(stations['1'], {
    id: '1',
    name: 'Meriadeck',
    address: 'Rue Claude Bonnier (station tramway), Bordeaux',
    lat: 44.83803,
    lon: -0.58437,
    capacity: 43,
  });
  assert.throws(() => parseStations({}), VeloApiError);
});

test('status: classic and electric counted apart, docks, flags', () => {
  const status = parseStatus(stationStatusPayload(), KINDS);
  assert.deepEqual(status['1'], {
    id: '1',
    installed: true,
    renting: true,
    returning: true,
    bikes: 15,
    mechanical: 10,
    electric: 5,
    docks: 28,
    reportedAt: Date.parse('2026-10-13T09:10:35Z'),
  });
});

test('status: a station that does not rent offers no bike, one that does not return no dock', () => {
  const status = parseStatus(
    stationStatusPayload({
      2: {
        station_id: '2',
        is_installed: true,
        is_renting: true,
        is_returning: false,
        num_vehicles_available: 3,
        num_docks_available: 9,
        vehicle_types_available: [{ vehicle_type_id: 'electric', count: 3 }],
      },
    }),
    KINDS,
  );
  assert.equal(status['3'].renting, false);
  assert.deepEqual([status['3'].bikes, status['3'].mechanical, status['3'].electric], [0, 0, 0]);
  assert.equal(status['3'].docks, 18);
  assert.deepEqual([status['2'].bikes, status['2'].electric, status['2'].docks], [3, 3, 0]);
});

test('status: GBFS 2 fields, and no split by kind', () => {
  const status = parseStatus({
    data: {
      stations: [
        {
          station_id: 7,
          num_bikes_available: 4,
          num_docks_available: 2,
          last_reported: 1760000000,
        },
      ],
    },
  });
  assert.equal(status['7'].bikes, 4);
  assert.equal(status['7'].mechanical, null);
  assert.equal(status['7'].reportedAt, 1760000000000);
});

test('search: by name or street, accents ignored', () => {
  const dir = { stations: parseStations(stationInformationPayload()) };
  assert.deepEqual(
    searchStations(dir, 'judaïque').map((s) => s.id),
    ['3'],
  );
  assert.deepEqual(
    searchStations(dir, 'sourdis').map((s) => s.id),
    ['2'],
  );
  assert.deepEqual(
    searchStations(dir, '58').map((s) => s.id),
    ['58'],
  );
});

test('near: closest first, within the radius', () => {
  const dir = { stations: parseStations(stationInformationPayload()) };
  const home = { lat: MERIADECK_HOUSE.latitude, lon: MERIADECK_HOUSE.longitude };
  assert.deepEqual(
    stationsNear(dir, home, 1000).map(({ station, distance }) => [station.id, distance]),
    [
      ['1', 0],
      ['2', 466],
      ['3', 764],
    ],
  );
});

test('the directory is read once, then served from memory and from /data', async (t) => {
  const { calls } = stubFetch(t);
  const dir = await loadDirectory({ now: NOW });
  assert.equal(Object.keys(dir.stations).length, 4);
  assert.deepEqual(dir.kinds, KINDS);
  await loadDirectory({ now: NOW + 3600_000 });
  assert.equal(calls.length, 2);

  // A restart: the file is enough.
  setDirectory(null);
  const reread = await loadDirectory({ now: NOW + 7200_000 });
  assert.equal(Object.keys(reread.stations).length, 4);
  assert.equal(calls.length, 2);
});

test('a failed refresh keeps the previous directory; none at all throws', async (t) => {
  stubFetch(t, { station_information: { status: 503 } });
  await assert.rejects(loadDirectory({ now: NOW }), VeloApiError);
  setDirectory({ fetchedAt: 0, stations: { 1: { id: '1' } }, kinds: {} });
  const dir = await loadDirectory({ now: NOW });
  assert.deepEqual(Object.keys(dir.stations), ['1']);
});

test('without vehicle_types, the stations are still read', async (t) => {
  stubFetch(t, { vehicle_types: { status: 404 } });
  const dir = await loadDirectory({ now: NOW });
  assert.equal(Object.keys(dir.stations).length, 4);
});

test('the status is read once for every station of a poll tick', async (t) => {
  const { calls } = stubFetch(t);
  const [a, b] = await Promise.all([fetchStatus({ now: NOW }), fetchStatus({ now: NOW })]);
  assert.equal(a, b);
  await fetchStatus({ now: NOW + 20_000 });
  assert.equal(calls.length, 1);
  await fetchStatus({ now: NOW + 40_000 });
  assert.equal(calls.length, 2);
  await fetchStatus({ now: NOW + 41_000, fresh: true });
  assert.equal(calls.length, 3);
});
