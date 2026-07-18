# Workspace Rules - K6 Stratos Portal

Any coding assistant agent working on this workspace MUST adhere to the target enterprise specifications and architectural principles documented in [architecture_design.md](file:///Users/yehoshouad/tmp/perso/k6-stratos-portal/docs/architecture_design.md).

## Critical Guidelines:
1. **Security by Default:** Never use long-lived static AWS credentials or hardcoded API keys. Use STS assume-role structures and token hashing protocols.
2. **API-First & Token Hashing:** Enforce token validation on all programmatic endpoints, using SHA-256 hashes of the plain `stratum_tok_` keys stored in the database.
3. **i18n Localization:** Keep all user-facing UI messages in localized dictionaries. If translations for Spanish (`es`) or German (`de`) are introduced, register them in `strings.ts`.
4. **Theme Flash Prevention:** Do not change the inline theme check blocking script in `index.html` unless updating theme loading methods.
5. **No Placeholders:** Ensure all charts, logs, and dashboards use real or simulated live data streams rather than simple placeholders.
