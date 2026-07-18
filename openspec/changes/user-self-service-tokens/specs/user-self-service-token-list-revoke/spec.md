## ADDED Requirements

### Requirement: Un utilisateur peut lister ses propres jetons self-service
Le système SHALL exposer `GET /api/v1/me/tokens` retournant uniquement les jetons dont `owned_by = <username de l'appelant>`. Les jetons administrés (owned_by vide) ne SHALL PAS apparaître dans cette liste.

#### Scenario: Liste de ses propres jetons
- **WHEN** un utilisateur authentifié appelle `GET /api/v1/me/tokens`
- **THEN** le système retourne la liste des jetons dont il est propriétaire, avec les champs : `token_hash`, `name`, `scopes`, `created_at`, `expires_at`, `is_expired`

#### Scenario: Isolation entre utilisateurs
- **WHEN** l'utilisateur `alice` appelle `GET /api/v1/me/tokens`
- **THEN** le système SHALL ne retourner que les jetons créés par `alice`, jamais ceux créés par `bob` ou par un administrateur

### Requirement: Un utilisateur peut révoquer ses propres jetons self-service
Le système SHALL permettre à un utilisateur de supprimer un de ses propres jetons via `DELETE /api/v1/me/tokens/{hash}`. L'utilisateur ne SHALL PAS pouvoir révoquer les jetons d'un autre utilisateur ou des jetons admin.

#### Scenario: Révocation réussie de son propre jeton
- **WHEN** un utilisateur appelle `DELETE /api/v1/me/tokens/{hash}` pour un jeton dont il est propriétaire
- **THEN** le système supprime le jeton et retourne HTTP 200 `{"success": true}`

#### Scenario: Refus de révocation d'un jeton appartenant à un autre utilisateur
- **WHEN** l'utilisateur `alice` appelle `DELETE /api/v1/me/tokens/{hash}` pour un hash appartenant à `bob`
- **THEN** le système SHALL retourner HTTP 403 `{"error": "forbidden: not your token"}`

#### Scenario: Révocation d'un jeton déjà expiré
- **WHEN** un utilisateur appelle `DELETE /api/v1/me/tokens/{hash}` pour un jeton expiré lui appartenant
- **THEN** le système supprime le jeton et retourne HTTP 200 (idempotent)

### Requirement: La création et la révocation de jetons self-service sont tracées dans l'audit log
Le système SHALL enregistrer une entrée dans `audit_logs` pour chaque création et révocation de jeton personal avec `action = "token.self_service.create"` ou `"token.self_service.revoke"` et `actor = <username>`.

#### Scenario: Audit de création de jeton self-service
- **WHEN** un utilisateur crée un jeton via `POST /api/v1/me/tokens`
- **THEN** une entrée `{action: "token.self_service.create", actor: "<username>", target: "<nom du token>"}` SHALL être écrite dans `audit_logs`

#### Scenario: Audit de révocation de jeton self-service
- **WHEN** un utilisateur révoque un jeton via `DELETE /api/v1/me/tokens/{hash}`
- **THEN** une entrée `{action: "token.self_service.revoke", actor: "<username>", target: "<hash>"}` SHALL être écrite dans `audit_logs`
