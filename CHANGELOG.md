# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-13

### Added

- A "Le Vélo map" dashboard widget: the house and the stations on an
  OpenStreetMap background, each with a pill of its classic and electric
  bikes (or of its free docks) in the colors of the station widget, and the
  same stations listed by distance under the map. The stations you added, or
  the ones near the house.

### Changed

- The stations are refreshed every 30 seconds instead of every minute (the
  setting now goes down to 30 s). The stations added before take it after
  “Update” in the Discover tab.

## [0.3.0] - 2026-10-13

### Changed

- The chart of the "Le Vélo station" widget draws the free docks too, next to
  the classic and the electric bikes.

## [0.2.0] - 2026-10-13

### Added

- A "Le Vélo station" dashboard widget: the classic bikes, the electric bikes
  and the free docks of a station, green, orange when few are left (threshold
  of your choice), red when none, with the state of the station and, if asked,
  a chart of the bikes over the last 12 hours, day or week.

### Changed

- A new cover image, in the style of the TBM integration: a classic bike and
  an electric bike on a cycle lane along the quays of Bordeaux.

## [0.1.0] - 2026-10-13

### Added

- One device per Le Vélo station, with the classic bikes and the electric
  bikes counted apart, the total, the free docks, the state of the station and
  a ready-made summary ("10 musculaires · 5 électriques · 28 places").
- The stations near the house proposed in the Discover tab, others added by
  number, and a "Find a station" button to get those numbers.

[Unreleased]: https://github.com/daviddu26/gladys-le-velo/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/daviddu26/gladys-le-velo/compare/v0.3.0...v1.0.0
[0.3.0]: https://github.com/daviddu26/gladys-le-velo/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/daviddu26/gladys-le-velo/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/daviddu26/gladys-le-velo/releases/tag/v0.1.0
