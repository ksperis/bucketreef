# Plan d’implémentation — Ceph Admin Multisite Diagnostics

Statut initial : proposition détaillée, puis implémentation V1 sur cette branche ;
voir le [suivi des validations et limites](implementation-status.md). Date :
27 octobre 2026. Branche dédiée : `feat-ceph-admin-multisite`.

## 1. Résultat attendu et limites de cette itération

Permettre à un administrateur de stockage de répondre à quatre questions :

1. Quelles zones et quels flux peut-il réellement observer ?
2. Quelle phase Ceph rapporte-t-il pour la synchronisation metadata et data ?
3. Pour un bucket et un couple source/destination, quels états, générations et
   marqueurs sont enregistrés ?
4. Qu’est-ce qui a changé entre deux observations et quelles entrées du journal
   source peut-on examiner pour poursuivre le diagnostic ?

La conception initiale livrait **le plan et la maquette**. L'implémentation V1
est désormais suivie dans [le bilan de qualification](implementation-status.md).
Son périmètre comprend les trois vues et les observations
successives pendant une session de consultation. Un historique permanent et un
collecteur en arrière-plan sont un lot ultérieur, explicitement distinct.

Le module est intégralement en lecture seule vis-à-vis de Ceph : aucun trim,
notify, lock, resync, arrêt, réparation, changement de policy, de cap ou de clé.
Ni SSH, ni CephX, ni exécution de `radosgw-admin`, ni API Ceph Dashboard requise.

### Ce qui ne sera pas affiché comme une mesure Ceph

- Pourcentage de réplication ou de shards « sains ».
- Retard exact en secondes ou nombre d’objets restants en incrémental.
- État de réplication individuel déduit de `bilog.state`.
- Date de fin d’un full sync ou date de création d’une génération.
- Compteur `shards_done_with_gen` : interne, absent du dump REST Tentacle.
- Erreurs détaillées du sync error log : pas de route GET dédiée dans le
  dispatch `/admin/log` étudié.

Les cellules sans preuve afficheront « Indéterminé », « Non observé » ou
« Indisponible », selon le cas. Un champ absent n’est jamais converti en zéro.

## 2. Références vérifiées et décisions structurantes

Le [contrat annexe](ceph-api-contract.md) est la référence des appels Ceph.
Le code a été lu au tag `v20.2.4`, commit
`7f793731f1b39eb4f465e960113d2363c311b964`. Les noms des membres C++ ne sont
pas pris pour les noms JSON : les méthodes `dump()` et le formatter ont aussi
été examinés.

Le dépôt BucketReef inspecté est le miroir public au commit
`d84b4e63817d22ce8bfc35788a2be3bd970d75ed`. Les consignes de `AGENTS.md`,
`ai-assistant-guidelines.md`, `product-design.md`, `workspace-surfaces.md` et
`ui-theme.md` ont guidé les choix.

| Décision | Application concrète |
| --- | --- |
| Module dans Ceph Admin | Pas de nouvelles pages Manager, Portal ou Storage Ops |
| Endpoint sélectionné = point d’entrée de consultation | Il ne devient pas implicitement la source de tous les flux |
| Statut lu sur la destination | Toute lecture conserve explicitement source et destination |
| Configuration et observation séparées | Un flux déclaré n’est pas présenté comme actif ou à jour |
| Couverture explicite | Afficher zones connues, endpoints associés et échecs de lecture |
| Pas de comparaison générique de marqueurs | Chaînes opaques, jamais de soustraction ni d’ordre lexical universel |
| Réemploi du transport existant | Signature V4, TLS et absence de redirection déjà gérés |
| Réemploi de l’identité `ceph_admin` | Pas de nouveau modèle parallèle de permission |
| Échec partiel conservé | Une zone en erreur ne vide pas les autres résultats |
| API de diagnostic strictement typée | Pas de proxy libre vers `/admin/*` |

### Identité privilégiée existante

BucketReef exige actuellement une identité Ceph Admin externe avec
`admin=true`, `system=false` (`ceph_admin_service_identity.py`). Elle possède
potentiellement des droits plus larges que le diagnostic. La garantie V1 est
donc l’absence d’opérations de mutation dans le nouveau chemin applicatif,
vérifiée par allowlist et tests réseau. Elle n’est pas une limitation des droits
globaux de cette identité RGW. Ne pas annoncer qu’une simple liste de caps
`*=read` restreint un utilisateur déjà administrateur.

Les checks Ceph demandent `zone=read`, `mdlog=read`, `datalog=read`,
`bilog=read`, et `buckets=read` pour l’inventaire/résolution d’instance. Une
future identité exclusivement diagnostique serait une évolution explicite du
contrat d’identité, à concevoir séparément. Aucune élévation automatique en V1.

## 3. Parcours et structure UX

### Navigation commune

Ajouter « Multisite » dans le groupe Monitoring de `CephAdminLayout`, après
Usage & Metrics, avec son pictogramme de sites reliés. Le groupe Monitoring est
placé sous Data dans la sidebar. Utiliser les contrats de navigation et breadcrumbs existants.

Routes UI proposées :

```text
/ceph-admin/multisite
/ceph-admin/multisite/bucket
/ceph-admin/multisite/logs
```

La sélection d’endpoint réutilise `CephAdminEndpointContext`. Les paramètres
URL retiennent le contexte non secret : zone source, zone destination,
tenant/nom des buckets, shard, famille, génération et panneau ouvert. Réutiliser
la convention existante de sélection d’endpoint ; ne pas créer un second
sélecteur concurrent. Toute URL est revalidée côté serveur.

### Vue d’ensemble

En-tête : titre Multisite, badge Lecture seule, fraîcheur et bouton Actualiser.
Onglets : Vue d’ensemble, Réplication d’un bucket, Journaux.

Le nom du realm est résolu par `GET /admin/realm?id=REALM_ID` ; le period ne
fournit que son identifiant. Si cette lecture manque, afficher le realm_id.
Une synthèse en ligne indique realm, realm epoch, nombre de zones et couverture
des connexions. Un inventaire compact représente la topologie par zone : nom,
rôle metadata, zonegroup, endpoint associé, disponibilité de lecture. Il reste
lisible à trois zones comme à trente ; pas de diagramme qui se transforme en
enchevêtrement de flèches. Le JSON de configuration est accessible en détail.

Deux tables distinguent ensuite metadata et data :

- Metadata : destination, metadata master de référence, phase, nombre attendu
  de shards metadata et compte des états reçus, fraîcheur.
- Data : source, destination, phase globale, états des shards datalog reçus,
  action Voir les shards.

Le nombre de relations candidates n’est pas un KPI de flux actifs. Une policy
complexe non résolue garde le libellé « Périmètre à confirmer ». Les sources
connues peuvent être interrogées de manière bornée pour constater l’existence
d’un gestionnaire de sync ; un succès ne prouve pas que chaque bucket est inclus.

Le panneau d’un flux montre la famille de shards, phase, marqueur complet,
timestamp Ceph et provenance. Les nombres de
shards mdlog, datalog et bilog ne sont jamais additionnés en un total de santé.

### Réplication d’un bucket

Formulaire compact : destination, bucket destination, tenant, source et bucket
source (identique par défaut, modifiable pour les configurations qui le
nécessitent). Résoudre séparément les instances source et destination. Un
bouton « Lire le diagnostic » effectue uniquement des GET. Toute modification
du périmètre invalide les résultats précédents immédiatement.

Résultat : état global retourné, génération suivie, nombre de statuts de shards
reçus, génération source la plus récente si disponible. Une génération source
plus récente est un écart observé ; elle ne produit pas automatiquement une
alerte de retard.

Sous-onglets :

1. **Shards** : état, marqueur destination et timestamp du marqueur Ceph.
   Filtres locaux clairement limités aux
   statuts chargés. Panneau pour le marqueur entier et le JSON.
2. **Générations source** : `gen`, `num_shards`, repères « Suivie » et « Plus
   récente » lorsque les lectures ont réussi. Pas de dates ni d’état « Active ».
3. **Journal source** : listing bilog, génération et instance explicites ;
   `write`, `del`, etc., `pending`/`complete` comme état de l’opération source.
Le mode normal est un couple source/destination non fusionné. Le mode
`options=merge` reste un contrôle avancé facultatif après qualification : il
sera intitulé « Statut fusionné de destinations locales », avec avertissement
sur la perte d’attribution. Ne pas le présenter comme un inventaire de pipes.
L’API ne retourne pas de liste détaillée des pipes ni d’identité de pipe dans
chaque statut. Plusieurs règles vers le même couple ne sont pas distinguables
automatiquement à partir de ce seul endpoint.

### Journaux

Sélecteur de famille Metadata / Data / Bucket index. L’endpoint interrogé est
affiché explicitement : consulter le bilog source ne change pas silencieusement
le point d’entrée du workspace.

- Metadata : shard obligatoire, période explicite et page bornée.
- Data : shard obligatoire, `extra-info=true` pour préserver log_id et
  log_timestamp en plus de l’entrée métier ; `last_update` est qualifié comme
  date du journal, pas date d’application sur la destination.
- Bucket index : bucket, tenant, instance, génération explicites ; shard via
  `bucket-instance=<name>:<instance>:<shard>` lorsque demandé.

Les colonnes changent avec la famille. Un panneau latéral présente le JSON
filtré, les paramètres non secrets et les horodatages de collecte. Il n’y a pas
de recherche globale inventée, de sévérité fictive ni de filtre temporel envoyé
à RGW : `start-time`/`end-time` sont refusés par mdlog/datalog.

Pagination Suivant par marqueur, Précédent par pile de curseurs dans la session.
Pas de numéro de dernière page ni de nombre total d’entrées inconnu. Les filtres
« dans les entrées chargées » ne prétendent pas rechercher le journal complet.
En V1, pas de mode All shards ; l’agrégation globale reste un futur lot avec
pagination multi-curseurs et budget de requêtes explicite.

### Langage visuel et accessibilité

Réutiliser `PageShell`/`PageHeader`, `PageTabs variant="line"`, `InlineSummary`,
`ListPageSection`, `ListToolbar`, `DataTableShell`, `UiBadge`, `UiInlineMessage`,
`UiDrawer`, `UiDetails` et `ErrorState`. Couleurs et géométrie : tokens `ui-*`
et `shell-*`, bleu Reef `#0569f8`, bordures fines, panneaux 8 px, badges 4 px,
tables 12/18 px, actions compactes 28 px sur bureau et cibles 44 px sur mobile.

Pas de nouvelle charte, de grosses cartes KPI décoratives ni de couleurs santé
sur une simple phase `sync`. Maintenir séparément nom lisible et identifiant
technique copiable. Les timestamps portent un fuseau ; conserver la valeur
brute et la précision nécessaire dans les détails. Une valeur de timestamp
vide ou à l’époque Unix est affichée comme indisponible, pas comme retard.

Panneau non modal sur bureau, plein écran sous 1024 px, fermeture Escape,
retour du focus à la ligne, sélection de la ligne indépendante du focus.
Les tabulations, compteurs et erreurs sont accessibles sans couleur seule.
Au changement de périmètre, annuler les requêtes et ignorer les réponses tardives.

## 4. Architecture proposée

### Découverte live zone / endpoint

La zone locale est découverte avec `GET /admin/config?type=zone` au moyen de
l'identité Ceph Admin du endpoint. Cette lecture fournit l'ID de zone et le
realm, puis le period fournit zonegroups et zones. Aucune association multisite
n'est stockée dans `StorageEndpoint`.

- À l'ouverture de la page, lire la zone locale du point d'entrée, puis le
  realm/period lorsqu'un realm est configuré.
- Pour chaque endpoint Ceph Admin enregistré, relire sa propre zone locale avec
  sa propre identité et l'associer à la zone du period ayant le même ID/realm.
- Un seul endpoint enregistré pour une zone devient l'exécuteur de diagnostic.
  Plusieurs correspondances rendent le choix ambigu et aucun endpoint n'est
  sélectionné implicitement.
- Un 401/403, timeout ou contrat invalide sur un endpoint secondaire le laisse
  non attribué sans bloquer les autres zones.
- Aucun appel automatique aux URLs publiées dans le period. Seuls les endpoints
  enregistrés et autorisés dans BucketReef sont utilisés.
- Le probe de navigation désactive Multisite uniquement si la lecture de zone
  réussit et qu'aucun realm n'est configuré. Tout échec reste `unknown`.

La lecture de zone nécessite `zone=read`. Comme la réponse Ceph brute peut
contenir `system_key`, le client projette immédiatement uniquement ID/nom de
zone, realm, placements et noms de classes de stockage. Les classes restent des
données live dans cette itération et ne sont pas persistées.

### Chaîne backend

```text
router Ceph Admin → service Multisite → résolution d’endpoints autorisés
                  → client RGW à méthodes GET autorisées → transport V4 existant
                  → normalisation DTO + résultat par composant
```

Le routeur reste mince. Le client expose des méthodes explicites :
`get_realm`, `get_period`, `get_metadata_sync_status`, `get_data_sync_status`,
`get_bucket_sync_status`, `get_bilog_info`, `list_mdlog`, `list_datalog`,
`list_bilog` et `get_multisite_bucket_info`.

La couche de diagnostic ne reçoit aucune méthode HTTP, URL ou chemin libre du
frontend. Contrôler aussi les paramètres : un GET n’est pas une garantie de
lecture seule dans toutes les Admin Ops (par exemple certaines actions bucket
acceptent `fix`). La liste autorisée est figée sur les handlers examinés.

### DTO communs

```typescript
type Availability =
  | 'available' | 'not_observed' | 'not_applicable' | 'not_found'
  | 'denied' | 'unsupported' | 'unavailable' | 'misconfigured';

type Observation<T> = {
  availability: Availability;
  data: T | null;
  collected_at: string;             // UTC, horodatage BucketReef
  last_success_at: string | null;
  stale: boolean;
  provenance: {
    endpoint_id: number;
    realm_id: string | null;
    local_zone_id: string | null;
    source_zone_id: string | null;
    operation: string;              // enum fermé, jamais URL libre
    http_status: number | null;
    duration_ms: number;
    collection_id: string;
  };
  reason_code: string | null;
};
```

Les phases sont propres à chaque famille. Conserver la valeur inconnue en
`raw_status`, avec affichage Unknown, sans la rabattre sur `init`. Les DTO
normalisent les tableaux `{key,val}` Ceph vers `{shard_id,...}`. Le numéro de
shard de `inc_status` est l’indice du tableau, pas un champ retourné par Ceph.
Transmettre les entiers 64 bits susceptibles de dépasser `Number.MAX_SAFE_INTEGER`
comme chaînes décimales dans les DTO frontend ; ne pas altérer les marqueurs.

`LogPage` contient famille, périmètre, entries, next_cursor, truncated,
last_update éventuel et éventuellement next_log. Pour bilog, le curseur courant
vient du dernier `op_id`, pas d’un champ top-level marker inexistant.

### Routes applicatives proposées

Préfixe existant `/api/ceph-admin/endpoints/{endpoint_id}/multisite` (respecter
`settings.api_prefix` réel). Ce sont des routes BucketReef, pas des routes Ceph.

| Route GET | Usage |
| --- | --- |
| `/state` | Probe léger actif/inactif/inconnu basé sur la zone locale |
| `/topology` | Configuration period normalisée, références des endpoints autorisés |
| `/overview` | États metadata/data des destinations observables, erreurs partielles |
| `/flows/status` | Statut local pour une source et une destination explicites |
| `/bucket/status` | Couple de buckets et source-zone ; version=2 obligatoire |
| `/logs/metadata` | Période, shard, taille et curseur |
| `/logs/data` | Shard, taille, curseur, extra-info=true imposé |
| `/logs/bucket-index` | Bucket/instance/génération/shard et curseur |

Chaque endpoint de destination/source secondaire est résolu à nouveau avec
les garde-fous Ceph Admin existants. Ne pas accepter un `source_endpoint_id`
simplement parce que le point d’entrée principal est autorisé. Le catalogue
des endpoints et l’exécution emploient la même autorité d’accès.

### Disponibilité et erreurs

| Cas | Traitement |
| --- | --- |
| 401/403 | denied ; ne pas convertir en API absente |
| 404 metadata sur metadata master configuré | non applicable pour la sync entrante ; garder provenance |
| 404 data ou bucket | not_found / aucun état disponible ; pas de déduction automatique « aucun flux configuré » |
| 404 d’une route présumée | ambigu tant que route, configuration et objet ne sont pas distingués |
| 405/501 ou preuve explicite de route non supportée | unsupported pour cette opération, pas pour tout l’endpoint |
| timeout/TLS/connexion/5xx | unavailable ; conserver dernière réussite avec stale=true |
| JSON inattendu, incomplet ou tronqué | erreur de contrat explicite, aucun état « sain » |
| zone locale absente du period | misconfigured ; aucune attribution arbitraire |
| statut `stopped` Ceph | afficher l’état réel ; ce n’est pas une indisponibilité HTTP |

Le cas metadata master doit aussi accepter une réponse HTTP 200 avec une
structure par défaut : `read_sync_status()` peut retourner 0 sans peupler la
structure. Le rôle connu est déterminant, pas seulement le code 404.

Les API bilog listent des données en streaming. Une rupture peut produire un
JSON incomplet ou un corps inachevé malgré des headers déjà envoyés. Exiger une
réponse complète ; ne pas rendre une liste partielle comme une page valide.
Le handler datalog remplace son code retour de listing par celui du get_info
suivant : une réponse réussie vide doit rester descriptive, sans prouver à elle
seule l’absence de changements ou le rattrapage de la destination.

### Budgets de lecture et fraîcheur

Valeurs de départ configurables à mesurer au laboratoire :

- V1 : collecte à la demande et actualisation uniquement manuelle ; aucune tâche
  de fond implicite.
- Une collecte overview traite au plus 8 destinations à la fois ; pages/groupes
  suivants explicites. Concurrence maximale 3 appels RGW, budget 32 appels par
  collecte, timeout 8 s par appel et deadline globale 20 s. Renvoyer les résultats
  disponibles et le périmètre non collecté, sans attente illimitée.
- Configuration/topologie : cache serveur 60 s, statuts 10 s ; journaux sans
  préchargement. Cache isolé par endpoint, identité/configuration et périmètre ;
  une modification de credentials change l'empreinte et force une nouvelle lecture.
- Une page de journal vaut 100 entrées par défaut, maximum applicatif 500
  (mdlog/datalog plafonnent eux-mêmes à 1000). Taille de corps limitée, par
  exemple 4 MiB configurable ; limite explicite, jamais truncation silencieuse.
- Au plus 1000 shards rendus par tranche côté UI, avec compteur reçu/attendu.
  Les status Ceph ne sont pas paginés par shard : vérifier la charge et les
  limites de corps avant de qualifier les configurations très volumineuses.
- Pas de polling des journaux ni de tous les buckets. Le statut de données
  n’est pas une liste de tous les buckets en retard.
- Chaque rafraîchissement revalide les permissions ; une révocation ne réutilise
  pas un cache ancien.

## 5. Historique des observations — retiré

La comparaison session-only entre collectes, la rétention frontend et la vue
« Observations » ont été retirées après revue UX. L’implémentation conserve les
marqueurs Ceph bruts et la provenance utiles au diagnostic, sans fabriquer un
état « modifié », « inchangé » ou « première observation » entre deux lectures.
Un historique persistant ou un collecteur périodique reste hors périmètre.

## 6. Lots de travail, fichiers et validation

Les noms de nouveaux fichiers ci-dessous sont proposés ; les fichiers existants
ont été repérés dans le commit de référence. Garder l’architecture routeurs
minces → services → clients. Chaque lot possède son critère de sortie.

| Lot | Contenu / fichiers principaux | Dépendance | Validation de sortie | Charge indicative |
| --- | --- | --- | --- | --- |
| 0 | Actualiser branche et références ; capturer vrais payloads Tentacle ; enrichir `backend/app/scripts/probe_rgw_admin_contract.py` sans mutation | — | réponses assainies et matrice endpoints/caps/erreurs ; confirmer bucket-instance | 1–2 j |
| 1 | Retiré : associations persistantes remplacées par la découverte live des zones à partir des identités Ceph Admin existantes | 0 | aucune migration ni configuration d’association ; ambiguïtés laissées non attribuées | — |
| 2 | `services/rgw_admin_multisite.py`, intégration au client `rgw_admin.py` ; allowlist GET/params et parsing exact ; fixtures `tests/fixtures/ceph_multisite/tentacle/` | 0 | URLs/flags/tenants/générations, JSON réel, exceptions 403/404/5xx, streaming invalide ; zéro mutation | 2–3 j |
| 3 | `models/ceph_multisite.py`, `services/ceph_multisite_service.py`, `routers/ceph_admin/multisite.py`, enregistrement dans `main.py` ; disponibilité, budgets, caches et autorisation sur chaque endpoint | 1,2 | accès anonyme/Manager/Portal refusé ; endpoint secondaire interdit ; partial success ; cache après révocation | 2–3 j |
| 4 | `frontend/src/api/cephMultisite.ts`, routes `router.tsx`, `navigation/workspacePages.ts`, breadcrumbs, `CephAdminLayout.tsx` ; sous-dossier `features/cephAdmin/multisite/` | 3 | navigation, endpoint sélectionné, deep links, annulation des requêtes et états absents | 1 j |
| 5 | `MultisiteOverviewPage.tsx`, tables zones/metadata/data, `FlowDetailDrawer.tsx`, couverture ; réemploi des primitives | 4 | chiffres dérivés corrects par famille, états partiels, 0/1/3/30 zones ; clavier et mobile | 1–2 j |
| 6 | `BucketReplicationPage.tsx`, formulaire de périmètre, `BucketShardTable.tsx`, `BilogGenerationsTable.tsx`, liens d’inventaire bucket existant | 4 | buckets source≠dest, tenant identique/noms identiques, instance absente, resharding, génération source≠suivie | 2–3 j |
| 7 | `MultisiteLogExplorerPage.tsx`, `LogEntryDrawer.tsx`, pagination adaptée à chaque famille, export local des entrées chargées | 4,6 | mdlog period, datalog extra-info, bilog next_log/op_id ; filtre local annoncé ; JSON et CSV assainis | 1–2 j |
| 8 | Retiré : la comparaison session-only des observations a été supprimée au profit d’un état Ceph courant rafraîchi explicitement | 5,6 | aucune colonne ou vue de changement local ; refresh manuel conserve les états Ceph bruts utiles | — |
| 9 | i18n Ceph Admin, docs Admin/opérations, contrats OpenAPI générés selon conventions, scénario docs screenshots, tests visuels/E2E et qualification laboratoire | 5–7 | scénarios ci-dessous, light/dark, desktop/mobile, CI ciblée et vérification générale requise | 2–3 j |

Ordre recommandé : 0 → 1+2 → 3 → 4 → 5+6+7 → 9. Charge indicative cumulée
14–23 jours de travail, à recalibrer après les payloads et la topologie du
laboratoire. Ce n’est ni une promesse de délai calendaire ni le temps de cette
première itération. Les lots parallèles restent soumis aux dépendances et à la
coordination de fichiers.

### Délégation demandée : maximum trois sous-agents

Modèle à utiliser : `model="chatgpt-web/gpt-5.6-sol"`,
`reasoning_effort="high"`. Ne pas remplacer ce modèle silencieusement.
Il n'était pas disponible dans la session de conception. La session
d'implémentation l'utilise avec au plus trois sous-agents simultanés.

Paquets autonomes dès qu’il sera exposé :

| Vague | Agent 1 | Agent 2 | Agent 3 | Intégration principale |
| --- | --- | --- | --- | --- |
| Analyse | Contrat Ceph : handlers + dumps + tests réels | Architecture BucketReef, identités, cache, autorisations | UX existante, composants, états, parcours | Arbitrer, vérifier les preuves, figer contrats et maquette |
| Implémentation A | Client Ceph + fixtures (lot 2) | Découverte live des zones (lot 1) | Tests de contrat/risques en lecture seule | Lots 0/3 et revue des changements partagés |
| Implémentation B | Vue d’ensemble (lot 5) | Bucket (lot 6) | Journaux (lot 7) | Routes/API partagées et état courant |
| Qualification | Permissions/allowlist backend | Parcours UI et accessibilité | Scénarios vrais RGW et documentation | Résoudre les écarts et livrer |

Chaque mission indique fichiers possédés, entrées, résultat attendu, tests et
preuves. Pas de modification concurrente de `main.py`, `router.tsx`, migration,
catalogues i18n ou types partagés : un propriétaire les intègre. Chaque agent
rapporte ce qu’il a réellement exécuté ; la revue principale vérifie les
résultats avant de déclarer une capacité disponible.

### Découpage Git recommandé

1. `docs(ceph-admin): specify Tentacle multisite diagnostics` : présente itération.
2. `feat(backend): add read-only RGW multisite contracts` : fixtures + client.
3. `feat(ceph-admin): resolve multisite zone observations` : configuration + services.
4. `feat(ceph-admin): add multisite overview`.
5. `feat(ceph-admin): add bucket replication diagnostics`.
6. `feat(ceph-admin): add multisite log explorer`.
7. `feat(ceph-admin): track session marker observations`.
8. `docs(ceph-admin): document and qualify multisite diagnostics`.

Respecter les corps Why / What / Validation du dépôt. Les changements d’API
backend sont coordonnés avec le frontend de la même release ; ils ne sont pas
automatiquement classés breaking. Ne pas inclure les changements étrangers à
cette branche. Cette préparation ne pousse ni ne fusionne de branche distante.

## 7. Stratégie de tests

### Contrat statique et unitaires backend

- Fixtures calquées sur les dumps exacts et distinguées des captures réelles.
  Root JSON sans faux wrapper `status`/`info`/`result` ; markers `{key,val}`.
- Tester les champs absents/inconnus, timestamp nul, tableaux vides, entiers
  64 bits, données inattendues et marqueur de pagination répétitif.
- Vérifier toutes les requêtes sortantes : uniquement méthodes GET, chemins et
  clés de paramètres autorisés, flags vides préservés par la signature.
- Refuser notify, trim, lock, unlock, fix, start/stop, resync, méthode ou URL
  fournie par le client. Aucun accès à ces variantes via une route générique.
- Autorisation sur tous les endpoints utilisés, invalidation du cache lors
  d’une révocation et absence de fuite à travers le JSON ou les messages d’erreur.
- Un 404 ne devient ni une preuve d’API absente, ni un état synchronisé.
- Tester la cardinalité inc_status et les résolutions d’instance avec tenant.

### Tests frontend et browser

- Navigation/URL, sélection du workspace, champs de périmètre, route directe,
  résultats après changement d’endpoint, absence de réponse périmée.
- Résultats partiels, denied vs unavailable, données vieillies, absence de logs,
  rôle metadata master, champs inconnus et famille de shards explicite.
- Pagination bilog qui change de génération : jamais avancer une génération
  tant que la page courante n’est pas consommée ; curseurs indépendants.
- Recherche limitée aux données chargées, téléchargement JSON/CSV limité au
  périmètre annoncé, échappement CSV et prévention des formules injectées.
- Clavier : onglets, lignes, drawer, Escape, retour du focus, controls 44 px
  mobile ; axe sur écrans et drawer ; lecture sans dépendre d’une couleur.
- Captures aux largeurs 1728, 1440 et 390 px, light/dark ; grand nom de zone,
  longue clé d’objet, grand marqueur et traductions longues.

### Qualification sur un vrai Tentacle

Environnement isolé de deux zones au minimum, troisième zone inaccessible
simulée côté client si nécessaire. Création/configuration des fixtures de test
par une procédure d’exploitation extérieure au module ; le module ne les crée
pas. Utiliser des secrets locaux non versionnés et des comptes de test autorisés.

| Scénario | Preuve attendue |
| --- | --- |
| Zone locale sans realm | état inactif explicite, menu grisé |
| Lecture de zone refusée/indisponible | état inconnu, menu accessible, aucun secret exposé |
| Deux endpoints enregistrés pour la même zone | attribution visible, aucun exécuteur choisi automatiquement |
| Metadata master puis secondaire | rôle, phase, cardinalité et réponses 200/404 conformes au cluster |
| Écriture puis période d’inactivité | marqueurs observés, aucune fausse alerte sur marqueur inchangé |
| Coupure réseau puis rétablissement | unavailable/stale, reprise des lectures ; pas de commande corrective |
| Full sync puis incrémental | états réels, compte de full sync sans pourcentage incrémental |
| Même nom de bucket dans deux tenants | instances distinctes, aucune contamination du diagnostic |
| Bucket source différent de destination | `source-bucket` explicite, attribution correcte |
| Resharding / plusieurs générations | génération suivie et source distinctes, next_log préservé |
| Cap manquante / endpoint secondaire refusé | 403 conservé, pas de repli sur une identité plus privilégiée |
| Bucket sans état sync / génération supprimée | absence explicite, aucun libellé « synchronisé » |
| Journaux paginés et objet supprimé | curseurs exacts, operation state conservé |
| Plusieurs pipes / mode merge | qualification séparée, échec tailles incompatibles explicite |

Le résultat CLI peut servir d’oracle de laboratoire externe pour comparer les
observations, sans devenir une dépendance ou un appel de BucketReef. Le contrat
upstream n’est pas une validation d’une distribution RHCS non testée.

Commandes adaptées aux futurs changements : tests pytest ciblés nouveaux
services/routeurs/client, tests Vitest des trois pages, `npm run typecheck`,
`npm run lint`, contrôles listings/deadcode pertinents, build frontend, scénario
Playwright authentifié et docs screenshots. Exécuter ensuite les contrôles
requis du dépôt/CI ; une nouvelle itération ne relance pas inutilement les mêmes
suites si elle ne touche que les textes de conception.

## 8. Sécurité, exploitation et critères de livraison

- Réutiliser la résolution Ceph Admin et `EffectiveAccessService` selon les
  conventions du dépôt ; aucune permission parallèle ni accès Portal.
- Métadonnées de collection : traces opérationnelles bornées ; pas une entrée
  d’audit utilisateur pour chaque lecture. Les éventuels changements de
  configuration Admin suivent l’audit de contrôle existant.
- Pas de secrets ou headers signés dans les DTO, exports, logs, traces ou JSON.
  Whitelist des champs et assainissement récursif pour les détails ; noms de
  buckets/objets restent réservés aux administrateurs autorisés.
- Pas de navigation réseau à partir d’une URL contenue dans un period ni de
  redirection signée ; conserver les règles TLS de l’endpoint.
- Cache, limites et exports incluent le périmètre exact. Distinguer données
  source, observations de destination et champs calculés BucketReef.

La V1 est livrable lorsque les trois écrans fonctionnent dans la vraie surface
Ceph Admin, que chaque valeur est rattachée au contrat/à un calcul documenté,
que les tests de lecture seule et d’isolement passent, et que la qualification
Tentacle confirme les cas courants et limites. Une capture de maquette ne
constitue pas une validation des API sur un cluster.

Points à mesurer avant qualification complète : payloads réels du laboratoire,
nombre maximal de zones/shards, comportement précis du mode merge, encodage des
marqueurs source par backend de journal, identité du LB et disponibilité des
instances de bucket. Ces inconnues ont des états de repli prévus ; elles ne sont
pas remplacées par des indicateurs supposés.
