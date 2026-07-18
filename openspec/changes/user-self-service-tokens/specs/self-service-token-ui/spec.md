## ADDED Requirements

### Requirement: Interface utilisateur "Mes Jetons" accessible à tous les utilisateurs connectés
Le système SHALL exposer une section "Mes Jetons" dans la page des paramètres (`/settings`), visible et utilisable par tout utilisateur connecté quelque soit son rôle. Cette section est distincte de la section "Gestion des jetons API" réservée aux administrateurs.

#### Scenario: Affichage de la section "Mes Jetons" pour un viewer
- **WHEN** un utilisateur de rôle `viewer` visite la page `/settings`
- **THEN** la section "Mes Jetons" SHALL être visible avec un bouton "Créer un jeton"

#### Scenario: Formulaire de création de jeton personal
- **WHEN** un utilisateur clique sur "Créer un jeton" dans la section "Mes Jetons"
- **THEN** un formulaire SHALL s'afficher avec les champs : `nom` (texte libre) et `durée` (slider ou select de 1 à 7 jours)

#### Scenario: Affichage du jeton en clair après création
- **WHEN** la création d'un jeton réussit
- **THEN** le jeton brut SHALL être affiché une seule fois dans une alerte ou modal avec un bouton "Copier" et un avertissement indiquant qu'il ne sera plus visible

#### Scenario: Liste des jetons personnels actifs et expirés
- **WHEN** un utilisateur consulte la section "Mes Jetons"
- **THEN** ses jetons SHALL être listés avec : nom, date de création, date d'expiration, statut (Actif / Expiré), et un bouton "Révoquer" pour chaque

#### Scenario: Confirmation avant révocation
- **WHEN** un utilisateur clique sur "Révoquer" pour un de ses jetons
- **THEN** une boîte de dialogue de confirmation SHALL s'afficher avant d'effectuer la suppression

### Requirement: Les strings i18n de la section "Mes Jetons" sont disponibles dans les 6 locales
Le système SHALL inclure toutes les clés de traduction de l'interface "Mes Jetons" dans les 6 locales supportées : `en`, `fr`, `es`, `de`, `he`, `zh`, dans le fichier `frontend/src/i18n/strings.ts`.

#### Scenario: Affichage localisé en français
- **WHEN** l'utilisateur a sélectionné la langue française dans ses préférences
- **THEN** tous les labels, boutons, messages d'erreur et confirmations de la section "Mes Jetons" SHALL s'afficher en français

#### Scenario: Toutes les clés requises sont présentes dans strings.ts
- **WHEN** le code est compilé (build Next.js)
- **THEN** toutes les clés liées aux jetons self-service SHALL exister dans les objets `en`, `fr`, `es`, `de`, `he`, `zh` du dictionnaire `supplementalStrings`
