// -----------------------------------------------------------------------------
// Walking time from the house to the stations.
//
// Transitous (https://transitous.org), the free community routing service
// (MOTIS 2) also used by the TBM integration, computes walking times along
// the streets: its one-to-many call gives, in one request, the time from one
// point (the house) to many (the stations).
//
// A walking time from the house to a station does not change: it is asked
// once and kept in /data/walking.json, asked again only when the house moves
// or a new station appears. A handful of calls in the life of an
// installation, within Transitous' policy (https://transitous.org/api/):
// open source, a User-Agent naming the application, light use.
//
// Until Transitous answered (offline, down, no path found), the time is an
// estimate: the straight line lengthened by 30 % for the streets, at 80 m a
// minute, shown "≈ 6 min".
// -----------------------------------------------------------------------------

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { distanceMeters } from './gbfs.js';
import { fetchJson } from './http.js';

const logger = createLogger({ name: 'walk' });

export const TRANSITOUS_API_URL = 'https://api.transitous.org/api';

const dataDir = () => process.env.VELO_DATA_DIR || '/data';
const CACHE_FILE = 'walking.json';
// Bump when the cached shape changes: an older file is then ignored.
const CACHE_VERSION = 1;

// An ordinary walking pace, and how much longer the streets are than the
// straight line in a city centre.
const WALK_METERS_PER_MINUTE = 80;
const DETOUR = 1.3;
// What one request asks for at most (the server caps the targets).
const BATCH = 50;
// A walk longer than this is no walk to a bike station.
const MAX_SECONDS = 3600;
// After a failure, Transitous is not asked again before this.
const RETRY_AFTER_MS = 10 * 60 * 1000;

/** The estimate: the straight line, lengthened for the streets. */
export function estimateMinutes(house, station) {
  return Math.max(1, Math.ceil((distanceMeters(house, station) * DETOUR) / WALK_METERS_PER_MINUTE));
}

const point = ({ lat, lon }) => `${lat.toFixed(6)};${lon.toFixed(6)}`;
// The house "moved" when its coordinates did, to about a meter.
const houseKey = (house) => `${house.lat.toFixed(5)};${house.lon.toFixed(5)}`;

/** @type {{ house: string, minutes: Record<string, number | null> } | null} */
let cache = null;
let failedAt = 0;

/** Forget everything (tests). */
export function clearWalkingCache() {
  cache = null;
  failedAt = 0;
}

async function readCache() {
  try {
    const saved = JSON.parse(await readFile(join(dataDir(), CACHE_FILE), 'utf8'));
    if (saved?.version === CACHE_VERSION && saved.minutes) return saved;
  } catch {
    // Nothing saved yet.
  }
  return null;
}

async function writeCache(value) {
  try {
    await mkdir(dataDir(), { recursive: true });
    await writeFile(
      join(dataDir(), CACHE_FILE),
      JSON.stringify({ version: CACHE_VERSION, ...value }),
    );
  } catch (err) {
    logger.warn(`The walking times could not be saved: ${err.message}`);
  }
}

/**
 * Ask Transitous the walking times from the house to these stations.
 * @returns {Promise<Record<string, number | null>>} minutes, null when no path
 */
async function askTransitous(house, stations) {
  const minutes = {};
  for (let i = 0; i < stations.length; i += BATCH) {
    const batch = stations.slice(i, i + BATCH);
    const params = new URLSearchParams({
      one: point(house),
      many: batch.map(point).join(','),
      mode: 'WALK',
      max: String(MAX_SECONDS),
      maxMatchingDistance: '250',
      arriveBy: 'false',
    });
    const durations = await fetchJson(`${TRANSITOUS_API_URL}/v1/one-to-many?${params}`);
    if (!Array.isArray(durations) || durations.length !== batch.length) {
      throw new Error('one-to-many did not answer one duration per station');
    }
    batch.forEach((station, k) => {
      const seconds = Number(durations[k]?.duration);
      minutes[station.id] = Number.isFinite(seconds) ? Math.max(1, Math.round(seconds / 60)) : null;
    });
  }
  return minutes;
}

/**
 * The walking time from the house to each station: Transitous' when known,
 * else the estimate. Never throws.
 * @param {{ lat: number, lon: number }} house
 * @param {{ id: string, lat: number, lon: number }[]} stations
 * @param {{ now?: number }} [options]
 * @returns {Promise<Record<string, { minutes: number, exact: boolean }>>}
 */
export async function walkingTimes(house, stations, { now = Date.now() } = {}) {
  const key = houseKey(house);
  if (!cache) cache = await readCache();
  if (!cache || cache.house !== key) cache = { house: key, minutes: {} };

  const missing = stations.filter((station) => !(station.id in cache.minutes));
  if (missing.length > 0 && now - failedAt >= RETRY_AFTER_MS) {
    try {
      Object.assign(cache.minutes, await askTransitous(house, missing));
      await writeCache(cache);
      logger.info(`Walking times from the house: ${missing.length} station(s) asked`);
    } catch (err) {
      failedAt = now;
      logger.warn(`Walking times not found, estimated for now: ${err.message}`);
    }
  }

  return Object.fromEntries(
    stations.map((station) => {
      const known = cache.minutes[station.id];
      return [
        station.id,
        typeof known === 'number'
          ? { minutes: known, exact: true }
          : { minutes: estimateMinutes(house, station), exact: false },
      ];
    }),
  );
}

/** "6 min à pied", "≈ 6 min à pied" for an estimate. */
export function formatWalk(walk, language = 'fr') {
  const approx = walk.exact ? '' : '≈ ';
  return language === 'en'
    ? `${approx}${walk.minutes} min walk`
    : `${approx}${walk.minutes} min à pied`;
}
