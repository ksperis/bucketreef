# Suivi d'implémentation et de qualification

27 octobre 2026, branche `feat-ceph-admin-multisite`.

## Périmètre implémenté

- La migration 0194, qui avait ajouté une association multisite persistée aux
  endpoints, est annulée fonctionnellement par 0195. Realm, zonegroup, zone et
  endpoint de diagnostic ne font plus partie de la configuration endpoint.
- Découverte live de la zone locale via `GET /admin/config?type=zone`, puis du
  realm/period. Les endpoints Ceph Admin enregistrés sont associés aux zones en
  lisant leur propre configuration locale. Une correspondance unique sélectionne
  l'exécuteur de diagnostic ; une correspondance ambiguë n'en sélectionne aucun.
- Probe léger `/multisite/state` pour la navigation : seul un succès sans
  realm désactive l'entrée Multisite. Un refus ou une indisponibilité reste
  `unknown` et laisse la page accessible.
- Client RGW à méthodes GET explicites et paramètres allowlistés, signature,
  TLS et refus des redirections réutilisés. Corps limités pendant le
  téléchargement, JSON complet obligatoire, journaux bornés à 500 entrées.
- DTO et normalisation des dumps Tentacle : statuts inconnus conservés,
  shards `{key,val}`, entiers 64 bits transmis sans perte de précision,
  disponibilité et provenance par composant, détails par projection de champs.
- Services et dix routes Ceph Admin GET : topologie, capacités, overview,
  flux, bucket/instances/générations et trois familles de journaux. Autorité
  existante réappliquée aux endpoints secondaires, cache isolé par identité,
  configuration et périmètre, budget/concurrence/deadline et résultats partiels.
- Trois routes UI, navigation Monitoring et lien depuis l'inventaire bucket,
  endpoint de workspace conservé, scopes source/destination distincts,
  pagination des journaux, recherche locale, exports JSON/CSV et provenance.
- Observations en mémoire de session, comparaison d'égalité, nouveau contexte
  lors d'un changement d'instance/période/génération, rétention 20/30 minutes,
  rafraîchissement visible facultatif à 30 secondes.
- Traductions FR/DE/ZH, documentation Admin et notes de migration, schéma DB
  régénéré. Les classes de stockage découvertes restent dans la réponse live de
  zone et ne sont pas persistées. Aucun historique persistant ni collecteur en
  arrière-plan.

## Validation automatisée

Dernière exécution intégrée :

| Contrôle | Résultat |
| --- | --- |
| Pytest ciblé services/clients/permissions/endpoints/migrations/schéma | 247 réussis |
| Vitest ciblé Ceph Admin/formulaires/navigation/workbench | 246 réussis |
| Playwright trois routes, desktop/mobile, clair/sombre et cas limites | 20 réussis |
| TypeScript, ESLint, deadcode, présentation des listings | Réussis |
| Build frontend, cycles de chunks et budgets de bundle | Réussis |
| Schéma DB généré et `git diff --check` | Conformes |
| Relecture des nouvelles captures du laboratoire anonymisées | 7 réussis |

La migration a été exécutée sur SQLite, y compris aller/retour. Les
contraintes et l'index partiel ont leur syntaxe PostgreSQL explicite ; aucun
serveur PostgreSQL réel n'a été utilisé pour ces tests. Ces résultats sont
ceux des suites ciblées, pas une exécution de toute la CI du dépôt.

Les suites ciblent les contrats de lecture seule, les erreurs 403/404/5xx,
le JSON invalide ou trop volumineux, les permissions Manager/Portal/anonyme,
les endpoints secondaires révoqués, les tenants et instances distincts,
les marqueurs opaques, la pagination et les exports CSV.

La suite `multisiteVisualQa.spec.ts` ouvre les trois vraies routes React avec
des API et une session de documentation simulées. Elle couvre 1728, 1440 et
390 px, clair/sombre, drawer, Escape et retour du focus, pagination,
rechargement, absence de débordement horizontal et erreurs applicatives.
Ces scénarios ne constituent pas une connexion authentifiée à un vrai RGW.

Les fixtures sous `backend/tests/fixtures/ceph_multisite/tentacle/` sont
explicitement synthétiques. Les 11 captures anonymisées ajoutées dans
`backend/tests/fixtures/ceph_multisite/lab/` sont distinctes, avec un manifeste
de provenance et d'empreintes. Les captures navigateur restent dans les
sorties ignorées.

## Qualification réelle après redémarrage du laboratoire

Le laboratoire a été explicitement autorisé avec `backend/.env.save`. Les
premières tentatives expiraient ; après le redémarrage des instances par
l'utilisateur, les deux endpoints publics répondent aux GET signés.

Les identités Ceph Admin des deux endpoints ont été vérifiées par le probe
existant. La nouvelle découverte de zone lit directement la configuration RGW
avec ces identités et projette immédiatement les champs non sensibles ; aucune
association n'est enregistrée en base. Les routes de diagnostic ont été exercées via
FastAPI TestClient avec un acteur de test isolé et les vrais clients RGW :
14 lectures applicatives vérifiées, toutes avec une réponse HTTP 200 et des
disponibilités par composant conformes. Ce n'est pas une connexion navigateur
avec un utilisateur de l'instance de production.

| Cas observé | Résultat |
| --- | --- |
| Configuration lue sur les deux endpoints | Même realm/period, deux zones, master metadata explicite |
| Réponse brute du master metadata | HTTP 200, structure par défaut `init`, 0 shard ; service `not_applicable` |
| Metadata sur la secondaire | Phase `sync`, 64 états reçus / 64 attendus |
| Data entrante sur la secondaire depuis le master | Phase `sync`, 128 états reçus / 128 attendus |
| Direction inverse sans état | 404 `NoSuchKey`, conservé en `not_found` |
| Deux buckets existants du lab | Instances résolues séparément, `incremental-sync`, génération 0, 11 shards |
| Générations bilog source | Une génération, `gen=0`, `num_shards=11`, marqueur composite conservé |
| Buckets avec tenant | Noms et tenants vérifiés sur les deux instances ; absence de sync conservée en `not_found` |
| Buckets source et destination de noms différents | Résolution distincte, absence de statut conservée en `not_found` |
| Journaux metadata/data/bilog et infos de shards | Réponses complètes et normalisées ; pages observées vides |
| Deux collectes sans changement d'écriture | Positions identiques pour le flux data observé, aucune déduction de panne |

Les réponses réelles n'ont nécessité aucune correction du client, des DTO ou
du service. Les captures reproduisent notamment la position de full sync
bucket sous forme d'objet `{name: ...}`, et le cas particulier du master.

Aucune configuration ni ressource Ceph n'a été modifiée. Les cas suivants
restent couverts par les tests synthétiques mais **non qualifiés sur ce lab** :
pagination avec des entrées présentes, `next_log`, resharding et générations
multiples, full sync en cours, même nom dans deux tenants, refus d'une cap
Ceph et reprise après une coupure intervenant après une lecture réussie.
Le mode merge n'est pas activé. La version exacte du serveur n'a pas été
attestée par ces lectures ; le contrat de référence reste upstream 20.2.4.
La qualification d'une distribution RHCS ou d'un autre driver reste séparée.

Commande reproductible et limites :
[documentation Multisite](../../docs/admin/en/storage/ceph-admin/multisite.md).
