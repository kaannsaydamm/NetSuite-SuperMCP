# Changelog

## 0.1.36

- Added requester-owned, immutable versioned business terms and metric definitions.
- Added deterministic compilation of supported metrics into parameterized read-only SuiteQL plans.
- Added metric planning, validation, bounded execution, definition drift, and lineage tracing.
- Added evidence-backed reports and JSONL/CSV metric exports with optional gzip compression.
- Every metric result includes its formula, query and plan fingerprints, source fields, and explicit
  source references.
- No account-specific metric meanings or date/time normalization behavior were added.

## 0.1.35

- Added native customization inventory with explicit gaps for inaccessible or unstable-ID objects.
- Added stable script-ID and checksum environment drift comparison that ignores internal-ID changes
  and excludes date/time fields.
- Added bounded checksum-pinned SuiteCloud project generation, validation, deployment preview,
  provider-approved deployment plans, result recording, and live version verification.
- Added rollback planning limited to files with verified previous content.
- Added cross-account migration, dependency mapping, orphan/unused customization cleanup proposals,
  technical-debt facts, and deterministic system documentation.
- Customization ownership metadata remains unknown unless supplied; cleanup never deletes objects.

## 0.1.34

- Added versioned integration contracts, typed validation, deterministic reconciliation, and
  evidence-linked difference totals for orders, inventory, returns, payments, and generic records.
- Added integration health and deterministic incident grouping from caller-supplied execution facts.
- Added write-disabled shadow, replay, and regression previews; sandbox replay is account-gated.
- Added bounded canary prepare/monitor/promotion/abort state. Promotion validates prepared operation
  plans but never commits them and explicitly requires harness approval.
- Added explicit synthetic-data generation and selected-field anonymization.
- Added provider-delivered event subscriptions with a persistent idempotent outbox and retry state.
- No external-system credentials, date/time normalization, or account-specific rules were added.

## 0.1.33

- Added native script/deployment discovery and execution evidence without caller-supplied Saved
  Search IDs.
- Added bounded SuiteScript source retrieval through a permanent RESTlet action.
- Added conservative source audit, AMD dependency graph, record reader/writer, field usage, and
  exact duplicate-logic tools.
- Findings include file, line, rule, severity, confidence, and redacted evidence; secret-like
  literals are never returned.
- Unsupported dependency types and date-dependent stuck/governance assessments are reported as
  unknown instead of inferred.

## 0.1.32

- Added tokenized read-only SuiteQL validation, parameterized query building, cost warnings, and
  sensitive-field classification.
- Added HMAC-signed keyset cursors, bounded paging, and opaque incremental checkpoints.
- Added persistent read jobs with progress, budgets, cancellation, recovery, partial failures, and
  deterministic resumable chunks.
- Added streamed MCP export resources for JSONL/CSV with optional gzip compression.
- Added Saved Search definition export, definition diff, and non-mutating clone preview.
- Existing `ns_runSuiteQL` now uses the same read-only validator and a default 100-row cap.
- Incremental reads use explicit unique key fields; no date/time normalization or account-specific
  date logic was added.

## 0.1.31

- Added typed record-type and field discovery with REST metadata and permanent SuiteScript fallback.
- Added bounded external-ID resolution, batch record reads, and explicit sublist expansion.
- Added transaction relationship graphs, raw System Notes event streams, and evidence-backed diagnosis.
- Added deterministic redacted evidence bundles and record snapshot/diff primitives.
- Date/time fields remain raw NetSuite values and are never normalized, reordered, compared, or rewritten.

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
