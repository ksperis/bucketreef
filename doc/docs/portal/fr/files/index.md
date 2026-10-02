# Fichiers d'un espace de stockage

Utilisez cette page pour travailler sur les fichiers d'un espace de stockage
Portal actif.

## Tâches principales

| Tâche | Fonctionnement |
|---|---|
| Parcourir les dossiers | Utilisez le fil d'Ariane et les lignes de dossiers dans l'espace sélectionné. |
| Importer des fichiers | Disponible lorsque votre rôle autorise l'écriture. |
| Prévisualiser un fichier | Ouvrez le fichier et utilisez **Aperçu** pour les formats pris en charge. |
| Télécharger | Utilisez la ligne du fichier ou sa vue détaillée lorsque votre rôle autorise la lecture. |
| Consulter l'historique | Utilisez **Historique** lorsque l'historique des fichiers est disponible. |
| Restaurer un ancien fichier ou un fichier supprimé | Restaurez-le depuis l'historique ; le contenu restauré devient la version courante. |
| Créer des dossiers | Utilisez l'action de la liste des fichiers lorsque votre rôle autorise l'écriture. |
| Supprimer | La suppression n'est disponible qu'avec les droits d'écriture/suppression requis. |
| Partager un fichier | Utilisez la vue de partage si la politique du projet autorise le partage externe. |

## Détails d'un fichier

Portal conserve une vue orientée utilisateur : nom, chemin, taille, type, date de
mise à jour, aperçu, historique, partage et informations essentielles. Les
métadonnées S3 avancées, tags, règles de rétention et diagnostics relèvent des
workflows Browser ou Manager.

Les chemins sont exacts. Les espaces et les caractères `/` répétés ou placés au
début d'une clé sont significatifs en S3 et sont conservés par les opérations sur
les fichiers, l'historique, la restauration et le partage.

## Fichiers supprimés et historique

Lorsque l'historique est activé, un fichier supprimé peut rester restaurable.
Utilisez **Afficher les fichiers supprimés** dans le dossier courant, ouvrez
l'entrée supprimée puis restaurez une version disponible. La restauration d'un
dossier agit sur son chemin exact et affiche explicitement la progression et les
échecs.

Consultez [Versions précédentes](versions.md) pour le parcours Portal et
[Suppression sûre](safe-deletion.md) avant une opération destructive.

## Pages associées

- [Espaces de stockage](../spaces/index.md)
- [Collaboration](../collaboration.md)
- [État du stockage](../storage-health.md)
