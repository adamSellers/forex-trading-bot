# Node.js tooling and language policy

The user requires no Python in any project. The instruction is saved permanently
in `~/.codex/AGENTS.md` and recorded in this repository's `CLAUDE.md`. Research,
analysis, tests, deployment and maintenance use the established Node.js/shell
runtime. Trading strategy, risk settings and timestamp meanings remain unchanged.

## Current tools

The input audit and experiment protocol are ported to Node.js. Existing schema,
coverage arithmetic, candidate validation and trial-ledger semantics are retained.
Tool identity/runtime metadata truthfully identify the replacement. The Node audit
uses a new default report path so the original historical audit is retained.
Explicit output paths retain the prior caller-directed write behavior.

The existing native SQLite dependency uses its Node prebuilt binary. Maintenance
runtime loading forces node-gyp's interpreter command to `/usr/bin/false`, which
disables its Python discovery/source-build fallback. If a suitable prebuilt binary
is unavailable, dependency preparation fails before cutover. No Python installation
is a recovery step. The forced-command behavior is verified against the bundled
Node 22.16.0 npm source and its actual finder.

Operational JSON, process-lock and filesystem checks use Node.js. Backup and
restore retain their SQLite integrity/lifecycle checks, matched snapshots, bounded
operations, archive path/link/credential restrictions, pause/broker preflights,
atomic moves and recovery behavior. The one-command deployment workflow stays
local development → GitHub → deployment from the published revision.

Actual GNU, PAX and USTAR archives, including extended UTF-8 paths, are covered.
GNU sparse tar encodings are unsupported by the Node parser and are rejected
before extraction; they must not be accepted as ordinary file payloads. The current
backup producer does not request sparse encoding. Database-only restore into
current reviewed source remains available. This is a documented archive-format
compatibility limit, not a claim of general parity with every retired parser format.

## Historical sources and evidence

Fifteen old one-off analysis/preparation scripts are retired from the current tree.
Their exact sources remain in Git at
[`af2c14da80255b07b9415af6430a476da1ff9507`](https://github.com/adamSellers/forex-trading-bot/tree/af2c14da80255b07b9415af6430a476da1ff9507/docs/reviews/evidence).
Historical reports, raw/reduced observations, numerical results, manifests and
original source hashes are retained. Their provenance is not relabelled as a
Node.js calculation. Historical source inspection is distinct from rerunning a
study; no current Python execution path is provided.

Older source archives retain their original tooling. Use database-only recovery
into current Node.js source to preserve the language policy. Current restore guards
retain their invoking Node helper outside the candidate across cutover, so accepted
older archives do not remove the guard while replacing the installation.

Current offline evaluation continues through the Node.js research tools. Reusing
an old study calculation requires a validated Node.js implementation, rather than
executing retired code or treating a source archive as a current project tool.

## Validation and delivery

Validation records the converted research and operational scenarios, full backend
regression, source inventory, input audit comparison and deployment state. A passed
fixture is not a real restore drill or evidence of trading profitability.

Independent integration review corrected the staged native dependency lookup,
immutable verification of standalone WAL-format snapshots, streaming tar descriptor
ownership and the helper's lifetime across source replacement. Snapshot bytes and
sidecars remain unchanged during verification; live WAL uncertainty remains visible.

The [retained validation](evidence/2026-10-06/tooling/node-tooling-validation.json)
records 1,229 passing backend tests across 65 suites, including 31 converted
research-tool tests; 57 deployment/restore cases; 21 health scenarios; and all
backup regressions. Interpreter sentinels recorded no invocation. The full Node
audit contains 7 instruments and 1,147,442 candles with zero structural problems;
all non-tool fields exactly match the preserved audit. The new versioned replay
manifest pins 107 source files. Its coarse historical snapshot exactly matches
the prior reviewed capture, with zero observed network attempts. These are
contract and software checks, not a profitability result.

Tooling `ed18345` and the native dependency correction `9b3785b` were committed
locally and published to GitHub. The existing deployment command completed
successfully at clean `9b3785b`.

### Observed native installation correction

The first deployment of published `ed18345` stopped during dependency preparation:
the locked `better-sqlite3` 9.6.0 did not supply a Node 22 Linux ARM64 binary.
The interpreter guard rejected the source-build fallback; deployed `810c7f9`,
healthy enabled intent, run selection and loss/cooldown state were preserved.
The [failure capture](evidence/2026-10-06/tooling/prebuilt-native-correction.json)
records this observed limit.

The correction pins `better-sqlite3` 11.10.0, whose [official assets](https://github.com/WiseLibs/better-sqlite3/releases/expanded_assets/v11.10.0)
include Node ABI 127 binaries for both Darwin ARM64 and Linux ARM64. This changes
the native SQLite library to 3.49.2; project schemas and SQL APIs remain the same.
The [release notes](https://github.com/WiseLibs/better-sqlite3/releases/tag/v11.10.0)
reject Promise-returning native transaction callbacks; project asynchronous
transactions use Knex BEGIN/COMMIT instead of that synchronous native helper.
A clean local install succeeded with the interpreter guard and sentinels active.
The versioned `-node-sqlite` replay manifest preserves the previous `-node`
checkpoint rather than rewriting its package hashes.

The corrected dependency passes a fresh 1,229-test/65-suite backend regression,
57 deployment/restore cases, 21 health scenarios and all backup regressions.
The historical replay snapshot exactly matches the earlier native version,
with zero observed network attempts; interpreter sentinels remain unused.

### Production verification

The [post-deployment capture](evidence/2026-10-06/tooling/deployment-verification.json)
verifies clean `9b3785b`, Node 22.16.0/ABI127 with native SQLite 3.49.2, healthy
enabled operation and zero current project Python files outside Git/dependencies.
The target passed 1,229 backend tests across 65 suites, the frontend build,
matched source/database backup and operational health checks. The same v5
strategy 1.3.0, 0.25% risk, run/config identity and one-loss/no-active-cooldown
state were preserved. The account was flat/resolved at A$95.2621 in this dated
capture. No test order was submitted.

This final documentation is a separate publication after deployment; it does not
require another runtime restart. Future research and maintenance must use Node.js
or shell under the permanently saved cross-project policy.
