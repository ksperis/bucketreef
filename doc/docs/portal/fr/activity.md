# Historique : activité et journaux d'accès

Utilisez cette page pour consulter les changements de gouvernance et, en tant
que gestionnaire de projet, les journaux d'accès fournis par le service S3.

## Quand l'utiliser

Utilisez **Portal > Historique > Activité** pour savoir qui a modifié les accès,
les partages, les paramètres, les clés, les espaces ou un workflow global.
Utilisez **Journaux d'accès** pour analyser les requêtes sur les objets lorsque
le Server Access Logging est activé.

## Prérequis

- Portal est activé.
- Vous êtes rattaché au projet sélectionné.
- Vous avez accès à au moins un espace de stockage actif.

## Étapes

1. Ouvrez **Portal > Historique** et conservez l'onglet **Activité**.
2. Le résumé indique le nombre de changements récents, de personnes et d'espaces concernés.
3. Filtrez la chronologie par action ou par espace pour cibler votre recherche.
4. Parcourez la colonne **Modification** pour identifier l'auteur et le changement.
5. Utilisez **Ouvrir l'espace** pour consulter les paramètres ou collaborateurs concernés.
6. Ouvrez le détail d'une ligne uniquement si vous avez besoin de la ressource,
   de l'action ou de l'adresse IP technique exacte pour le support.
7. En tant que Portal Manager, ouvrez **Journaux d'accès** pour filtrer les
   requêtes S3 par date, action, espace, chemin, identité ou résultat, ou pour
   exporter les journaux bruts du fournisseur.

## Résultat attendu

Vous pouvez expliquer les changements récents de gouvernance dans Portal et,
lorsque les journaux du fournisseur sont activés, relier un accès objet à une
identité de stockage.

## Vous avez terminé lorsque

Vous savez qui a agi, ce qui a changé, quel espace est concerné et si vous devez
ouvrir cet espace pour davantage de contexte.

## Si aucune activité n'apparaît

Si **Activité** est vide, créez un espace, modifiez un paramètre, un
collaborateur, un lien ou une clé, puis vérifiez que vous pouvez accéder à
l'espace concerné. Les opérations sur les objets n'apparaissent jamais dans Activité.

## Limites

!!! note
    L'activité Portal est limitée aux espaces visibles et contient uniquement
    des événements de gouvernance. Le journal d'audit Admin est la source globale
    du plan de contrôle de la plateforme.

!!! warning
    Les journaux d'accès proviennent du fournisseur S3. Ils peuvent être retardés
    et dépendent de leur activation et de leur durée de conservation. S'ils sont
    désactivés, BucketReef ne possède pas d'historique exhaustif des opérations sur les objets.

## Pages associées

- [Guide Portal](index.md)
- [Espaces de stockage](spaces/index.md)
- [Fichiers](files/index.md)
- [Dépannage](help/troubleshooting.md)

## Exemple visuel

Cette page réutilise la capture du tableau de bord Portal car elle montre la
carte d'activité dans son contexte.

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/workspace-portal.light.png" alt="Tableau de bord Portal avec activité de gouvernance, partages, utilisation et alertes" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/workspace-portal.dark.png" alt="Tableau de bord Portal avec activité de gouvernance, partages, utilisation et alertes" loading="lazy">
</div>
