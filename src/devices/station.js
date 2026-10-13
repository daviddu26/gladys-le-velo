// -----------------------------------------------------------------------------
// Device type: A LE VÉLO STATION
//
// One device per station the user follows: "Le Vélo – Meriadeck". What matters
// at a station is whether there is a bike of the kind one wants, and a dock to
// leave it, so the bikes are counted by kind:
//
//   Vélos musculaires     10      (counter)
//   Vélos électriques      5      (counter)
//   Vélos disponibles     15      (counter, both kinds)
//   Places libres         28      (counter)
//   État                  "En service"                          (text)
//   Résumé                "10 musculaires · 5 électriques · 28 places" (text)
//
// The counters keep their history: Gladys can chart when the station empties
// in the morning. Only the values that moved are sent (publishChangedStates).
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { fetchStatus, getDirectory } from '../api/gbfs.js';

export const DEVICE_TYPE = 'station';

const logger = createLogger({ name: DEVICE_TYPE });

// `t_device_feature.min/max` are NOT NULL in the Gladys core: a text feature
// sent without them fails the whole publication (HTTP 422). 0/0 is what the
// core's own UI stores for a text feature.
const TEXT_RANGE = { min: 0, max: 0 };

// The largest station of the network holds about 50 docks; a counter max is
// only a display bound, the capacity of the station sets it when known.
const DEFAULT_MAX = 100;

/** Feature keys. Forever: Gladys keys history and scenes on them. */
export const FEATURES = {
  mechanical: 'mechanical',
  electric: 'electric',
  bikes: 'bikes',
  docks: 'docks',
  status: 'status',
  summary: 'summary',
};

const LABELS = {
  fr: {
    mechanical: 'Vélos musculaires',
    electric: 'Vélos électriques',
    bikes: 'Vélos disponibles',
    docks: 'Places libres',
    status: 'État',
    summary: 'Résumé',
    states: {
      ok: 'En service',
      closed: 'Hors service',
      no_rent: 'Location suspendue',
      no_return: 'Retour impossible',
      unknown: 'Station inconnue du service',
    },
    count: (n, one, many) => `${n} ${n > 1 ? many : one}`,
    words: {
      mechanical: ['musculaire', 'musculaires'],
      electric: ['électrique', 'électriques'],
      bikes: ['vélo', 'vélos'],
      docks: ['place', 'places'],
    },
  },
  en: {
    mechanical: 'Classic bikes',
    electric: 'Electric bikes',
    bikes: 'Bikes available',
    docks: 'Free docks',
    status: 'Status',
    summary: 'Summary',
    states: {
      ok: 'In service',
      closed: 'Out of service',
      no_rent: 'Rentals suspended',
      no_return: 'Returns impossible',
      unknown: 'Station unknown to the service',
    },
    count: (n, one, many) => `${n} ${n === 1 ? one : many}`,
    words: {
      mechanical: ['classic', 'classic'],
      electric: ['electric', 'electric'],
      bikes: ['bike', 'bikes'],
      docks: ['dock', 'docks'],
    },
  },
};

/**
 * The state of a station, as a key of LABELS.states.
 * @param {object | undefined} status one station of parseStatus
 */
export function stateOf(status) {
  if (!status) return 'unknown';
  if (!status.installed || (!status.renting && !status.returning)) return 'closed';
  if (!status.renting) return 'no_rent';
  if (!status.returning) return 'no_return';
  return 'ok';
}

/**
 * The words of a state, for the widget caption: "Location suspendue".
 * @param {string} state a key of LABELS.states (stateOf)
 * @param {string} language
 */
export function stateLabel(state, language = 'fr') {
  return LABELS[language].states[state];
}

/**
 * The summary sentence: "10 musculaires · 5 électriques · 28 places", or the
 * state when the station is not in service: "Hors service".
 * @param {object | undefined} status one station of parseStatus
 * @param {string} language
 */
export function formatSummary(status, language = 'fr') {
  const labels = LABELS[language];
  const state = stateOf(status);
  if (state === 'unknown' || state === 'closed') return labels.states[state];
  const word = (key, n) => labels.count(n, ...labels.words[key]);
  const parts =
    status.mechanical === null
      ? [word('bikes', status.bikes)]
      : [word('mechanical', status.mechanical), word('electric', status.electric)];
  parts.push(word('docks', status.docks));
  const text = parts.join(' · ');
  return state === 'ok' ? text : `${text} (${labels.states[state]})`;
}

/**
 * The blueprint of one station.
 * @param {{ station: string, label?: string }} entry
 *   `label` is the reason it is proposed ("à 250 m").
 */
export function createStationBlueprint(entry) {
  // The platform id is the GBFS station_id: it never changes, so it never
  // takes a name (a station renamed by TBM keeps its device and its history).
  const platformId = entry.station;

  /** What the directory says of the station (may be nothing yet). */
  const describe = () => {
    const station = getDirectory()?.stations?.[entry.station];
    return {
      name: station?.name ?? `Station ${entry.station}`,
      address: station?.address ?? '',
      capacity: station?.capacity ?? null,
    };
  };

  return {
    key: `${DEVICE_TYPE}:${platformId}`,
    type: DEVICE_TYPE,
    station: entry.station,
    label: entry.label,
    describe,

    deviceExternalId(gladys) {
      return gladys.externalIds(DEVICE_TYPE, platformId).device;
    },

    buildDevice(gladys, config) {
      const ids = gladys.externalIds(DEVICE_TYPE, platformId);
      const labels = LABELS[config.language];
      const info = describe();
      const max = info.capacity ?? DEFAULT_MAX;
      const counter = (key) => ({
        name: labels[key],
        external_id: ids.feature(key),
        category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
        min: 0,
        max,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      });
      const text = (key) => ({
        name: labels[key],
        external_id: ids.feature(key),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        ...TEXT_RANGE,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      });
      return {
        name: `Le Vélo – ${info.name}`,
        external_id: ids.device,
        // Gladys only polls a device created with both fields, and only at one
        // of its own frequencies: the configured interval is applied by the
        // poll dispatcher (src/devices/index.js), not here.
        should_poll: true,
        poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
        params: [{ name: 'station', value: entry.station }],
        features: [
          counter(FEATURES.mechanical),
          counter(FEATURES.electric),
          counter(FEATURES.bikes),
          counter(FEATURES.docks),
          text(FEATURES.status),
          text(FEATURES.summary),
        ],
      };
    },

    /**
     * The status of this station (undefined when the feed does not list it).
     * Shared by the poll and the buttons, so they always agree.
     * @param {{ now?: number, fresh?: boolean }} [options]
     */
    async read(options = {}) {
      const stations = await fetchStatus(options);
      return stations[entry.station];
    },

    async onPoll(gladys, config, { now = Date.now() } = {}) {
      const ids = gladys.externalIds(DEVICE_TYPE, platformId);
      const status = await this.read({ now });
      const labels = LABELS[config.language];
      const state = (key, value) => ({
        device_feature_external_id: ids.feature(key),
        state: value,
      });
      const states = [
        state(FEATURES.bikes, status?.bikes ?? 0),
        state(FEATURES.docks, status?.docks ?? 0),
        {
          device_feature_external_id: ids.feature(FEATURES.status),
          text: labels.states[stateOf(status)],
        },
        {
          device_feature_external_id: ids.feature(FEATURES.summary),
          text: formatSummary(status, config.language),
        },
      ];
      // A feed without the split by kind leaves those two counters as they
      // were rather than claiming no bike of either kind.
      if (!status || status.mechanical !== null) {
        states.push(
          state(FEATURES.mechanical, status?.mechanical ?? 0),
          state(FEATURES.electric, status?.electric ?? 0),
        );
      }
      // Only what moved. The SDK forgets these values when the user creates or
      // updates the device, so a new device gets all of them.
      await gladys.publishChangedStates(states);
      if (!status) logger.warn(`Station ${platformId} is not in the status feed`);
      return status;
    },
  };
}
