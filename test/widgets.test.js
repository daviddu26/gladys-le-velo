import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { countColor, selectedHistory, selectedThreshold, stationContent } from '../src/widgets.js';
import { parseStatus, parseVehicleTypes } from '../src/api/gbfs.js';
import { stationStatusPayload, vehicleTypesPayload } from './helpers/fixtures.js';

const status = parseStatus(stationStatusPayload(), parseVehicleTypes(vehicleTypesPayload()));
const featureIds = { mechanical: 'ext:1:mechanical', electric: 'ext:1:electric' };

test('colors: red at zero, orange up to the threshold, grey when closed', () => {
  assert.equal(countColor(0, 2), 'danger');
  assert.equal(countColor(2, 2), 'warning');
  assert.equal(countColor(3, 2), 'success');
  assert.equal(countColor(0, 2, false), 'neutral');
});

test('settings: threshold and history, with their defaults', () => {
  assert.equal(selectedThreshold('5'), 5);
  assert.equal(selectedThreshold('4'), 2);
  assert.equal(selectedThreshold(undefined), 2);
  assert.equal(selectedHistory('last-day'), 'last-day');
  assert.equal(selectedHistory('none'), null);
  assert.equal(selectedHistory(''), null);
});

test('a station in service: three tiles, the time of the report', () => {
  const content = stationContent({ name: 'Meriadeck' }, status['1'], { featureIds });
  assert.deepEqual(validateWidgetContent(content), []);
  const [heading, caption, ...tiles] = content.components;
  assert.equal(heading.text, 'Meriadeck');
  assert.equal(caption.text.fr, 'Mis à jour à 11:10.');
  assert.deepEqual(
    tiles.map((tile) => [tile.label.fr, tile.value, tile.color]),
    [
      ['Musculaires', 10, 'success'],
      ['Électriques', 5, 'success'],
      ['Places libres', 28, 'success'],
    ],
  );
});

test('few electric bikes left: orange; none: red', () => {
  const content = stationContent({ name: 'Gare Saint-Jean' }, status['58'], { featureIds });
  const tiles = content.components.filter((component) => component.type === 'value');
  assert.deepEqual(
    tiles.map((tile) => tile.color),
    ['danger', 'warning', 'success'],
  );
});

test('a station that does not rent says so, its bikes in grey', () => {
  const content = stationContent({ name: 'Piscine Judaique' }, status['3'], { featureIds });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[1].text.fr, 'Location suspendue.');
  const tiles = content.components.filter((component) => component.type === 'value');
  assert.deepEqual(
    tiles.map((tile) => tile.color),
    ['neutral', 'neutral', 'success'],
  );
});

test('the history chart is bound to the two counters', () => {
  const content = stationContent({ name: 'Meriadeck' }, status['1'], {
    featureIds,
    history: 'last-day',
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const chart = content.components.find((component) => component.type === 'chart');
  assert.deepEqual(chart.device_features, [featureIds.mechanical, featureIds.electric]);
  assert.equal(chart.interval, 'last-day');
});

test('a station missing from the feed: the heading and why', () => {
  const content = stationContent({ name: 'Meriadeck' }, undefined, { featureIds });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components.length, 2);
  assert.equal(content.components[1].text.fr, 'Station inconnue du service.');
});
