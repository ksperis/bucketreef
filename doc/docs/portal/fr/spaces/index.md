# Espaces de stockage

Un **espace de stockage** est l'endroit où Portal présente les fichiers d'un
projet. Utilisez **Portal > Espaces** pour ouvrir les espaces existants et,
lorsque votre rôle le permet, les créer, les partager, les archiver, les
restaurer ou les supprimer.

## Tâches courantes

| Tâche | Action |
|---|---|
| Ouvrir un espace | Sélectionnez-le dans **Portal > Espaces** pour ouvrir ses fichiers et ses informations. |
| Créer un espace privé | Choisissez **Créer un espace** si la création d'espaces privés vous est autorisée. |
| Créer un espace d'équipe | Un Portal Manager peut choisir le mode de collaboration et les premiers membres si le projet l'autorise. |
| Ajouter un stockage existant | Un Portal Manager peut choisir **Ajouter un espace existant** pour faire apparaître dans Portal une zone de stockage déjà existante. |
| Modifier l'icône ou la description | Ouvrez les paramètres de l'espace et modifiez son identité. |
| Inviter des personnes | Ouvrez l'onglet **Collaborateurs** de l'espace. |
| Consulter l'utilisation | Ouvrez **Statistiques** pour l'espace. |
| Vérifier les liens externes | Ouvrez **Liens externes** pour cet espace. |
| Configurer l'historique des fichiers | Ouvrez l'onglet **Paramètres** de l'espace. |
| Archiver ou restaurer | Utilisez les actions de gestion de l'espace. |
| Supprimer définitivement | Videz d'abord l'espace et son historique, puis utilisez **Supprimer l'espace**. |

## Choisir le bon mode d'accès

| Mode | Signification |
|---|---|
| **Privé** | Le propriétaire et les Portal Managers peuvent travailler avec l'espace. |
| **Équipe** | Les membres du projet reçoivent l'accès par défaut défini pour l'espace. |
| **Personnes sélectionnées** | Seuls les membres choisis reçoivent un accès Lecteur ou Éditeur. |

Choisissez le modèle de collaboration avant de créer l'espace. Portal indique
les choix qui restent modifiables ensuite. Si une personne n'est pas encore
disponible dans le projet, utilisez d'abord le circuit Collaboration/Demandes
pour demander son ajout.

## Démarrer un nouvel espace

Après avoir créé ou ajouté un espace :

1. ajoutez les fichiers ou dossiers nécessaires au projet ;
2. invitez les collaborateurs lorsque le contenu est prêt ;
3. configurez l'historique des fichiers si le projet impose une conservation particulière ;
4. créez un lien externe ou un accès pour outil externe uniquement lorsque la
   collaboration normale dans Portal ne suffit pas.

## Historique des fichiers

La page **Paramètres** de l'espace peut indiquer si les anciennes versions sont
conservées, si l'historique est nettoyé automatiquement et pendant combien de
temps les versions précédentes sont gardées. Les propriétaires peuvent consulter
ces paramètres ; les Portal Managers peuvent les modifier si le projet l'autorise.

Désactiver la création de nouvelles versions ne supprime pas l'historique déjà
présent. Un nettoyage manuel peut supprimer d'anciennes versions et des marqueurs
de suppression. Vérifiez le résultat avant de quitter la page : l'arrêt de
l'opération ne restaure pas un historique déjà supprimé.

## Archiver ou supprimer un espace

**Archiver** est réversible. L'espace de stockage est conservé mais le travail
normal sur les fichiers et le partage sont suspendus jusqu'à sa restauration.

**Supprimer l'espace** est définitif. Portal exige que l'espace soit vide :

1. supprimez les fichiers courants ;
2. supprimez l'historique restant si nécessaire ;
3. vérifiez que l'espace ne contient plus de données ;
4. utilisez **Supprimer l'espace** et relisez la confirmation.

Si l'espace contient encore des données, Portal bloque sa suppression au lieu de
le vider automatiquement. Supprimer un espace met également fin aux accès des
collaborateurs, aux identifiants externes et aux liens publics associés.

## Statistiques

L'onglet **Statistiques** peut afficher le stockage utilisé, l'espace restant, le
nombre de fichiers, leur répartition et l'activité d'import/téléchargement lorsque
ces mesures sont disponibles. Un tiret signifie que la valeur est inconnue ; une
valeur nulle est affichée comme zéro.

Les espaces archivés et ceux que vous ne pouvez pas lire n'exposent pas de
statistiques détaillées. Les tendances globales du projet restent disponibles
dans [État du stockage](../storage-health.md).

## Si vous ne voyez pas un espace

Vérifiez d'abord le projet sélectionné. Si l'espace reste absent, demandez à son
propriétaire ou à un Portal Manager de vérifier votre accès et l'état d'archivage.

## Pages associées

- [Fichiers](../files/index.md)
- [Collaboration](../collaboration.md)
- [État du stockage](../storage-health.md)
- [Outils externes](../external-tools.md)

## Exemple visuel

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/portal-storage-spaces.light.png" alt="Espaces de stockage Portal avec leurs actions principales" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/portal-storage-spaces.dark.png" alt="Espaces de stockage Portal avec leurs actions principales" loading="lazy">
</div>
