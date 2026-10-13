// -----------------------------------------------------------------------------
// Le Vélo par TBM, read from its GBFS feeds.
//
// GBFS (General Bikeshare Feed Specification) is the open standard bike-share
// operators publish. Bordeaux Métropole publishes Le Vélo in GBFS 3.0, with
// the same public open-data key as the TBM real time:
//
//   station_information  every station: id, name, position, address, capacity
//                        (ttl 1 h, changes a few times a year)
//   vehicle_types        the kinds of bike: "classic" (human) and "electric"
//                        (electric_assist) (ttl 1 day)
//   station_status       per station: bikes available by type, free docks,
//                        renting / returning flags (ttl 60 s)
//
// The directory (stations and vehicle types) is read once a day at most, and
// kept in /data so that a restart, or the API being down at that moment,
// still finds the stations. The status is read for the whole network at once
// (~230 stations, one small document) and shared by every device: polling ten
// stations costs one request, not ten.
//
// What vehicle_types names a type is not to be trusted: in October 2026 the
// "classic" type, human-powered, is named "Vélo électrique". The kind of a bike
// comes from `propulsion_type`, never from its name.
// -----------------------------------------------------------------------------

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { fetchJson, VeloApiError } from './http.js';

const logger = createLogger({ name: 'gbfs' });

// Data set: https://transport.data.gouv.fr/datasets/station-le-velo-en-temps-reel-1
// The key is the public one Bordeaux Métropole gives to everybody.
const BASE_URL = 'https://bdx.mecatran.com/utw/ws/gbfs/bordeaux/v3';
const API_KEY = 'opendata-bordeaux-metropole-flux-gtfs-rt';

/** The URL of a GBFS feed ("station_status"). */
export function feedUrl(feed) {
  return `${BASE_URL}/${feed}.json?apiKey=${API_KEY}`;
}

// The only writable directory of the container (see the Dockerfile). Read at
// each use, so that the tests can point it elsewhere.
const dataDir = () => process.env.VELO_DATA_DIR || '/data';
const CACHE_FILE = 'directory.json';
const MAX_AGE_MS = 24 * 3600 * 1000;
// Bump when the cached shape changes: an older file is then ignored.
const CACHE_VERSION = 1;

/** The two kinds of bike the integration counts apart. */
export const KINDS = ['mechanical', 'electric'];

/**
 * A GBFS text: a plain string in GBFS 2, a list of translations in GBFS 3
 * ([{ text, language }]). French first, the network is in Bordeaux.
 * @param {unknown} value
 */
export function localizedText(value) {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  const french = value.find((entry) => String(entry?.language ?? '').startsWith('fr'));
  return String((french ?? value[0])?.text ?? '').trim();
}

/**
 * A GBFS date: an RFC 3339 string in GBFS 3, POSIX seconds in GBFS 2.
 * @returns {number | null} milliseconds
 */
export function gbfsTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value * 1000;
  if (typeof value === 'string') {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

export function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Distance in meters between two points (haversine): good to a meter at the
 * scale of a city, which is all a "stations near my home" needs.
 */
export function distanceMeters(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

/**
 * The kind of a vehicle type, from its propulsion: a human-powered bike is
 * "mechanical", any motor makes it "electric". Without a propulsion, the id
 * decides ("electric", "classic"), then it is a classic bike.
 * @param {{ vehicle_type_id?: string, propulsion_type?: string }} type
 * @returns {'mechanical' | 'electric'}
 */
export function kindOfType(type) {
  const propulsion = String(type?.propulsion_type ?? '').toLowerCase();
  if (propulsion === 'human') return 'mechanical';
  if (propulsion) return 'electric';
  return /elec|vae|assist/i.test(String(type?.vehicle_type_id ?? '')) ? 'electric' : 'mechanical';
}

/**
 * The vehicle types: id → kind.
 * @param {unknown} payload
 * @returns {Record<string, 'mechanical' | 'electric'>}
 */
export function parseVehicleTypes(payload) {
  const types = payload?.data?.vehicle_types;
  if (!Array.isArray(types)) return {};
  return Object.fromEntries(
    types
      .filter((type) => type?.vehicle_type_id !== undefined)
      .map((type) => [String(type.vehicle_type_id), kindOfType(type)]),
  );
}

/**
 * The stations of station_information, by id. A station without position is
 * left out: nobody can be proposed it, nor find it on a map.
 * @param {unknown} payload
 * @returns {Record<string, { id: string, name: string, address: string, lat: number,
 *   lon: number, capacity: number | null }>}
 */
export function parseStations(payload) {
  const stations = payload?.data?.stations;
  if (!Array.isArray(stations)) {
    throw new VeloApiError('station_information has no data.stations');
  }
  const result = {};
  for (const station of stations) {
    const id = String(station?.station_id ?? '').trim();
    const lat = Number(station?.lat);
    const lon = Number(station?.lon);
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const capacity = Number(station.capacity);
    result[id] = {
      id,
      name: localizedText(station.name) || `Station ${id}`,
      address: localizedText(station.address),
      lat,
      lon,
      capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
    };
  }
  return result;
}

/**
 * The status of every station, by id. The bikes of an unknown type are
 * counted in the total only.
 *
 * A station that does not rent has no bike to offer, whatever its docks hold
 * (locked bikes, maintenance): it counts 0 bikes. One that does not take bikes
 * back counts 0 free docks. That is what a "fewer than 2 bikes" scene expects.
 *
 * @param {unknown} payload
 * @param {Record<string, 'mechanical' | 'electric'>} kinds vehicle type id → kind
 */
export function parseStatus(payload, kinds = {}) {
  const stations = payload?.data?.stations;
  if (!Array.isArray(stations)) {
    throw new VeloApiError('station_status has no data.stations');
  }
  const count = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
  };
  const result = {};
  for (const station of stations) {
    const id = String(station?.station_id ?? '').trim();
    if (!id) continue;
    const installed = station.is_installed !== false;
    const renting = installed && station.is_renting !== false;
    const returning = installed && station.is_returning !== false;
    // GBFS 3 says num_vehicles_available, GBFS 2 num_bikes_available.
    const total = count(station.num_vehicles_available ?? station.num_bikes_available);
    let byKind = null;
    if (Array.isArray(station.vehicle_types_available)) {
      byKind = { mechanical: 0, electric: 0 };
      for (const entry of station.vehicle_types_available) {
        const kind = kinds[String(entry?.vehicle_type_id)] ?? kindOfType(entry);
        byKind[kind] += count(entry?.count);
      }
    }
    result[id] = {
      id,
      installed,
      renting,
      returning,
      bikes: renting ? total : 0,
      mechanical: byKind && renting ? byKind.mechanical : byKind ? 0 : null,
      electric: byKind && renting ? byKind.electric : byKind ? 0 : null,
      docks: returning ? count(station.num_docks_available) : 0,
      reportedAt: gbfsTime(station.last_reported),
    };
  }
  return result;
}

// ----------------------------------------------------------------------------
// Directory: stations and vehicle types, a day in memory and in /data.
// ----------------------------------------------------------------------------

/** @type {{ fetchedAt: number, stations: object, kinds: object } | null} */
let directory = null;

/** The directory in memory (null until the first read). */
export function getDirectory() {
  return directory;
}

/** Replace the directory in memory (tests). */
export function setDirectory(value) {
  directory = value;
}

async function readCache() {
  try {
    const cached = JSON.parse(await readFile(join(dataDir(), CACHE_FILE), 'utf8'));
    if (cached?.version !== CACHE_VERSION || !cached.stations || !cached.kinds) return null;
    return { fetchedAt: cached.fetchedAt, stations: cached.stations, kinds: cached.kinds };
  } catch {
    return null;
  }
}

async function writeCache(value) {
  try {
    await mkdir(dataDir(), { recursive: true });
    await writeFile(
      join(dataDir(), CACHE_FILE),
      JSON.stringify({ version: CACHE_VERSION, ...value }),
    );
  } catch (err) {
    // A cache that cannot be written only costs a request at the next start.
    logger.warn(`The directory could not be saved: ${err.message}`);
  }
}

/**
 * The directory: from memory, else from /data, refreshed once a day. A failed
 * refresh keeps the previous one; with none at all, it throws.
 * @param {{ fresh?: boolean, now?: number }} [options]
 * @throws {VeloApiError}
 */
export async function loadDirectory({ fresh = false, now = Date.now() } = {}) {
  if (!directory) {
    directory = await readCache();
  }
  if (!fresh && directory && now - directory.fetchedAt < MAX_AGE_MS) {
    return directory;
  }
  try {
    const [informationPayload, typesPayload] = await Promise.all([
      fetchJson(feedUrl('station_information')),
      // The kinds can also be told from the type ids: a missing catalog must
      // not leave the integration without its stations.
      fetchJson(feedUrl('vehicle_types')).catch((err) => {
        logger.warn(`vehicle_types could not be read: ${err.message}`);
        return null;
      }),
    ]);
    const next = {
      fetchedAt: now,
      stations: parseStations(informationPayload),
      kinds: { ...(directory?.kinds ?? {}), ...parseVehicleTypes(typesPayload) },
    };
    if (Object.keys(next.stations).length === 0) {
      throw new VeloApiError('station_information came back empty');
    }
    directory = next;
    await writeCache(next);
    logger.info(`Directory read: ${Object.keys(next.stations).length} stations`);
  } catch (err) {
    if (!directory) throw err;
    logger.warn(`The directory could not be refreshed, the previous one is kept: ${err.message}`);
  }
  return directory;
}

/**
 * The station of an id the user typed.
 * @param {object} dir
 * @param {string} typed
 */
export function findStation(dir, typed) {
  const id = String(typed ?? '').trim();
  return dir?.stations?.[id] ?? null;
}

/**
 * The stations whose name or address holds every word of the query, the
 * names that start with it first.
 * @param {object} dir
 * @param {string} query
 */
export function searchStations(dir, query, limit = 10) {
  const words = normalize(query).split(' ').filter(Boolean);
  if (words.length === 0 || !dir) return [];
  const exact = findStation(dir, query);
  const wanted = words.join(' ');
  const matches = Object.values(dir.stations).filter((station) => {
    const text = normalize(`${station.name} ${station.address}`);
    return words.every((word) => text.includes(word));
  });
  const rank = (station) => {
    const name = normalize(station.name);
    if (name === wanted) return 0;
    if (name.startsWith(wanted)) return 1;
    if (name.includes(wanted)) return 2;
    return 3;
  };
  matches.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'fr'));
  const results = exact ? [exact, ...matches.filter((station) => station !== exact)] : matches;
  return results.slice(0, limit);
}

/**
 * The stations within `radius` meters of a point, closest first.
 * @param {object} dir
 * @param {{ lat: number, lon: number }} point
 * @param {number} radius
 */
export function stationsNear(dir, point, radius) {
  if (!dir) return [];
  return Object.values(dir.stations)
    .map((station) => ({ station, distance: distanceMeters(point, station) }))
    .filter((entry) => entry.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
}

// ----------------------------------------------------------------------------
// Status: the whole network, shared by every device.
// ----------------------------------------------------------------------------

// Every device of a poll tick asks within the same seconds: a read younger
// than this serves them all. It stays under the shortest interval (30 s), so
// each tick reads afresh; how often a device is refreshed is the poller's
// business (src/devices/index.js).
const STATUS_MAX_AGE_MS = 15_000;

/** @type {{ readAt: number, stations: Record<string, object> } | null} */
let status = null;
/** @type {Promise<object> | null} the read in flight, shared */
let pending = null;

/** Forget the status read (tests). */
export function clearStatusCache() {
  status = null;
  pending = null;
}

/**
 * The status of every station. Every device of a poll tick asks for it within
 * the same second: the first one reads, the others wait for that read.
 * @param {{ now?: number, fresh?: boolean }} [options]
 * @returns {Promise<Record<string, ReturnType<typeof parseStatus>[string]>>}
 * @throws {VeloApiError}
 */
export async function fetchStatus({ now = Date.now(), fresh = false } = {}) {
  if (!fresh && status && now - status.readAt < STATUS_MAX_AGE_MS) return status.stations;
  if (pending) return pending;
  pending = (async () => {
    try {
      const payload = await fetchJson(feedUrl('station_status'));
      const stations = parseStatus(payload, directory?.kinds ?? {});
      status = { readAt: now, stations };
      return stations;
    } finally {
      pending = null;
    }
  })();
  return pending;
}
