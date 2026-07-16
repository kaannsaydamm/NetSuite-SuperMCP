# Changelog

## 0.1.30

- Added bounded OAuth/login diagnostics, Login Audit Trail access, token metadata and eligibility,
  current-role visibility measurement, explicit management-role comparison, integration feature
  checks, identity relationship discovery, and caller-defined segregation-of-duties analysis.
- Added `netsuite-supermcp auth-diagnose` for offline and authenticated diagnosis.
- Changed `netsuite-supermcp logout` to revoke authorization-code OAuth at NetSuite's revoke
  endpoint and remove the local refresh token without starting another browser login.
- Added an optional diagnostics-only management identity. It is never used as a fallback for
  business operations.

## 0.1.29

- Routed transaction, record, file, saved-search, mapping, integration-retry, and inventory
  mutations through bound, single-use operation plans with preview, stale-state detection,
  idempotent replay, and compensation guidance.
- Added explicit transaction line selection and permanent SuiteScript operation modules; normal
  operation no longer creates temporary SuiteScripts or modifies RESTlets at runtime.
- Added typed public tool contracts, valid/invalid examples, local request validation, capability
  effects and permission hints, standard error envelopes, request IDs, generated schema snapshots,
  and ChatGPT cache compatibility guidance.
- Inventory stock import tools are now prepare-only; commits use `ns_commitAction`.
- No date/time normalization, timezone conversion, transaction-date rewriting, or account-specific
  behavior was added.
