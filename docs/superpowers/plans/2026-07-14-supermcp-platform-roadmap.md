# NetSuite SuperMCP Platform Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create an executable implementation plan for each phase, then use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement it task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve NetSuite SuperMCP from a collection of NetSuite tools into a typed, observable, recoverable operations, diagnostics, integration, administration, and business-analysis platform without introducing account-specific date/time behavior.

**Architecture:** Keep NetSuite authorization in the connected OAuth user/role and keep user consent in the calling harness. SuperMCP supplies typed contracts, read-only discovery, prepare/preview/commit protocols, snapshots, idempotency, audit evidence, jobs, and deterministic diagnostics. Large features are delivered as independent, testable modules behind stable MCP interfaces rather than by adding one-off SuiteScripts per task.

**Tech Stack:** TypeScript 5.9, Bun 1.3, Zod 4, MCP SDK 1.29, Hono, NetSuite REST Web Services, SuiteQL, SuiteScript 2.1 RESTlets, Oracle SuiteCloud CLI, NDJSON audit storage, Node/Bun standard cryptography and streams.

## Global Constraints

- Do not add date/time normalization, timezone conversion, date-shift diagnosis, transaction-date rewriting, or account-specific clock logic.
- Do not include Moneta-specific scripts, assumptions, identifiers, mappings, workflows, or migration behavior.
- Never bypass NetSuite roles or permissions; every operation runs with the connected OAuth identity.
- SuperMCP does not decide user consent. The provider/harness controls tool availability, approval prompts, and task-level scopes.
- Production mutations remain supported, but every high-impact operation must use typed prepare/preview/commit and idempotency.
- No mutation may silently choose an account, location, subsidiary, inventory status, transaction line, or target record.
- No temporary SuiteScript creation or runtime RESTlet modification is permitted for normal operations.
- New tools require typed input and output schemas, risk metadata, examples, standard errors, audit coverage, and contract tests.
- Read operations must be paged, bounded, and explicit about truncation.
- Secrets and credentials must never appear in MCP responses or audit logs.
- Every phase must pass `bun run prepack`, RESTlet contract checks, read-only live probes, and a production deployment version check before release.
- Preserve unrelated worktree changes and release each phase with a separate conventional commit and version bump.

---

## Scope Exclusions

The following ideas are intentionally excluded from every phase:

- Timestamp normalization or conversion between source systems and NetSuite.
- Transaction date correction or automated date rewriting.
- Detection or repair of midnight/day-boundary shifts.
- Account-specific behavior learned from Moneta customizations.
- MCP-side replacement of provider consent or NetSuite role authorization.
- Fully atomic rollback claims for NetSuite operations that NetSuite cannot reverse atomically.

---

## Target Architecture

```text
Agent / ChatGPT / Claude / Codex
        |
        | provider consent, enabled actions, task scope
        v
Typed MCP Contract Layer
        |
        +-- Read/query services
        +-- Operation planner -> preview -> commit
        +-- Diagnostics and evidence services
        +-- Job manager for bounded long-running work
        |
        v
NetSuite Gateway
        |
        +-- REST Record API
        +-- SuiteQL
        +-- Permanent modular RESTlet actions
        +-- SuiteCloud deployment pipeline
        |
        v
Connected NetSuite OAuth user and role
```

Cross-cutting modules:

- `src/contracts/`: typed request, response, error, risk, and example definitions.
- `src/operations/`: preparation, snapshots, idempotency, commit, compensation planning.
- `src/jobs/`: bounded batch execution, checkpoints, resume, cancellation, status.
- `src/diagnostics/`: record, transaction, script, integration, role, and root-cause analysis.
- `src/evidence/`: claim/evidence references, bundles, hashes, and exports.
- `src/business/`: business terms, metrics, rules, process models, and invariants.
- `netsuite/suitescript/`: permanent, responsibility-focused SuiteScript modules only.

---

## Release Sequence

| Phase | Release theme | Depends on | Primary outcome |
|---|---|---|---|
| 0 | Mutation safety | Current `0.1.28` | Accidental fulfillment/invoice/receipt/bill creation is prevented |
| 1 | Typed contracts and errors | Phase 0 | Agents know exact inputs, outputs, effects, and failures |
| 2 | Identity and access diagnostics | Phase 1 | OAuth role visibility and authentication failures are explainable |
| 3 | Record and transaction intelligence | Phase 1 | Batch reads, transaction graph, history, snapshots, and diagnosis |
| 4 | Scalable query and export | Phase 1 | Safe SuiteQL, cursors, jobs, exports, and incremental reads |
| 5 | SuiteScript observability and analysis | Phases 1, 3 | Scripts, deployments, dependencies, source risks, and runtime health |
| 6 | Integration operations | Phases 3, 4, 5 | Health, reconciliation, replay, shadow, canary, and incidents |
| 7 | Customization and deployment administration | Phases 3, 5 | Inventory, drift, migration, deployment, ownership, and cleanup |
| 8 | Business semantics and analytics | Phases 3, 4 | Governed metrics, natural-language planning, lineage, and exports |
| 9 | Process, rules, quality, and simulation | Phases 3, 5, 8 | Process mining, conflicts, invariants, impact, GL, and inventory simulation |
| 10 | Operational automation and evidence | Phases 3-9 | Runbooks, bounded repair, SLA, event correlation, evidence, and docs |
| 11 | Harness integration and composition | Phases 0-10 | Provider-controlled profiles, budgets, approvals, and composite tools |

---

## Phase 0: Mutation Safety and Recovery Foundation

**Problem:** Named mutation tools currently route directly to RESTlet `commit`. A model can create a real Item Fulfillment by selecting the wrong sales order before a deterministic preview exists.

**Files:**

- Modify: `src/tools/action-tools.ts`
- Modify: `src/tools/catalog.ts`
- Modify: `src/tools/output-schemas.ts`
- Modify: `src/netsuite/types.ts`
- Create: `src/operations/operation-plan.ts`
- Create: `src/operations/operation-store.ts`
- Create: `src/operations/snapshot.ts`
- Create: `src/contracts/operation-schemas.ts`
- Modify: `netsuite/suitescript/supermcp_transform_actions.js`
- Create: `netsuite/suitescript/supermcp_operation_actions.js`
- Modify: `netsuite/suitescript/supermcp_action_restlet.js`
- Modify: `scripts/suitecloud-project.ts`
- Modify: `scripts/check-restlet-contract.ts`
- Test: `tests/mcp-operation-safety.test.ts`
- Test: `tests/mcp-actions.test.ts`
- Test: `tests/restlet-operation-contract.test.ts`

**Interfaces:**

- `ns_prepareOperation(request)` returns an opaque `operationId`, record snapshot fingerprint, human-readable impact, selected lines, warnings, and exact confirmation.
- `ns_previewOperation({ operationId })` recomputes the source state and returns the final record diff without saving.
- `ns_commitOperation({ operationId, confirmation })` loads the server-side plan, verifies its fingerprint and single-use state, then commits exactly the prepared payload.
- Named helpers such as `ns_fulfillSalesOrder` become typed prepare-only conveniences. They never call RESTlet `commit` directly.
- Existing internal RESTlet transform actions remain available only through the operation planner.

### Task 0.1: Stop direct commits from named transform tools

- [ ] Add a failing test proving `ns_fulfillSalesOrder`, `ns_invoiceSalesOrder`, `ns_receivePurchaseOrder`, and `ns_billPurchaseOrder` route to `phase: "prepare"` and never `phase: "commit"`.
- [ ] Run `bun test tests/mcp-actions.test.ts` and verify the existing direct-commit behavior fails the new assertion.
- [ ] Replace the `readOnlyActionTools` binary decision with explicit per-tool phases and assign all named transaction mutations to `prepare`.
- [ ] Update tool descriptions to state that the result is a plan and no NetSuite record is created.
- [ ] Run the test and verify all named transform tools are prepare-only.
- [ ] Commit as `fix: prevent direct transaction transform commits`.

### Task 0.2: Add typed operation plans

- [ ] Define a Zod discriminated union for `fulfillSalesOrder`, `invoiceSalesOrder`, `receivePurchaseOrder`, `billPurchaseOrder`, `transformRecord`, `createRecord`, `updateRecord`, `submitFields`, `deleteRecord`, `inventoryAdjustment`, `fileMutation`, `savedSearchMutation`, `mappingUpdate`, and `integrationRetry`.
- [ ] Require explicit source IDs and explicit line selection. “All open lines” must be represented by an explicit `selection.mode: "allOpen"`; omission is invalid.
- [ ] Define `OperationPlanSchema` with `operationId`, `kind`, `environment`, `accountId`, `requester`, `client`, `source`, `selection`, `snapshotFingerprint`, `impact`, `warnings`, `confirmation`, and `used`.
- [ ] Implement an in-memory `OperationStore` using cryptographically random opaque IDs. Plans are single-use and disappear on process restart; no clock or expiry logic is used.
- [ ] Bind plans to account, requester, and client so another connection cannot commit them.
- [ ] Add unit tests for missing line selection, wrong requester, wrong account, reused operation ID, and altered confirmation.
- [ ] Commit as `feat: add typed single-use operation plans`.

### Task 0.3: Add deterministic snapshots and stale-plan detection

- [ ] Read the source record body, relevant transaction lines, status, related target transactions, inventory-impacting fields, and selected custom fields before preparing a mutation.
- [ ] Canonically serialize the snapshot with sorted object keys and stable line ordering.
- [ ] Hash the canonical snapshot with SHA-256 and store only the fingerprint plus the redacted snapshot required for preview.
- [ ] Re-read and re-hash the source immediately before commit.
- [ ] Reject commit with `OPERATION_SOURCE_CHANGED` when the fingerprint differs.
- [ ] Add tests showing a status, quantity, line, location, or related-transaction change invalidates the plan.
- [ ] Do not read, normalize, compare, or modify transaction date/time fields as part of this feature.
- [ ] Commit as `feat: detect stale NetSuite operation plans`.

### Task 0.4: Make fulfillment selection and idempotency explicit

- [ ] Make fulfillment preparation return source order number, current status, existing fulfillments, every fulfillable line, selected quantity, location, inventory detail requirements, and expected inventory effect.
- [ ] Require either explicit selected lines or explicit `allOpen` acknowledgement.
- [ ] Generate an idempotency key during preparation and set it as the target transaction external ID when NetSuite supports it.
- [ ] Before saving, search for an existing target transaction with the same idempotency key and return the original result instead of creating a duplicate.
- [ ] Prevent quantities above the currently fulfillable quantity.
- [ ] Add a regression test based on the accidental `FUL00010398` class of incident using synthetic IDs only; do not encode production record IDs in tests.
- [ ] Commit as `feat: add idempotent fulfillment preparation`.

### Task 0.5: Add preview, impact, and compensation planning

- [ ] Produce a human-readable dry-run describing the record to be created, selected lines, quantity changes, source status transition candidates, inventory impact, and automation contexts that may run.
- [ ] Save no record during prepare or preview.
- [ ] Capture a pre-commit snapshot and the committed record reference in the audit event.
- [ ] Add `ns_prepareCompensation` that explains whether the operation can be reversed, deleted, voided, or requires a manual counter-transaction.
- [ ] Never label compensation as atomic rollback.
- [ ] Add tests for reversible fulfillment deletion, non-reversible operations, and already-changed source records.
- [ ] Commit as `feat: add operation impact and compensation plans`.

### Phase 0 Acceptance Gate

- [ ] No public named transaction tool sends `phase: "commit"`.
- [ ] A commit without a server-created, unused operation plan fails.
- [ ] A commit after source-state change fails.
- [ ] Duplicate commit returns the original result or a deterministic idempotency response.
- [ ] The harness still controls user approval; SuperMCP does not add hidden account permissions.
- [ ] Production read-only live probes pass and no live mutation probe is executed.

---

## Phase 1: Typed Contracts, Discovery, and Standard Errors

### Features

- Strongly typed input schemas for every public tool.
- Strongly typed output schemas for every public tool.
- `ns_describeTool`, `ns_getToolExample`, and `ns_validateToolRequest`.
- Required fields, accepted values, ID semantics, examples, effects, risk, required NetSuite permissions, and phase behavior.
- Standard error envelope with stable error codes, HTTP status, NetSuite code, likely cause, required permission, retryability, and request ID.
- Tool catalog versioning and schema-diff reporting.

### Implementation Units

- [ ] Create `src/contracts/tool-registry.ts` as the single source for name, title, description, input schema, output schema, risk, mutation effect, permissions, examples, and phase support.
- [ ] Replace `GenericActionInputSchema` registrations one action family at a time: transform, read/search, file, report, integration, mapping, and platform.
- [ ] Generate MCP registration metadata, `ns_describeTool`, examples, capability output, and documentation from the registry.
- [ ] Create `src/shared/error-envelope.ts` and map REST, SuiteQL, OAuth, RESTlet, validation, governance, and conflict errors.
- [ ] Include `requestId` in responses and audit events without exposing secrets.
- [ ] Add schema snapshots and reject accidental contract drift in CI.
- [ ] Add a compatibility report for cached ChatGPT app tool definitions.

### Acceptance Gate

- [ ] No public tool uses an unbounded catch-all input schema.
- [ ] Every tool has at least one valid and one invalid example test.
- [ ] Every failure uses the same error envelope.
- [ ] `ns_validateToolRequest` performs local validation without calling NetSuite.

---

## Phase 2: OAuth, Role, Permission, and Login Diagnostics

### Features

- `ns_getLoginAuditTrail` when the active role can access it.
- `ns_diagnoseAuthentication` and `netsuite-supermcp auth-diagnose` for connection failures.
- `ns_testOAuthCredentials` without returning tokens or secrets.
- `ns_analyzeRoleAccess`, `ns_compareRoleVisibility`, and `ns_explainTokenEligibility`.
- User-role-token relationship discovery.
- Integration record state and enabled-feature checks.
- Token metadata and explicit logout/revoke workflow where NetSuite supports it.
- Segregation-of-duties analysis.

### Implementation Units

- [ ] Separate offline configuration checks from authenticated NetSuite checks so broken credentials still yield useful diagnostics.
- [ ] Add an optional management identity profile for audit-trail diagnosis; never silently fall back to it for business operations.
- [ ] Measure effective visibility with bounded sample/count probes instead of inferring access from permission names alone.
- [ ] Return a comparison matrix by record family, operation, visible count, restriction reason, and tested identity.
- [ ] Detect risky permission combinations without modifying roles.
- [ ] Keep role changes, action approvals, and consent outside MCP unless explicitly initiated by a provider-approved operation plan.

### Acceptance Gate

- [ ] Authentication failures distinguish expired authorization, revoked refresh token, wrong account, disabled integration, role restriction, and unreachable endpoint.
- [ ] No credential value is emitted or logged.
- [ ] Role comparison is read-only and bounded.

---

## Phase 3: Record Explorer, Batch Read, Transaction Graph, and Evidence

### Features

- `ns_listRecordTypes`, `ns_describeRecordType`, `ns_listRecordFields`, `ns_describeField`, and `ns_findFieldByLabel`.
- `ns_findRecordByExternalId` and batch internal-ID resolution.
- `ns_batchGetRecords` and `ns_getRecordWithSublists`.
- `ns_getTransactionChain` covering orders, invoices, fulfillments, receipts, returns, credits, payments, and related integration records.
- `ns_getSystemNotes` and `ns_explainRecordHistory`.
- `ns_getTransactionEventStream` preserving NetSuite's returned event sequence and original values; the MCP does not synthesize chronology.
- `ns_diagnoseTransaction` and ranked root-cause hypotheses with evidence references.
- Record snapshot, diff, and evidence bundle primitives.

### Implementation Units

- [x] Build metadata adapters that prefer REST metadata and fall back to permanent SuiteScript discovery for unsupported record families.
- [x] Implement bounded batch reads with per-record success/error results.
- [x] Build transaction graph edges from `createdfrom`, applying transactions, links, and configured integration references.
- [x] Return graph nodes and edges plus a compact human-readable tree.
- [x] Map System Notes into typed field-change events in NetSuite-returned sequence while preserving original values.
- [x] Do not sort, merge, shift, infer, compare, normalize, or rewrite any date/time value.
- [x] Build evidence references that point to record IDs, searches, script logs, files, and audit events.
- [x] Add `ns_createEvidenceBundle` with manifest, hashes, redacted payloads, and deterministic file layout.

### Acceptance Gate

- [x] A sales order query returns its complete available transaction chain in one call.
- [x] Missing permissions produce partial results with explicit gaps.
- [x] Evidence claims always cite source records or logs.

---

## Phase 4: Safe SuiteQL, Pagination, Jobs, Export, and Incremental Read

### Features

- `ns_buildSuiteQL`, `ns_validateSuiteQL`, `ns_explainSuiteQL`, and `ns_runSuiteQLPaged`.
- Keyset/cursor pagination with `nextCursor`, `hasMore`, and `truncated`.
- Query field validation, row caps, cost warnings, timeout estimates, and sensitive-data classification.
- `ns_batchResolveInternalIds` and generic bounded batch reads.
- Job status, progress, checkpoints, resume, cancellation, partial failures, and operation budgets.
- `ns_incrementalExport` with opaque checkpoints.
- `ns_exportSuiteQL` and `ns_exportSavedSearch` to streamed CSV, JSONL, and compressed resources.
- Saved Search definition export, diff, and clone preview.

### Implementation Units

- [x] Parse and validate supported SuiteQL statements; reject mutation statements and unbounded requests.
- [x] Implement signed opaque cursors containing query fingerprint and keyset position, not raw secrets.
- [x] Create `src/jobs/job-store.ts` with explicit states: queued, running, partial, completed, failed, cancelled.
- [x] Chunk calls by NetSuite governance limits and persist resumable checkpoints.
- [x] Stream large exports instead of embedding them in MCP text responses.
- [x] Record row counts, truncation, partial failures, and checkpoint metadata in the standard output schema.

### Acceptance Gate

- [x] Large reads never depend on offset-only pagination.
- [x] Jobs resume without repeating completed chunks.
- [x] Cancellation stops future chunks and preserves completed-result evidence.

---

## Phase 5: SuiteScript Observability, Dependency Graph, and Source Audit

### Features

- Native script/deployment discovery without requiring caller-supplied Saved Search IDs.
- Recent executions, script errors, Map/Reduce progress, scheduled-script status, stuck-script detection, and governance usage.
- `ns_analyzeScript`, `ns_findScriptDependencies`, `ns_findRecordWriters`, `ns_findRecordReaders`, and `ns_findFieldUsage`.
- Workflow, form, saved-search, deployment, file, and custom-field dependency edges.
- Source scanning for hardcoded credentials, destructive calls, ignored mandatory fields, unbounded pagination, missing governance checks, duplicate creation risk, and exposed external secrets.
- Duplicate-logic detection across scripts.

### Implementation Units

- [x] Add permanent script-observability RESTlet actions backed by supported script, deployment, and execution-log searches.
- [x] Parse AMD `define` dependencies and known SuiteScript API calls into an indexed dependency graph.
- [x] Add conservative static rules with evidence lines and severity; never claim full semantic proof from regex alone.
- [x] Scan secrets locally and return redacted fingerprints, never secret contents.
- [x] Correlate script executions with affected records and operation audit IDs where evidence exists; otherwise return explicit gaps.

### Acceptance Gate

- [x] Script tools work with script/deployment IDs directly.
- [x] Every finding includes file, line, rule, severity, and evidence.
- [x] Unsupported dependency types are reported as unknown rather than inferred.

---

## Phase 6: Integration Health, Reconciliation, Replay, Shadow, and Canary

### Features

- Integration health summaries, failed jobs, grouped errors, stale integrations, processed/pending counts, and output freshness.
- Cross-system reconciliation for orders, inventory, returns, payments, and record counts.
- Record-level classifications: missing, extra, amount mismatch, status mismatch, quantity mismatch, duplicate, and delayed processing.
- Integration contract definitions and validation.
- Payload replay in sandbox or simulation mode.
- Shadow execution that produces the would-be NetSuite record without saving.
- Canary deployment prepare, monitor, promote, and abort.
- Synthetic transaction generation and anonymization.
- Regression test generation and execution.
- Event subscriptions/webhooks, incremental cursors, and integration-failure alerts.
- Event correlation and business SLA monitoring.

### Implementation Units

- [x] Define adapter interfaces for NetSuite and external sources; keep credentials in provider-owned secret storage.
- [x] Build reconciliation around canonical records with source evidence and deterministic match keys.
- [x] Store integration contracts as versioned schemas with required fields, mappings, and invariants.
- [x] Run replay and shadow modes with writes disabled and return record diffs.
- [x] Restrict canaries by explicit record predicate and maximum count; promotion remains a provider-approved operation.
- [x] Group related failures into incidents using shared execution, script, record, and integration evidence.
- [x] Emit webhook events through an outbox with retries and idempotency.

### Acceptance Gate

- [x] Reconciliation totals link to record-level differences.
- [x] Replay and shadow modes cannot save NetSuite records.
- [x] Canary promotion requires a prepared operation and explicit harness approval.

---

## Phase 7: Customization Inventory, Drift, Deployment, and Migration

### Features

- Complete customization inventory for custom records, fields, lists, scripts, deployments, workflows, forms, searches, roles, integrations, bundles, and SuiteApps.
- Schema/customization drift detection.
- Sandbox-production comparison without date/time comparison or normalization.
- SuiteScript deployment prepare, deploy, monitor, and rollback/compensation planning.
- Checksum validation, sandbox-first workflow, canary support, and dependency verification.
- Cross-account migration planning and internal-ID dependency mapping.
- Customization ownership, orphan detection, technical-debt scoring, unused customization discovery, and cleanup plans.
- Automatic system documentation generation.

### Implementation Units

- [x] Build a canonical customization model with stable script IDs and checksums.
- [x] Compare environments by script ID, definition, deployment state, permissions, and dependencies.
- [x] Generate SuiteCloud projects from selected, checksum-pinned customization sets.
- [x] Require validate, preview diff, deployment operation plan, and post-deploy verification.
- [x] Store owner, business owner, technical owner, criticality, and provenance as metadata without inventing values.
- [x] Produce cleanup plans only; deletion remains a separate prepared operation.

### Acceptance Gate

- [x] Environment diff never relies on internal IDs alone.
- [x] Deployment reports uploaded files, changed objects, validation warnings, and live version verification.
- [x] Rollback claims are limited to restorable files/objects with verified previous content.

---

## Phase 8: Business Semantic Layer, Metrics, Query Planning, and Lineage

### Features

- Business term definitions and field resolution.
- Versioned metric catalog with definitions, formulas, exclusions, currencies, owners, and lineage.
- Natural-language business query planning, preview, validation, and execution.
- Metric comparison and definition drift.
- Data lineage from metric/report cells to NetSuite records, source integrations, searches, and query versions.
- Direct analytical exports and evidence-backed reports.

### Implementation Units

- [x] Store business terms and metrics as versioned declarative definitions, never hardcoded account assumptions.
- [x] Compile supported definitions into validated SuiteQL/search plans.
- [x] Return the planned tables, fields, filters, formula, and exclusions before execution.
- [x] Attach lineage nodes and evidence references to every metric result.
- [x] Require explicit user-provided definitions for ambiguous terms such as sales, stock, margin, return, and active item.

### Acceptance Gate

- [x] The same metric version produces the same query plan for the same schema.
- [x] Ambiguous business terms never silently choose a definition.
- [x] Every reported number links to its formula and source evidence.

---

## Phase 9: Process Mining, Rule Discovery, Data Quality, Invariants, and Simulation

### Features

- Business-process discovery, process variants, bottlenecks, and incomplete transaction chains.
- Business-rule discovery from scripts, workflows, forms, searches, and field configuration.
- Field-write conflict analysis and execution-context evidence.
- Data-quality profiling, anomalies, and master-data validation.
- Business invariants and pre/post-operation checks.
- Policy evaluation metadata for provider/harness enforcement.
- Downstream-impact simulation.
- GL-impact preview and explanation.
- Inventory digital twin and inventory-state simulation.
- Channel allocation simulation based on user-supplied business inputs.
- Ranked root-cause hypotheses with confidence and evidence.

### Implementation Units

- [x] Build process graphs from transaction chains and event evidence, preserving unknown gaps.
- [x] Extract candidate business rules with source locations and confidence levels.
- [x] Detect multiple writers to the same field and report ordering evidence when available.
- [x] Implement declarative data-quality rules and invariant checks with severity and remediation suggestions.
- [x] Keep policy decisions in harness-controlled configuration; SuperMCP returns policy facts and evaluation results.
- [x] Use NetSuite-provided GL impact where available and label estimates explicitly.
- [x] Keep simulations isolated from commit paths and require explicit scenario inputs.

### Acceptance Gate

- [x] Discovered rules are labeled as observed, inferred, or configured.
- [x] Simulations never mutate NetSuite.
- [x] Root-cause rankings include contradicting evidence and uncertainty.

---

## Phase 10: Runbooks, Bounded Repair, Incident Correlation, Evidence, and Documentation

### Features

- Versioned diagnostic and operational runbooks.
- Runbook preview and step-by-step execution.
- Repair proposals and provider-approved bounded repairs.
- Incident correlation across scripts, integrations, records, jobs, files, and alerts.
- SLA measurement and alerting.
- Evidence bundles suitable for internal review or vendor support.
- Automatic architecture, script, field, role, search, mapping, transaction-flow, and runbook documentation.
- Conversation-safe evidence memory with claim, evidence, confidence, and supersession.

### Implementation Units

- [x] Represent runbooks as typed steps referencing existing tools and operation plans.
- [x] Require preview output for every mutating runbook step and stop on changed evidence.
- [x] Limit self-healing to configured low-risk repair classes; financial and destructive operations always return proposals.
- [x] Correlate events using deterministic identifiers before probabilistic similarity.
- [x] Build evidence bundles with manifests, hashes, redaction reports, and reproducible queries.
- [x] Regenerate documentation from live metadata and version it with source fingerprints.

### Acceptance Gate

- [x] Runbooks are resumable and auditable.
- [x] Repairs cannot bypass the Phase 0 operation protocol.
- [x] Evidence memory updates prior claims instead of silently contradicting them.

---

## Phase 11: Harness-Controlled Profiles, Budgets, Approvals, and Tool Composition

### Features

- Provider-selected catalog profiles: read, preview, and operations.
- Task-level allowed actions, record types, and field sensitivity supplied by the harness.
- Operation budgets for calls, rows, records, governance units, and runtime.
- Sensitivity annotations and secret/PII redaction.
- Approval metadata and approver-resolution hooks without building an approval UI into MCP.
- Composite tools assembled from existing typed tools and versioned runbooks.

### Implementation Units

- [x] Define a signed harness context contract and reject unsigned scope claims when verification is configured.
- [x] Filter the exposed tool catalog according to the harness-selected profile; do not infer profiles from the model prompt.
- [x] Enforce resource budgets independently of consent and report remaining budget in structured metadata.
- [x] Annotate sensitive fields and redact secrets unconditionally; let approved harness policies decide whether non-secret PII is shown.
- [x] Expose approval requirements and callbacks while leaving the user interaction to ChatGPT, Claude, Codex, or another harness.
- [x] Implement `ns_createCompositeTool` as a versioned runbook definition with schema validation, cycle detection, and no arbitrary code execution.

### Acceptance Gate

- [x] Different harnesses can expose different profiles without changing NetSuite credentials.
- [x] Budget exhaustion is deterministic and resumable.
- [x] Composite tools cannot introduce undeclared inputs, tools, or mutation paths.

---

## Cross-Phase Test Strategy

- Unit tests for every schema, canonicalizer, fingerprint, cursor, error mapping, and policy fact.
- MCP protocol tests for tool discovery, input validation, structured output, and audit events.
- SuiteScript contract tests that compare MCP action registries with permanent RESTlet action maps.
- Simulation tests for prepare/preview/commit proving prepare and preview never save.
- Idempotency and stale-state regression tests for every mutation family.
- Read-only live probes against production with bounded IDs and row limits.
- Mutation integration tests only in an explicitly configured sandbox account.
- SuiteCloud validation before every deployment.
- Live `ns_getSuperMcpVersion` verification after deployment.
- Cached ChatGPT app schema refresh/recreate instructions in every release note when contracts change.

---

## Release and Documentation Requirements

Every phase must update:

- `README.md`
- `docs/client-setup.md`
- `docs/deployment.md`
- Generated tool contract reference
- Migration notes and compatibility notes
- `src/version.ts`, `package.json`, smoke expectations, and RESTlet version
- SuiteCloud file manifest and RESTlet contract checker
- Changelog with security, behavior, and schema changes

Release order for each phase:

1. Run focused tests.
2. Run `bun run prepack`.
3. Generate and validate the SuiteCloud project.
4. Deploy permanent RESTlet modules.
5. Verify live version and read-only capabilities.
6. Publish the npm package.
7. Push the tagged GitHub release.
8. Refresh or recreate cached ChatGPT app tool definitions as required by the workspace plan.

---

## Immediate Execution Order

The first implementation cycle must execute only these items:

1. Phase 0.1 direct-commit removal.
2. Phase 0.2 typed single-use operation plans.
3. Phase 0.3 snapshot fingerprint checks.
4. Phase 0.4 fulfillment idempotency and explicit lines.
5. Phase 0.5 preview and compensation planning.
6. Phase 1 typed contracts for transaction operations and standard errors.

No later phase begins until accidental fulfillment, invoice, receipt, bill, delete, retry, file mutation, search mutation, mapping mutation, and inventory mutation paths are covered by the same safety invariant.

---

## Self-Review

- [x] All requested feature families are assigned to a phase.
- [x] Date/time normalization and account-specific date behavior are explicitly excluded.
- [x] Moneta-specific behavior is explicitly excluded.
- [x] NetSuite role authorization remains authoritative.
- [x] Harness consent remains authoritative.
- [x] Accidental production mutation prevention is the first release gate.
- [x] Independent subsystems are split into phases that require their own executable implementation plans.
- [x] No phase depends on temporary SuiteScript creation.
- [x] No rollback claim exceeds NetSuite's actual reversibility.
