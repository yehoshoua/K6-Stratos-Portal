## Context

Actuellement, le portail K6 Stratos restreint la création de jetons d'API (`stratum_tok_`) aux seuls administrateurs via `POST /api/settings/tokens`. Ces jetons peuvent être permanents ou avoir une durée quelconque. Le modèle `APIToken` en base de données possède les colonnes `token_hash`, `name`, `role`, `scopes`, `created_at`, `expires_at`.

L'authentification middleware dans `server.go` valide les deux catégories de tokens (JWT de session et `stratum_tok_` d'API) de manière identique. La sécurité des tokens d'API repose sur le hash SHA-256 du jeton brut stocké en base (jamais le token en clair).

Les scopes sont gérés dans `abac.go` via `scopesForRole()`. Le système ABAC est déjà en place pour contraindre les accès par cluster/namespace/environment par utilisateur.

## Goals / Non-Goals

**Goals:**
- Permettre à tout utilisateur authentifié de créer un jeton d'API pour ses propres tâches d'automatisation, sans dépendre d'un administrateur.
- Imposer une durée maximale de 7 jours (168 heures) sur tous les jetons self-service, côté serveur (la validation frontend est un UX hint uniquement).
- Restreindre les scopes d'un jeton self-service aux scopes que possède déjà l'utilisateur créateur — impossible de s'auto-élever.
- Permettre à l'utilisateur de lister et révoquer uniquement ses propres jetons self-service.
- Tracer chaque création/révocation dans le journal d'audit.
- Identifier clairement les jetons self-service des jetons administrateurs via un champ `owned_by`.

**Non-Goals:**
- Permettre à un utilisateur de créer un jeton pour un autre utilisateur.
- Permettre à un viewer de créer un jeton avec des scopes d'editor ou d'admin.
- Modifier la gestion admin existante des tokens (`/api/settings/tokens`).
- Introduire un système de refresh token ou d'OAuth2.
- Ajouter une limitation du nombre de jetons par utilisateur (v1 sans quota).

## Decisions

### D1 — Nouvelles routes dédiées plutôt que modification des routes admin

**Décision** : Créer de nouvelles routes `/api/v1/me/tokens` (GET, POST, DELETE) distinctes des routes admin existantes (`/api/settings/tokens`).

**Rationale** : Les routes admin nécessitent `adminOnly()`. Modifier leur middleware pour accepter aussi les users ordinaires introduirait des risques de régression et de confusion. Des routes dédiées permettent un contrôle d'accès propre et indépendant.

**Alternative écartée** : Réutiliser `POST /api/settings/tokens` avec un check de rôle dynamique — écarté car cela mélange la sémantique admin et self-service, complexifie les middlewares et rend l'audit moins lisible.

### D2 — Colonne `owned_by` additive dans `api_tokens`

**Décision** : Ajouter une colonne `owned_by TEXT DEFAULT ''` à la table `api_tokens`. Les tokens admin existants gardent `owned_by = ''` (ou `'system'`). Les tokens self-service ont `owned_by = <username>`.

**Rationale** : Migration non-destructive, rétrocompatible avec les tokens existants. Permet à la route admin `GET /api/settings/tokens` de continuer d'afficher tout sans changement. Le champ vide est le signal naturel "géré par admin".

**Alternative écartée** : Créer une nouvelle table `user_tokens` séparée — écarté car cela duplique la logique de validation du middleware (qui doit aller chercher en un seul endroit).

### D3 — Validation côté serveur du plafond 7 jours

**Décision** : La contrainte `expires_at ≤ now + 7 days` est validée dans le handler Go `handleSelfServiceGenerateToken`. Si `expiry_days` est absent/0 ou > 7, le serveur retourne HTTP 400.

**Rationale** : La sécurité ne peut pas reposer sur le frontend. Le frontend propose simplement un slider de 1 à 7 jours comme UX hint, mais le serveur est la source de vérité.

**Alternative écartée** : Permettre `expiry_days=0` (infini) avec un cap serveur — écarté car les tokens sans expiration pour le self-service sont un risque de sécurité inacceptable pour des comptes non-admin.

### D4 — Scopes plafonnés à ceux du rôle du créateur

**Décision** : Lors de la création d'un token self-service, les scopes demandés sont intersectés avec `validScopesForRole(creatorRole)`. Toute scope hors de cette liste retourne HTTP 400.

**Rationale** : Réutilise la logique déjà existante dans `tokens.go` (`validScopesForRole`). Pas de nouveau mécanisme à maintenir. Empêche toute tentative d'escalade de privilèges.

### D5 — Architecture des handlers : réutilisation maximale

**Décision** : `handleSelfServiceGenerateToken` extrait `username` et `role` depuis les headers injectés par `authMiddleware` (`X-User-Name`, `X-User-Role`) et délègue la génération du token brut et du hash à la logique existante dans `tokens.go`. Le handler utilise `SaveAPIToken` avec le paramètre `owned_by` ajouté.

**Alternative écartée** : Un handler entièrement séparé avec sa propre logique de hashage — écarté car cela crée de la duplication et des divergences potentielles avec le mécanisme de validation du middleware.

## Risks / Trade-offs

| Risque | Mitigation |
|--------|-----------|
| Un utilisateur crée 1000 tokens et pollue la table `api_tokens` | À adresser dans une v2 avec quota par utilisateur. En v1, l'audit log traçant chaque création permet à un admin de détecter l'abus. |
| Un utilisateur oublie de révoquer ses tokens expirés | Les tokens expirés sont rejetés par l'authMiddleware (`ExpiresAt.Before(now)`). La vue "Mes jetons" affiche clairement le statut expiré. |
| La colonne `owned_by` peut être vide pour les anciens tokens admin | C'est le comportement attendu et documenté. Les routes self-service filtrent `WHERE owned_by = ?` (username du créateur). |
| Le plafond 7 jours peut frustrer des usages légitimes (ex: pipeline CI long) | Cas d'usage atypique ; l'admin garde la possibilité de créer des tokens longue durée via la route admin. La doc doit clairement expliquer cette distinction. |

## Migration Plan

1. **Base de données** : La colonne `owned_by` est ajoutée via `ensureColumn("api_tokens", "owned_by", "TEXT DEFAULT ''")` dans `createTables()` / `InitDB()` — le même mécanisme déjà utilisé pour la colonne `scopes`.
2. **Backend** : Les nouvelles routes sont ajoutées dans `registerRoutes()`. Aucune route existante n'est modifiée.
3. **Frontend** : Nouvelle section dans la page Settings, visible par tous les rôles authentifiés.
4. **Rollback** : La colonne `owned_by` étant additive avec DEFAULT, un rollback du binaire backend laisse la colonne ignorée sans erreur. Les nouvelles routes peuvent être supprimées sans impact sur les routes admin.

## Open Questions

- **Quota** : Limiter le nombre de tokens actifs par utilisateur en v1 (ex: max 5) ou laisser illimité et adresser en v2 si abus constaté ?
- **UI** : Nouvelle page dédiée "Profil utilisateur" ou section dans la page Settings existante (onglet "Mes jetons") ?
- **Nom de l'action d'audit** : `token.self_service.create` ou `token.personal.create` — lequel est plus cohérent avec la convention existante dans `audit.go` ?
