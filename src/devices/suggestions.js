// -----------------------------------------------------------------------------
// "Near my home": the stations the integration proposes by itself.
//
// Gladys knows where the house is: the manifest declares `location: true`
// (the user grants it at install time) and `getHouses()` returns the
// coordinates. The integration looks up the closest stations and publishes
// them in the Discovery tab ("Le Vélo – Meriadeck"): adding one is a click,
// nobody has to know that the station is number 1.
//
// The suggestions only ADD devices to propose. What keeps a created device
// working is its own params (see src/devices/index.js): a station that stops
// being among the closest — the user changed the radius — keeps refreshing.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { getDirectory, stationsNear } from '../api/gbfs.js';

const logger = createLogger({ name: 'suggestions' });

/**
 * @typedef {{ status: 'disabled' | 'no_permission' | 'no_location' | 'no_directory' | 'ok',
 *   house: string | null,
 *   entries: { station: string, label: string, distance: number }[] }} Suggestions
 */

/** @type {Suggestions} */
let suggestions = { status: 'disabled', house: null, entries: [] };

/** The current suggestions (empty until the first lookup). */
export function getSuggestions() {
  return suggestions;
}

/** Forget the suggestions (tests). */
export function clearSuggestions() {
  suggestions = { status: 'disabled', house: null, entries: [] };
}

/**
 * The first house of Gladys that has coordinates. Several houses may exist (a
 * holiday home): the integration looks around the first located one, in the
 * order Gladys gives them, and the documentation says so.
 *
 * @returns {Promise<{ lat: number, lon: number, name: string } | null | undefined>}
 *   null when no house is located, undefined when Gladys refused to tell
 */
export async function homeLocation(gladys) {
  let houses;
  try {
    houses = await gladys.getHouses();
  } catch (err) {
    // A 403: the location permission was not granted.
    logger.warn(`The house location is not available: ${err.message}`);
    return undefined;
  }
  const house = (Array.isArray(houses) ? houses : []).find(
    (candidate) => Number.isFinite(candidate?.latitude) && Number.isFinite(candidate?.longitude),
  );
  return house ? { lat: house.latitude, lon: house.longitude, name: house.name } : null;
}

/**
 * Look the stations around the house up again. Never throws: a failed lookup
 * leaves the integration as useful as its configuration, and the status says
 * why.
 * @param {object} gladys
 * @param {ReturnType<import('../config.js').normalizeConfig>} config
 * @returns {Promise<Suggestions>}
 */
export async function refreshSuggestions(gladys, config) {
  if (config.nearby_stations === 0) {
    suggestions = { status: 'disabled', house: null, entries: [] };
    return suggestions;
  }
  const home = await homeLocation(gladys);
  if (home === undefined) {
    suggestions = { status: 'no_permission', house: null, entries: [] };
    return suggestions;
  }
  if (home === null) {
    suggestions = { status: 'no_location', house: null, entries: [] };
    return suggestions;
  }
  const dir = getDirectory();
  if (!dir) {
    suggestions = { status: 'no_directory', house: home.name ?? null, entries: [] };
    return suggestions;
  }
  const entries = stationsNear(dir, home, config.nearby_radius)
    .slice(0, config.nearby_stations)
    .map(({ station, distance }) => ({ station: station.id, label: `${distance} m`, distance }));
  logger.info(`Near ${home.name ?? 'the house'}: ${entries.length} station(s) proposed`);
  suggestions = { status: 'ok', house: home.name ?? null, entries };
  return suggestions;
}
