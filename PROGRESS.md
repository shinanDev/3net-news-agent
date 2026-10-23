# Progress log

Newest entries first. One entry per working day: what was done, what was decided, what is open.

## 2026-10-23 (build day 2)

**Done**
- Node.js installed.
- Dev dependencies installed: `typescript`, `tsx`, `@types/node` (see `package.json`).
- npm reported that `esbuild@0.28.2` (needed by `tsx`) has a postinstall script not yet covered by `allowScripts`. Approved for exactly this version (`"esbuild@0.28.2": true` in `package.json`), not with `--all`.
- TypeScript pipeline scaffold (ports and adapters): ingest, prefilter, memory check, rate, summarise, output; every stage is logged to `data/runs/<timestamp>.json`.
- Zetaris source: the Microsoft 365 Roadmap query runs through the Zetaris SQL editor API; the raw response is saved to `data/snapshots/` before mapping. Field mapping derived from a real response (2,163 items).
- Prefilter rules with rule ids and reasons: VF-NEU, VF-CLOUD, VF-STATUS, VF-PRODUCT, VF-HORIZONT, VF-LIMIT; `RATE_ITEM_IDS` to rate selected items only. On the 2026-10-23 snapshot 115 of 2,163 items reach the model.
- Nightshift rating adapter: the model returns components as strict JSON, the score 0-10 is computed in code with caps; invalid answers get one more attempt, failed items get no score. Per rating the answering model, latency and Meterless receipt id are logged.
- HTML run report in `data/out/`: items above and below the threshold, failed ratings, already reported items, prefilter summary per rule.
- First item above the threshold: 573696 (SharePoint: Copilot Search in SharePoint and OneDrive), score 8.
- H-MEM "already reported" done: reference vendored unchanged in `vendor/hmem/` (Meterless/Meterless, commit `1742dec`), exact URL first, then similarity with a strict threshold (0.999); conformance 13/13 and a two-run proof (the second run reports the item as already reported via URL).
- Meterless (sponsor) confirmed in the HackOS 'Help Meterless' channel (2026-10-23, 14:12) that the vendored H-MEM reference in a working feature satisfies the engine requirement.
- 71 tests green.

**Decided**
- `RATING_STRICT_MODEL=false` for development; the answering model is logged per rating.
- VF-HORIZONT is configurable; measured with M=3 and M=4 (option C).
- VF-PRODUCT with the out-of-scope product list in the relevance profile (`config/profile.m365.json`), not in code.
- The 3NET logo may go into the repository (team decision); newsletter design on Monday.
- Storage: the "already reported" state lives in H-MEM under `data/memory/`; run logs and snapshots are JSON files under `data/`; Zetaris stays read-only.
- VF-NEU window 8 days (overlap is handled by the memory check; gaps are worse).
- `MEMORY_MARK` is off by default, so test runs do not block items.
- Rating reasoning in English for the hackathon (`RATING_LANGUAGE=en`).

**Learned**
- npm records approved dependency install scripts in the `allowScripts` field of `package.json`. Approving single packages pinned to their version keeps control over what runs during install (supply-chain security).
- Nightshift coerces a concrete model id to `meterless/auto`: a learned router races 3 candidates and picks one (confirmed by the receipt metadata in the response; the hint came first from another participant, not official).
- The hypothesis that an unregistered app name causes the routing was disproved by the live check: with the registered app name the requests were still routed.
- `/no_think` as first system message had no clear effect (still about 1,700 characters of extra text, 25-30 s per rating).
- The H-MEM reference embedder is a hash of words: identical titles are often different platform or cloud variants, and one-character words are ignored. Similarity therefore compares title, platforms and clouds, with a strict threshold.
- The roadmap URL pattern `?id=<id>` was verified in the browser.
- `created` is not the announcement date (many items share timestamps from bulk updates); VF-NEU therefore uses `modified`.

**Open**
- ~~Check that `npx tsx --version` runs.~~ Works.
- ~~TypeScript scaffold, M365 ingestion via Zetaris, H-MEM reference test, Nightshift model adapter, prefilter with rule IDs.~~ Done.
- Nightshift: check in the console whether the app policy can pin a model; ratings take 30-80 s per item.
- Real summaries (summarise is still a placeholder), newsletter output (HTML mail to a local SMTP catcher), test-set measurement with the rating date (round 2: 2026-10-19).
- README: update the step table and repository layout to the current state.
- DATEV ICS source with the maintenance window rule (neutral example).
- Prove a run without sponsor components.
- ~~Logo: written approval from management and the file from an official internal source.~~ Approved; added as `assets/3net-logo.png`.
- Repository license.
- Check the Rules channel for changes to 5.1/6.4; screenshot of the 22.10 announcement.
- Sponsor tech and tools statement for the submission (rule 6.4).
- Ask Zetaris mentors about the view error.

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
