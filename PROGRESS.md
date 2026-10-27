# Progress log

Newest entries first. One entry per working day: what was done, what was decided, what is open.

## 2026-10-27 (build day 4)

**Done**
- Checked that the last commit of 2026-10-26 (`5b4bb51`) is on `origin/main`.
- `npm test`: 126 tests green, no network. `npm run conformance`: 13/13.
- README checked section by section against `src/`, `config/`, `scripts/`, `test/` and `package.json`, then corrected (commit `59727c1`): test count in the quick start (126 instead of 83); architecture diagram with real summaries, the newsletter output (localhost SMTP only) and the DATEV calendar as second source with the rule-based maintenance windows; rate and summarise marked as live with `RATER=nightshift`, stub by default; latency of newsletter calls (40–115 s); where measurement results are written; repository layout (`assets/`, maintenance calendar port, report from run log, ICS fixture, scripts); data sources with the DATEV calendar row, summaries no longer "planned".
- `docs/sponsor-statement.md` checked; it matches the code, no change.
- README quick start completed (commit `1dc6f7c`): `npm run typecheck` and `npm run conformance` (13/13); the stub run uses three fictional items, two reach the stub model; note on the harmless `fsevents` allow-scripts warning on macOS; live runs on Windows 11 (PowerShell), clean-setup check (stub run, tests, conformance) on macOS with Node 24.

**Decided**
- Measurement numbers stay as reported in the README; raw results stay in `data/out/measure-<timestamp>.json`, not in the repository.
- Feature freeze continues: documentation only.

**Learned**
- The Mermaid diagram cannot be validated locally without installing a tool; it was checked by hand.

**Open**
- Check that the architecture diagram renders on GitHub.
- Terms of use of the Microsoft 365 Roadmap and the DATEV calendar are under review.
- Still open from 2026-10-26: rubric change for small features in core products (new labelled round); Nightshift app policy and cached answers.

## 2026-10-26 (build day 3)

**Done**
- Checked that Friday's commits are on `main` (same-day default for maintenance windows, `.env.example`).
- Test-set measurement (`scripts/measure-testsets.ts`): human labels from two rounds (`data/testsets/`, not in the repository), saved snapshot of 2026-10-23, prefilter as of each rating date with VF-NEU and VF-LIMIT off, M=3 and M=4, rating with the rating date as "today". 21 ratings, none failed. Result: recall 100 % on both rounds (no relevant item missed), precision 86 % on the calibration set and 20 % on the holdout set, accuracy 93 % / 73 %. Validity notes in the report; results in the README.
- Newsletter mail (`OUTPUT=newsletter`): mail-safe HTML (tables, 600 px, inline CSS, no external resources, no tracking) with plain-text part and CID logo, dark theme from the logo colors (WCAG AA checked by a test), English and German labels. Written to `data/out/`, sent only to a local SMTP catcher (Mailpit); other hosts are refused unless explicitly allowed.
- Real summaries: own prompt and strict JSON answer (`summary`, `whyItMatters`), same markers as the rating, copy check (8 consecutive words), one retry; only for items above the threshold. The rating prompt is unchanged.
- Two audiences (`NEWSLETTER_AUDIENCE`): `reviewers` (draft with score badge, components and the agent's reasoning) and `customers` (approved version with availability line, without scores, reasoning or run details). Polish after review: compact badge, muted reasoning, roadmap link, one line per maintenance window.
- Live runs to Mailpit with 573696 (score 8 = 7 + 1, summarised) and 577819 (score 0, not summarised); the second run with the DATEV calendar showed the windows on 1 Nov and 29 Nov.
- `scripts/render-newsletter.ts` renders both audiences again from a run log and its snapshot without model calls; used to send both versions to Mailpit.
- Mailpit HTML check: supported 93.5 % before, 95.3 % (reviewers) and 94.6 % (customers) after the fixes for Outlook and Gmail.
- Screenshots of both newsletter versions in Mailpit (team), shown in the README (customer version near the top, review draft in the newsletter section); replaced after the signature was added, alt texts updated.
- Newsletter signature (`NEWSLETTER_SIGNATURE_PATH`) above the footer in both audiences: small logo, company details, website and email as the only links (`https:` and `mailto:`), legal lines and privacy link in small muted text. DATEV Solution Partner badge (`NEWSLETTER_PARTNER_LOGO_PATH`) next to it as a second inline image, unchanged, on a light tile. Real files under `data/brand/`; the repository has only `config/signature.example.json` with placeholders. Both audiences re-rendered from the last run to Mailpit; HTML check 95.1 % (reviewers) and 94.7 % (customers).
- Sponsor technology statement for the submission form (rule 6.4) in `docs/sponsor-statement.md`; the README section "Sponsor technology and AI tools" aligned with it, phase table updated.
- Run without sponsor components: a run with stub source and stub rater produced run report and newsletter end to end (no Zetaris, Nightshift or H-MEM). The README states that `npm run run` without any configuration uses the stub adapters (section "Architecture").
- 126 tests green, type check clean.

**Decided**
- Measurement: failed ratings count as "not relevant"; ratings use the rating date as "today".
- The measurement is reported as it is. The rubric is not changed now; a change for small features in core products is measured on a new labelled round, so the holdout result stays independent.
- Recall matters more than precision: a person reviews every draft, a missed item never reaches the reviewer.
- Summary and "Why this matters" are for readers; the rating reasoning is shown to reviewers only.
- A failed summary keeps the item in the newsletter without summary; the run continues.
- Language mix documented instead of coupled: for a fully German draft set `RATING_LANGUAGE=de` as well.
- `nodemailer` 10.2.1 (MIT-0) and `@types/nodemailer` 8.0.2, pinned to exact versions.
- The roadmap link is shown in both audiences.
- `.env.example` is maintained by the team.
- Signature: phone as plain text; unknown fields are rejected, so no event or marketing banners can be added. The partner badge is shown only together with a signature.
- Screenshots with the real signature and the partner badge may be in the public repository (the company posted the same on its LinkedIn account).
- Feature freeze after the signature commit; only docs from now on.

**Learned**
- All five false positives follow one pattern: a small feature in a core product gets `baseValue` 7, plus `actionBonus` 1 for "a concrete benefit once available"; the reasoning is near-identical across items.
- The two rounds were labelled with different strictness (round 1 by a domain expert, round 2 by the team).
- M=3 and M=4 give the same result on the test sets; the choice of M is not decidable from them.
- VF-HORIZONT counts whole months inclusive; this was decided after the holdout case 573696 was known, so the holdout result for that rule is not fully independent.
- Routing stays: in the measurement 18 of 21 answers came from `nemotron-3-ultra-550b-a55b`, 2 from `nemotron-3.5-super-vl-120b-a12b`, 1 from the requested model; all newsletter calls were answered by the ultra model. 40-115 s per call.
- The maintenance look-ahead counts the window start: with 30 days on 2026-10-26 the window of 29 Nov is not included.
- `formatRange` in ICU puts thin spaces around the range dash in English; tests must not expect a plain dash.
- `process.loadEnvFile` does not override variables already set in the environment, so per-run settings on the command line take precedence over `.env`.

**Open**
- Rubric change for small features in core products, measured on a new labelled round.
- Nightshift: check in the console whether the app policy can pin a model; check whether Meterless serves cached answers.
- Repository license.
- ~~Sponsor tech and tools statement for the submission (rule 6.4).~~ Done (`docs/sponsor-statement.md`).
- Check the Rules channel for changes to 5.1/6.4.
- Ask Zetaris mentors about the view error.
- Maintenance windows, edge case: a release on a Sunday after the window has started.
- Record the demo video (storyboard ready).
- Finish the slide deck (update the test count to 126).
- ~~Optional: DATEV partner logo in the newsletter, only with an official file and permission.~~ Done (badge in the signature, file under `data/brand/`).
- Customer version: drop the source-code link for the internal version.
- Internal submission and status to the CTO.
- Build window ends on 2026-10-27: submission.

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
- 83 tests green.
- Live two-run demo recorded: run 1 rated 573696 (score 8, answering model `nvidia/nemotron-3-ultra-550b-a55b`, receipt `rcpt_req_jk2wk5mu`) and remembered it; run 2 skipped it as already reported (`via url`, record `mem-1`) without calling the model.
- README rewritten for the jury: pitch and impact, "explain why" with a real rating example, architecture diagram, pipeline status, prefilter and scoring, model routing, H-MEM with proof, sponsor technology, quick start, testing, security, limitations. 3NET logo and a screenshot of the run report added under `assets/`.
- DATEV maintenance windows: update dates from a local ICS file (`DATEV_MAINTENANCE_ICS_PATH`, kept under `data/`, not in the repository), tolerant parser without a new dependency, window rule computed in code (no model, no network). The run report lists upcoming windows with the update, the window and the rule ("why this window"). Checked: update on 2026-04-16 gives the window Sunday 2026-04-19 19:00 to Monday 2026-04-20 07:00. Tests use a synthetic ICS fixture; the real file read 13 events and 3 upcoming windows (400-day look-ahead).
- README "Why it matters" sharpened: 3NET as DATEV solution partner (linked to the DATEV consulting page on 3net.de), the manual reading effort as the problem, human review of the explained selection, and the pipeline growing by source adapters and relevance profiles.

**Decided**
- `RATING_STRICT_MODEL=false` for development; the answering model is logged per rating.
- VF-HORIZONT is configurable; measured with M=3 and M=4 (option C).
- VF-PRODUCT with the out-of-scope product list in the relevance profile (`config/profile.m365.json`), not in code.
- The 3NET logo may go into the repository (team decision); newsletter design on Monday.
- Storage: the "already reported" state lives in H-MEM under `data/memory/`; run logs and snapshots are JSON files under `data/`; Zetaris stays read-only.
- VF-NEU window 8 days (overlap is handled by the memory check; gaps are worse).
- `MEMORY_MARK` is off by default, so test runs do not block items.
- Rating reasoning in English for the hackathon (`RATING_LANGUAGE=en`).
- Maintenance window rule as our practice: first Sunday on or after the update date, 19:00 to Monday 07:00 (Europe/Berlin); a release on a Sunday is installed that evening (`DATEV_MAINTENANCE_SAME_DAY=true`, default). Weekday, times, time zone and look-ahead are configurable.
- DATEV may be named in code and docs (3NET is a DATEV partner, public on the company website).
- Commit authors are history metadata: a team member who builds a block may be named as its author with consent; the rule against personal data in code and docs is not affected.

**Learned**
- npm records approved dependency install scripts in the `allowScripts` field of `package.json`. Approving single packages pinned to their version keeps control over what runs during install (supply-chain security).
- Nightshift coerces a concrete model id to `meterless/auto`: a learned router races 3 candidates and picks one (confirmed by the receipt metadata in the response; the hint came first from another participant, not official).
- The hypothesis that an unregistered app name causes the routing was disproved by the live check: with the registered app name the requests were still routed.
- `/no_think` as first system message had no clear effect (still about 1,700 characters of extra text, 25-30 s per rating).
- The H-MEM reference embedder is a hash of words: identical titles are often different platform or cloud variants, and one-character words are ignored. Similarity therefore compares title, platforms and clouds, with a strict threshold.
- The roadmap URL pattern `?id=<id>` was verified in the browser.
- `created` is not the announcement date (many items share timestamps from bulk updates); VF-NEU therefore uses `modified`.
- The DATEV update calendar has date-only start dates, and all 13 DTSTAMP values carry seven digits in the time part; the parser warns once and ignores DTSTAMP.

**Open**
- ~~Check that `npx tsx --version` runs.~~ Works.
- ~~TypeScript scaffold, M365 ingestion via Zetaris, H-MEM reference test, Nightshift model adapter, prefilter with rule IDs.~~ Done.
- Nightshift: check in the console whether the app policy can pin a model; ratings take 30-80 s per item.
- ~~Real summaries (summarise is still a placeholder), newsletter output (HTML mail to a local SMTP catcher), test-set measurement with the rating date (round 2: 2026-10-19).~~ Done on 2026-10-26.
- ~~README: update the step table and repository layout to the current state.~~ Done with the README rewrite.
- In the demo the reasoning for 573696 was word for word the same as in an earlier run, although another model answered; check whether Meterless serves cached answers.
- ~~DATEV ICS source with the maintenance window rule (neutral example).~~ Done.
- Maintenance windows, edge case: a release on a Sunday after the window has started (ICS dates are usually date-only, so the release time is unknown).
- ~~README "Why it matters": DATEV partner wording and link from 3net.de (Monday).~~ Done.
- ~~Prove a run without sponsor components.~~ Done on 2026-10-26 (stub source and stub rater, run report and newsletter).
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
