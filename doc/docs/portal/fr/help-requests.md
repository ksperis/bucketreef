# Demandes

Utilisez cette page lorsqu'un administrateur du stockage doit intervenir avant
que vous puissiez terminer une tâche Portal : ajouter ou retirer une personne du
projet, modifier la limite de stockage ou changer un paramètre qui n'a pas été
délégué aux Portal Managers.

Les ajouts de collaborateurs et les changements de rôle apparaissent également
ici lorsqu'ils nécessitent l'approbation d'un Admin. Si l'action est déléguée,
elle est appliquée immédiatement et conservée dans l'historique comme demande
approuvée afin d'assurer la traçabilité.

## Avant de commencer

- Le projet sélectionné doit être celui concerné par la demande.
- Pour une demande de collaborateur ou de limite de stockage, vous devez être
  gestionnaire du stockage du projet ; pour une modification de paramètre, vous
  devez être Portal Manager.
- Pour un nouvel accès au projet, connaissez le nom et l'adresse e-mail de la personne.
- Pour une modification de limite, connaissez la capacité cible. Le motif est facultatif.
- Les demandes de paramètre ne sont disponibles que tant que les paramètres du
  projet restent gérés par l'administrateur. S'ils sont délégués, modifiez-les
  directement depuis **Portal > Paramètres**.
- La délégation des collaborateurs est configurée séparément pour chaque projet.
  La délégation des ajouts et celle de la gestion des rôles sont deux permissions
  différentes, désactivées par défaut.

## Tâches principales

1. Ouvrez **Portal > Demandes**.
2. Consultez d'abord **Mes demandes** pour voir les demandes en attente,
   approuvées, rejetées ou en échec.
3. Choisissez **Gérer les membres** pour ajouter ou retirer un collaborateur dans
   le même formulaire. Lors d'un ajout, choisissez le rôle demandé :
   **Membre du workspace** (`portal_user`) ou **Gestionnaire du workspace**
   (`portal_manager`). Pour un retrait, sélectionnez un collaborateur direct du
   projet ; son nom et son e-mail sont renseignés automatiquement. Le motif est facultatif.
   Lorsque l'ajout de collaborateurs est délégué, un Membre du workspace est
   ajouté immédiatement. Ajouter immédiatement un Gestionnaire du workspace
   nécessite à la fois la délégation de l'ajout et celle de la gestion des rôles ;
   sinon la demande reste en attente d'approbation par un Admin. Le retrait d'un
   membre du projet nécessite toujours une approbation Admin.
   Pour changer le rôle d'un collaborateur direct existant, ouvrez son examen
   d'accès depuis **Portal > Collaborateurs**, puis choisissez **Changer le rôle**.
   L'action bascule entre Membre et Gestionnaire du workspace. Elle est appliquée
   immédiatement si la gestion des rôles est déléguée ; sinon elle reste en attente.
   Portal ne propose pas cette action pour votre propre appartenance ni pour un accès hérité d'un groupe.
4. Choisissez **Modifier la limite de stockage**, saisissez la nouvelle cible et
   l'unité. L'aperçu montre la limite actuelle, la limite demandée et l'espace déjà utilisé.
5. Si les paramètres du projet ne sont pas délégués, choisissez **Modifier un
   paramètre du projet**. Sélectionnez un seul paramètre, vérifiez sa valeur
   actuelle et sa source, puis demandez soit une valeur propre au projet, soit
   **Valeur de la plateforme** pour supprimer la surcharge du projet. Le commutateur
   de délégation et les paramètres exclusivement globaux ne peuvent pas être demandés.
6. Suivez l'état de la demande dans la liste.
7. Ouvrez ses détails pour lire les messages de l'Admin, les erreurs d'exécution ou le résultat final.

## États

| État | Signification |
|---|---|
| En attente | La demande attend la décision d'un Admin. |
| En cours | Un Admin l'a approuvée et la plateforme applique la modification. |
| Approuvée | L'action s'est terminée avec succès, immédiatement par délégation ou après approbation Admin. |
| Rejetée | Un Admin a refusé la demande. |
| Échec | La plateforme n'a pas pu appliquer une demande approuvée. |

## Résultat attendu

La demande reste visible dans Portal avec son état final et les messages de
l'Admin. Les actions non déléguées, les retraits et les changements de limite
restent inchangés tant qu'un Admin ne les a pas validés. Les actions déléguées
sont enregistrées directement comme **Approuvées**, sans demander de décision à
un Admin, et leur journal d'audit identifie l'exécution déléguée.

Pour un ajout, l'exécution applique le rôle Portal demandé. Une ancienne demande
sans rôle ni intention explicite continue d'ajouter un Membre du workspace. Pour
un changement de rôle, Portal vérifie d'abord que le collaborateur possède
toujours le rôle direct enregistré lors de la création de la demande. Si son
appartenance ou son rôle a changé entre-temps, l'action échoue plutôt que
d'écraser l'état plus récent.

Portal bloque une demande de limite qui placerait la nouvelle limite sous
l'espace déjà utilisé. Pour une demande de paramètre, l'approbation modifie
uniquement le paramètre demandé et conserve les autres changements réalisés
depuis la création de la demande.

## Pages associées

- [Guide Portal](index.md)
- [Collaborateurs](collaboration.md)
- [État du stockage](storage-health.md)

## Exemple visuel

Cette page réutilise la capture du tableau de bord Portal car elle montre le
point d'entrée des Demandes dans son contexte.

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/workspace-portal.light.png" alt="Tableau de bord Portal avec utilisation, activité, partages, demandes et alertes" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/workspace-portal.dark.png" alt="Tableau de bord Portal avec utilisation, activité, partages, demandes et alertes" loading="lazy">
</div>
