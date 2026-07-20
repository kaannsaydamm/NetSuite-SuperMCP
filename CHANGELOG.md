# Changelog

## 0.1.44 - 2026-07-20

- Redact nested System Note PII carried in generic value fields and entity references.
- Enforce a fail-closed System Note record-type discriminant so identical internal IDs do not mix histories.
- Publish direct object input schemas from one canonical contract source for every MCP tool.
- Repair script inventory, deployment, source, and observability searches with stable search columns and concrete SuiteScript record types.
- Canonicalize transaction graph aliases and orient parent/child edges without cycles.
- Require a File Cabinet folder target, lower the default result limit, and make sanitized URLs opt-in.
- Return actionable, secret-sanitized NetSuite error codes and details for failed diagnostics.
- Return explicit configuration guidance when integration diagnostic saved searches are not supplied.
- Change the public license from MIT to PolyForm Noncommercial 1.0.0; commercial rights remain reserved by Kaan Kadir Aluçlu.

## 0.1.43 - 2026-07-20

- Fixed the NetSuite authorization request to send OAuth scopes as a space-delimited value.
- Added a regression test for the NetSuite authorization URL scope format.

## 0.1.42 - 2026-07-20

- Fixed `public-url` selecting an older ngrok tunnel when another SuperMCP instance was already running.
- Correlates the discovered HTTPS tunnel with the local MCP port before printing connector URLs.

## 0.1.41 - 2026-07-20

- Added MCP-native OAuth 2.1 Authorization Code flow with PKCE S256, RFC 9728 protected-resource
  discovery, authorization-server metadata, Dynamic Client Registration, token rotation, and
  revocation for Claude and other remote MCP clients.
- Added per-user NetSuite OAuth brokering. MCP tokens are opaque and persisted only as hashes;
  NetSuite refresh tokens and temporary upstream PKCE verifiers are encrypted with AES-256-GCM.
- Added request-scoped NetSuite clients so every remote connector session runs with the NetSuite
  account and role selected during browser authorization.
- Changed `netsuite-supermcp public-url` to launch OAuth-protected ngrok endpoints and print the
  exact Claude connector and NetSuite callback settings. Stable ngrok domains are supported through
  `NGROK_DOMAIN` or `--domain`.
- Preserved bearer and stdio modes. No date/time normalization or account-specific behavior was
  added.

## 0.1.40

- Added recursive built-in PII redaction for email, phone, address, personal-name, addressee,
  attention, and postal-code fields. Harness `piiMode: show` remains the explicit override.
- Replaced full request/response audit persistence with bounded metadata, fingerprints, counts,
  duration, record references, and error codes; legacy full-body rows are compacted on access.
- Added a bounded unsigned-production preview profile. Prepare tools remain available, while actual
  commit and OAuth revocation require an explicitly signed operations scope.
- Fixed SuiteTalk REST SuiteQL parameters by safely rendering validated scalar literals into `q`,
  including keyset cursor numeric IDs and semantic metric execution.
- Fixed JSON Schema field discovery, System Notes search columns and diagnostic gap handling,
  transaction type canonicalization, data-quality frequency counts, and invalid tool examples.
- Fixed SuiteScript source resolution by loading script records instead of requesting unsupported
  script search columns. Read-only requests may retry transient upstream failures; mutations do not.
- Added requester-owned `ns_deleteBusinessTerm` and `ns_deleteMetric` cleanup tools and explicit
  `registryOwner`, `businessOwner`, and `createdBy` provenance.

## 0.1.39

- Added HMAC-verified harness contexts for provider-selected read, preview, and operations profiles.
- Added actual MCP catalog filtering, explicit tool and record-type scope, and persistent resumable
  call/row/record/governance/runtime budgets.
- Added unconditional secret redaction, harness-selected PII handling, and structured sensitivity
  and remaining-budget metadata on tool responses.
- Added approval requirement, decision, approver, and callback facts without invoking callbacks or
  moving consent into the MCP server.
- Added immutable typed composite definitions with declared-input validation, referenced tool and
  runbook validation, version protection, and cycle rejection. Composite definitions never execute
  arbitrary code or hidden nested tools.

## 0.1.38

- Added immutable versioned runbooks with persistent, resumable, ordered execution state.
- Added mandatory operation-plan and preview evidence validation for mutating runbook steps.
- Added provider-configured bounded repair proposals; financial and destructive repairs remain
  proposal-only and all repairs require harness approval.
- Added deterministic-first incident correlation, SLA facts and alerts, hashed redacted support
  evidence, and fingerprint-versioned documentation from supplied live metadata.
- Added evidence memory that requires explicit supersession before a prior claim can be replaced.

## 0.1.37

- Added evidence-preserving process variants, edges, bottleneck facts, and explicit unknown gaps.
- Added observed/inferred/configured rule discovery and field-writer conflict analysis.
- Added declarative data-quality, master-data, invariant, and provider-owned policy evaluation.
- Added isolated downstream, GL, inventory-state, and channel-allocation simulations.
- Added uncertainty-aware root-cause ranking with supporting and contradicting evidence.
- Simulations never commit, and GL output labels NetSuite-provided facts separately from estimates.

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
