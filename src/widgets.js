// -----------------------------------------------------------------------------
// Dashboard widget "station" (manifest `widgets`).
//
// The devices already put every value on the dashboard, one feature per row,
// and that does not answer the one question asked before leaving: "is there a
// bike of the kind I want, and a dock where I go?". The widget is a card the
// integration composes itself, for one station:
//   - three tiles: classic bikes, electric bikes, free docks, each green,
//     orange when few are left (the threshold of the settings), red at zero;
//   - a caption: the state when the station is not fully in service, else the
//     time of the last report;
//   - optionally, the history of the bikes and of the free docks (a chart
//     bound to the features, drawn by Gladys from the history it keeps): when
//     the station empties, and when it is full.
//
// Dashboard widget "map": the house and the stations on an OpenStreetMap
// background (src/map.js), each station a pill with its bikes (classic and
// electric) or its free docks, colored like the tiles above; under the map,
// the same stations by distance, with their names.
//
// Nothing here throws at the dashboard: a device removed, or the API down,
// renders as a card saying so — an empty or failed widget tells nothing.
// -----------------------------------------------------------------------------

import {
  createLogger,
  WIDGET_CHART_INTERVALS,
  WIDGET_CHART_TYPES,
  WIDGET_COLORS,
  WIDGET_IMAGE_FITS,
  WIDGET_TEXT_VARIANTS,
} from '@gladysassistant/integration-sdk';
import { createHash } from 'node:crypto';
import { createdStations, DeviceSelectionError, findSelectedBlueprint } from './devices/index.js';
import { homeLocation } from './devices/suggestions.js';
import { distanceMeters, fetchStatus, getDirectory, stationsNear } from './api/gbfs.js';
import { renderMap } from './map.js';
import { FEATURES, stateOf, stateLabel, DEVICE_TYPE } from './devices/station.js';
import { VeloApiError } from './api/http.js';

const logger = createLogger({ name: 'widgets' });

/** Widget key, as declared in the manifest. Forever. */
export const STATION_WIDGET = 'station';
export const MAP_WIDGET = 'map';

// The core re-pulls the card at the pace of the shortest poll interval.
const TTL_SECONDS = 30;

const { NEUTRAL, SUCCESS, WARNING, DANGER } = WIDGET_COLORS;

/** Cut a text to the budget of its component. */
export function truncate(value, max) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function messageContent(message, ttl = 60) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: WIDGET_TEXT_VARIANTS.BODY, text: message }],
  };
}

// "Few left" from this many, as chosen in the settings.
export const DEFAULT_THRESHOLD = 2;
const THRESHOLDS = [1, 2, 3, 5];

/** The "few left" threshold of the widget settings. */
export function selectedThreshold(value) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return THRESHOLDS.includes(number) ? number : DEFAULT_THRESHOLD;
}

// The history windows offered in the settings, from the core's enum.
export const HISTORY_OPTIONS = {
  'last-twelve-hours': WIDGET_CHART_INTERVALS.LAST_TWELVE_HOURS,
  'last-day': WIDGET_CHART_INTERVALS.LAST_DAY,
  'last-week': WIDGET_CHART_INTERVALS.LAST_WEEK,
};

/** The history window of the settings, or null for no chart ("none", empty). */
export function selectedHistory(value) {
  return HISTORY_OPTIONS[String(value ?? '').trim()] ?? null;
}

/**
 * The color of a count: red at zero, orange up to the threshold, green above.
 * A station that does not rent (or return) shows grey: its zero is not
 * "everybody took them", it is "closed".
 */
export function countColor(count, threshold, available = true) {
  if (!available) return NEUTRAL;
  if (count <= 0) return DANGER;
  if (count <= threshold) return WARNING;
  return SUCCESS;
}

const clock = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
});

const LABELS = {
  fr: {
    bikes: 'Vélos',
    mechanical: 'Musculaires',
    electric: 'Électriques',
    docks: 'Places libres',
    history: 'Vélos et places libres',
    reported: (time) => `Mis à jour à ${time}.`,
  },
  en: {
    bikes: 'Bikes',
    mechanical: 'Classic',
    electric: 'Electric',
    docks: 'Free docks',
    history: 'Bikes and free docks',
    reported: (time) => `Updated at ${time}.`,
  },
};

/**
 * The card of one station.
 * @param {{ name: string }} info
 * @param {object | undefined} status one station of parseStatus
 * @param {{ threshold?: number, history?: string | null,
 *   featureIds?: { mechanical: string, electric: string, docks: string } }} [options]
 *   `featureIds`: the external ids of the three counters, for the chart
 */
export function stationContent(
  info,
  status,
  { threshold = DEFAULT_THRESHOLD, history = null, featureIds } = {},
) {
  const components = [
    { type: 'text', variant: WIDGET_TEXT_VARIANTS.HEADING, text: truncate(info.name, 40) },
  ];
  const state = stateOf(status);

  // The caption: what is wrong first; when all is well, how fresh it is.
  if (state !== 'ok') {
    components.push({
      type: 'text',
      variant: WIDGET_TEXT_VARIANTS.CAPTION,
      text: { en: `${stateLabel(state, 'en')}.`, fr: `${stateLabel(state, 'fr')}.` },
    });
  } else if (status.reportedAt) {
    const time = clock.format(new Date(status.reportedAt));
    components.push({
      type: 'text',
      variant: WIDGET_TEXT_VARIANTS.CAPTION,
      text: { en: LABELS.en.reported(time), fr: LABELS.fr.reported(time) },
    });
  }

  if (!status) return { ttl_seconds: TTL_SECONDS, components };

  const tile = (key, value, icon, color) => ({
    type: 'value',
    value,
    label: { en: LABELS.en[key], fr: LABELS.fr[key] },
    icon,
    color,
  });
  if (status.mechanical === null) {
    // A feed without the split by kind: the total, honestly.
    components.push(
      tile('bikes', status.bikes, 'disc', countColor(status.bikes, threshold, status.renting)),
    );
  } else {
    components.push(
      tile(
        'mechanical',
        status.mechanical,
        'disc',
        countColor(status.mechanical, threshold, status.renting),
      ),
      tile(
        'electric',
        status.electric,
        'zap',
        countColor(status.electric, threshold, status.renting),
      ),
    );
  }
  components.push(
    tile('docks', status.docks, 'log-in', countColor(status.docks, threshold, status.returning)),
  );

  // The history is drawn by Gladys from the features it keeps: nothing to
  // send but their ids.
  if (history && featureIds) {
    components.push({
      type: 'chart',
      chart_type: WIDGET_CHART_TYPES.STEPLINE,
      device_features: [featureIds.mechanical, featureIds.electric, featureIds.docks],
      interval: history,
      title: { en: LABELS.en.history, fr: LABELS.fr.history },
    });
  }
  return { ttl_seconds: TTL_SECONDS, components };
}

// ----------------------------------------------------------------------------
// The map widget.
// ----------------------------------------------------------------------------

// A status list holds ten rows: the map shows the same stations.
const MAP_MAX_STATIONS = 10;

/** Which stations: the ones followed (created devices), or the ones near the house. */
export function selectedScope(value) {
  return value === 'nearby' ? 'nearby' : 'followed';
}

/** What the pills count: the bikes (default) or the free docks. */
export function selectedShow(value) {
  return value === 'docks' ? 'docks' : 'bikes';
}

const MAP_LABELS = {
  fr: {
    followed: 'Mes stations Le Vélo',
    nearby: 'Le Vélo près de chez moi',
    alt: 'Carte de la maison et des stations Le Vélo',
    bikes: (s) =>
      s.mechanical === null ? `${s.bikes} vélos` : `${s.mechanical} musc. · ${s.electric} élec.`,
    docks: (s) => `${s.docks} ${s.docks > 1 ? 'places' : 'place'}`,
    unknown: 'inconnue du service',
  },
  en: {
    followed: 'My Le Vélo stations',
    nearby: 'Le Vélo near my home',
    alt: 'Map of the house and of the Le Vélo stations',
    bikes: (s) =>
      s.mechanical === null
        ? `${s.bikes} bikes`
        : `${s.mechanical} classic · ${s.electric} electric`,
    docks: (s) => `${s.docks} ${s.docks === 1 ? 'dock' : 'docks'}`,
    unknown: 'unknown to the service',
  },
};

/**
 * One station on the map: where, which color, what its pill says.
 * @param {object | undefined} status one station of parseStatus
 * @param {'bikes' | 'docks'} show
 * @param {number} threshold
 */
export function mapMarker(status, show, threshold) {
  if (!status) return { color: NEUTRAL, parts: [{ icon: 'bike', text: '?' }] };
  if (show === 'docks') {
    return {
      color: countColor(status.docks, threshold, status.returning),
      parts: [{ icon: 'dock', text: String(status.docks) }],
    };
  }
  return {
    color: countColor(status.bikes, threshold, status.renting),
    parts:
      status.mechanical === null
        ? [{ icon: 'bike', text: String(status.bikes) }]
        : [
            { icon: 'bike', text: String(status.mechanical) },
            { icon: 'bolt', text: String(status.electric) },
          ],
  };
}

// The maps asked for, by image key, and their rendering (started at once,
// awaited by onWidgetGetImage). A key names its content: the same counts make
// the same key, which the core caches an hour.
const MAP_KEEP = 30;
const maps = new Map();

function rememberMap(key, spec) {
  if (maps.has(key)) return;
  const rendering = renderMap(spec).then((image) => image.toString('base64'));
  // A failure is reported when the image is asked for, not as an unhandled
  // rejection now.
  rendering.catch(() => {});
  maps.set(key, rendering);
  while (maps.size > MAP_KEEP) maps.delete(maps.keys().next().value);
}

/** Forget the maps (tests). */
export function clearMaps() {
  maps.clear();
}

/** The base64 image of a key given by the map widget. */
export async function mapImage(key) {
  const rendering = maps.get(key);
  if (!rendering) throw new Error(`Unknown map image ${key}`);
  return rendering;
}

/**
 * The card of the map widget.
 * @param {{ scope: "followed" | "nearby", house: object | null,
 *   stations: { name: string, lat: number, lon: number, distance: number | null,
 *     status: object | undefined }[], show: 'bikes' | 'docks', threshold: number }} view
 */
export function mapContent({ scope, house, stations, show, threshold }) {
  const markers = stations.map((station) => ({
    lat: station.lat,
    lon: station.lon,
    ...mapMarker(station.status, show, threshold),
  }));
  const spec = { house: house ? { lat: house.lat, lon: house.lon } : null, stations: markers };
  const key = `map-${createHash('sha1').update(JSON.stringify(spec)).digest('hex').slice(0, 24)}`;
  rememberMap(key, spec);

  const components = [
    {
      type: 'text',
      variant: WIDGET_TEXT_VARIANTS.HEADING,
      text: { en: MAP_LABELS.en[scope], fr: MAP_LABELS.fr[scope] },
    },
  ];
  if (!house) {
    components.push({
      type: 'text',
      variant: WIDGET_TEXT_VARIANTS.CAPTION,
      text: {
        en: 'The house has no address in Gladys: the map shows the stations alone.',
        fr: 'La maison n’a pas d’adresse dans Gladys : la carte montre les stations seules.',
      },
    });
  }
  components.push({
    type: 'image',
    key,
    alt: { en: MAP_LABELS.en.alt, fr: MAP_LABELS.fr.alt },
    fit: WIDGET_IMAGE_FITS.COVER,
  });
  components.push({
    type: 'status',
    items: stations.map((station, i) => {
      const where = station.distance === null ? '' : ` · ${station.distance} m`;
      const text = (language) =>
        station.status ? MAP_LABELS[language][show](station.status) : MAP_LABELS[language].unknown;
      return {
        label: `${truncate(station.name, 40 - where.length)}${where}`,
        value: { en: truncate(text('en'), 40), fr: truncate(text('fr'), 40) },
        color: markers[i].color,
      };
    }),
  });
  return { ttl_seconds: TTL_SECONDS, components };
}

/**
 * The stations of the map widget, closest to the house first.
 * @returns {Promise<{ house: object | null, stations: object[] } | { message: object }>}
 */
export async function mapStations(gladys, config, scope) {
  const dir = getDirectory();
  if (!dir) {
    return {
      message: {
        en: 'The Le Vélo stations are not known yet: try again in a minute.',
        fr: 'Les stations Le Vélo ne sont pas encore connues : réessayez dans une minute.',
      },
    };
  }
  const located = await homeLocation(gladys);
  const house = located ?? null;
  let ids;
  if (scope === 'nearby') {
    if (!house) {
      return {
        message: {
          en: 'Give your house an address in Gladys (Settings → Houses) to see the stations near it.',
          fr: 'Donnez une adresse à votre maison dans Gladys (Paramètres → Maisons) pour voir les stations proches.',
        },
      };
    }
    ids = stationsNear(dir, house, config.nearby_radius).map(({ station }) => station.id);
  } else {
    ids = createdStations(gladys).filter((id) => dir.stations[id]);
  }
  if (ids.length === 0) {
    return {
      message:
        scope === 'nearby'
          ? {
              en: 'No station within the search radius of the house: widen it in the configuration.',
              fr: 'Aucune station dans le rayon de recherche autour de la maison : élargissez-le dans la configuration.',
            }
          : {
              en: 'No station followed yet: add some in the Discover tab, or choose “Near my home”.',
              fr: 'Aucune station suivie pour l’instant : ajoutez-en dans l’onglet Découverte, ou choisissez « Près de chez moi ».',
            },
    };
  }
  const stations = ids.map((id) => {
    const station = dir.stations[id];
    return {
      id,
      name: station.name,
      lat: station.lat,
      lon: station.lon,
      distance: house ? distanceMeters(house, station) : null,
    };
  });
  if (house) stations.sort((a, b) => a.distance - b.distance);
  return { house, stations: stations.slice(0, MAP_MAX_STATIONS) };
}

export const WIDGETS = {
  [MAP_WIDGET]: {
    async get(gladys, { settings, config }) {
      const scope = selectedScope(settings?.scope);
      try {
        const found = await mapStations(gladys, config, scope);
        if (found.message) return messageContent(found.message, 300);
        const status = await fetchStatus();
        return mapContent({
          scope,
          house: found.house,
          stations: found.stations.map((station) => ({ ...station, status: status[station.id] })),
          show: selectedShow(settings?.show),
          threshold: selectedThreshold(settings?.threshold),
        });
      } catch (err) {
        if (err instanceof VeloApiError) {
          logger.warn(`Widget ${MAP_WIDGET}: ${err.message}`);
          return messageContent(err.userMessage, 60);
        }
        throw err;
      }
    },
  },
  [STATION_WIDGET]: {
    async get(gladys, { settings, config }) {
      let blueprint;
      try {
        blueprint = findSelectedBlueprint(gladys, settings?.device, config, DEVICE_TYPE);
      } catch (err) {
        if (err instanceof DeviceSelectionError) return messageContent(err.userMessage, 300);
        throw err;
      }
      try {
        const status = await blueprint.read();
        const ids = gladys.externalIds(DEVICE_TYPE, blueprint.station);
        return stationContent(blueprint.describe(), status, {
          threshold: selectedThreshold(settings?.threshold),
          history: selectedHistory(settings?.history),
          featureIds: {
            mechanical: ids.feature(FEATURES.mechanical),
            electric: ids.feature(FEATURES.electric),
            docks: ids.feature(FEATURES.docks),
          },
        });
      } catch (err) {
        if (err instanceof VeloApiError) {
          logger.warn(`Widget ${STATION_WIDGET}: ${err.message}`);
          return messageContent(err.userMessage, 60);
        }
        throw err;
      }
    },
  },
};

/**
 * Ask the core to re-pull every widget now (after a reconnection or a
 * configuration change). Fire-and-forget, rate-limited core-side.
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
