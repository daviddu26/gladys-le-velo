// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest, but nothing there can know which
// handlers the code registers: these tests keep both sides in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/devices/index.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { HISTORY_OPTIONS, WIDGETS } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

/** Every text of the manifest that a user reads must exist in French and English. */
function* userTexts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) yield* userTexts(item, `${path}[${index}]`);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (['label', 'description', 'placeholder'].includes(key)) yield [`${path}.${key}`, value];
    yield* userTexts(value, `${path}.${key}`);
  }
}

test('the manifest asks for the house location, the suggestions need it', () => {
  assert.equal(manifest.location, true);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
});

test('every widget has a content handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
});

test('the history options are the windows the code knows', () => {
  const widget = manifest.widgets.find((entry) => entry.key === 'station');
  const history = widget.settings.find((field) => field.key === 'history');
  assert.deepEqual(
    history.options.map((option) => option.value).filter((value) => value !== 'none'),
    Object.keys(HISTORY_OPTIONS),
  );
});

test('dynamic selects declare a source and no static options', () => {
  const fields = (manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []);
  for (const field of fields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, field.key);
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') continue;
    assert.ok(field.key in DEFAULT_CONFIG, `"${field.key}" has no default in src/config.js`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
    }
  }
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined, section.key);
    assert.equal(section.default, undefined, section.key);
    assert.equal(section.placeholder, undefined, section.key);
    assert.ok(!(section.key in DEFAULT_CONFIG), section.key);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('the categories are known to the declared Gladys version', () => {
  assert.match(manifest.gladys_version, />=\s*5\.1\.0/);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
  assert.ok(manifest.docker_image.startsWith('ghcr.io/daviddu26/gladys-le-velo:'));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('every user-facing text is a French and English object', () => {
  for (const [path, value] of userTexts(manifest)) {
    assert.equal(typeof value, 'object', `${path} must be { en, fr }`);
    assert.ok(value.en && value.fr, `${path} needs both en and fr`);
  }
});
