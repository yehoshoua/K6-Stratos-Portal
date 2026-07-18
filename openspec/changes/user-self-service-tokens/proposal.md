## Why

Actuellement, seuls les administrateurs peuvent créer des jetons d'API (`stratum_tok_`). Les utilisateurs (editeurs, viewers) n'ont aucun moyen de s'auto-servir des jetons pour automatiser leurs propres tâches CI/CD ou scripts personnels, ce qui crée un goulot d'étranglement administratif et ralentit les workflows d'automatisation. Cette limitation rend le portail moins autonome pour les équipes techniques.

## What Changes

- **Nouveau point d'accès self-service** : Un utilisateur authentifié peut désormais créer ses propres jetons d'API sans intervention administrateur, via une nouvelle route `POST /api/v1/me/tokens`.
- **Durée maximale imposée à 7 jours** : Les jetons créés via le self-service ont une expiration obligatoire plafonnée à 7 jours — ni durée infinie, ni durée supérieure à 168 heures.
- **Isolation par propriétaire** : Chaque jeton créé via le self-service est associé à l'utilisateur connecté (`owned_by`). L'utilisateur ne peut lister, voir et supprimer que ses propres jetons via `GET/DELETE /api/v1/me/tokens`.
- **Scopes limités au rôle de l'utilisateur** : Un éditeur ne peut pas créer un jeton avec des scopes d'administrateur. Les scopes du jeton sont plafonnés aux droits du créateur.
- **Les administrateurs conservent la vue globale** : La route admin existante `GET /api/settings/tokens` continue d'afficher tous les jetons (y compris ceux du self-service), avec un champ `owned_by` visible pour l'audit.
- **Traçabilité dans l'audit log** : Toute création/suppression de jeton via le self-service est enregistrée dans le journal d'audit avec `action: token.self_service.create` et `actor: <username>`.
- **Interface frontend** : Une nouvelle section "Mes Jetons" est ajoutée dans le profil ou les paramètres utilisateur (accessible à tous les rôles connectés).

## Capabilities

### New Capabilities

- `user-self-service-token-create` : Un utilisateur connecté peut créer un jeton d'API personnel limité à 7 jours max, avec des scopes bornés à son propre rôle.
- `user-self-service-token-list-revoke` : Un utilisateur peut lister et révoquer ses propres jetons self-service sans toucher à ceux des autres.
- `self-service-token-ui` : Interface frontend dans les paramètres utilisateur permettant de créer, visualiser et révoquer ses jetons personnels.

### Modified Capabilities

- `api-token-management` : Le modèle `APIToken` en base de données gagne un champ `owned_by TEXT DEFAULT ''` pour distinguer les jetons administrateurs (owned_by vide ou `system`) des jetons self-service (owned_by = `<username>`).

## Impact

- **Backend** : Nouvelles routes dans `backend/internal/server/tokens.go`, nouvelle colonne `owned_by` dans la table `api_tokens` (migration additive), nouvelle validation de plafonnement dans `handleSelfServiceGenerateToken`.
- **Base de données** : Migration SQLite/PostgreSQL ajoutant `owned_by TEXT DEFAULT ''` à `api_tokens`. Existing tokens remain unaffected (`owned_by` defaults to empty string = admin-managed).
- **Frontend** : Nouvelle section dans `frontend/src/app/settings/page.tsx` ou un profil utilisateur dédié ; nouvelles clés i18n dans `strings.ts` pour tous les 6 locales (en, fr, es, de, he, zh).
- **ABAC/Scopes** : La fonction `scopesForRole()` existante dans `abac.go` est réutilisée pour plafonner les scopes au moment de la création du jeton.
- **Audit** : Nouveau type d'action `token.self_service.create` et `token.self_service.revoke` dans le journal d'audit.
