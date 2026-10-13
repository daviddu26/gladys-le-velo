import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSummary, stateOf } from '../src/devices/station.js';
import { parseStatus, parseVehicleTypes } from '../src/api/gbfs.js';
import { stationStatusPayload, vehicleTypesPayload } from './helpers/fixtures.js';

const status = parseStatus(stationStatusPayload(), parseVehicleTypes(vehicleTypesPayload()));

test('summary: classic, electric, docks; singular and plural', () => {
  assert.equal(formatSummary(status['1'], 'fr'), '10 musculaires · 5 électriques · 28 places');
  assert.equal(formatSummary(status['58'], 'fr'), '0 musculaire · 1 électrique · 39 places');
  assert.equal(formatSummary(status['1'], 'en'), '10 classic · 5 electric · 28 docks');
  assert.equal(formatSummary(status['58'], 'en'), '0 classic · 1 electric · 39 docks');
});

test('summary: the state when the station is not fully in service', () => {
  assert.equal(stateOf(status['3']), 'no_rent');
  assert.equal(
    formatSummary(status['3'], 'fr'),
    '0 musculaire · 0 électrique · 18 places (Location suspendue)',
  );
  assert.equal(formatSummary({ ...status['1'], installed: false }, 'fr'), 'Hors service');
  assert.equal(formatSummary(undefined, 'en'), 'Station unknown to the service');
});

test('summary: a feed without the split by kind gives the total', () => {
  assert.equal(
    formatSummary({ ...status['1'], mechanical: null, electric: null }, 'fr'),
    '15 vélos · 28 places',
  );
});
