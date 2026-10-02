# Supprimer des fichiers en sécurité

Consultez cette page avant de supprimer des fichiers d'un espace de stockage Portal.

## Avant de supprimer

- Vérifiez le projet et l'espace de stockage affichés dans Portal.
- Vérifiez le nom du fichier ou du dossier et son chemin.
- Assurez-vous de travailler dans le bon espace, surtout si plusieurs projets
  contiennent des espaces de noms proches.
- Pour un fichier important, vérifiez si des versions précédentes sont disponibles.

## Supprimer un fichier

1. Ouvrez l'espace de stockage et repérez le fichier.
2. Choisissez l'action de suppression et relisez la confirmation.
3. Confirmez uniquement si le chemin affiché correspond bien au fichier visé.
4. Actualisez la liste si l'état final de l'opération n'est pas clair.

Si le stockage conserve les versions, supprimer le fichier courant peut laisser
une version précédente restaurable ou un marqueur de suppression. Consultez
[Versions précédentes](versions.md) pour vérifier ce qui peut être restauré.
Sans historique, Portal ne peut pas annuler au niveau applicatif une suppression
déjà terminée.

## Si la suppression échoue

Ne répétez pas immédiatement l'action si son résultat est incertain. Actualisez
d'abord l'espace. Si le fichier reste présent et que l'erreur persiste, indiquez
le projet, l'espace de stockage, le chemin, l'heure et le message d'erreur exact.

## Pages associées

- [Fichiers](index.md)
- [Versions précédentes](versions.md)
- [Dépannage](../help/troubleshooting.md)

## Exemple visuel

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/portal-object-list.light.png" alt="Liste des fichiers Portal dans un espace de stockage" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/portal-object-list.dark.png" alt="Liste des fichiers Portal dans un espace de stockage" loading="lazy">
</div>
