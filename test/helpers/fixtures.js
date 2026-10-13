// -----------------------------------------------------------------------------
// GBFS 3.0 answers shaped like the real Le Vélo feeds (seen 2026-10-13), on
// network landmarks only (Meriadeck, Saint-Bruno, Piscine Judaïque, Gare
// Saint-Jean): never a personal address.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A directory read from the (stubbed) API is cached on disk: never in /data.
process.env.VELO_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'gladys-le-velo-'));

export const NOW = Date.parse('2026-10-13T09:10:40Z');

const fr = (text) => [{ text, language: 'fr' }];

export function stationInformationPayload() {
  return {
    last_updated: '2026-10-13T09:00:35Z',
    ttl: 3600,
    version: '3.0',
    data: {
      stations: [
        {
          station_id: '1',
          name: fr('Meriadeck'),
          lat: 44.83803,
          lon: -0.58437,
          address: fr('Rue Claude Bonnier (station tramway), Bordeaux'),
          post_code: '33000',
          capacity: 43,
          is_virtual_station: false,
        },
        {
          station_id: '2',
          name: fr('Saint-Bruno - Hôtel de Région'),
          lat: 44.83784,
          lon: -0.59028,
          address: fr('Rue François de Sourdis (cimetière de la Chartreuse), Bordeaux'),
          capacity: 19,
        },
        {
          station_id: '3',
          name: fr('Piscine Judaique'),
          lat: 44.840813,
          lon: -0.593233,
          address: fr('Place du Capitaine du Tertre, Bordeaux'),
          capacity: 27,
        },
        {
          station_id: '58',
          name: fr('Gare Saint-Jean'),
          lat: 44.8256,
          lon: -0.5563,
          address: fr('Rue Charles Domercq, Bordeaux'),
          capacity: 40,
        },
        // No position: left out of the directory.
        { station_id: '999', name: fr('Dépôt'), capacity: 10 },
      ],
    },
  };
}

// As published: the human-powered type is named "Vélo électrique".
export function vehicleTypesPayload() {
  return {
    last_updated: '2026-10-01T16:58:08Z',
    ttl: 86400,
    version: '3.0',
    data: {
      vehicle_types: [
        {
          vehicle_type_id: 'classic',
          form_factor: 'bicycle',
          propulsion_type: 'human',
          name: fr('Vélo électrique'),
          rider_capacity: 1,
        },
        {
          vehicle_type_id: 'electric',
          form_factor: 'bicycle',
          propulsion_type: 'electric_assist',
          max_range_meters: 50000,
          rider_capacity: 1,
        },
      ],
    },
  };
}

function status(id, classic, electric, docks, flags = {}) {
  return {
    station_id: id,
    last_reported: '2026-10-13T09:10:35Z',
    is_installed: true,
    is_renting: true,
    is_returning: true,
    num_vehicles_available: classic + electric,
    num_docks_available: docks,
    vehicle_types_available: [
      { vehicle_type_id: 'classic', count: classic },
      { vehicle_type_id: 'electric', count: electric },
    ],
    ...flags,
  };
}

export function stationStatusPayload(overrides = {}) {
  return {
    last_updated: '2026-10-13T09:10:35Z',
    ttl: 60,
    version: '3.0',
    data: {
      stations: [
        overrides['1'] ?? status('1', 10, 5, 28),
        overrides['2'] ?? status('2', 7, 4, 8),
        overrides['3'] ?? status('3', 2, 7, 18, { is_renting: false }),
        overrides['58'] ?? status('58', 0, 1, 39),
      ],
    },
  };
}

/** Meriadeck, as a Gladys house: the station is 0 m away. */
export const MERIADECK_HOUSE = {
  id: 'house-1',
  name: 'Maison',
  selector: 'maison',
  latitude: 44.83803,
  longitude: -0.58437,
};
