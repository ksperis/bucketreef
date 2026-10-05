# Utiliser un outil S3 externe

Utilisez **Portal > Outils externes** lorsque vous devez accéder à un espace de
stockage depuis une application compatible S3 comme Cyberduck, Mountain Duck,
WinSCP ou un script.

Si l'autre personne peut se connecter à Portal, privilégiez la collaboration
normale dans Portal. Créez un accès pour outil externe uniquement lorsqu'un
client S3 direct est réellement nécessaire.

## Avant de commencer

- Sélectionnez le bon projet Portal.
- Identifiez l'espace de stockage auquel l'outil doit accéder.
- Déterminez si l'accès est pour vous ou pour un utilisateur externe.
- Préparez un emplacement sûr pour enregistrer le secret : Portal ne l'affiche qu'une fois.

## Créer un accès pour un outil

1. Ouvrez **Portal > Outils externes** et choisissez **Nouvel accès outil**.
2. Choisissez **Pour moi** ou **Pour un utilisateur externe**.
3. Pour un accès externe, sélectionnez l'espace de stockage et privilégiez
   **Lecture seule** sauf si l'outil doit importer, remplacer ou supprimer des fichiers.
4. Créez l'accès et copiez immédiatement le secret dans un emplacement sûr.
5. Choisissez **Configurer un outil** pour le nouvel accès, ou **Connecter** à
   côté d'un accès existant.
6. Sélectionnez l'espace de stockage lorsque Portal le demande.
7. Choisissez l'application :
   - **Cyberduck / Mountain Duck** télécharge un signet ;
   - **WinSCP** télécharge une configuration de session S3 ;
   - une autre application S3 peut utiliser l'endpoint, le nom technique du
     bucket, l'identifiant d'accès et les informations d'adressage affichés par Portal.
8. Importez la configuration téléchargée et saisissez le secret lorsque le client le demande.
9. Désactivez ou supprimez les accès qui ne sont plus nécessaires.

Les fichiers de configuration téléchargés ne contiennent pas le secret. Ne
placez pas ce secret dans des tickets, documents partagés, captures d'écran,
historiques de shell ou dépôts de code source.

## Limites des accès

- Un accès personnel suit vos droits Portal actuels sur les espaces de stockage.
- Un accès pour utilisateur externe est limité à l'espace et au niveau de permission choisis.
- Un Portal User ne peut créer un accès externe que si le projet l'autorise et
  s'il possède l'espace cible.
- Les Portal Managers disposent des options d'accès externe autorisées par leur projet.
- Créer un accès outil n'accorde jamais plus de droits que ceux attribués par Portal à cet identifiant.
- Le nom technique du bucket est affiché car certains clients S3 en ont besoin.
  Dans Portal, continuez à utiliser le nom de l'espace de stockage.

## Si la création d'un accès n'est pas disponible

Le projet peut interdire ce type d'accès, votre rôle sur l'espace peut être
insuffisant ou vous pouvez avoir atteint le nombre maximal d'identifiants actifs
autorisés. Consultez [Disponibilité des fonctions](help/feature-availability.md)
ou contactez votre administrateur en indiquant le projet et l'espace concernés.

## Pages associées

- [Espaces de stockage](spaces/index.md)
- [Collaboration](collaboration.md)
- [Paramètres](settings.md)
- [Dépannage](help/troubleshooting.md)

## Exemple visuel

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="/assets/screenshots/user/portal-access-keys.light.png" alt="Configuration Portal d'un outil externe pour un espace de stockage" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="/assets/screenshots/user/portal-access-keys.dark.png" alt="Configuration Portal d'un outil externe pour un espace de stockage" loading="lazy">
</div>
