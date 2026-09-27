# Audit détaillé de l’interface BucketReef — 27 septembre 2026

## Résumé exécutif

Le lot de 80 scénarios a été exécuté sur une instance Docker dédiée construite depuis le code source local. Elle utilise le projet Compose `bucketreef-ui-audit`, le frontend `http://localhost:19080`, le backend `http://localhost:19000` et le endpoint S3 de laboratoire `s3-z1.lab.ksperis.com`. Les conteneurs backend et frontend sont sains. Aucun déploiement existant ni aucune donnée de production n’a été utilisé.

Résultat global :

- **49 scénarios atteints** ;
- **25 scénarios partiels** ;
- **5 scénarios non atteints** ;
- **1 scénario bloqué par l’outillage de test** ;
- **10 défauts évidents corrigés et commités séparément** ;
- plusieurs défauts plus importants restent à traiter, en particulier la recherche Ceph Admin Accounts et les métriques Manager.

La vérification a porté sur l’état visible, la persistance après rechargement, les retours d’erreur, l’effet réel sur S3 et, lorsque pertinent, la cohérence entre Manager, Browser, Ceph Admin et Storage Ops. Les captures ont été inspectées pendant le parcours aux formats 1440×900, 1024×768 et 390×844.

## Instance et données de test

L’instance a été initialisée avec un super-administrateur éphémère `ui-audit-admin@example.com`, une connexion partagée et une connexion privée vers le même endpoint de laboratoire. Les surfaces Ceph Admin et Storage Ops ont été activées uniquement dans l’override de cette instance.

Le bucket `bucketreef-ui-audit-20260927-a` contient volontairement les preuves suivantes :

- versioning activé ;
- tag `purpose=ui-audit` ;
- une règle CORS autorisant `http://localhost:19080` ;
- deux fichiers racine, dont plusieurs versions ;
- un dossier `audit-folder/` et un fichier imbriqué ;
- un instantané d’usage Ceph Admin : 508 octets logiques, 6 versions, 314 octets courants et 194 octets non courants.

Ces ressources n’ont pas été supprimées afin de conserver les preuves et de permettre une reprise. Leur suppression nécessite une opération de nettoyage explicite.

## Résultats scénario par scénario

| ID | Scénario | Résultat | Vérification et difficultés |
|---|---|---|---|
| UI-01 | Soumission vide du formulaire de connexion | Atteint | Les champs obligatoires bloquent la soumission et le focus revient sur l’e-mail. Le message natif du navigateur reste en français alors que l’interface est en anglais. |
| UI-02 | Adresse e-mail invalide | Atteint | `not-an-email` est refusé avant appel réseau. Même incohérence de langue dans le message natif. |
| UI-03 | Mauvais mot de passe puis bon mot de passe | Atteint | L’échec affiche une erreur, puis la connexion correcte réussit sans rechargement. Le message « Invalid credentials or server unavailable » mélange toutefois deux causes différentes. |
| UI-04 | Afficher et masquer le mot de passe | Atteint | Contrôle absent initialement, ajouté puis vérifié dans le build Docker : type `password` → `text` → `password`, libellés accessibles Show/Hide. |
| UI-05 | Déconnexion puis navigation Retour | Atteint | Après déconnexion, Retour reste sur `/login` et n’expose pas l’interface authentifiée. |
| UI-06 | URL protégée sans session | Atteint | Accès direct à `/manager/buckets` redirigé vers `/login`. |
| UI-07 | Rechargement d’une route authentifiée profonde | Atteint | `/manager/buckets?ctx=conn-1` est restauré correctement avec une session valide. |
| UI-08 | Propagation de déconnexion entre deux onglets | Atteint | Échec initial : le second onglet conservait l’interface jusqu’au rechargement. Après correction, les deux onglets passent à `/login` en moins d’une seconde. |
| UI-09 | Sélecteur de workspaces | Atteint | Admin, Ceph Admin, Storage Ops, Manager et Browser sont accessibles conformément aux droits du compte. |
| UI-10 | Navigation Retour/Avance | Atteint | L’historique fonctionne entre listes, détails et workspaces ; l’URL inconnue révèle toutefois le défaut UI-15. |
| UI-11 | Réduction et réouverture de la barre latérale | Atteint | Le mode compact conserve les icônes et le bouton permet de restaurer la largeur. |
| UI-12 | Liens Retour et fil d’Ariane | Atteint | Les retours depuis les détails ramènent vers la liste correspondante ; les fils d’Ariane sont cohérents. |
| UI-13 | Changer de contexte depuis un détail | Partiel | Les contextes privé et partagé sont maintenant explicitement identifiés. Le changement de contexte a surtout été vérifié depuis les listes. |
| UI-14 | Rechargement après changement de contexte | Partiel | La persistance du contexte Manager a été observée ; toutes les combinaisons workspace/contexte n’ont pas été rejouées. |
| UI-15 | URL inconnue et page 404 utile | Non atteint | `/does-not-exist-ui-audit` redirige silencieusement vers le tableau de bord Storage Ops. Aucune page 404 ni explication. |
| UI-16 | Deux actions rapides et retours visuels | Atteint | Toasts et statuts observés sur upload, copie, enregistrement de tag et actualisation. |
| UI-17 | Modifier un champ de profil réversible | Atteint | Langue changée vers English, enregistrée, rechargée et conservée après reconstruction du frontend. |
| UI-18 | Abandonner des modifications non enregistrées | Atteint | Une modification Ceph Admin déclenche un dialogue d’abandon ; Escape annule et la valeur d’origine est restaurée. |
| UI-19 | Thème clair/sombre et persistance | Atteint | Les deux thèmes ont été appliqués et conservés après rechargement. |
| UI-20 | Ouvrir puis annuler l’enrôlement passkey | Atteint | Le dialogue explique l’impact sur les sessions et jetons ; il a été annulé sans créer de passkey. |
| UI-21 | Rechercher un utilisateur Admin | Atteint | Recherche avec résultat et sans résultat. L’état vide distingue maintenant l’absence totale de l’absence de correspondance. |
| UI-22 | Tri et pagination des utilisateurs | Partiel | La liste volumineuse est utilisable, mais toutes les colonnes et tailles de page n’ont pas été combinées systématiquement. |
| UI-23 | Ouvrir un utilisateur puis revenir à la liste | Atteint | Les onglets du détail chargent et le retour conserve le contexte de navigation. |
| UI-24 | Validations de création d’utilisateur | Atteint | Mot de passe trop court refusé ; annulation et abandon restaurent la liste. L’erreur obsolète est maintenant effacée à la fermeture. |
| UI-25 | Rôles, workspaces et droits effectifs | Partiel | Les capacités effectives et surfaces visibles du compte de test concordent. Les variations de rôle n’ont pas toutes été mutées. |
| UI-26 | Dialogue de désactivation et annulation | Partiel | Les dialogues de sécurité ont été ouverts et annulés, mais aucun compte secondaire complet n’a été désactivé. |
| UI-27 | Filtres de la piste d’audit | Atteint | Filtres, actualisation et état vide vérifiés. |
| UI-28 | Détail d’un événement d’audit | Partiel | La liste et les filtres sont fonctionnels ; la totalité des variantes de détail n’a pas été parcourue. |
| UI-29 | Recherche et tri des endpoints | Partiel | Recherche et accès au endpoint connus vérifiés ; la matrice complète de tri n’a pas été rejouée. |
| UI-30 | Tableau de bord d’un endpoint | Atteint | Métadonnées, état, tags et navigation de détail chargent correctement. |
| UI-31 | Actualisation manuelle de santé | Atteint | Endpoint affiché Up, latence observée à 47 ms après contrôle. |
| UI-32 | Historique et incidents vides | Atteint | Les états vides sont explicites et sans erreur. |
| UI-33 | Reprise d’onboarding RGW en échec | Partiel | Toutes les validations ont réussi, mais l’étape finale créant des droits/identités RGW n’a pas été soumise. Le défaut `InvalidArgument` du lot précédent n’est donc pas requalifié ici. |
| UI-34 | Revalider les identifiants S3 | Atteint | Les validations de connexion partagée et privée réussissent contre `s3-z1`. |
| UI-35 | Champs invalides d’une connexion partagée | Atteint | Les contraintes de formulaire et la validation distante rendent les erreurs avant enregistrement. |
| UI-36 | Modifier un libellé non secret | Partiel | Les libellés et contextes sont bien rendus, mais toutes les variantes de renommage n’ont pas été persistées. |
| UI-37 | Rotation ou désactivation puis annulation | Partiel | Les écrans de gestion de clé et les annulations sont accessibles ; aucune nouvelle clé persistante n’a été créée. |
| UI-38 | Rechercher un bucket Manager | Atteint | Correspondance exacte et recherche sans résultat. L’état vide corrigé affiche maintenant « No buckets match this search. ». |
| UI-39 | Trier les buckets par nom, date et taille | Partiel | Tri et colonnes ont été manipulés, mais les trois séquences avec vérification complète de l’ordre n’ont pas toutes été répétées. |
| UI-40 | Parcourir tous les onglets d’un bucket | Atteint | Overview, Objects, Quota, Usage stats, Properties, Permissions, Advanced et Metrics chargent. |
| UI-41 | Ajouter, modifier et supprimer un tag | Partiel | Ajout et persistance après rechargement vérifiés. Le tag de preuve a été conservé ; suppression finale non exécutée. |
| UI-42 | Modifier puis restaurer CORS | Partiel | La règle pour l’origine locale est enregistrée et visible dans Manager et Ceph Admin. La configuration d’origine n’a pas été restaurée afin de conserver la preuve. |
| UI-43 | JSON CORS invalide | Non atteint | Le cas JSON CORS invalide n’a pas été isolé dans ce lot. |
| UI-44 | JSON de policy invalide | Non atteint | Le cas JSON de policy invalide n’a pas été isolé dans ce lot. |
| UI-45 | ACL et Block Public Access | Partiel | Lecture cohérente : ACL privée/full control et BPA à 0/4. Les mutations n’ont pas été appliquées. |
| UI-46 | Option réversible de bucket | Atteint | Versioning suspendu, enregistré, puis réactivé et enregistré. |
| UI-47 | Lifecycle Visual/JSON et annulation | Atteint | `{invalid` déclenche l’erreur de syntaxe et Save est maintenant désactivé ; fermeture sans mutation. |
| UI-48 | Métriques et usage Manager | Partiel | Usage Ceph Admin fonctionne, mais Manager affiche un `403 AccessDenied` RGW brut dans le contexte de connexion. |
| UI-49 | Rechercher bucket, préfixe et objet dans Browser | Atteint | Recherche dans le bucket et recherche globale ; le même nom est retrouvé à la racine et dans le dossier. |
| UI-50 | Double-clic, dossier et fil d’Ariane Browser | Atteint | Création de dossier, entrée, retour parent et fil d’Ariane vérifiés. |
| UI-51 | Validation de création de dossier | Partiel | Création valide vérifiée ; toutes les variantes de noms invalides n’ont pas été rejouées. |
| UI-52 | Upload d’un fichier texte | Atteint | Upload réel, listing, ouverture et contenu exact vérifiés. |
| UI-53 | Upload d’un nom existant et version | Atteint | Une seconde version est créée ; latest et version précédente sont visibles. |
| UI-54 | Upload de plusieurs fichiers | Atteint | Deux fichiers envoyés ensemble et visibles. Le mode direct échoue dans cet environnement puis le proxy reprend automatiquement. |
| UI-55 | Annuler un upload en cours | Non atteint | Aucun transfert suffisamment long n’a été utilisé pour prouver l’annulation sans objet résiduel. |
| UI-56 | Aperçu texte, image et fichier non prévisualisable | Partiel | Aperçu texte exact vérifié. Les branches image et binaire non prévisualisable n’ont pas été couvertes. |
| UI-57 | Télécharger et comparer le fichier | Partiel | Le backend `/download` répond 200 avec le bon objet. L’événement de téléchargement du navigateur intégré a expiré, donc la sauvegarde client n’est pas prouvée. |
| UI-58 | Détails objet, ETag, taille, date et métadonnées | Atteint | Le tiroir de détail expose les propriétés attendues et les versions. |
| UI-59 | Copier/coller un objet | Atteint | La sélection de deux objets et la copie affichent le statut « Items copied ». |
| UI-60 | Dialogue de suppression puis annulation | Non atteint | Aucun dialogue de suppression d’objet n’a été validé dans ce second lot. |
| UI-61 | Versions et sélection | Atteint | Latest et version antérieure sont listées et sélectionnables. |
| UI-62 | URL présignée à courte durée | Partiel | URL générée et copiée avec le bucket correct. L’expiration effective n’a pas été attendue jusqu’à son terme. |
| UI-63 | Sélection multiple et actions Browser | Atteint | Deux objets sélectionnés, barre d’actions et copie fonctionnelles. Un défaut séparé subsiste : Apply peut être actif dans Bulk attributes sans changement utile. |
| UI-64 | Panneau des opérations | Atteint | Progression et résultat de transferts observés, y compris le message explicite de reprise proxy. |
| UI-65 | Compte Ceph Admin connu et détail | Partiel | La liste charge 1 923 comptes. La recherche d’un nom absent bloque le chargement plus de 40 s, ce qui empêche un parcours fiable par recherche. |
| UI-66 | Tri et pagination d’une grande liste Ceph Admin | Partiel | Les volumes 1 923 comptes, 1 974 utilisateurs et 1 417 buckets sont affichés, mais le coût de la recherche Accounts empêche une matrice complète. |
| UI-67 | Filtrer un bucket Storage Ops | Atteint | Le bucket apparaît deux fois, une par contexte, avec les nouveaux libellés privé/partagé. |
| UI-68 | Aperçu puis annulation d’une opération Storage Ops | Atteint | Preview versioning : 0 changement, 2 inchangés. Apply était actif à tort ; il est désormais désactivé. Cancel revient à la sélection. |
| UI-69 | Navigation clavier connexion, listes et dialogues | Partiel | Entrée, tabulation et Escape vérifiés sur les zones principales. Aucun parcours clavier exhaustif de toutes les listes n’a été réalisé. |
| UI-70 | Focus et clavier dans les dialogues | Atteint | Escape ferme les dialogues testés et le focus revient au flux utile. |
| UI-71 | Noms accessibles des boutons icônes | Atteint | Les contrôles principaux exposent des noms : compte, notifications, thème, colonnes, actions et mot de passe. |
| UI-72 | Association des erreurs aux formulaires | Atteint | Validation native de connexion, erreurs de création et erreur JSON lifecycle sont associées au champ ou visibles dans le groupe concerné. |
| UI-73 | Responsive 1440 px | Atteint | Toutes les surfaces principales restent lisibles et denses sur desktop. |
| UI-74 | Responsive 1024 px | Partiel | Dashboard et détails sont utilisables. Les tables larges nécessitent un défilement horizontal et les dernières colonnes sortent du viewport. |
| UI-75 | Responsive 390 px | Partiel | Dashboard, détail, menus et dialogue Object Lock sont corrects. La liste Storage Ops reste une table horizontale et masque les colonnes/actions à droite. |
| UI-76 | Zoom navigateur 200 % | Bloqué outillage | Le navigateur intégré ne fournit pas de commande de zoom vérifiable ; les raccourcis testés n’ont pas modifié la représentation. |
| UI-77 | Requête lente, état de chargement et double soumission | Partiel | Les états Loading et boutons désactivés sont visibles. La recherche Accounts révèle une attente excessive, mais toutes les doubles soumissions n’ont pas été instrumentées. |
| UI-78 | Erreur récupérable et nouvelle tentative | Atteint | L’upload direct en erreur bascule maintenant automatiquement vers le proxy et termine avec succès, avec message explicite. |
| UI-79 | Cohérence du même bucket entre Manager et Browser | Atteint | Nom, objets, versions, tag et configuration convergent entre les vues testées. |
| UI-80 | Modifier dans Manager puis rafraîchir Browser | Atteint | Les modifications de versioning/CORS et les objets restent visibles après actualisation des autres surfaces. |

## Corrections réalisées

Tous les commits sont locaux et n’ont pas été poussés.

| Commit | Correction | Validation principale |
|---|---|---|
| `ea4c883b` | Distinguer une recherche Admin Users sans résultat d’une liste réellement vide | Test ciblé Users, typecheck, build et vérification navigateur |
| `fb014411` | Effacer l’erreur de création d’utilisateur après Cancel/Discard | Test du dialogue, typecheck et vérification navigateur |
| `adf14a9b` | Identifier clairement les contextes Manager partagés et privés | Tests Manager, typecheck et vérification sur les deux contextes |
| `234d2816` | Clarifier l’état vide d’une recherche de bucket Manager | Tests Manager et vérification navigateur |
| `d2d6f2b6` | Désactiver Save lorsque le JSON Lifecycle est invalide | 79 tests Manager et typecheck |
| `a4b78931` | Reprendre automatiquement l’upload via le proxy quand le mode direct échoue | 129 tests Browser, typecheck et upload réel multi-fichier |
| `9b6e9ba6` | Clarifier l’état vide filtré des utilisateurs Ceph Admin | 12 tests ciblés, typecheck et vérification navigateur |
| `72f88026` | Désactiver Apply quand une opération Storage Ops ne produit aucun changement | 4 tests du panneau d’exécution, typecheck et vérification navigateur |
| `d0ec7013` | Ajouter Show/Hide pour mot de passe, LDAP et secret key | 8 tests Auth, typecheck, build de production et vérification navigateur |
| `8d740c58` | Propager la fin de session entre onglets | 15 tests Session/API/Layout, typecheck, build de production et test réel à deux onglets |

Les messages des dix commits respectent le format Conventional Commit avec les sections `Why:`, `What:` et `Validation:` et ont été contrôlés avec `backend/scripts/validate_ai_commit_message.py`.

## Problèmes importants restant à traiter

### 1. Recherche Ceph Admin Accounts très lente

Une recherche sans correspondance sur 1 923 comptes reste sur `Loading accounts...` au-delà de 40 secondes. Le chemin de repli enrichit un grand nombre de profils quand aucun identifiant ou nom ne correspond. Ce traitement doit être borné, paginé côté serveur ou remplacé par une requête indexée avant enrichissement.

### 2. Métriques Manager inutilisables dans un contexte de connexion

La page remonte un `403 AccessDenied` RGW brut. L’interface devrait soit utiliser la source de métriques compatible avec ce contexte, soit présenter un état d’indisponibilité compréhensible comme le fait Storage Ops.

### 3. Routes inconnues redirigées silencieusement

Une URL invalide envoie l’utilisateur vers le dashboard Storage Ops. Une page Not Found doit conserver l’URL fautive, expliquer le problème et proposer les destinations disponibles.

### 4. Tables Storage Ops peu adaptées aux petits écrans

À 390 px et, dans une moindre mesure, 1024 px, la table conserve sa largeur desktop. Le contexte reste identifiable, mais les colonnes de droite et les actions disparaissent hors écran. Une présentation par cartes ou des colonnes prioritaires mobiles amélioreraient fortement l’usage.

### 5. Localisation incohérente

Le profil configuré en anglais n’empêche pas les messages de validation HTML du navigateur d’apparaître en français. Plusieurs dialogues observés avant le changement de préférence étaient aussi en français alors que les workspaces restent principalement en anglais. Il faut décider si la langue suit le profil ou le navigateur et l’appliquer de manière homogène.

### 6. Données de synthèse Storage Ops absentes de la liste

Les colonnes Used et Objects restent à `-` pour le bucket de test, même après ouverture des détails et calcul d’usage dans Ceph Admin. La page de détail explique correctement l’indisponibilité des métriques en direct, mais la liste ne donne aucun motif.

### 7. Bulk attributes Browser accepte un no-op

Le bouton Apply peut rester actif sans section sélectionnée ou avec une ligne de tag inexploitable. La validation devrait appliquer la même règle que le correctif Storage Ops : aucune mutation utile, aucun Apply.

### 8. Téléchargement non prouvé côté navigateur intégré

Le backend renvoie bien 200 sur l’endpoint de téléchargement, mais l’événement de téléchargement du navigateur de test a expiré. Une vérification E2E Playwright avec dossier de téléchargement contrôlé est recommandée.

### 9. Onboarding RGW final non retesté

Les étapes de validation réussissent, mais l’application finale créerait des identités et droits persistants. Elle n’a pas été déclenchée dans ce lot. Le `HTTP 400 InvalidArgument` vu lors du premier audit reste donc un risque à retester séparément.

### 10. Message d’échec de connexion ambigu

« Invalid credentials or server unavailable » ne permet pas de savoir si l’utilisateur s’est trompé ou si le service est indisponible. Il est possible de conserver une réponse prudente côté sécurité tout en distinguant un problème réseau d’un refus d’authentification.

## Validation technique

- builds de production Docker frontend réussis après les corrections ;
- backend et frontend dédiés en état `healthy`, scheduler actif ;
- tests ciblés Manager, Browser, Ceph Admin, Storage Ops, Auth, Session, client API et Layout réussis ;
- typecheck frontend réussi après chaque groupe de corrections ;
- `git diff --check` et `git diff --cached --check` réussis avant commit ;
- aucun push effectué ;
- arbre Git propre après le commit du présent rapport.

Une suite frontend complète n’a pas été relancée après chaque petit commit ; les tests ciblés ont été choisis selon la surface modifiée, complétés par le typecheck, le build de production et une reproduction navigateur sur l’instance dédiée.
