## ADDED Requirements

### Requirement: Tout utilisateur authentifié peut créer un jeton d'API personnel
Le système SHALL permettre à tout utilisateur connecté (quelque soit son rôle : viewer, editor, security_auditor ou administrator) de créer un jeton d'API personnel via `POST /api/v1/me/tokens`. La durée d'expiration est obligatoire et doit être comprise entre 1 et 7 jours inclus.

#### Scenario: Création réussie d'un jeton personnel
- **WHEN** un utilisateur authentifié envoie `POST /api/v1/me/tokens` avec `name`, et `expiry_days` ∈ [1, 7]
- **THEN** le système génère un jeton `stratum_tok_<random>`, stocke son hash SHA-256 avec `owned_by = <username>` et retourne le jeton brut en clair une seule fois

#### Scenario: Refus si expiry_days est absent ou vaut 0
- **WHEN** un utilisateur envoie `POST /api/v1/me/tokens` sans `expiry_days` ou avec `expiry_days = 0`
- **THEN** le système SHALL retourner HTTP 400 avec le message d'erreur `"expiry_days is required for personal tokens (1-7)"`

#### Scenario: Refus si expiry_days dépasse 7
- **WHEN** un utilisateur envoie `POST /api/v1/me/tokens` avec `expiry_days = 8` ou plus
- **THEN** le système SHALL retourner HTTP 400 avec le message d'erreur `"personal tokens cannot exceed 7 days"`

#### Scenario: Les scopes sont plafonnés au rôle du créateur
- **WHEN** un utilisateur de rôle `editor` demande un token avec des scopes incluant `admin:full`
- **THEN** le système SHALL retourner HTTP 400 avec le message `"scope is not permitted for your role"`

#### Scenario: Les scopes par défaut correspondent au rôle du créateur
- **WHEN** un utilisateur envoie `POST /api/v1/me/tokens` sans champ `scopes`
- **THEN** le système SHALL assigner les scopes par défaut correspondant au rôle de l'utilisateur (via `scopesForRole`)
