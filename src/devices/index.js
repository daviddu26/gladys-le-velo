// -----------------------------------------------------------------------------
// Device registry.
//
// One device type: a Le Vélo station (src/devices/station.js). The list is
// not a static catalog: one device per station followed, built from three
// sources merged by station id:
//   1. the stations typed in the configuration ("1, 12");
//   2. the suggestions: the stations closest to the house
//      (src/devices/suggestions.js);
//   3. the devices the user already created, rebuilt from their own params:
//      a device keeps refreshing once it stops being suggested, or after its
//      id left the configuration — a device is deleted in Gladys, not by
//      editing a text field.
//
// Nothing here is controllable: bike-share data is read-only.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import {
  fetchStatus,
  findStation,
  getDirectory,
  loadDirectory,
  searchStations,
} from '../api/gbfs.js';
import { VeloApiError } from '../api/http.js';
import { createStationBlueprint, DEVICE_TYPE, formatSummary } from './station.js';
import { getSuggestions } from './suggestions.js';

const logger = createLogger({ name: 'devices' });

/** The value of a param of a device listed by the SDK. */
function paramValue(device, name) {
  const param = (device?.params ?? []).find((candidate) => candidate?.name === name);
  return param?.value === undefined || param?.value === null ? '' : String(param.value);
}

/**
 * The stations behind the devices the user created (their params).
 * @param {object} gladys
 */
export function createdStations(gladys) {
  return (gladys?.devices ?? []).map((device) => paramValue(device, 'station')).filter(Boolean);
}

/**
 * The ids of the "stations" field found in the directory, and the ones that
 * are not, for the connection status.
 * @param {ReturnType<import('../config.js').normalizeConfig>} config
 */
export function configuredStations(config) {
  const dir = getDirectory();
  const unknown = [...config.watched.invalid];
  if (!dir) return { stations: [], unknown };
  const stations = [];
  for (const id of config.watched.ids) {
    if (findStation(dir, id)) stations.push(id);
    else unknown.push(id);
  }
  return { stations, unknown };
}

/**
 * Every blueprint: configuration, suggestions, created devices.
 * @param {object} gladys
 * @param {ReturnType<import('../config.js').normalizeConfig>} config
 */
export function buildBlueprints(gladys, config) {
  const entries = [
    ...configuredStations(config).stations.map((station) => ({ station })),
    ...getSuggestions().entries,
    ...createdStations(gladys).map((station) => ({ station })),
  ];
  const seen = new Set();
  const blueprints = [];
  for (const entry of entries) {
    if (seen.has(entry.station)) continue;
    seen.add(entry.station);
    blueprints.push(createStationBlueprint(entry));
  }
  return blueprints;
}

/** The discovery payload. */
export function buildDiscoveredDevices(gladys, config) {
  return buildBlueprints(gladys, config).map((blueprint) => blueprint.buildDevice(gladys, config));
}

/** The blueprint owning a device, from its external_id. */
export function findBlueprintByDevice(gladys, device, config) {
  return buildBlueprints(gladys, config).find(
    (blueprint) => blueprint.deviceExternalId(gladys) === device?.external_id,
  );
}

/**
 * Error raised when a widget points at a device the integration cannot read.
 * It carries the explanation the widget displays.
 */
export class DeviceSelectionError extends Error {
  constructor(userMessage) {
    super(userMessage.en);
    this.name = 'DeviceSelectionError';
    this.userMessage = userMessage;
  }
}

/**
 * The blueprint behind the device a widget was set up with.
 * @throws {DeviceSelectionError}
 */
export function findSelectedBlueprint(gladys, deviceExternalId, config, type = DEVICE_TYPE) {
  if (typeof deviceExternalId !== 'string' || deviceExternalId.length === 0) {
    throw new DeviceSelectionError({
      en: 'Choose a Le Vélo station in the settings.',
      fr: 'Choisissez une station Le Vélo dans les réglages.',
    });
  }
  const blueprint = findBlueprintByDevice(gladys, { external_id: deviceExternalId }, config);
  if (!blueprint || blueprint.type !== type) {
    throw new DeviceSelectionError({
      en: 'This device is no longer known to the integration: add it again, or choose another one.',
      fr: 'Cet appareil n’est plus connu de l’intégration : ajoutez-le à nouveau, ou choisissez-en un autre.',
    });
  }
  return blueprint;
}

// Gladys' poll ticks drift by a few milliseconds: a read due within the next
// half-minute runs now, so a 120 s interval does not slip to 180 s.
const POLL_TOLERANCE_MS = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES / 2;

/**
 * The `onPoll` dispatcher: route the poll to the blueprint owning the device,
 * at the interval of the configuration (Gladys ticks once a minute).
 */
export function createPoller() {
  const lastReads = new Map();
  return async function pollDevice(
    gladys,
    device,
    config,
    { now = Date.now(), force = false } = {},
  ) {
    const blueprint = findBlueprintByDevice(gladys, device, config);
    if (!blueprint) {
      logger.debug(`onPoll ignored, ${device.external_id} is not a known device`);
      return false;
    }
    const last = lastReads.get(blueprint.key);
    if (
      !force &&
      last !== undefined &&
      now - last < config.poll_frequency * 1000 - POLL_TOLERANCE_MS
    ) {
      return false;
    }
    await blueprint.onPoll(gladys, config, { now });
    lastReads.set(blueprint.key, now);
    return true;
  };
}

/** One station of a list: "1 — Meriadeck (Rue Claude Bonnier, Bordeaux)". */
function describeStation(station) {
  return `${station.id} — ${station.name}${station.address ? ` (${station.address})` : ''}`;
}

/** Handlers of the manifest actions (the buttons of the Configuration screen). */
const RAW_ACTIONS = {
  /** Find a station by name or address, and show the ids to paste in "Stations". */
  async search_stations(_gladys, { fields }) {
    const query = String(fields?.query ?? '').trim();
    if (query.length < 2) {
      return { en: 'Type at least 2 characters.', fr: 'Saisissez au moins 2 caractères.' };
    }
    const dir = await loadDirectory();
    const results = searchStations(dir, query);
    if (results.length === 0) {
      return {
        en: `No Le Vélo station matches "${query}". Try part of the name or of the street, e.g. "Meriadeck".`,
        fr: `Aucune station Le Vélo ne correspond à « ${query} ». Essayez une partie du nom ou de la rue, ex. « Meriadeck ».`,
      };
    }
    const list = results.map(describeStation).join('\n');
    return {
      en: `Paste the number in "Stations", e.g. ${results[0].id}:\n${list}`,
      fr: `Collez le numéro dans « Stations », ex. ${results[0].id} :\n${list}`,
    };
  },

  /** Read the directory and the status of one station, now. */
  async test_connection(gladys, { config }) {
    const dir = await loadDirectory({ fresh: true });
    const status = await fetchStatus({ fresh: true });
    const count = Object.keys(dir.stations).length;
    const blueprint = buildBlueprints(gladys, config)[0];
    const station = dir.stations[blueprint?.station] ?? Object.values(dir.stations)[0];
    const sample = station
      ? {
          en: `${station.name}: ${formatSummary(status[station.id], 'en')}.`,
          fr: `${station.name} : ${formatSummary(status[station.id], 'fr')}.`,
        }
      : null;
    const suggestions = getSuggestions();
    const near = {
      ok: {
        en: `Near ${suggestions.house ?? 'the house'}: ${suggestions.entries.length} station(s) in the Discovery tab.`,
        fr: `Près de ${suggestions.house ?? 'la maison'} : ${suggestions.entries.length} station(s) dans l’onglet Découverte.`,
      },
      no_location: {
        en: 'The house has no address in Gladys: set it in Settings → Houses to get the stations near it.',
        fr: 'La maison n’a pas d’adresse dans Gladys : renseignez-la dans Paramètres → Maisons pour avoir les stations proches.',
      },
      no_permission: {
        en: 'Gladys does not share the house location with the integration.',
        fr: 'Gladys ne partage pas la position de la maison avec l’intégration.',
      },
      disabled: {
        en: 'Stations near the house: turned off.',
        fr: 'Stations près de la maison : désactivé.',
      },
      no_directory: {
        en: 'Stations near the house: not looked up yet.',
        fr: 'Stations près de la maison : pas encore recherchées.',
      },
    }[suggestions.status];
    return {
      en: [`Le Vélo API OK: ${count} stations.`, sample?.en, near.en].filter(Boolean).join('\n'),
      fr: [`API Le Vélo OK : ${count} stations.`, sample?.fr, near.fr].filter(Boolean).join('\n'),
    };
  },
};

/**
 * The action handlers, with the API refusals turned into a message the user
 * can act on (a thrown error shows the raw text under the button).
 */
export const ACTIONS = Object.fromEntries(
  Object.entries(RAW_ACTIONS).map(([key, handler]) => [
    key,
    async (gladys, context) => {
      try {
        return await handler(gladys, context);
      } catch (err) {
        if (err instanceof VeloApiError) {
          logger.warn(`Action ${key} failed: ${err.message}`);
          return err.userMessage;
        }
        throw err;
      }
    },
  ]),
);

export { DEVICE_TYPE };
