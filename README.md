# Gladys Le Vélo

> **Beta.** Feedback welcome in the [issues](https://github.com/daviddu26/gladys-le-velo/issues).

External integration for [Gladys Assistant](https://gladysassistant.com) that brings **Le Vélo par
TBM** (formerly V³ / VCub), the bike-share service of Bordeaux Métropole, into your smart home:

- **bikes available per station, classic and electric counted apart**, the free docks, the state
  of the station and a ready-made summary, refreshed every minute;
- **the stations near your home proposed by themselves** in the Discover tab, from the address of
  the house in Gladys;
- any other station added by its number, found with the **Find a station** button.

**No account, no key:** the availability is open data (GBFS 3.0).

Unofficial: not affiliated with TBM, Keolis Bordeaux Métropole Mobilités nor Bordeaux Métropole.

User documentation: [français](docs/fr.md) · [English](docs/en.md).

## Development

```bash
npm install
npm test               # node --test, no network access
npm run lint           # ESLint
npm run format:check   # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store .   # store admission checks
```

The project follows the official
[integration template](https://github.com/GladysAssistant/integration-template-js), like its
sibling [gladys-tbm](https://github.com/daviddu26/gladys-tbm): Node 22+, ES modules, the Gladys SDK
as the only runtime dependency, a multi-arch Docker image published to GHCR by the Release
workflow. See [CLAUDE.md](CLAUDE.md) for the architecture and the conventions.

### Publishing a version

1. In GitHub: **Actions → Release → Run workflow**, choose **minor** for the first release
   (0.0.0 → 0.1.0). It bumps the version, rolls the changelog, tags, builds the image
   (`linux/amd64`, `linux/arm64`) and creates the GitHub Release.
2. The first time only: make the GHCR package **public** (Packages → gladys-le-velo → Package
   settings → Change visibility). Gladys refuses an image it cannot pull.
3. Add the topic `gladys-assistant-integration` to the repository: the store picks the
   integration up within the hour.

## Data and licences

- Stations and availability: Bordeaux Métropole, data set
  [Station Le Vélo en temps réel](https://transport.data.gouv.fr/datasets/station-le-velo-en-temps-reel-1)
  (GBFS), [Licence Ouverte / Open Licence](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).
- Code: Apache License 2.0.
