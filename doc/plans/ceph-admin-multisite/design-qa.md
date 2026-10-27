# Vérification de la maquette Multisite

Date : 27 octobre 2026. Portée : conception et prototype autonome, données
fictives. Aucun comportement de production BucketReef n’a été modifié.

## Références et captures

- Source visuelle : `doc/docs/assets/screenshots/user/workspace-ceph-admin.light.png`
  dans le dépôt de référence, 1728 × 972 px ; capture dark correspondante.
- Source normative actuelle : `frontend/src/index.css`, `components/ui/styles.ts`,
  `sidebarSizing.ts`, `product-design.md` et `ui-theme.md`.
- Implémentation rendue : `index.html`, aperçu ouvert dans le navigateur cloud.
- Desktop : viewport CSS observé 1363 × 936, devicePixelRatio 1. Le fournisseur
  de capture a produit des images de 1348 × 926 ou 1363 × 936 selon la capture ;
  les dimensions des fichiers sont conservées, sans les présenter comme un
  contrôle pixel à pixel d’un même écran.
- Mobile : iframe de contenu 390 × 844, largeur utile 375 px avec scrollbar.
  Aucun débordement horizontal du body observé. La capture 392 × 846 inclut
  les bordures de l’iframe ; elle est extraite de la capture navigateur complète.
- [Comparaison réunie dans une seule image](captures/qa-comparison.jpg), régions
  de 900 × 500 à échelle 1:1 pour les éléments du shell. La référence est la
  page Buckets, la proposition est Multisite : le contenu métier est nouveau,
  sa structure n’est pas évaluée comme une reproduction de la page Buckets.
- Vues : [Overview](captures/01-overview.jpg), [Bucket](captures/02-bucket.jpg),
  [Générations](captures/03-generations.jpg), [Shard](captures/04-shard-detail.jpg),
  [Journaux](captures/05-logs.jpg), [JSON](captures/06-log-detail.jpg),
  [Mobile](captures/07-mobile.jpg), [Sombre](captures/08-dark.jpg).

## Surfaces de fidélité évaluées

| Surface | Vérification / résultat |
| --- | --- |
| Typographie | Même pile Inter/system ; titres compacts 17 px, contenu 12 px, JSON monospace. Pas de fonte externe requise. Le fallback système dépend de la machine. |
| Rythme et disposition | Sidebar de 208 px, topbar 56 px sur bureau, panneaux 8 px, bordures fines, tableaux compacts et onglets ligne. Flux data visibles dans la première zone de lecture. |
| Couleurs et tokens | Palette existante reprise en clair/sombre ; bleu réservé à l’accent/phase, ambre à full sync ou avertissement, aucune phase sync colorée comme une preuve de santé. |
| Assets | Logo BucketReef existant réutilisé, non redessiné ; icônes de bibliothèque Lucide incorporées ; pas d’image générée pour des données ou diagrammes exacts. |
| Contenu métier | Champs et limites du contrat Tentacle ; couverture distincte de santé, génération source distincte de génération suivie, état opération bilog distinct de réplication objet. |

Les captures originales ont été ouvertes, puis la comparaison commune a été
inspectée. Les zones de typographie/shell et les détails de tableaux/JSON ont
également été examinés à taille lisible, en plus de la planche des trois vues.

## Historique des corrections

| Priorité | Constat initial | Correction | Preuve après correction |
| --- | --- | --- | --- |
| P2 | Les flux data étaient sous les tables de topologie et metadata à largeur desktop courante | Remontée des flux dans l’ordre DOM et visuel | `01-overview.jpg` |
| P2 | Le sélecteur Workspace se comprimait sur 390 px et sa hauteur chevauchait le contexte | Présentation topbar mobile simplifiée ; contexte Ceph Admin conservé dans le breadcrumb/menu | `07-mobile.jpg` |
| P2 | Un changement de bucket pouvait laisser visible le diagnostic du périmètre précédent | Invalidation immédiate, message explicite et nouvelle lecture obligatoire | Contrôle browser : résultats retirés après saisie, première observation après lecture |
| P2 | Pagination de shards et observations initiales insuffisamment représentées | Tranches 0–7 puis 8–15 ; remise à zéro du contexte ; pas de comparaison avant la seconde collecte | Contrôles DOM/browser des tranches et de l’onglet Observations |
| P2 | Ligne inspectée non repérée pendant l’ouverture du drawer | Teinte persistante et `aria-current`, retrait à la fermeture | `06-log-detail.jpg` et contrôle du focus |

Les corrections ont été suivies d’une nouvelle capture ou d’un contrôle
browser de l’état concerné. La carte dark a été recapturée après le rendu
effectif ; une première capture trop précoce montrait encore le thème clair.

## Interactions vérifiées dans le navigateur

- Trois onglets principaux, sous-onglets du bucket et familles de journaux.
- Shards : inspection, JSON, fermeture et retour au contexte ; tranches locales.
- Bucket source différent du bucket destination ; changement de périmètre et
  première observation ; aucune comparaison inventée avant deux lectures.
- Générations : distinction Suivie / Plus récente ; absence de dates fictives.
- Journaux : page suivante puis précédente, filtre local avec résultat vide,
  détails metadata/data et parsing du JSON exporté (5 entrées, marqueur demo).
- Scénario bilog 403 : destination consultable, informations source refusées.
- Scénario endpoint z2 indisponible : couverture et nombre de statuts partiels.
- Affichage mobile, formulaire, drawer `aria-modal=true` et fermeture Escape.
- Thème sombre, texte et états lisibles ; navigation et légendes conservées.
- Console inspectée : aucune erreur applicative provenant de l’aperçu observée.
  Des erreurs propres à l’extension de navigateur étaient présentes ; elles
  n’ont pas été attribuées au prototype.

Le prototype ne fait aucun appel RGW. Les seules ressources nécessaires à son
affichage sont intégrées à l’HTML. Les valeurs ne constituent pas des résultats
de tests d’un cluster.

## Validation des fichiers et limites

Syntaxe JavaScript contrôlée avec Node ; liens locaux de documentation contrôlés ;
images ouvertes ; contrôle `git diff --check` effectué avant le commit.
Les tests backend/frontend complets de BucketReef ne sont pas requis pour
cette branche documentaire : aucune route ni composant de production n’a été
changé. Ils sont détaillés dans le plan pour l’implémentation.

La maquette utilise du HTML autonome. La vraie intégration réemploiera les
primitives React et les comportements i18n/a11y du projet. La qualification
mobile sur appareil tactile, l’audit axe complet et les largeurs 1440/1728 sont
des vérifications de la future intégration, pas des tests prétendument exécutés
ici. Les contrôles du shell hors Multisite sont volontairement désactivés dans
le prototype.

P3 : la maquette reproduit la pile de fontes disponible sans garantir la même
police installée sur toutes les machines. L’icône Multisite définitive pourra
réutiliser le répertoire d’icônes interne lors de l’intégration React.

final result: passed
