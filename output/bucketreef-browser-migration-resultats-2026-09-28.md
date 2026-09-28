# Audit des évolutions Browser et migration de bucket — 28 septembre 2026

## Résumé exécutif

Ce lot cible les fonctions Browser ajoutées depuis le précédent audit et le nouveau parcours de migration de bucket. Les scénarios ont été exécutés dans le navigateur intégré contre deux instances Docker dédiées, toutes deux construites depuis le code local et reliées uniquement au endpoint de laboratoire `s3-z1.lab.ksperis.com`.

Deux instances ont été nécessaires parce que la branche Browser et le travail de migration en cours définissent chacun une migration Alembic `0135` différente depuis `0134` :

- `bucketreef-browser-audit` : frontend `http://localhost:19180`, backend `http://localhost:19100`, branche `codex/browser-evolutions` ;
- `bucketreef-ui-audit` : frontend `http://localhost:19080`, backend `http://localhost:19000`, arbre principal contenant le travail de migration non committé déjà présent.

Résultat global : **35 scénarios atteints, 2 partiels et 1 non atteint**. Un défaut Browser évident a été corrigé et committé. Trois sujets demandent une correction plus structurelle : la finalisation du ZIP en streaming, un faux positif dans le rapport de différences de migration et la collision entre les deux révisions Alembic `0135`.

## Données de test

Le bucket Browser versionné `br-browser-qa-595216` contenait des fichiers CSV, JSON, texte, image et binaire, des dossiers imbriqués, plusieurs versions et des tags. Les migrations ont utilisé les buckets `br-mig-qa-595216`, `br-mig-empty-595216`, `br-mig-existing-595216` et `br-mig-target-595216`.

Les effets des opérations sensibles ont été vérifiés à deux niveaux : état visible après rechargement et lecture directe des objets sur RGW. Les contenus copiés ont été comparés par SHA-256, les versions et tags ont été comparés après migration, et les droits d’écriture de la source ont été éprouvés avant et après restauration.

## Résultats scénario par scénario

| ID | Scénario | Résultat | Vérification et difficultés |
|---|---|---|---|
| BR-01 | Ouvrir un bucket et naviguer entre racine, dossier et fil d’Ariane | Atteint | La liste, le dossier `reports/` et ses sous-dossiers chargent sans erreur console. |
| BR-02 | Prévisualiser un CSV | Atteint | `reports/data.csv` est rendu dans l’aperçu avec son contenu. |
| BR-03 | Prévisualiser une image | Atteint | `reports/pixel.png` est chargé comme image depuis le panneau d’aperçu. |
| BR-04 | Ouvrir un fichier binaire non prévisualisable | Atteint | `reports/binary.bin` affiche un état explicite de format non pris en charge. |
| BR-05 | Naviguer au fichier chargé précédent/suivant | Atteint | Le compteur et les actions parcourent les fichiers réellement chargés : CSV, image puis JSON. |
| BR-06 | Afficher l’historique des versions | Atteint | Les deux versions de `reports/version.json` sont listées et ouvrables. |
| BR-07 | Comparer deux versions JSON | Atteint | La comparaison en lecture seule met en évidence la ligne supprimée et la ligne ajoutée entre révisions 1 et 2. |
| BR-08 | Ajouter un favori personnel | Atteint | Le favori `Rapports QA` est créé et ouvre le bon préfixe. |
| BR-09 | Synchroniser le favori entre onglets | Atteint | Un second onglet authentifié reçoit le favori sans rechargement manuel. |
| BR-10 | Recherche avancée récursive avec filtre d’extension | Atteint | Le filtre `csv` renvoie uniquement `reports/data.csv`; la requête backend contient bien la portée récursive et l’extension. |
| BR-11 | Réutiliser le résultat de recherche mis en cache | Atteint | Les paramètres de portée et de filtre font partie de la clé de cache et le même résultat est restauré. |
| BR-12 | Uploader un nom existant et choisir « Conserver les deux » | Atteint | Le conflit affiche les objets source/cible, puis crée `reports/data (1).csv` avec la taille attendue de 18 octets. |
| BR-13 | Renommer un objet avec des caractères Unicode | Atteint | L’objet devient `résumé-qa-ß.csv`; le statut d’opération est `Moved 1/1`. |
| BR-14 | Copier explicitement un objet vers un sous-dossier | Atteint après correction | La copie vers `reports/nested/` aboutit et la vue courante reste sur `reports/` après le correctif. Avant correction, le contenu du tableau basculait sur la destination alors que le fil d’Ariane restait sur la source. |
| BR-15 | Vérifier le contenu copié directement sur S3 | Atteint | `reports/nested/data.csv` existe et son SHA-256 est identique à celui de la source. |
| BR-16 | Déplacer explicitement un objet Unicode | Atteint | Le fichier est déplacé vers `reports/empty/`, disparaît de la source et apparaît dans la destination. |
| BR-17 | Vérifier la copie et le déplacement Unicode directement sur S3 | Atteint | La copie imbriquée et la destination du déplacement existent; la clé source a disparu. |
| BR-18 | Calculer le volume d’une sélection mixte | Atteint | Un fichier et un dossier donnent `1 file · 1 folder · 73 B`. |
| BR-19 | Télécharger une sélection mixte sous forme de ZIP | Non atteint | Les quatre objets sont téléchargés et marqués terminés, mais l’opération parent reste indéfiniment sur `Streaming zip` dans le navigateur intégré. |
| BR-20 | Recharger après navigation dans un sous-dossier | Partiel | La navigation fonctionne, mais le préfixe courant est conservé seulement dans l’état du routeur; un rechargement revient au préfixe encodé dans l’URL précédente. |
| MIG-01 | Charger l’inventaire source et filtrer les buckets | Atteint | Le sélecteur charge 48 buckets et filtre la source attendue. |
| MIG-02 | Refuser un nom de destination S3 invalide | Atteint | Un nom contenant des majuscules produit une erreur inline et bloque la progression. |
| MIG-03 | Refuser une destination déjà existante | Atteint | Le conflit avec `br-mig-existing-595216` est détecté avant création et confirmé par le backend. |
| MIG-04 | Configurer les options avancées | Atteint | Pré-copie, cutover manuel, démarrage immédiat, transport, copie des réglages et protections sont conservés dans le récapitulatif. |
| MIG-05 | Enregistrer un brouillon | Atteint | La définition #1 est créée et réapparaît dans la liste après rechargement. |
| MIG-06 | Exécuter les contrôles en lecture seule | Atteint | Le rapport montre zéro blocage et zéro avertissement, puis demande explicitement les contrôles actifs. |
| MIG-07 | Vérifier l’information avant contrôles actifs | Atteint | Le dialogue décrit le blocage temporaire des écritures, le bucket temporaire et la restauration attendue. |
| MIG-08 | Terminer les contrôles actifs | Atteint | La migration progresse vers `Ready to copy` sans laisser la source verrouillée. |
| MIG-09 | Lancer la pré-copie | Atteint | Trois objets courants sont copiés et le workflow atteint `Ready for cutover`. |
| MIG-10 | Écrire sur la source pendant la pré-copie | Atteint | `after-precopy.txt` et son tag sont créés après la première copie, ce qui prouve que la source reste disponible. |
| MIG-11 | Exécuter le cutover incrémental | Atteint | Le nouvel objet est repris et le workflow termine sur `Copy verified` avec quatre versions transférées. |
| MIG-12 | Comparer source et destination directement sur S3 | Atteint | Clés, versions, contenus SHA-256 et tags concordent; le service persiste zéro différence. |
| MIG-13 | Bloquer les écritures source après cutover | Atteint | Une écriture directe sur la source échoue avec `AccessDenied`; la destination reste accessible. |
| MIG-14 | Restaurer l’accès à la source | Atteint | La maintenance passe à `completed`, le statut devient `Source retained` et une nouvelle écriture S3 réussit. |
| MIG-15 | Précontrôler une source vide | Atteint | Le rapport retourne un avertissement unique expliquant que contenu et tags seront contrôlés si des objets apparaissent. |
| MIG-16 | Recharger la liste et le détail d’une migration | Atteint | États, progression et rapports persistent sans erreur console. |
| MIG-17 | Afficher uniquement les différences réellement détectées | Partiel | Les compteurs et échantillons sont tous vides, mais le détail affiche quand même `Differences found` à `awaiting_cutover` et après terminaison. |
| MIG-18 | Vérifier le schéma et les transitions par tests automatisés | Atteint | 154 tests backend et 21 tests frontend de migration passent. |

## Correction réalisée

Le commit local `7884c7d1` (`fix(browser): preserve visible listing after explicit transfers`) corrige le rafraîchissement post-copie/post-déplacement. Le hook rafraîchissait le préfixe de destination dans le contexte de liste de la source, ce qui produisait un tableau et un fil d’Ariane incohérents. Il rafraîchit désormais le préfixe réellement visible après succès, annulation ou terminaison partielle.

La régression est couverte par un test d’une copie explicite vers un autre dossier. Après reconstruction du frontend, une copie réelle vers `reports/nested/` a laissé `reports/` visible et l’objet cible a été relu directement sur RGW. Ce commit est limité à deux fichiers Browser et n’a pas été poussé.

## Problèmes nécessitant un travail plus important

### 1. Finalisation du ZIP en streaming

Le navigateur intégré accepte le descripteur de fichier, télécharge les quatre objets et termine les quatre sous-opérations, mais `ZipWriter.close()` ne rend pas la main. L’opération parent reste donc `In progress` avec le bouton Stop.

Proposition : introduire une abstraction de destination d’archive avec détection explicite des capacités et temporisation de la finalisation. Pour les sélections dont le volume est déjà calculé et reste sous un seuil raisonnable, produire le ZIP en mémoire puis écrire le blob final dans le descripteur ou déclencher le téléchargement standard. Ajouter des tests E2E sur Chrome, Firefox, Safari et le navigateur intégré, couvrant finalisation, annulation et repli; une opération dont tous les enfants sont terminés ne doit jamais rester active sans diagnostic.

### 2. Faux positif « Differences found »

Le composant de détail teste la présence de `diff_sample`, qui est un objet présent même lorsque tous ses compteurs et tableaux sont vides. Le bandeau apparaît donc alors que la comparaison et la base indiquent zéro différence.

Proposition : centraliser un prédicat `hasMigrationDifferences` fondé sur `different_count`, `only_source_count`, `only_target_count` et la longueur réelle des échantillons. Ajouter une régression pour `awaiting_cutover` et `completed`. La correction n’a pas été isolée ici car le composant appartient au vaste travail de migration non committé déjà présent dans l’arbre principal; le modifier puis le committer aurait absorbé une partie de ce travail sans base stable.

### 3. Deux migrations Alembic concurrentes `0135`

La branche Browser définit `0135_browser_presets` et le travail de migration définit `0135_bucket_migration_workflow`, tous deux descendants directs de `0134`. Leur réunion créera deux têtes Alembic ou une collision de révision, et empêche déjà de qualifier les deux surfaces dans une seule base locale.

Proposition : après stabilisation des deux branches, renuméroter la migration arrivée en second ou créer une vraie migration de fusion avec un identifiant unique. Ajouter au CI une vérification `alembic heads` exigeant une tête unique pour chaque ensemble de surfaces livré.

### 4. Préfixe Browser absent de l’URL

Le bucket et le préfixe courant résident principalement dans l’état du routeur. Le partage d’un lien ou le rechargement d’un sous-dossier peut donc restaurer un ancien préfixe présent dans la query string.

Proposition : faire de `bucket` et `prefix` des paramètres d’URL canoniques, puis conserver dans l’état du routeur uniquement l’index de navigation, les sélections temporaires et les bloqueurs de dialogue. Ajouter des tests retour/avance, rechargement profond et ouverture dans un nouvel onglet.

## Validation technique

- backend Browser ciblé : **66 tests passés** ;
- frontend Browser ciblé : **133 tests passés** ;
- typecheck frontend Browser : réussi ;
- backend migration ciblé : **154 tests passés** ;
- frontend migration ciblé : **21 tests passés** ;
- typecheck frontend migration : réussi ;
- `git diff --check` sur le correctif Browser : réussi ;
- reconstruction Docker des deux instances : réussie, conteneurs backend et frontend sains ;
- vérifications S3 directes : contenus copiés identiques, destinations Unicode présentes, source déplacée absente, instantanés de migration identiques et protections d’écriture conformes ;
- nettoyage final : les cinq buckets temporaires et leurs 25 versions ou marqueurs ont été supprimés du laboratoire ;
- aucun push effectué.

Les modifications de migration déjà présentes dans l’arbre principal ont été laissées intactes et ne font pas partie du commit Browser.
