# Ceph Admin — Multisite Diagnostics

Conception et implémentation V1, 27 octobre 2026. Cible : Ceph Tentacle
`v20.2.4`, backend RADOS. Branche : `feat-ceph-admin-multisite`.

- [Plan d’implémentation](implementation-plan.md) : architecture, lots, dépendances,
  fichiers, tests, critères d’acceptation et qualification réelle.
- [Contrat Ceph vérifié](ceph-api-contract.md) : requêtes autorisées, champs JSON,
  preuves dans le code et corrections de l’audit précédent.
- [Maquette interactive](index.html) : ouvrir directement le fichier dans un
  navigateur. Autonome, sans dépendance réseau et sans connexion à un cluster.
- [Empreintes des sources Ceph](ceph-source-manifest.json) : provenance des lectures.
- [Contrôle de la maquette](design-qa.md) : vérification visuelle et interactions.

La maquette utilise des données fictives explicitement signalées. Elle propose
trois vues : vue d’ensemble, réplication d’un bucket, journaux. Les panneaux de
détail exposent shards, observations successives, provenance et JSON.

La branche contient désormais les associations d'endpoints, le client GET
borné, les DTO/services/routes et les trois vues dans la surface Ceph Admin.
Voir le [suivi d'implémentation et de qualification](implementation-status.md).
Aucun changement de sync policy, démarrage/arrêt/réparation de réplication
n'est exposé par le module.

Référence BucketReef : `d84b4e63817d22ce8bfc35788a2be3bd970d75ed`
(miroir public GitHub, 26 octobre 2026). La branche locale de Laurent peut
contenir des changements non présents dans ce miroir ; les points d’intégration
doivent être revérifiés lors du démarrage de l’implémentation.

## Délégation demandée

L'implémentation utilise au plus trois sous-agents simultanés avec le modèle
demandé `chatgpt-web/gpt-5.6-sol`, effort `high`. Leurs lots portent sur le
client et les tests backend, les associations et traductions, puis les écrans.
L'intégration principale possède les API, services, navigation et contrôles
navigateur. Les résultats de qualification restent distingués des fixtures.

## Aperçu local facultatif

Le fichier HTML fonctionne aussi en `file://`. Pour le servir :

```bash
cd doc/plans/ceph-admin-multisite
npm run dev -- --host 0.0.0.0 --port 4173 --strictPort
```

Le petit serveur sert uniquement les fichiers de ce dossier. Il n’appelle
aucune API et ne fait pas partie de l’application BucketReef.
