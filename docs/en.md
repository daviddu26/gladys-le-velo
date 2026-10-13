# Le Vélo (TBM)

This integration brings into Gladys the **bikes available and the free docks** of the **Le Vélo
par TBM** stations (formerly V³ / VCub), the bike-share service of Bordeaux Métropole. **Classic
and electric bikes are counted apart**: you know before leaving whether an electric bike is still
waiting at your station.

No account, no key: the station availability is published as open data by Bordeaux Métropole.

> Community integration, not affiliated with TBM, Keolis Bordeaux Métropole Mobilités nor Bordeaux
> Métropole.

> **Beta.** Report any issue or idea on
> [GitHub](https://github.com/daviddu26/gladys-le-velo/issues), with a screenshot if you can.

## Get started

1. Check that your house has an **address** in Gladys (**Settings → Houses**).
2. Install the integration, allow access to the house location, then **save** the configuration
   page.
3. Open the **Discover** tab of the integration: the stations closest to your home are proposed
   there. Press **Add** on the ones you want.

The values arrive within a minute.

With several houses, the integration looks around the first one that has an address.

## What you get

One device per station, for example **Le Vélo – Meriadeck**, with:

| Feature         | Example                            | Note                        |
| --------------- | ---------------------------------- | --------------------------- |
| Classic bikes   | 10                                 | Bikes without assistance    |
| Electric bikes  | 5                                  | Electrically assisted bikes |
| Bikes available | 15                                 | Both together               |
| Free docks      | 28                                 | Where to return a bike      |
| Status          | In service                         | See below                   |
| Summary         | 10 classic · 5 electric · 28 docks | Ready for a notification    |

The counters keep their history: Gladys can chart when your station empties in the morning.

The **status** is **In service**, **Rentals suspended** (you can return, not rent), **Returns
impossible** (you can rent, not return) or **Out of service**. A station that does not rent counts
**0 bikes**, even with bikes left at the docks (locked or under maintenance); a station that does
not take bikes back counts **0 docks**. A "fewer than 2 bikes" scene then tells the truth.

## Follow another station

For a station far from home (work, train station…):

1. At the bottom of the configuration page, press **Find a station** and type part of its name
   or street (e.g. "Saint-Jean").
2. Copy its **number** into the **Stations** field (several numbers separated by commas), then
   save.
3. The station appears in the **Discover** tab.

A station added keeps being followed even if you remove it from the field or change the radius:
to stop, delete the device in Gladys.

## Settings

| Setting               | Default | Effect                                              |
| --------------------- | ------- | --------------------------------------------------- |
| Stations near my home | 3       | How many stations to propose (0 turns it off)       |
| Search radius (m)     | 500     | Largest distance from the house                     |
| Stations              | (empty) | Numbers of additional stations                      |
| Refresh interval (s)  | 30      | How often the stations are read, 30 seconds minimum |
| Language of values    | French  | Language of the feature names and of the texts      |

## Dashboard

The **Le Vélo station** widget shows a station at a glance: its name, then three numbers,
**Classic**, **Electric** and **Free docks**.

- **Green**: enough left; **orange**: few left; **red**: none left; **grey**: the station does not
  rent (or take bikes back) right now.
- Under the name: the time of the last update, or the state of the station when it is not fully in
  service ("Rentals suspended").

To add it: **Dashboard → Edit → Add a box → Le Vélo station**, then:

| Setting         | Effect                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| Station         | The station to show (a device already added)                                                                    |
| "Few left" from | Orange at this number or fewer (1, 2, 3 or 5; 2 by default)                                                     |
| History         | A chart of the classic bikes, the electric bikes and the free docks over 12 h, 24 h or a week (none by default) |

The chart fills up over time: it starts when the station was added.

## Scenes

The features are ordinary Gladys sensors: use the **Device state change** trigger. Examples:

- **Electric bikes** of your station **below 1** on weekdays at 8 am → notification "No electric
  bike left at Meriadeck, take the tram".
- In the morning, send the **Summary** in a message: "10 classic · 5 electric · 28 docks".

## Buttons of the configuration page

- **Find a station**: finds a station by its name or street, and gives its number.
- **Test the connection**: reads the stations and the availability, and shows the state of a
  followed station.

## Troubleshooting

| Message or symptom                    | What to do                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| "Give your house an address…"         | Settings → Houses: set the address, then save the configuration again.                  |
| Nothing in the Discover tab           | Widen the search radius, or add a station by hand.                                      |
| "Not found in Stations: …"            | Check the number with **Find a station**.                                               |
| "The Le Vélo service does not answer" | Outage on the operator's side: the integration retries and keeps the stations it knows. |
| "Station unknown to the service"      | The station was removed or renumbered: delete the device, add the right one.            |

## Data

Station availability: Bordeaux Métropole, data set
[Station Le Vélo en temps réel](https://transport.data.gouv.fr/datasets/station-le-velo-en-temps-reel-1)
in the GBFS format, under the [Licence Ouverte](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).
The list of stations is read once a day and kept in the container; the availability of the whole
network is read in a single request every 30 seconds, however many stations are followed.
