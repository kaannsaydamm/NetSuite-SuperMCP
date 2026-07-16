# Changelog

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
