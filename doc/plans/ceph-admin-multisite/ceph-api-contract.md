# Contrat Ceph vérifié — Tentacle 20.2.4

Vérification statique au 27 octobre 2026. Source : dépôt upstream Ceph, tag
`v20.2.4`, commit `7f793731f1b39eb4f465e960113d2363c311b964`.
Les sources ont été téléchargées et l’arbre du tag résolu via GitHub. Ce document
décrit la vérification statique initiale. Les lectures réelles effectuées
ensuite sur le laboratoire, leurs captures anonymisées et leurs limites sont
consignées dans le [bilan de qualification](implementation-status.md).

## 1. Preuves principales dans le code

Les liens sont figés sur le commit, pas sur une branche évolutive.

| Référence | Code / utilité |
| --- | --- |
| [Dispatch et handlers de log](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/driver/rados/rgw_rest_log.cc#L1206) | GET metadata, data, bucket-index ; pas de famille sync-error |
| [GET period et contrôle zone=read](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/driver/rados/rgw_rest_realm.cc#L53) | Route `/admin/realm/period`, paramètres realm_id / period_id / epoch |
| [GET realm](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/driver/rados/rgw_rest_realm.cc#L281) | Résolution du nom via id/name, distincte du period |
| [Dump du period](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/rgw_period.cc#L234) | id, epoch, master_zone, realm_id, realm_epoch, period_map ; pas de realm_name |
| [Zones et zonegroups](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/rgw_zone.cc#L71) | Dumps des zones : IDs/noms/endpoints, read_only, sync_from_all/sync_from ; zonegroup.sync_policy |
| [Phase et marqueurs data](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/driver/rados/rgw_data_sync.h#L68) | Noms JSON réels `info.status`, `markers`, états des marqueurs |
| [Phase et marqueurs metadata](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/driver/rados/rgw_sync.cc#L2637) | État numeric `state` du marqueur metadata ; realm_epoch |
| [Statut bucket v2](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/driver/rados/rgw_rest_log.cc#L983) | source-bucket, source-zone, lecture par couple et merge |
| [Dumps bucket et bilog_status_v2](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/driver/rados/rgw_data_sync.cc#L6725) | inc_marker, statut shard, full, incremental_gen ; absence de shards_done_with_gen dans le JSON |
| [Listing bilog](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/driver/rados/rgw_rest_log.cc#L367) | format-ver=2, generation, entries/truncated/next_log |
| [Bilog info](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/driver/rados/rgw_rest_log.cc#L520) | générations, max_marker, syncstopped ; parse de bucket-instance |
| [Parse de bucket-instance](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/rgw_common.cc#L3212) | `name:instance[:shard]` ; une chaîne vide est rejetée |
| [Dump d’une entrée bilog](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/cls/rgw/cls_rgw_types.cc#L604) | op_id/op/object/state, pas un état de réplication distante |
| [Listing datalog](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/driver/rados/rgw_rest_log.cc#L654) | id obligatoire, extra-info, marker, last_update, truncated |
| [Dumps datalog](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/driver/rados/rgw_datalog.cc#L61) | entity_type/key/timestamp/gen ; extra-info ajoute log_id/log_timestamp/entry |
| [Listing mdlog](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/driver/rados/rgw_rest_log.cc#L45) | période, id, marker, truncated ; refus start-time/end-time |
| [Dumps metadata log](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/rgw_metadata.cc#L462) | id/section/name/timestamp/data ; data peut être absent si décodage impossible |
| [Statuts de mutation mdlog](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/rgw_metadata.cc#L70) | read_version/write_version/status, sans ACL/configuration historique |
| [Encodage des maps](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/common/ceph_json.h#L602) | Une std::map utilise un tableau d’objets key/val |
| [Racine JSON](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/common/Formatter.cc#L207) | Le nom d’une section à la racine n’ajoute pas de wrapper JSON |
| [Master metadata](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/driver/rados/rgw_sync.cc#L2156) | read_sync_status retourne aussi 0 immédiatement si meta master |
| [Structure des sync policies](https://github.com/ceph/ceph/blob/7f793731f1b39eb4f465e960113d2363c311b964/src/rgw/rgw_sync_policy.cc#L523) | Configuration des groupes/flows/pipes ; pas un statut d’exécution individuel |

## 2. Requêtes autorisées et forme des réponses

Toutes les lectures sont des GET signés V4, avec `format=json`. `/admin` doit
suivre la configuration Admin Ops déjà gérée par BucketReef ; ne pas créer un
proxy arbitraire. Les booléens de présence sont envoyés avec une valeur vide
et restent signés exactement comme transmis.

Les chemins JSON ci-dessous partent de la vraie racine : `status`, `info`,
`log_entries`, `result` sont des noms de sections du formatter, pas nécessairement
des propriétés racine. Aucun wrapper n’est inventé à partir du C++.

| Lecture | Query Ceph | Champs de sortie utilisables |
| --- | --- | --- |
| Configuration | `/admin/realm/period[?realm_id=…&period_id=…&epoch=…]` | Objet RGWPeriod, period_map/zonegroups/zones, realm_id, realm_epoch et epoch distincts |
| Nom du realm | `/admin/realm?id=REALM_ID` | Objet realm ; nom si disponible, sinon garder le realm_id |
| Metadata sync, destination | `/admin/log?type=metadata&status` | `info.{status,num_shards,period,realm_epoch}`, `markers[]:{key,val}` |
| Data sync, destination | `/admin/log?type=data&status&source-zone=ID` | `info.{status,num_shards,instance_id}`, `markers[]:{key,val}` |
| Bucket sync, destination | `/admin/log?type=bucket-index&status&bucket=DEST_KEY&source-bucket=SOURCE_KEY&source-zone=ID&version=2` | `sync_status.{state,full,incremental_gen}`, `inc_status[]` |
| Générations bilog, source | `/admin/log?type=bucket-index&info&tenant=T&bucket=B&bucket-instance=B:INSTANCE` | `bucket_ver,master_ver,max_marker,syncstopped,oldest_gen,latest_gen,generations[]` |
| Bilog source paginé | `/admin/log?type=bucket-index&tenant=T&bucket=B&bucket-instance=B:INSTANCE[:SHARD]&generation=G&max-entries=100&format-ver=2&marker=M` | `entries[]`, `truncated`, `next_log?{generation,num_shards}` ; pas de champ racine marker |
| Infos mdlog | `/admin/log?type=metadata` | `num_objects`, période et realm_epoch du plus ancien period de log si présent, pas automatiquement le period actuel |
| Page mdlog | `/admin/log?type=metadata&period=P&id=N&max-entries=100&marker=M` | `marker,truncated,entries[]` |
| Infos datalog | `/admin/log?type=data` | `num_objects` |
| Page datalog | `/admin/log?type=data&id=N&max-entries=100&extra-info=true&marker=M` | `marker,last_update,truncated,entries[]` |
| Info shard data | `/admin/log?type=data&id=N&info` | `marker,last_update` |
| Info shard metadata | `/admin/log?type=metadata&period=P&id=N&info` | Header du log ; qualification spécifique avant comparaison source/destination |

Les clés bucket du statut sont parsées avec `rgw_bucket_parse_bucket_key`.
Les handlers list/info bilog utilisent une autre grammaire : `tenant` distinct
et `bucket-instance=name:instance[:shard]`. Ne pas réutiliser aveuglément le même
constructeur de paramètres entre ces opérations. Résoudre le vrai bucket_id
depuis l’inventaire / get_bucket_info existant, sans lui substituer un nom de
zone ou de bucket. Conserver les tenants et instances source/destination.

### Anomalie à qualifier : requêtes bilog avec seulement bucket

Dans cette version, `RGWOp_BILog_List` et `RGWOp_BILog_Info` appellent
systématiquement `rgw_bucket_parse_bucket_instance`, même lorsque la query ne
fournit que `bucket`. Le parseur renvoie `-EINVAL` sans séparateur `:`.
L’exemple historique `?type=bucket-index&info&bucket=X` n’est donc pas retenu
comme contrat fiable pour cette cible. La stratégie est de fournir l’instance
explicite et de confirmer les deux cas sur un vrai RGW. Ce constat est issu de
lecture statique, pas d’un test reproduit sur cluster.

## 3. Valeurs exactes et sens

| Famille | Champ | Valeurs / interprétation |
| --- | --- | --- |
| Metadata/data global | `info.status` | init, building-full-sync-maps, sync, unknown |
| Metadata marker | `val.state` | entier : 0 full, 1 incrémental ; conserver l’inconnu |
| Metadata marker | autres | marker,next_step_marker,total_entries,pos,timestamp,realm_epoch |
| Data marker | `val.status` | full-sync, incremental-sync, unknown |
| Data marker | autres | marker,next_step_marker,total_entries,pos,timestamp |
| Bucket global | `sync_status.state` | init, full-sync, incremental-sync, stopped, unknown |
| Bucket full | `full` | position,count ; pas de total exploitable pour un pourcentage fiable |
| Bucket shard | `inc_status[i].status` | init, full-sync, incremental-sync, stopped, unknown |
| Bucket shard | `inc_marker` | position,timestamp ; i est le shard, pas un identifiant exposé |
| Génération bilog | génération | uint64 ; num_shards par génération, pas date de création |
| Bilog entrée | state | pending,complete,invalid : état de l’opération dans le journal source |
| Bilog entrée | op | nom d’opération RGW, pas automatiquement une méthode HTTP PUT/DELETE |
| Mdlog entrée | data.status | write,set_attrs,remove,complete,abort et valeur inconnue possible |
| Datalog entrée | entity_type | bucket ou unknown ; c’est un journal de changements de buckets, pas une liste de transferts d’objets |

`sync` et `incremental-sync` décrivent une phase. Ils ne prouvent pas que les
écritures source ont été appliquées à la destination. `syncstopped` provient du
journal de bucket interrogé ; il n’est pas l’état universel de toutes les
destinations.

## 4. Exemple illustratif de statut bucket v2

Fixture minimale, non capturée sur un cluster. Les 2 shards de cet exemple ne
sont pas les 64 du scénario visuel. L’objet est directement à la racine JSON.

```json
{
  "sync_status": {
    "state": "incremental-sync",
    "full": {"position": "", "count": 8240},
    "incremental_gen": 3
  },
  "inc_status": [
    {"status": "incremental-sync", "inc_marker": {"position": "0000000012.34.1", "timestamp": "2026-10-27T09:31:42.000000Z"}},
    {"status": "incremental-sync", "inc_marker": {"position": "0000000013.21.1", "timestamp": "2026-10-27T09:31:44.000000Z"}}
  ]
}
```

Les formes de timestamps et marqueurs illustrent leurs types, sans prétendre
reproduire le moteur de journal d’un cluster particulier. Les fixtures de
qualification conserveront le format et la précision réellement observés.

## 5. Merge, disponibilité et lecture seule

`options=merge` parcourt les destinations locales provenant du handler de
policy source. Les positions incrémentales minimales sont retenues ; des
cardinalités de shards différentes provoquent `EINVAL`. `sync_status` est relu
dans la boucle et ne constitue pas une agrégation générale de toutes les
phases. Ne pas présenter le résultat comme « tous les pipes sont synchronisés ».

Les statuts metadata/data peuvent retourner ENOENT en l’absence de gestionnaire.
Le même code HTTP peut également désigner un état ou un objet absent. Un refus
d’accès n’est pas une absence de support. La disponibilité doit être qualifiée
opération par opération, avec le contexte de configuration et de rôle.

Le dispatch comporte aussi des handlers POST et DELETE (notify, trim, lock,
etc.). Ils sont hors périmètre et hors allowlist. Le fait de partager
`/admin/log` ne les autorise pas. Les lectures de statut étudiées lisent les
objets de suivi ; aucun bouton ne doit appeler une initialisation/reprise.

## 6. Corrections apportées aux audits précédents

1. `shards_done_with_gen` existe en C++, mais n’est pas dans
   `rgw_bucket_sync_status::dump()` : pas de compteur directement exposé.
2. Les dumps metadata et data ne donnent pas le même nom/type d’état shard.
3. Le formatter supprime le nom du conteneur racine ; ne pas coder un parser
   exigeant `payload.status.sync_status` ou `payload.info.generations`.
4. `markers` est une std::map sérialisée en tableau key/val, pas un dictionnaire
   de shards dont on pourrait supposer la forme.
5. Les exemples bilog par seul nom de bucket nécessitent la qualification
   décrite ci-dessus ; la maquette et le plan prévoient l’instance explicite.
6. Pas de `id` autonome inventé pour filtrer le bilog : son shard passe par
   bucket-instance dans le handler examiné.
7. Pas de sévérité native, de recherche globale ou de filtres temporels mdlog /
   datalog inventés. Aucun mode REST All shards dans ces listings.
8. Pas de total de travail incrémental, ni d’état objet répliqué tiré de
   `state=complete` ou d’une zone présente dans zones_trace.

## 7. Conditions de validation finale

Le plan et la maquette sont fondés sur les champs sérialisés. Ils restent à
confronter aux réponses d’un Tentacle multisite : authentification et caps,
RADOS vs autres drivers, cas de period absent, bucket-instance, multi-tenant,
merge, générations après resharding, données sans gestionnaire, limites de
volume, streaming et disponibilité des endpoints. Chaque écart donnera une
fixture réelle assainie et une mise à jour explicite du contrat.
