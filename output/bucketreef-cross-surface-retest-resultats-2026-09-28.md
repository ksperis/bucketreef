# Retest utilisateur multi-workspaces — 28 septembre 2026

## Résumé exécutif

Dix scénarios utilisateur ont été exécutés sur une instance Docker dédiée construite depuis le `main` local. Le périmètre couvre l'authentification, l'administration, Manager, IAM, Portal, Browser, Storage Ops, Ceph Admin, la supervision et l'audit.

Résultat global : **10 scénarios atteints, dont 2 après correction**. Deux défauts de contrôle d'accès frontend ont été corrigés dans des commits locaux indépendants. Aucun push n'a été effectué.

## Instance et données de test

- projet Compose : `bucketreef-cross-surface-audit` ;
- frontend : `http://localhost:19280` ; backend : `http://localhost:19200` ;
- base SQLite neuve migrée jusqu'à `0137_browser_path_favorites` ;
- source initiale : `main` au commit `764f24cd` ;
- endpoint S3 de laboratoire non production ;
- un super-administrateur, un manager, un collaborateur, un groupe d'habilitation et un compte RGW éphémères ;
- buckets versionnés `cross-audit-1b6a5e-data` et `cross-audit-1b6a5e-portal`, plus le bucket technique de journaux Portal ;
- objets texte, CSV et JSON, chemins avec espaces et Unicode, deux versions de `audit-folder/report.txt` ;
- utilisateur, groupe, rôle et stratégie IAM éphémères.

Les mutations ont été vérifiées par une lecture directe de S3 depuis le backend dédié. Les secrets de test ont été conservés hors du dépôt et ne figurent pas dans ce rapport.

## Résultats des dix scénarios

| # | Parcours | Résultat | Vérifications, difficultés et preuves |
|---|---|---|---|
| 1 | Première connexion, erreur et cycle de session | Atteint | Un mot de passe incorrect affiche une erreur compréhensible, la connexion valide ouvre le bon workspace et la déconnexion dans un onglet invalide immédiatement la session d'un second onglet. Les réponses 401 observées correspondent à ces essais volontaires. |
| 2 | Administration des endpoints et supervision | Atteint | Les trois endpoints configurés sont listés, `s3-z1` est le défaut, ses champs gérés par l'environnement restent en lecture seule et le tag UI `cross-audit` est enregistré. Un healthcheck manuel renvoie `Up`, HTTP 200 et 27 ms ; le détail affiche ensuite un échantillon et 100 % de disponibilité sur la fenêtre testée. |
| 3 | Utilisateurs, groupes et droits effectifs | Atteint | Le compte RGW, les deux utilisateurs et le groupe sont retrouvés par recherche. L'audit d'accès du manager expose 9 droits de plateforme, 3 droits de compte et leurs sources directes ou héritées. Les liens Manager, Portal et Browser correspondent aux rôles provisionnés. |
| 4 | Configuration d'un bucket dans Manager | Atteint | Le bucket `cross-audit-1b6a5e-data` est créé depuis l'interface avec versioning, tag S3 `qa=cross-surface` et CORS pour l'origine locale. La lecture directe S3 confirme le versioning `Enabled`, le tag et la règle GET/PUT/HEAD. |
| 5 | Gestion IAM dans Manager | Atteint | L'utilisateur `cross-audit-reader-1b6a5e`, son groupe et son rôle sont visibles. L'appartenance au groupe, le chemin de rôle `/cross-audit/` et la stratégie inline `BucketReadOnly` ciblant le bucket et ses objets sont corrects. |
| 6 | Collaboration Portal et permissions | Atteint après correction | Le manager crée un Storage Space partagé restreint et le collaborateur le voit avec le rôle Editor. Le collaborateur ne peut ni inviter ni créer de lien public, mais crée le dossier `collaborator-created/`, ensuite relu directement dans S3. L'accès direct du collaborateur à `/manager` exposait initialement le shell Manager ; `280250bf` le remplace par la page d'accès restreint tout en conservant l'accès du manager. |
| 7 | Navigation Browser et données d'objet | Atteint | Le choix du contexte et du bucket, les dossiers, Retour/Avance, le rechargement profond et un nouvel onglet conservent `ctx`, `bucket` et `prefix`. L'aperçu affiche le contenu v2 de `report.txt`, l'historique montre ses deux versions et le panneau d'objet ne contient plus « Copier le chemin ». |
| 8 | Storage Ops avec habilitation héritée | Atteint après correction | Le manager reçoit Storage Ops par son groupe. Le frontend refusait pourtant le workspace car il ne lisait que le booléen direct ; `2479c31c` utilise désormais `effective_access`. Après reconstruction, le dashboard s'ouvre, le filtre exact retrouve le bucket et le détail confirme propriétaire, versioning et CORS. |
| 9 | Ceph Admin sur un inventaire réel | Atteint | Après attribution de l'habilitation Ceph Admin au super-administrateur éphémère, la recherche exacte isole le compte parmi 1 924 comptes, le bucket parmi 1 423 buckets et l'utilisateur racine parmi 1 981 utilisateurs. Les détails confirment le nom du compte, le quota, le propriétaire RGW, quatre versions d'objets, le versioning et CORS. |
| 10 | Audit, observabilité, responsive et journaux | Atteint | L'audit charge 32 événements avec acteur, scope, statut et métadonnées ; une recherche sur le bucket retrouve ses trois actions de création, tags et CORS. À 390 × 844, les filtres et les lignes d'audit restent utilisables sous forme empilée. La console ne contient que l'erreur 401 volontaire du scénario 1 et aucun HTTP 5xx n'apparaît dans les logs backend. |

## Contrôles directs S3

- `cross-audit-1b6a5e-data` contient trois clés et quatre versions sans marqueur de suppression ;
- `cross-audit-1b6a5e-portal` contient trois clés, dont le dossier créé par le collaborateur, et trois versions sans marqueur de suppression ;
- les deux buckets applicatifs ont le versioning activé ;
- le bucket technique Portal est présent et vide ;
- les lectures d'objets confirment le contenu courant et les chemins avec espaces et Unicode.

## Corrections réalisées

| Commit | Problème corrigé | Validation principale |
|---|---|---|
| `280250bf` — `fix(manager): guard workspace without execution context` | Un utilisateur Portal sans contexte d'exécution Manager pouvait ouvrir le shell `/manager`, qui échouait ensuite au chargement. La route s'appuie maintenant sur `/me/workspace-access` et affiche une page d'accès restreint avant le shell. | Tests du garde Manager, typecheck, ESLint, build et reproduction réelle avec le collaborateur puis le manager. |
| `2479c31c` — `fix(auth): honor inherited privileged workspace access` | Les gardes Storage Ops et Ceph Admin ignoraient les habilitations héritées d'un groupe et ne lisaient que les indicateurs directement portés par l'utilisateur. | Tests des droits directs et hérités, typecheck, ESLint, build et ouverture réelle de Storage Ops avec le manager de groupe. |

Les messages ont été validés avec `backend/scripts/validate_ai_commit_message.py`. Les commits sont limités à leur cause et n'ont pas été poussés.

## Constats à traiter séparément

### 1. Uniformiser la langue du Browser Portal intégré

Le shell Portal respecte la langue française, mais certaines actions du Browser intégré et le dialogue de création de dossier restent en anglais (`Portal browser`, `New folder`, `Create folder`) alors que les actions voisines sont traduites. La correction devrait passer par le contrat de traduction partagé du Browser et couvrir les quatre surfaces afin d'éviter de nouvelles divergences.

### 2. Expliquer précisément l'indisponibilité des transferts directs

Le bucket possède une règle CORS compatible avec l'origine locale, mais le Browser indique encore que le transfert direct n'est pas autorisé. Cette situation peut aussi dépendre de la capacité de l'endpoint, du type d'identité et de la politique de transfert. Le message devrait exposer la raison déterminée par le backend et l'étape de remédiation applicable, au lieu de laisser CORS apparaître comme la seule cause possible.

### 3. Réduire le bruit des absences de configuration S3 attendues

La consultation d'un bucket sans lifecycle, policy, chiffrement, site statique, Object Lock ou Public Access Block produit plusieurs logs `WARNING`, bien que l'API traduise correctement ces réponses en états « désactivé » ou « non configuré ». Centraliser la classification des codes `NoSuch*` attendus permettrait de les journaliser en `DEBUG` ou `INFO` et de réserver `WARNING` aux échecs réellement anormaux.

### 4. Éviter le placeholder trompeur au rechargement profond Manager

Pendant la restauration d'une URL profonde, le Browser Manager affiche brièvement l'état « aucun compte sélectionné » avant de rétablir le compte et le préfixe. Un état de chargement explicite éviterait ce faux diagnostic sans changer le contrat d'URL.

### 5. Unifier la preuve d'inventaire avant suppression d'un compte RGW

Après suppression et vérification indépendante de tous les buckets, la route Admin `DELETE /admin/accounts/{id}?delete_rgw=true` a refusé la suppression avec « Unable to verify bucket existence » : l'appel Admin Ops utilisé par ce précontrôle recevait un 403, alors que la liste Ceph Admin, la liste S3 du compte et les inventaires IAM prouvaient tous un état vide.

La suppression de test a été achevée de façon contrôlée en supprimant les deux groupes Portal vides, puis l'utilisateur racine et le compte par les opérations Ceph Admin confirmées, avant de retirer l'entrée locale. La correction produit doit conserver ce niveau de sûreté tout en partageant le même inventaire autoritatif que Ceph Admin, ou en prévoyant un repli explicite vers l'identité de supervision. Elle doit couvrir les réponses 403, l'absence totale de buckets, les groupes Portal résiduels et la reprise après une étape distante réussie.

## Validation technique

- tests Vitest ciblés des gardes Manager et des habilitations privilégiées : réussis ;
- typecheck frontend : réussi ;
- ESLint ciblé sur les fichiers modifiés : réussi ;
- build frontend de production : réussi ;
- reconstruction du frontend Docker après chaque correction : réussie ;
- migrations Alembic : tête unique `0137_browser_path_favorites` sur une base neuve ;
- contrôle navigateur visible sur les workspaces Admin, Manager, Portal, Browser, Storage Ops et Ceph Admin ;
- contrôle responsive représentatif à 390 × 844 ;
- healthcheck réel de `s3-z1` : HTTP 200, statut `Up`, 27 ms ;
- lecture S3 indépendante des objets, versions, tags, CORS et marqueurs de suppression ;
- aucun HTTP 5xx ni exception JavaScript inattendue pendant les scénarios ;
- `git diff --check` et validation des messages de commit exécutés avant les commits ;
- contrôle final Ceph : zéro compte, utilisateur racine ou bucket correspondant au préfixe de test ;
- buckets, versions, marqueurs, Storage Space, IAM, utilisateurs, groupe et compte éphémères supprimés ;
- conteneurs, réseau, volume et fichiers temporaires sensibles de `bucketreef-cross-surface-audit` supprimés ;
- aucun push effectué.
