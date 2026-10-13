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
//   - optionally, the history of the bikes (a chart bound to the features,
//     drawn by Gladys from the history it keeps): when the station empties.
//
// Nothing here throws at the dashboard: a device removed, or the API down,
// renders as a card saying so — an empty or failed widget tells nothing.
// -----------------------------------------------------------------------------

import {
  createLogger,
  WIDGET_CHART_INTERVALS,
  WIDGET_CHART_TYPES,
  WIDGET_COLORS,
  WIDGET_TEXT_VARIANTS,
} from '@gladysassistant/integration-sdk';
import { DeviceSelectionError, findSelectedBlueprint } from './devices/index.js';
import { FEATURES, stateOf, stateLabel, DEVICE_TYPE } from './devices/station.js';
import { VeloApiError } from './api/http.js';

const logger = createLogger({ name: 'widgets' });

/** Widget key, as declared in the manifest. Forever. */
export const STATION_WIDGET = 'station';

// The status feed moves every minute; the core re-pulls the card at this pace.
const TTL_SECONDS = 60;

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
    mechanical: 'Musculaires',
    electric: 'Électriques',
    docks: 'Places libres',
    history: 'Vélos disponibles',
    reported: (time) => `Mis à jour à ${time}.`,
  },
  en: {
    mechanical: 'Classic',
    electric: 'Electric',
    docks: 'Free docks',
    history: 'Bikes available',
    reported: (time) => `Updated at ${time}.`,
  },
};

/**
 * The card of one station.
 * @param {{ name: string }} info
 * @param {object | undefined} status one station of parseStatus
 * @param {{ threshold?: number, history?: string | null,
 *   featureIds?: { mechanical: string, electric: string } }} [options]
 *   `featureIds`: the external ids of the two counters, for the chart
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
      tile('history', status.bikes, 'disc', countColor(status.bikes, threshold, status.renting)),
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
      device_features: [featureIds.mechanical, featureIds.electric],
      interval: history,
      title: { en: LABELS.en.history, fr: LABELS.fr.history },
    });
  }
  return { ttl_seconds: TTL_SECONDS, components };
}

export const WIDGETS = {
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
