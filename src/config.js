// -----------------------------------------------------------------------------
// Integration configuration.
//
// The values come from the `config_schema` of the manifest, filled in by the
// user in Gladys. This module gives each one a default (the same as the
// manifest's: test/manifest.test.js checks it), forces its type — a form may
// send a number as a string, or an empty string — and parses the stations the
// user typed by hand.
// -----------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  // How many stations near the house are proposed in the Discovery tab, and
  // how far from it. 500 m is a six minutes walk: past that, the bike is not
  // "at the door" anymore.
  nearby_stations: 3,
  nearby_radius: 500,
  // Stations typed by hand, by id: "1, 12".
  stations: '',
  // Seconds between two reads. The feed is refreshed every minute or so.
  poll_frequency: 60,
  language: 'fr',
};

/** The bounds of the numeric settings, the same as the manifest's. */
const BOUNDS = {
  nearby_stations: [0, 10],
  nearby_radius: [100, 3000],
  poll_frequency: [60, 900],
};

function clampNumber(key, value) {
  const number = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(number)) {
    return DEFAULT_CONFIG[key];
  }
  const [min, max] = BOUNDS[key];
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * The station ids of the "stations" field (comma, semicolon, space or newline
 * separated), and what could not be read, to tell the user. Ids are numbers
 * in Bordeaux, but GBFS allows any short string.
 * @param {string} value
 * @returns {{ ids: string[], invalid: string[] }}
 */
export function parseStations(value) {
  const ids = [];
  const invalid = [];
  for (const raw of String(value ?? '').split(/[,;\s]+/)) {
    const id = raw.trim();
    if (!id) continue;
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) invalid.push(id);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, invalid };
}

/**
 * Merge the user config with the defaults, with the right types.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...raw };
  for (const key of Object.keys(BOUNDS)) {
    config[key] = clampNumber(key, raw[key]);
  }
  config.stations = typeof raw.stations === 'string' ? raw.stations : '';
  config.language = raw.language === 'en' ? 'en' : 'fr';
  config.watched = parseStations(config.stations);
  return config;
}
