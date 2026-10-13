// -----------------------------------------------------------------------------
// Dashboard widget "station" (manifest `widgets`).
//
// The devices already put every value on the dashboard, one feature per row,
// and that does not answer the one question asked before leaving: "is there a
// bike of the kind I want, and a dock where I go?". The widget is a card the
// integration composes itself, for one station:
//   - three tiles: classic bikes, electric bikes, free docks, each green,
//     orange when few are left (the threshold of the settings), red at zero;
//   - a caption: how many minutes away on foot, then the state when the
//     station is not fully in service, else the time of the last report;
//   - optionally, the history of the bikes and of the free docks (a chart
//     bound to the features, drawn by Gladys from the history it keeps): when
//     the station empties, and when it is full.
//
// Dashboard widget "map": the house and the stations on an OpenStreetMap
// background (src/map.js), each station a pill with its classic bikes, its
// electric bikes and its free docks (or some of them), colored like the tiles
// above; under the map, the same stations by walking time, with their names.
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
import { fetchStatus, getDirectory, stationsNear } from './api/gbfs.js';
import { renderMap } from './map.js';
import { formatWalk, walkingTimes } from './api/walk.js';
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
    reported: (time) => `mis à jour à ${time}`,
  },
  en: {
    bikes: 'Bikes',
    mechanical: 'Classic',
    electric: 'Electric',
    docks: 'Free docks',
    history: 'Bikes and free docks',
    reported: (time) => `updated at ${time}`,
  },
};

/**
 * The card of one station.
 * @param {{ name: string }} info
 * @param {object | undefined} status one station of parseStatus
 * @param {{ threshold?: number, history?: string | null,
 *   featureIds?: { mechanical: string, electric: string, docks: string },
 *   walk?: { minutes: number, exact: boolean } | null }} [options]
 *   `featureIds`: the external ids of the three counters, for the chart;
 *   `walk`: the walking time from the house (none without a located house)
 */
export function stationContent(
  info,
  status,
  { threshold = DEFAULT_THRESHOLD, history = null, featureIds, walk = null } = {},
) {
  const components = [
    { type: 'text', variant: WIDGET_TEXT_VARIANTS.HEADING, text: truncate(info.name, 40) },
  ];
  const state = stateOf(status);

  // The caption: how far on foot, then what is wrong; when all is well, how
  // fresh it is. "6 min à pied · Location suspendue."
  const notes = { en: [], fr: [] };
  for (const language of ['en', 'fr']) {
    if (walk) notes[language].push(formatWalk(walk, language));
    if (state !== 'ok') notes[language].push(stateLabel(state, language));
    else if (status.reportedAt) {
      notes[language].push(LABELS[language].reported(clock.format(new Date(status.reportedAt))));
    }
  }
  if (notes.fr.length > 0) {
    const sentence = (parts) => {
      const text = parts.join(' · ');
      return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
    };
    components.push({
      type: 'text',
      variant: WIDGET_TEXT_VARIANTS.CAPTION,
      text: { en: truncate(sentence(notes.en), 80), fr: truncate(sentence(notes.fr), 80) },
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

/** What the pills count: everything (default), the bikes, or the free docks. */
export function selectedShow(value) {
  return value === 'docks' || value === 'bikes' ? value : 'all';
}

const MAP_LABELS = {
  fr: {
    followed: 'Mes stations Le Vélo',
    nearby: 'Le Vélo près de chez moi',
    alt: 'Carte de la maison et des stations Le Vélo',
    bikes: (s) =>
      s.mechanical === null ? `${s.bikes} vélos` : `${s.mechanical} musc. · ${s.electric} élec.`,
    docks: (s) => `${s.docks} ${s.docks > 1 ? 'places' : 'place'}`,
    all: (s) =>
      s.mechanical === null
        ? `${s.bikes} vélos · ${s.docks} pl.`
        : `${s.mechanical} musc. · ${s.electric} élec. · ${s.docks} pl.`,
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
    all: (s) =>
      s.mechanical === null
        ? `${s.bikes} bikes · ${s.docks} docks`
        : `${s.mechanical} classic · ${s.electric} elec. · ${s.docks} docks`,
    unknown: 'unknown to the service',
  },
};

/**
 * One station on the map: where, which color, what its pill says.
 * @param {object | undefined} status one station of parseStatus
 * @param {'all' | 'bikes' | 'docks'} show
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
  const bikes =
    status.mechanical === null
      ? [{ icon: 'bike', text: String(status.bikes) }]
      : [
          { icon: 'bike', text: String(status.mechanical) },
          { icon: 'bolt', text: String(status.electric) },
        ];
  return {
    // Everything shown: the color still speaks of the bikes, what one comes
    // to a station for first.
    color: countColor(status.bikes, threshold, status.renting),
    parts: show === 'all' ? [...bikes, { icon: 'dock', text: String(status.docks) }] : bikes,
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
 *   stations: { name: string, lat: number, lon: number,
 *     walk: { minutes: number, exact: boolean } | null, status: object | undefined }[],
 *   show: 'all' | 'bikes' | 'docks', threshold: number }} view
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
      const text = (language) =>
        station.status ? MAP_LABELS[language][show](station.status) : MAP_LABELS[language].unknown;
      const label = (language) => {
        const where = station.walk ? ` · ${formatWalk(station.walk, language)}` : '';
        return `${truncate(station.name, 40 - where.length)}${where}`;
      };
      return {
        label: { en: label('en'), fr: label('fr') },
        value: { en: truncate(text('en'), 40), fr: truncate(text('fr'), 40) },
        color: markers[i].color,
      };
    }),
  });
  return { ttl_seconds: TTL_SECONDS, components };
}

/**
 * The stations of the map widget, the nearest on foot first.
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
  // The closest by straight line first: the walking times are only asked for
  // the stations shown.
  let stations = ids.map((id) => {
    const { name, lat, lon } = dir.stations[id];
    return { id, name, lat, lon, walk: null };
  });
  if (house) {
    const away = (station) => (station.lat - house.lat) ** 2 + (station.lon - house.lon) ** 2;
    stations.sort((a, b) => away(a) - away(b));
  }
  stations = stations.slice(0, MAP_MAX_STATIONS);
  if (house) {
    const walks = await walkingTimes(house, stations);
    for (const station of stations) station.walk = walks[station.id];
    stations.sort((a, b) => a.walk.minutes - b.walk.minutes);
  }
  return { house, stations };
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
        const station = getDirectory()?.stations?.[blueprint.station];
        const house = station ? await homeLocation(gladys) : null;
        const walk = house ? (await walkingTimes(house, [station]))[station.id] : null;
        return stationContent(blueprint.describe(), status, {
          walk,
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
