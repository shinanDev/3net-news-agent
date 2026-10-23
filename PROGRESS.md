# Progress log

Newest entries first. One entry per working day: what was done, what was decided, what is open.

## 2026-10-23 (build day 2)

**Done**
- Node.js installed.
- Dev dependencies installed: `typescript`, `tsx`, `@types/node` (see `package.json`).
- npm reported that `esbuild@0.28.2` (needed by `tsx`) has a postinstall script not yet covered by `allowScripts`. Approved for exactly this version (`"esbuild@0.28.2": true` in `package.json`), not with `--all`.

**Learned**
- npm records approved dependency install scripts in the `allowScripts` field of `package.json`. Approving single packages pinned to their version keeps control over what runs during install (supply-chain security).

**Open**
- Check that `npx tsx --version` runs; if not, `npm rebuild esbuild`.
- TypeScript scaffold (ports & adapters), M365 ingestion via Zetaris REST with JSON snapshot, H-MEM reference test, Nightshift model adapter, prefilter with rule IDs.
- Decide where items and ratings are stored (Zetaris reads only).

## 2026-10-22 (build day 1)

**Done**
- Public repository created after the build window opened.
- Claude Code installed and connected to PyCharm; `.env` blocked for Claude Code and ignored by Git (both tested).
- Zetaris: Microsoft 365 Roadmap registered as a REST table; query with `LATERAL VIEW explode(value)` returns one row per roadmap item.

**Decided**
- Language: TypeScript.
- Meterless Engine: H-MEM for "already reported" (sleep cycle off; duplicate check by exact URL first, then similarity with its own threshold).
- Zetaris is used as read and query layer; writing rows via SQL is not documented.
- Model: `nvidia/nemotron-3.5-lightning-30b-a3b`, set explicitly.

**Learned**
- Without `accept` and `user-agent` headers, Microsoft answers the Zetaris request with HTTP 400 ("Bad Request").
- `CREATE SCHEMASTORE VIEW` on the REST table fails with "Bad Request"; the direct SELECT works.
- After a laptop restart the Zetaris `driver` container had exited (code 127); `docker compose up -d driver` fixed it.

**Open**
- ~~Install Node.js LTS.~~ Done on 2026-10-23.
- Ask Zetaris mentors about the view error.

## 2026-10-21 (setup before the build window, no project code)

- Zetaris installed locally; `verify.sh` 9/9, REST query `SELECT 1` successful.
- Meterless Nightshift installed; NVIDIA key added in Nightshift; request to `nvidia/nemotron-3.5-lightning-30b-a3b` answered, signed receipt in the Nightshift console.
