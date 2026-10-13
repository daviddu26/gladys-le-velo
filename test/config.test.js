import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseStations } from '../src/config.js';

test('defaults when nothing is set', () => {
  const config = normalizeConfig();
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) assert.equal(config[key], value);
  assert.deepEqual(config.watched, { ids: [], invalid: [] });
});

test('numbers are read from strings and kept within bounds', () => {
  const config = normalizeConfig({
    nearby_stations: '12',
    nearby_radius: '50',
    poll_frequency: '',
  });
  assert.equal(config.nearby_stations, 10);
  assert.equal(config.nearby_radius, 100);
  assert.equal(config.poll_frequency, 60);
});

test('station ids: commas, semicolons, spaces; duplicates and garbage', () => {
  assert.deepEqual(parseStations('1, 12;58 12 é!'), { ids: ['1', '12', '58'], invalid: ['é!'] });
});

test('language: French unless English', () => {
  assert.equal(normalizeConfig({ language: 'de' }).language, 'fr');
  assert.equal(normalizeConfig({ language: 'en' }).language, 'en');
});
