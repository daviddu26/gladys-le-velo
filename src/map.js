// -----------------------------------------------------------------------------
// The map of the "map" widget: OpenStreetMap tiles, the house, the stations.
//
// Gladys offers no map component to integrations: the widget shows an image
// the integration renders itself (PNG/JPEG/WebP, 300 KB at most, a 16:9
// frame). The image is built here with sharp:
//   1. the zoom is the largest that shows the house and every station;
//   2. the OpenStreetMap tiles covering that view are put together;
//   3. the markers are drawn on top as SVG: the house, and for each station
//      a pill with its counts, colored like the tiles of the station widget.
//
// OpenStreetMap tile usage policy (operations.osmfoundation.org/policies/
// tiles): a User-Agent naming the application, at most 2 downloads at once,
// tiles kept locally at least 7 days, and the attribution shown. The view of
// a house barely changes, so the tiles are downloaded once and kept 30 days
// in /data/tiles: in normal use the integration fetches nothing from OSM.
// Without tiles (offline, refused), the map is drawn on a plain background
// rather than not at all.
// -----------------------------------------------------------------------------

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { createLogger } from '@gladysassistant/integration-sdk';
import { fetchBuffer } from './api/http.js';

const logger = createLogger({ name: 'map' });

export const WIDTH = 800;
export const HEIGHT = 450;
const TILE = 256;
const MIN_ZOOM = 12;
const MAX_ZOOM = 17;
// The markers are drawn this much bigger than their design size: the image
// is shown about half its width in a dashboard box.
const MARKER_SCALE = 1.5;
// Room kept around the points: the pills find their place around them
// (placePills), and stay inside the frame.
const PADDING = { x: 90, top: 60, bottom: 60 };

const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const TILE_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
// Gladys waits 15 s for an image: downloads stop after this budget (the
// missing tiles stay blank, and come at the next view), each one capped too.
const DOWNLOAD_BUDGET_MS = 6000;
const TILE_TIMEOUT_MS = 4000;
const dataDir = () => process.env.VELO_DATA_DIR || '/data';

// The colors of the widget vocabulary, as the Gladys theme draws them.
export const MARKER_COLORS = {
  success: '#2f9e44',
  warning: '#e8590c',
  danger: '#c92a2a',
  neutral: '#868e96',
};
const HOUSE_COLOR = '#8b1a3e';

/** Web Mercator: a position in pixels of the world map at zoom `z`. */
export function project({ lat, lon }, z) {
  const scale = TILE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/**
 * The view showing every point: the largest zoom where they fit with their
 * margins, centered on them.
 * @param {{ lat: number, lon: number }[]} points
 * @returns {{ zoom: number, left: number, top: number }} the top-left corner, in world pixels
 */
export function fitView(points) {
  let zoom = MAX_ZOOM;
  for (; zoom > MIN_ZOOM; zoom -= 1) {
    const xy = points.map((point) => project(point, zoom));
    const width = Math.max(...xy.map((p) => p.x)) - Math.min(...xy.map((p) => p.x));
    const height = Math.max(...xy.map((p) => p.y)) - Math.min(...xy.map((p) => p.y));
    if (width <= WIDTH - 2 * PADDING.x && height <= HEIGHT - PADDING.top - PADDING.bottom) break;
  }
  const xy = points.map((point) => project(point, zoom));
  const cx = (Math.max(...xy.map((p) => p.x)) + Math.min(...xy.map((p) => p.x))) / 2;
  const cy =
    (Math.max(...xy.map((p) => p.y)) + Math.min(...xy.map((p) => p.y))) / 2 -
    (PADDING.top - PADDING.bottom) / 2;
  return { zoom, left: Math.round(cx - WIDTH / 2), top: Math.round(cy - HEIGHT / 2) };
}

/**
 * One tile, from /data when fresh enough, else from OpenStreetMap (when
 * `download` allows it); null when none.
 */
async function loadTile(z, x, y, download = true) {
  const file = join(dataDir(), 'tiles', `${z}-${x}-${y}.png`);
  let cached = null;
  try {
    const info = await stat(file);
    cached = await readFile(file);
    if (Date.now() - info.mtimeMs < TILE_MAX_AGE_MS) return cached;
  } catch {
    // Not downloaded yet.
  }
  if (!download) return cached;
  try {
    const tile = await fetchBuffer(TILE_URL(z, x, y), { timeoutMs: TILE_TIMEOUT_MS });
    await mkdir(join(dataDir(), 'tiles'), { recursive: true });
    await writeFile(file, tile).catch((err) => logger.warn(`Tile not saved: ${err.message}`));
    return tile;
  } catch (err) {
    logger.warn(`Tile ${z}/${x}/${y} not downloaded: ${err.message}`);
    // An old tile is a far better background than none.
    return cached;
  }
}

/**
 * The background of a view: the tiles covering it, two downloads at most at
 * a time (OSM policy). Null when not one tile could be had.
 */
async function background({ zoom, left, top }) {
  const x0 = Math.floor(left / TILE);
  const y0 = Math.floor(top / TILE);
  const x1 = Math.floor((left + WIDTH - 1) / TILE);
  const y1 = Math.floor((top + HEIGHT - 1) / TILE);
  const max = 2 ** zoom;
  const wanted = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (y >= 0 && y < max) wanted.push({ x, y });
    }
  }
  const tiles = [];
  const deadline = Date.now() + DOWNLOAD_BUDGET_MS;
  for (let i = 0; i < wanted.length; i += 2) {
    const pair = wanted.slice(i, i + 2);
    const download = Date.now() < deadline;
    const loaded = await Promise.all(
      pair.map(({ x, y }) => loadTile(zoom, ((x % max) + max) % max, y, download)),
    );
    pair.forEach((position, k) => loaded[k] && tiles.push({ ...position, input: loaded[k] }));
  }
  if (tiles.length === 0) return null;
  const mosaic = await sharp({
    create: {
      width: (x1 - x0 + 1) * TILE,
      height: (y1 - y0 + 1) * TILE,
      channels: 3,
      background: '#e9e5dc',
    },
  })
    .composite(
      tiles.map((t) => ({ input: t.input, left: (t.x - x0) * TILE, top: (t.y - y0) * TILE })),
    )
    .png()
    .toBuffer();
  return sharp(mosaic)
    .extract({ left: left - x0 * TILE, top: top - y0 * TILE, width: WIDTH, height: HEIGHT })
    .png()
    .toBuffer();
}

function escape(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
  );
}

// DejaVu Sans Bold: a digit is 0.696 em wide, a space 0.348 em.
const FONT = 15;
const textWidth = (text) =>
  [...String(text)].reduce((sum, c) => sum + (c === ' ' ? 0.348 : 0.696) * FONT, 0);

// A lightning bolt, 9 × 13 px, drawn from its top-left corner.
const BOLT = 'M5.5 0 L0 7.5 H4 L2.5 13 L9 4.8 H5 L7 0 Z';
// A bicycle, 18 × 11 px.
const BIKE =
  '<circle cx="3.5" cy="7.5" r="3.2" fill="none" stroke="#fff" stroke-width="1.6"/>' +
  '<circle cx="14.5" cy="7.5" r="3.2" fill="none" stroke="#fff" stroke-width="1.6"/>' +
  '<path d="M3.5 7.5 L7 1.5 H12.5 L14.5 7.5 M7 1.5 L9 7.5 L12.5 1.5 M6 1 H8.5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>';

/**
 * A pill, drawn from its top-left corner at design size.
 * @param {{ icon: 'bike' | 'bolt' | 'dock', text: string }[]} parts
 * @param {string} color
 * @returns {{ width: number, height: number, svg: string }}
 */
function pill(parts, color) {
  const gap = 5;
  const iconWidth = { bike: 18, bolt: 9, dock: 10 };
  const inner = parts.reduce(
    (sum, part, i) => sum + iconWidth[part.icon] + 3 + textWidth(part.text) + (i ? gap + 6 : 0),
    0,
  );
  const width = Math.round(inner + 16);
  const height = 24;
  const middle = height / 2;
  let cursor = 8;
  const content = parts
    .map((part, i) => {
      let svg = '';
      if (i) {
        const sx = cursor + (gap + 6) / 2;
        svg += `<line x1="${sx}" y1="6" x2="${sx}" y2="${height - 6}" stroke="#fff" stroke-opacity="0.55" stroke-width="1"/>`;
        cursor += gap + 6;
      }
      if (part.icon === 'bike') {
        svg += `<g transform="translate(${cursor} ${middle - 5.5})">${BIKE}</g>`;
      } else if (part.icon === 'bolt') {
        svg += `<path transform="translate(${cursor} ${middle - 6.5})" d="${BOLT}" fill="#ffd43b"/>`;
      } else {
        svg += `<text x="${cursor}" y="${middle + 5}" font-family="DejaVu Sans" font-weight="bold" font-size="14" fill="#fff">P</text>`;
      }
      cursor += iconWidth[part.icon] + 3;
      svg += `<text x="${cursor}" y="${middle + 5.3}" font-family="DejaVu Sans" font-weight="bold" font-size="${FONT}" fill="#fff">${escape(part.text)}</text>`;
      cursor += textWidth(part.text);
      return svg;
    })
    .join('');
  return {
    width,
    height,
    svg:
      `<rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="${color}" stroke="#fff" stroke-width="2"/>` +
      content,
  };
}

const overlap = (a, b) =>
  Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) *
  Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));

/**
 * Where each pill goes. Close stations would pile their pills up: each one
 * tries, in turn, above its point, below it, to its right, to its left and
 * the four corners, and takes the first place that hides no other pill, no
 * point and not the house, inside the frame; when none is free, the one that
 * hides the least. The stations are placed in the order given (the nearest
 * to the house first: the ones that matter most get the best places).
 * @param {{ x: number, y: number, width: number, height: number }[]} markers final pixels
 * @param {{ x: number, y: number } | null} house
 * @returns {{ x: number, y: number }[]} the top-left corner of each pill
 */
export function placePills(markers, house) {
  const gap = 10;
  const margin = 4;
  const taken = [];
  if (house) {
    const r = 20 * MARKER_SCALE;
    taken.push({ x1: house.x - r, y1: house.y - r, x2: house.x + r, y2: house.y + r });
  }
  for (const m of markers) {
    taken.push({ x1: m.x - 8, y1: m.y - 8, x2: m.x + 8, y2: m.y + 8 });
  }
  return markers.map((m) => {
    const { x, y, width: w, height: h } = m;
    const candidates = [
      [x - w / 2, y - gap - h],
      [x - w / 2, y + gap],
      [x + gap, y - h / 2],
      [x - gap - w, y - h / 2],
      [x + gap * 0.7, y - gap * 0.7 - h],
      [x - gap * 0.7 - w, y - gap * 0.7 - h],
      [x + gap * 0.7, y + gap * 0.7],
      [x - gap * 0.7 - w, y + gap * 0.7],
    ].map(([cx, cy]) => {
      // Inside the frame, whatever the candidate.
      const left = Math.min(Math.max(cx, margin), WIDTH - margin - w);
      const top = Math.min(Math.max(cy, margin), HEIGHT - margin - h - 20);
      return { x1: left, y1: top, x2: left + w, y2: top + h };
    });
    // The own point is not an obstacle to its own pill.
    const others = taken.filter(
      (rect) => !(rect.x1 === x - 8 && rect.y1 === y - 8 && rect.x2 === x + 8),
    );
    let best = candidates[0];
    let bestCost = Infinity;
    for (const rect of candidates) {
      const cost = others.reduce((sum, other) => sum + overlap(rect, other), 0);
      if (cost < bestCost) {
        best = rect;
        bestCost = cost;
      }
      if (cost === 0) break;
    }
    taken.push(best);
    return { x: Math.round(best.x1), y: Math.round(best.y1) };
  });
}

/** The point of a rectangle closest to (x, y), for the line to the pill. */
function nearestPoint(rect, x, y) {
  return {
    x: Math.min(Math.max(x, rect.x), rect.x + rect.width),
    y: Math.min(Math.max(y, rect.y), rect.y + rect.height),
  };
}

/** The house: a burgundy disc with a white house in it. */
function houseMarker({ x, y }) {
  return (
    `<g transform="translate(${x} ${y}) scale(${MARKER_SCALE}) translate(${-x} ${-y})">` +
    `<circle cx="${x}" cy="${y}" r="16" fill="${HOUSE_COLOR}" stroke="#fff" stroke-width="3"/>` +
    `<path transform="translate(${x - 9} ${y - 9})" d="M9 1.5 L1 8.5 H3.5 V16.5 H7.5 V11.5 H10.5 V16.5 H14.5 V8.5 H17 Z" fill="#fff"/>` +
    `</g>`
  );
}

/**
 * Render the map.
 * @param {{ house: { lat: number, lon: number } | null,
 *   stations: { lat: number, lon: number, color: string,
 *     parts: { icon: 'bike' | 'bolt' | 'dock', text: string }[] }[] }} spec
 *   `color` is a key of MARKER_COLORS
 * @returns {Promise<Buffer>} a JPEG of WIDTH × HEIGHT
 */
export async function renderMap({ house, stations }) {
  const points = [...(house ? [house] : []), ...stations];
  const view = fitView(points);
  const at = (point) => {
    const p = project(point, view.zoom);
    return { x: Math.round(p.x - view.left), y: Math.round(p.y - view.top) };
  };
  const tiles = await background(view);

  const marks = stations.map((station) => {
    const color = MARKER_COLORS[station.color] ?? MARKER_COLORS.neutral;
    const drawn = pill(station.parts, color);
    return {
      ...at(station),
      color,
      drawn,
      width: drawn.width * MARKER_SCALE,
      height: drawn.height * MARKER_SCALE,
    };
  });
  const houseAt = house ? at(house) : null;
  const places = placePills(marks, houseAt);
  // The lines and the dots first, the pills over them.
  const links = marks
    .map((point, i) => {
      const box = { ...places[i], width: point.width, height: point.height };
      const end = nearestPoint(box, point.x, point.y);
      return (
        `<line x1="${point.x}" y1="${point.y}" x2="${end.x}" y2="${end.y}" stroke="${point.color}" stroke-width="3"/>` +
        `<circle cx="${point.x}" cy="${point.y}" r="7" fill="${point.color}" stroke="#fff" stroke-width="3"/>`
      );
    })
    .join('');
  const pills = marks
    .map(
      (point, i) =>
        `<g transform="translate(${places[i].x} ${places[i].y}) scale(${MARKER_SCALE})">${point.drawn.svg}</g>`,
    )
    .join('');
  const attribution = tiles
    ? `<rect x="${WIDTH - 178}" y="${HEIGHT - 20}" width="178" height="20" fill="#fff" fill-opacity="0.8"/>` +
      `<text x="${WIDTH - 6}" y="${HEIGHT - 6}" text-anchor="end" font-family="DejaVu Sans" font-size="12" fill="#333">© OpenStreetMap contributors</text>`
    : '';
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">` +
      links +
      // The house before the pills, which never stand on it.
      (houseAt ? houseMarker(houseAt) : '') +
      pills +
      attribution +
      `</svg>`,
  );
  const base = tiles
    ? sharp(tiles)
    : sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#e9e5dc' } });
  return base
    .composite([{ input: overlay, left: 0, top: 0 }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}
