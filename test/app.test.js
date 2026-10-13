// The whole integration against the fake Gladys of the SDK: connection,
// suggestions, publication, creation, poll, buttons.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { clearStatusCache, setDirectory } from '../src/api/gbfs.js';
import { clearSuggestions } from '../src/devices/suggestions.js';
import { clearMaps } from '../src/widgets.js';
import { clearWalkingCache } from '../src/api/walk.js';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { MERIADECK_HOUSE, NOW, stationStatusPayload } from './helpers/fixtures.js';
import { stubFetch } from './helpers/stubFetch.js';

beforeEach(async () => {
  // Every test starts as a first install: nothing in memory, nothing on disk.
  await rm(join(process.env.VELO_DATA_DIR, 'directory.json'), { force: true });
  setDirectory(null);
  clearSuggestions();
  clearStatusCache();
  clearMaps();
  clearWalkingCache();
  await rm(join(process.env.VELO_DATA_DIR, 'walking.json'), { force: true });
});

async function start(t, options = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const fetches = stubFetch(t, options.routes);
  const gladys = createFakeGladys({
    houses: [MERIADECK_HOUSE],
    config: { nearby_stations: 2 },
    ...options.gladys,
  });
  const app = registerHandlers(gladys);
  t.after(() => app.stop());
  await gladys.connect();
  return { gladys, fetches };
}

const feature = (device, key) => `${device.external_id}:${key}`;

test('on connection: the stations near the house are proposed, the status is green', async (t) => {
  const { gladys } = await start(t);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['Le Vélo – Meriadeck', 'Le Vélo – Saint-Bruno - Hôtel de Région'],
  );
  const [meriadeck] = gladys.fake.discoveredDevices;
  assert.deepEqual(
    meriadeck.features.map((f) => f.name),
    [
      'Vélos musculaires',
      'Vélos électriques',
      'Vélos disponibles',
      'Places libres',
      'État',
      'Résumé',
    ],
  );
  assert.equal(meriadeck.features[0].max, 43);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a created station is read at once, classic and electric apart', async (t) => {
  const { gladys } = await start(t);
  const [meriadeck] = gladys.fake.discoveredDevices;
  await gladys.fake.deviceCreated(meriadeck);
  assert.equal(gladys.fake.lastState(feature(meriadeck, 'mechanical')), 10);
  assert.equal(gladys.fake.lastState(feature(meriadeck, 'electric')), 5);
  assert.equal(gladys.fake.lastState(feature(meriadeck, 'bikes')), 15);
  assert.equal(gladys.fake.lastState(feature(meriadeck, 'docks')), 28);
  assert.equal(gladys.fake.lastState(feature(meriadeck, 'status')), 'En service');
  assert.equal(
    gladys.fake.lastState(feature(meriadeck, 'summary')),
    '10 musculaires · 5 électriques · 28 places',
  );
});

test('the poll follows the configured interval and reads the network once', async (t) => {
  const { gladys, fetches } = await start(t, {
    gladys: { config: { nearby_stations: 2, poll_frequency: 120 } },
  });
  const [a, b] = gladys.fake.discoveredDevices;
  await gladys.fake.deviceCreated(a);
  await gladys.fake.deviceCreated(b);
  const statusReads = () =>
    fetches.calls.filter((url) => url.pathname.endsWith('station_status.json')).length;
  assert.equal(statusReads(), 1);

  t.mock.timers.setTime(NOW + 60_000);
  await gladys.fake.poll(a);
  assert.equal(statusReads(), 1);

  t.mock.timers.setTime(NOW + 120_000);
  await gladys.fake.poll(a);
  await gladys.fake.poll(b);
  assert.equal(statusReads(), 2);
});

test('by default a station is read at every 30 s tick; at 60 s, one tick in two', async (t) => {
  const { gladys, fetches } = await start(t);
  const [meriadeck] = gladys.fake.discoveredDevices;
  assert.equal(meriadeck.poll_frequency, 30_000);
  await gladys.fake.deviceCreated(meriadeck);
  const statusReads = () =>
    fetches.calls.filter((url) => url.pathname.endsWith('station_status.json')).length;
  assert.equal(statusReads(), 1);
  t.mock.timers.setTime(NOW + 30_000);
  await gladys.fake.poll(meriadeck);
  assert.equal(statusReads(), 2);

  await gladys.fake.configUpdated({ nearby_stations: 2, poll_frequency: 60 });
  t.mock.timers.setTime(NOW + 60_000);
  await gladys.fake.poll(meriadeck);
  assert.equal(statusReads(), 2);
  t.mock.timers.setTime(NOW + 90_000);
  await gladys.fake.poll(meriadeck);
  assert.equal(statusReads(), 3);
});

test('a station that empties is published', async (t) => {
  let empty = false;
  const { gladys } = await start(t, {
    routes: {
      station_status: () =>
        stationStatusPayload(
          empty
            ? {
                1: {
                  station_id: '1',
                  num_vehicles_available: 0,
                  num_docks_available: 43,
                  vehicle_types_available: [],
                },
              }
            : {},
        ),
    },
  });
  const [meriadeck] = gladys.fake.discoveredDevices;
  await gladys.fake.deviceCreated(meriadeck);
  empty = true;
  t.mock.timers.setTime(NOW + 60_000);
  await gladys.fake.poll(meriadeck);
  assert.equal(gladys.fake.lastState(feature(meriadeck, 'electric')), 0);
  assert.equal(gladys.fake.lastState(feature(meriadeck, 'docks')), 43);
});

test('the buttons answer', async (t) => {
  const { gladys } = await start(t);
  const search = await gladys.fake.action('search_stations', { query: 'judaique' });
  assert.equal(search.success, true);
  assert.match(search.data.message.fr, /3 — Piscine Judaique \(Place du Capitaine du Tertre/);

  const none = await gladys.fake.action('search_stations', { query: 'zzz' });
  assert.match(none.data.message.fr, /Aucune station/);

  const testing = await gladys.fake.action('test_connection');
  assert.match(testing.data.message.fr, /API Le Vélo OK : 4 stations/);
  assert.match(testing.data.message.fr, /Meriadeck : 10 musculaires · 5 électriques · 28 places/);
  assert.match(testing.data.message.fr, /Près de Maison : 2 station/);
});

test('the widget shows a created station; a missing choice is explained', async (t) => {
  const { gladys } = await start(t);
  const [meriadeck] = gladys.fake.discoveredDevices;
  await gladys.fake.deviceCreated(meriadeck);
  const widget = await gladys.fake.widgetGet('station', {
    settings: { device: meriadeck.external_id, threshold: '3', history: 'last-day' },
    language: 'fr',
  });
  assert.equal(widget.success, true);
  const { components } = widget.data.content;
  assert.equal(components[0].text, 'Meriadeck');
  assert.equal(components[1].text.fr, '1 min à pied · mis à jour à 11:10.');
  assert.deepEqual(
    components.filter((c) => c.type === 'value').map((c) => c.value),
    [10, 5, 28],
  );
  assert.deepEqual(components.find((c) => c.type === 'chart').device_features, [
    feature(meriadeck, 'mechanical'),
    feature(meriadeck, 'electric'),
    feature(meriadeck, 'docks'),
  ]);

  const empty = await gladys.fake.widgetGet('station', { settings: {}, language: 'fr' });
  assert.match(empty.data.content.components[0].text.fr, /Choisissez une station/);
});

test('the map widget: my stations, then the stations near the house', async (t) => {
  const { gladys } = await start(t);
  const [meriadeck] = gladys.fake.discoveredDevices;

  const none = await gladys.fake.widgetGet('map', { settings: {}, language: 'fr' });
  assert.match(none.data.content.components[0].text.fr, /Aucune station suivie/);

  await gladys.fake.deviceCreated(meriadeck);
  const mine = await gladys.fake.widgetGet('map', { settings: {}, language: 'fr' });
  const { components } = mine.data.content;
  assert.deepEqual(validateWidgetContent(mine.data.content), []);
  assert.equal(components[0].text.fr, 'Mes stations Le Vélo');
  const image = components.find((c) => c.type === 'image');
  const status = components.find((c) => c.type === 'status');
  // Everything at once by default, and the walking time from Transitous.
  assert.deepEqual(
    status.items.map((item) => [item.label.fr, item.value.fr, item.color]),
    [['Meriadeck · 1 min à pied', '10 musc. · 5 élec. · 28 pl.', 'success']],
  );
  const served = await gladys.fake.widgetGetImage(image.key);
  assert.equal(served.success, true);
  assert.deepEqual(validateWidgetImage(served.data.image), []);

  const near = await gladys.fake.widgetGet('map', {
    settings: { scope: 'nearby', show: 'docks' },
    language: 'fr',
  });
  const rows = near.data.content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    rows.map((item) => [item.label.fr, item.value.fr]),
    [
      ['Meriadeck · 1 min à pied', '28 places'],
      ['Saint-Bruno - Hôtel de R… · 7 min à pied', '8 places'],
    ],
  );
  // Other counts, another image.
  assert.notEqual(near.data.content.components.find((c) => c.type === 'image').key, image.key);
});

test('a station typed by hand is published; a wrong number is reported', async (t) => {
  const { gladys } = await start(t, {
    gladys: { config: { nearby_stations: 0, stations: '58, 4242' } },
  });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['Le Vélo – Gare Saint-Jean'],
  );
  assert.match(gladys.fake.connectionStatus.message.fr, /Introuvable.*4242/);

  await gladys.fake.configUpdated({ nearby_stations: 0, stations: '58' });
  assert.equal(gladys.fake.connectionStatus.message, undefined);
});

test('a created station stays after it stops being proposed', async (t) => {
  const { gladys } = await start(t);
  const [meriadeck] = gladys.fake.discoveredDevices;
  await gladys.fake.deviceCreated(meriadeck);
  await gladys.fake.configUpdated({ nearby_stations: 0 });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['Le Vélo – Meriadeck'],
  );
});

test('an unlocated house is reported', async (t) => {
  const { gladys } = await start(t, {
    gladys: { houses: [{ ...MERIADECK_HOUSE, latitude: null, longitude: null }] },
  });
  assert.match(gladys.fake.connectionStatus.message.fr, /adresse à votre maison/);
});

test('without the stations, the status says the service does not answer', async (t) => {
  const { gladys } = await start(t, { routes: { station_information: { status: 503 } } });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /ne répond pas/);
  assert.deepEqual(gladys.fake.discoveredDevices, []);
});
