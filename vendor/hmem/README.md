# Vendored: H-MEM reference implementation

This folder contains third-party code, used by the "already reported" check of the 3NET News Agent.

| | |
| --- | --- |
| Upstream | https://github.com/Meterless/Meterless, path `engines/hmem/reference` |
| Commit | `1742dec56a66e58eef9dda2d2b865823758ca8cd` (latest on `main` when downloaded) |
| Downloaded | 2026-10-23 via degit |
| Version | 0.1.0 (`@meterless/hmem-reference`) |
| License | Apache-2.0, see [LICENSE](LICENSE) |

## What is unchanged

These files are copied byte for byte from upstream and must not be edited here:

- `src/*.ts` (from `engines/hmem/reference/src/`)
- `AGENTS.md` (the H-MEM spec)
- `LICENSE`
- `conformance/runner.ts`, `conformance/README.md`, `conformance/vectors/vectors.json`

## What is ours

- `README.md` (this file)
- `tsconfig.json`: type-check settings for the vendored code (upstream settings plus Node types). The project's own `tsconfig.json` uses stricter options and does not include this folder.

## Conformance

`npm run conformance` runs the vendored suite against the vendored engine (`HMEM_IMPL` = `vendor/hmem/src/index.ts`).
