# Le Vélo (TBM)

Cette intégration affiche dans Gladys les **vélos disponibles et les places libres** des stations
**Le Vélo par TBM** (anciennement V³ / VCub), le vélo en libre-service de Bordeaux Métropole. Les
**vélos musculaires et les vélos électriques sont comptés à part** : vous savez avant de sortir
s'il reste un vélo électrique à votre station.

Pas de compte, pas de clé : la disponibilité des stations est publiée en données ouvertes par
Bordeaux Métropole.

> Intégration communautaire, sans lien avec TBM, Keolis Bordeaux Métropole Mobilités ou Bordeaux
> Métropole.

> **Version bêta.** Signalez tout souci ou idée sur
> [GitHub](https://github.com/daviddu26/gladys-le-velo/issues), avec une capture d'écran si
> possible.

## Démarrer

1. Vérifiez que votre maison a une **adresse** dans Gladys (**Paramètres → Maisons**).
2. Installez l'intégration, acceptez l'accès à la position de la maison, puis **enregistrez** la
   page de configuration.
3. Ouvrez l'onglet **Découverte** de l'intégration : les stations les plus proches de chez vous
   y sont proposées. Cliquez sur **Ajouter** sur celles qui vous intéressent.

Les valeurs arrivent dans la minute.

Si vous avez plusieurs maisons, l'intégration cherche autour de la première qui a une adresse.

## Ce que vous obtenez

Un appareil par station, par exemple **Le Vélo – Meriadeck**, avec :

| Fonctionnalité    | Exemple                                    | Remarque                            |
| ----------------- | ------------------------------------------ | ----------------------------------- |
| Vélos musculaires | 10                                         | Vélos sans assistance               |
| Vélos électriques | 5                                          | Vélos à assistance électrique       |
| Vélos disponibles | 15                                         | Les deux ensemble                   |
| Places libres     | 28                                         | Bornes où rendre un vélo            |
| État              | En service                                 | Voir ci-dessous                     |
| Résumé            | 10 musculaires · 5 électriques · 28 places | Prêt à mettre dans une notification |

Les compteurs gardent leur historique : Gladys peut tracer à quelle heure votre station se vide le
matin.

L'**état** vaut **En service**, **Location suspendue** (on peut rendre mais pas emprunter),
**Retour impossible** (on peut emprunter mais pas rendre) ou **Hors service**. Une station qui
ne loue pas compte **0 vélo**, même s'il en reste aux bornes (vélos bloqués ou en maintenance) ; une
station qui ne reprend pas les vélos compte **0 place**. Ainsi, une scène « moins de 2 vélos »
dit vrai.

## Suivre une autre station

Pour une station loin de chez vous (travail, gare…) :

1. En bas de la page de configuration, cliquez sur **Chercher une station** et tapez une partie
   de son nom ou de sa rue (ex. « Saint-Jean »).
2. Copiez son **numéro** dans le champ **Stations** (plusieurs numéros séparés par des virgules),
   puis enregistrez.
3. La station apparaît dans l'onglet **Découverte**.

Une station ajoutée reste suivie même si vous la retirez du champ ou changez le rayon : pour
l'arrêter, supprimez l'appareil dans Gladys.

## Réglages

| Réglage                   | Par défaut | Effet                                                     |
| ------------------------- | ---------- | --------------------------------------------------------- |
| Stations près de chez moi | 3          | Combien de stations proposer (0 désactive la proposition) |
| Rayon de recherche (m)    | 500        | Distance maximale de la maison                            |
| Stations                  | (vide)     | Numéros de stations supplémentaires                       |
| Rafraîchissement (s)      | 60         | Fréquence de lecture, une minute minimum                  |
| Langue des valeurs        | Français   | Langue des noms de fonctionnalités et des textes          |

## Tableau de bord

Le widget **Station Le Vélo** affiche une station d'un coup d'œil : le nom de la station, puis
trois chiffres, **Musculaires**, **Électriques** et **Places libres**.

- **Vert** : il en reste assez ; **orange** : il en reste peu ; **rouge** : il n'y en a plus ;
  **gris** : la station ne loue pas (ou ne reprend pas) en ce moment.
- Sous le nom : l'heure de la dernière mise à jour, ou l'état de la station quand elle n'est pas
  entièrement en service (« Location suspendue »).

Pour l'ajouter : **Tableau de bord → Modifier → Ajouter une box → Station Le Vélo**, puis :

| Réglage             | Effet                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Station             | La station à afficher (un appareil déjà ajouté)                                                   |
| « Peu » à partir de | Orange à ce nombre ou moins (1, 2, 3 ou 5 ; 2 par défaut)                                         |
| Historique          | Une courbe des vélos musculaires et électriques sur 12 h, 24 h ou une semaine (aucune par défaut) |

La courbe se remplit avec le temps : elle part du moment où la station a été ajoutée.

## Scènes

Les fonctionnalités sont des capteurs Gladys ordinaires : utilisez le déclencheur **Changement
d'état d'un appareil**. Exemples :

- **Vélos électriques** de votre station **inférieur à 1** en semaine à 8 h → notification « Plus
  de vélo électrique à Meriadeck, prenez le tram ».
- Le matin, envoyez le **Résumé** dans un message : « 10 musculaires · 5 électriques · 28 places ».

## Boutons de la page de configuration

- **Chercher une station** : trouve une station par son nom ou sa rue, et donne son numéro.
- **Tester la connexion** : lit les stations et la disponibilité, et affiche l'état d'une station
  suivie.

## Dépannage

| Message ou symptôme                    | Que faire                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| « Donnez une adresse à votre maison… » | Paramètres → Maisons : renseignez l'adresse, puis réenregistrez la configuration.  |
| Rien dans l'onglet Découverte          | Augmentez le rayon de recherche, ou ajoutez une station à la main.                 |
| « Introuvable dans Stations : … »      | Vérifiez le numéro avec **Chercher une station**.                                  |
| « Le service Le Vélo ne répond pas »   | Panne côté opérateur : l'intégration réessaie seule et garde les stations connues. |
| « Station inconnue du service »        | La station a été retirée ou renumérotée : supprimez l'appareil, ajoutez la bonne.  |

## Données

Disponibilité des stations : Bordeaux Métropole, jeu
[Station Le Vélo en temps réel](https://transport.data.gouv.fr/datasets/station-le-velo-en-temps-reel-1)
au format GBFS, sous [Licence Ouverte](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).
La liste des stations est relue une fois par jour et gardée dans le conteneur ; la disponibilité
de tout le réseau est lue en une seule requête par minute, quel que soit le nombre de stations
suivies.
