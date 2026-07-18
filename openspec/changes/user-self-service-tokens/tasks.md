## 1. Base de données — Migration additive

- [x] 1.1 Ajouter `owned_by TEXT DEFAULT ''` dans la définition initiale de la table `api_tokens` dans `database.go` (CREATE TABLE IF NOT EXISTS)
- [x] 1.2 Ajouter la migration `ensureColumn("api_tokens", "owned_by", "TEXT DEFAULT ''")` dans `createTables()` pour les bases existantes (SQLite et PostgreSQL)
- [x] 1.3 Mettre à jour le struct `APIToken` dans `database.go` pour inclure le champ `OwnedBy string json:"owned_by"`
- [x] 1.4 Mettre à jour `SaveAPIToken()` pour accepter et stocker `owned_by`
- [x] 1.5 Mettre à jour `ListAPITokens()` pour inclure `owned_by` dans le SELECT et le Scan
- [x] 1.6 Mettre à jour `GetAPITokenByHash()` pour inclure `owned_by` dans le SELECT et le Scan
- [x] 1.7 Ajouter `ListAPITokensByOwner(username string)` dans `database.go` : `SELECT ... FROM api_tokens WHERE owned_by = ?`
- [x] 1.8 Mettre à jour la signature de `DeleteAPIToken()` ou ajouter `DeleteAPITokenByHashAndOwner(hash, username)` pour la validation d'appartenance

## 2. Backend — Handler self-service

- [x] 2.1 Ajouter `handleSelfServiceListTokens` dans `tokens.go` : extrait `X-User-Name` depuis headers, appelle `ListAPITokensByOwner`, retourne JSON
- [x] 2.2 Ajouter `handleSelfServiceGenerateToken` dans `tokens.go` : valide `expiry_days` ∈ [1, 7] (erreur 400 sinon), plafonne les scopes au rôle du créateur via `validScopesForRole`, génère le token, stocke avec `owned_by = username`, audite `token.self_service.create`
- [x] 2.3 Ajouter `handleSelfServiceDeleteToken` dans `tokens.go` : vérifie que `owned_by == X-User-Name` avant suppression (erreur 403 sinon), audite `token.self_service.revoke`
- [x] 2.4 Enregistrer les 3 nouvelles routes dans `registerRoutes()` dans `server.go` :
  - `GET /api/v1/me/tokens` → `s.authMiddleware(s.handleSelfServiceListTokens)`
  - `POST /api/v1/me/tokens` → `s.authMiddleware(s.handleSelfServiceGenerateToken)`
  - `DELETE /api/v1/me/tokens/{hash}` → `s.authMiddleware(s.handleSelfServiceDeleteToken)`
- [x] 2.5 Mettre à jour l'appel à `SaveAPIToken()` dans `handleGenerateAPIToken` (route admin) pour passer `owned_by = ""` (rétrocompatibilité)

## 3. Frontend — Service API

- [x] 3.1 Ajouter dans `frontend/src/services/api.ts` les 3 fonctions :
  - `listMyTokens()` → `GET /api/v1/me/tokens`
  - `createMyToken(name, expiryDays, scopes?)` → `POST /api/v1/me/tokens`
  - `revokeMyToken(hash)` → `DELETE /api/v1/me/tokens/{hash}`

## 4. Frontend — Interface utilisateur

- [x] 4.1 Ajouter une section "Mes Jetons" dans `frontend/src/app/settings/page.tsx`, visible à tous les rôles (pas de garde `adminOnly`)
- [x] 4.2 Implémenter la liste des jetons personnels : tableau avec nom, date de création, date d'expiration, badge de statut (Actif / Expiré), bouton "Révoquer"
- [x] 4.3 Implémenter le formulaire de création : champ `Nom` (text input requis) + champ `Durée` (select ou slider 1–7 jours)
- [x] 4.4 Afficher le jeton brut dans une modale/alerte avec bouton "Copier" et avertissement "Ce jeton ne sera plus affiché" après création réussie
- [x] 4.5 Implémenter la boîte de confirmation avant révocation d'un jeton
- [x] 4.6 Intégrer les appels API `listMyTokens`, `createMyToken`, `revokeMyToken` dans les handlers d'événements

## 5. Internationalisation (i18n)

- [x] 5.1 Ajouter les clés de traduction suivantes dans les 6 locales (`en`, `fr`, `es`, `de`, `he`, `zh`) dans `frontend/src/i18n/strings.ts` :
  - `myTokens` — titre de la section
  - `myTokensSubtitle` — description de la section
  - `createPersonalToken` — bouton de création
  - `personalTokenName` — label du champ nom
  - `personalTokenExpiry` — label du champ durée
  - `personalTokenExpiryDays` — "{n} jour(s)"
  - `personalTokenCreatedOnce` — avertissement affichage unique
  - `revokeToken` — bouton de révocation
  - `revokeTokenConfirm` — message de confirmation de révocation
  - `tokenExpired` — badge statut expiré
  - `tokenActive` — badge statut actif
  - `myTokensEmpty` — message liste vide
  - `personalTokenCreateSuccess` — toast de succès création
  - `personalTokenRevokeSuccess` — toast de succès révocation
  - `personalTokenCreateFailed` — message d'erreur création
  - `personalTokenRevokeFailed` — message d'erreur révocation
  - `personalTokenMaxDays` — "Maximum 7 jours"

## 6. Tests

- [x] 6.1 Ajouter un test backend `backend/internal/server/tokens_self_service_test.go` couvrant :
  - Création réussie avec `expiry_days = 7`
  - Refus avec `expiry_days = 0`
  - Refus avec `expiry_days = 8`
  - Refus de scopes hors rôle
  - Isolation : `alice` ne peut pas supprimer le token de `bob`
- [x] 6.2 Vérifier que `npm run build` passe sans erreur TypeScript après les changements frontend
- [x] 6.3 Vérifier que `go test ./...` passe dans le dossier `backend/`
