# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
Its runtime dependencies are that SDK and `sharp` (the map image). Sibling of
`daviddu26/gladys-tbm`, with the same tooling and conventions.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/gbfs.test.js             # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI runs `format:check`, `lint` and `test` on Node 22 and 24, and builds the
Docker image: run the three commands before pushing.

## What this integration does

Le Vélo par TBM (Bordeaux bike share), read from its GBFS 3.0 feeds with the
public open-data key. One read-only device per **station**: classic bikes,
electric bikes, total, free docks (counters with history), state and summary
(texts). The stations near the house are proposed in the Discover tab
(`location: true`, `getHouses()`).

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/api/http.js                   fetch with timeout and User-Agent, VeloApiError
src/api/gbfs.js                   feeds, parsing, directory (a day in /data), shared status
src/devices/index.js              registry: configured + suggested + created devices, poller, actions
src/devices/station.js            the device type: a station, its six features
src/devices/suggestions.js        the stations near the house, and the house location
src/widgets.js                    dashboard widgets "station" and "map", map images by key
src/map.js                        map rendering: OSM tiles (cached in /data/tiles), markers, sharp
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
test/helpers/fixtures.js          GBFS answers shaped like the real ones (2026-10)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## What is known of the Le Vélo data

- GBFS 3.0 at `https://bdx.mecatran.com/utw/ws/gbfs/bordeaux/v3/<feed>.json?apiKey=opendata-bordeaux-metropole-flux-gtfs-rt`
  (data set "Station Le Vélo en temps réel", transport.data.gouv.fr). Feeds:
  `system_information`, `vehicle_types`, `station_information` (ttl 3600),
  `station_status` (ttl 60). bdx.mecatran.com is out of reach of the
  development sandbox: the fixtures follow what was seen on 2026-10-13.
- ~232 stations, ids are numeric strings ("1" Meriadeck … "903"), with gaps.
  `name` and `address` are `[{ text, language: "fr" }]`.
- Two vehicle types: `classic` (propulsion `human`) and `electric`
  (`electric_assist`, 50 km range). **The `classic` type is named "Vélo
  électrique" in the feed**: the kind comes from `propulsion_type`, never from
  the name.
- `station_status`: `num_vehicles_available`, `num_docks_available`,
  `vehicle_types_available: [{ vehicle_type_id, count }]`, `is_installed`,
  `is_renting`, `is_returning`, `last_reported` (RFC 3339). No
  `num_vehicles_disabled` nor `vehicle_docks_available`.
- A station that does not rent counts 0 bikes, one that does not return 0
  docks (`parseStatus`): what a threshold scene expects.
- The device param `station` rebuilds a created device: never rename it. The
  platform id is the GBFS `station_id`.

## The map widget

- Gladys has no map component: the widget content holds an `image` whose key
  is a hash of what it shows (`map-<sha1>`); the rendering starts when the card
  is built and `onWidgetGetImage` awaits it. JPEG 800 × 450, well under the
  300 KB limit.
- OpenStreetMap tile policy: User-Agent of the integration, 2 downloads at
  once, tiles kept 30 days in `/data/tiles`, attribution drawn on the image.
  Downloads stop after 6 s so the image answers within Gladys' 15 s.
- tile.openstreetmap.org is out of reach of the development sandbox: the
  tests use a plain tile (`test/helpers/stubFetch.js`).
- The text is drawn by sharp through fontconfig: the Dockerfile installs
  `font-dejavu fontconfig`, and the CI draws a text in the built image to
  catch a missing font (the pills would come out empty, silently).

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`. Gladys keys devices, their history,
  scenes and dashboards on them: changing one creates a new device and orphans
  the old one. The same goes for every key users store: manifest
  `config_schema`, `actions`, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading: the Release workflow moves
  the section.
- **Manifest.** Texts are `{ "en": ..., "fr": ... }` objects. The catalog
  `description` holds 10 to 100 characters per language.
- **User-facing text** is bilingual (English and French), docs kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
