## MODIFIED Requirements

### Requirement: Le modèle APIToken inclut un champ owned_by pour distinguer les jetons admin des jetons self-service
La table `api_tokens` SHALL inclure une colonne `owned_by TEXT DEFAULT ''`. Les jetons créés via la route admin (`POST /api/settings/tokens`) SHALL avoir `owned_by = ''`. Les jetons créés via la route self-service (`POST /api/v1/me/tokens`) SHALL avoir `owned_by = <username du créateur>`. La migration SHALL être additive et non-destructive : les tokens existants conservent `owned_by = ''`.

#### Scenario: Colonne owned_by ajoutée au démarrage si absente
- **WHEN** le backend démarre sur une base de données existante sans la colonne `owned_by`
- **THEN** la colonne SHALL être créée via `ensureColumn("api_tokens", "owned_by", "TEXT DEFAULT ''")` sans perte de données

#### Scenario: Distinction visible dans la vue admin
- **WHEN** un administrateur appelle `GET /api/settings/tokens`
- **THEN** chaque token retourné SHALL inclure le champ `owned_by` permettant de distinguer les tokens administrés des tokens self-service
