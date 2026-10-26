# 3NET News Agent

<img src="assets/3net-logo.png" alt="3NET logo" width="200">

A weekly news agent that reads the public Microsoft 365 Roadmap, drops what is irrelevant with transparent rules, scores the rest with NVIDIA Nemotron, remembers what was already reported, and writes a report in which **every decision carries its reason**: the rule that dropped an item, the score components and reasoning behind a rating, the model that answered, and why an item counted as already reported.

Built for the **Open Agent Hackathon 2026** (GenAI.Works), track **The Agent That Can Explain Why**.

> **Status:** working prototype, built during the build window (22–27 October 2026). Daily progress is logged in [PROGRESS.md](PROGRESS.md). Everything marked *planned* is not in the repository yet.

## Contents

1. [Why it matters](#why-it-matters)
2. [What "explain why" means here](#what-explain-why-means-here)
3. [Architecture](#architecture)
4. [Pipeline status](#pipeline-status)
5. [Prefilter rules](#prefilter-rules)
6. [Scoring](#scoring)
7. [Model and routing transparency](#model-and-routing-transparency)
8. [Measurement against labelled test sets](#measurement-against-labelled-test-sets)
9. [Already reported: H-MEM memory](#already-reported-h-mem-memory)
10. [Sponsor technology and AI tools](#sponsor-technology-and-ai-tools)
11. [Quick start](#quick-start)
12. [Testing](#testing)
13. [Security and data](#security-and-data)
14. [Limitations and next steps](#limitations-and-next-steps)
15. [Pre-existing components and third-party code](#pre-existing-components-and-third-party-code)
16. [Data sources](#data-sources) · [License](#license)

## Why it matters

Team 3NET (3NET GmbH, Hamburg) is an IT service provider and [DATEV solution partner](https://www.3net.de/leistungen/datev-consulting/) that wants to keep its customers informed about changes that matter to them. Today, preparing such a newsletter means experienced consultants reading vendor announcements by hand: time that is hard to plan and cannot be billed to customers. The Microsoft 365 Roadmap alone listed 2,163 items on 2026-10-23, and most of them concern products, clouds or roles our customers do not use.

The agent does the reading: it filters with rules, scores the remaining items for the target audience (end users and decision makers in small and medium-sized businesses using Microsoft 365), skips what was already reported, and explains every step. A person reviews the result before anything is sent, so the work shifts from reading everything to checking a short, explained selection.

The pipeline is built to grow: new sources and audiences are added as a source adapter and a relevance profile, not new code paths. Today it covers the Microsoft 365 Roadmap and DATEV maintenance windows; next are further DATEV topics and news about the services 3NET offers (planned).

| Phase | Goal |
| --- | --- |
| Hackathon prototype (now) | Pipeline with explainable decisions and an internal run report |
| Pilot (planned) | Weekly runs, review of the report by the team, calibration against labelled test sets |
| Customer newsletter (planned) | Newsletter draft built from the reviewed items |

<img src="assets/newsletter-customer.png" alt="Customer version of the newsletter in Mailpit: the item SharePoint Copilot Search with summary, why this matters, products and availability (preview October 2026, available January 2027), and two DATEV maintenance windows with the note that DATEV systems are not available" width="600">

*Customer version of the newsletter: summary, why it matters, availability, DATEV maintenance windows.*

## What "explain why" means here

Every decision in a run is recorded with its reason, in the run log (`data/runs/<run>.json`) and in the HTML run report (`data/out/<run>.html`):

| Decision | What is recorded |
| --- | --- |
| Item dropped by the prefilter | Rule id and reason, e.g. `VF-PRODUCT`: "all products out of scope: Power Automate" |
| Item rated | Score 0–10, its components (`baseValue`, `actionBonus`, `excluded`, `products`), the model's reasoning, the model that answered and its Meterless receipt id |
| Rating failed | Reason and number of attempts; the item gets no score |
| Item already reported | Stage that matched (`url` or `similarity`), the memory record and the similarity |

**Real example** from a run on 2026-10-23 (`RATE_ITEM_IDS=573696`):

| Field | Value |
| --- | --- |
| Item | 573696, "SharePoint: Copilot Search in SharePoint and OneDrive" |
| Prefilter | passed all rules |
| Components | `baseValue` 7 (a core product is the subject) + `actionBonus` 1 (concrete benefit for users), `excluded` false, products OneDrive, SharePoint |
| Score | **8** (computed in code: 7 + 1, cap for base 7 is 10) |
| Reasoning | "Copilot Search directly targets core Microsoft 365 products SharePoint and OneDrive, bringing AI-powered natural-language search to both. Preview begins this month (October 2026), giving users a concrete new capability to try without any required action." |
| Requested model | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| Answering model | `nvidia/nemotron-3.5-super-vl-120b-a12b` (from the Meterless receipt; in another run the same item was answered by `nvidia/nemotron-3-ultra-550b-a55b`, see [routing](#model-and-routing-transparency)) |
| Receipt id | `rcpt_req_xrxfo8v2` (the receipt signature is stored in the run log only) |

<img src="assets/run-report.png" alt="HTML run report of demo run 2: item 573696 skipped as already reported via url, prefilter counts per rule" width="600">

*HTML run report of the second [demo run](#demo-already-reported-across-two-runs) (2026-10-23): item 573696 was rated with score 8 in run 1 and is now skipped as already reported (`via url`, memory record `mem-1`); the prefilter table shows the drops per rule.*

## Architecture

```mermaid
flowchart LR
    MS["Microsoft 365 Roadmap<br/>public JSON API"] --> Z
    subgraph Sponsors[Sponsor components]
        Z["Zetaris<br/>Lightning REST table + SQL"]
        NS["Meterless Nightshift<br/>NVIDIA Nemotron"]
        HM["Meterless H-MEM<br/>vendored reference"]
    end
    Z -->|"1 fetch"| PF["2 Prefilter<br/>rules with ids"]
    PF --> MEM{"3 Already reported?"}
    MEM -->|"check url, then similarity"| HM
    MEM -->|new items| RT["4 Rate<br/>components to score"]
    RT -->|"strict JSON, no tools"| NS
    RT --> SU["5 Summarise<br/>placeholder"]
    SU --> OUT["6 Output<br/>HTML run report"]
    OUT -.->|"MEMORY_MARK=true"| HM
```

The pipeline is not an autonomous agent: the model only scores and summarises text. Each step talks to the outside world through a small interface (ports and adapters), so every sponsor component can be replaced:

| Port | Adapters in the repo | Without sponsor components |
| --- | --- | --- |
| `NewsSource` | `ZetarisNewsSource` (Microsoft 365 Roadmap via Zetaris) | `StubNewsSource` (`SOURCE=stub`) |
| `MemoryStore` | `HmemMemoryStore` (H-MEM) | `InMemoryMemoryStore` (`MEMORY=none`) |
| `RatingModel` | `NightshiftRatingModel` (Nemotron via Nightshift) | `StubRatingModel` (`RATER=stub`) |
| `Output` | `HtmlFileOutput` (run report), `NewsletterMailOutput` (mail draft, `OUTPUT=newsletter`) | `ConsoleOutput` (`OUTPUT=console`) |

All stub adapters are the defaults, so `npm run run` without any configuration runs the full pipeline on three fictional items without Zetaris, Nightshift or H-MEM.

## Pipeline status

| Step | What happens | Status |
| --- | --- | --- |
| 1. Fetch | Microsoft 365 Roadmap items are read through Zetaris (SQL over REST); the raw response is saved to `data/snapshots/` before mapping | Working |
| 2. Prefilter | Rules without AI, each with an id and a reason ([table](#prefilter-rules)) | Working |
| 3. Already reported? | Exact URL first, then similarity in H-MEM memory | Working (opt-in, `MEMORY=hmem`) |
| 4. Rate | Nemotron via Nightshift returns score components; the score is computed in code | Working |
| 5. Summarise | Nemotron via Nightshift writes a summary and "why this matters" for readers, only for items above the threshold | Working |
| 6. Output | HTML run report in `data/out/` | Working |
| 6b. Newsletter | Newsletter draft as HTML mail, written to `data/out/` and sent only to a local SMTP catcher ([details](#newsletter-draft)) | Working (opt-in, `OUTPUT=newsletter`) |
| Second source | DATEV update calendar (ICS file): upcoming maintenance windows with the rule that explains them ([details](#maintenance-windows)) | Working (opt-in, `DATEV_MAINTENANCE_ICS_PATH`) |

### Maintenance windows

With `DATEV_MAINTENANCE_ICS_PATH` the agent also reads a calendar of software update dates (an ICS file kept locally under `data/`, not in the repository). For each update it computes the maintenance window with a configurable rule, no model and no network involved: by default the **first Sunday on or after the update date, 19:00 to Monday 07:00 (Europe/Berlin)**. Example: an update on Thursday 2026-04-16 gets the window Sunday 2026-04-19 19:00 to Monday 2026-04-20 07:00.

This follows our practice: an update released on a Sunday (for example at 18:00) is installed in that evening's window. `DATEV_MAINTENANCE_SAME_DAY=false` gives it the following Sunday's window instead. Open edge case: a release on a Sunday after the window has started; ICS dates are usually date-only, so the release time is not known and the same evening's window is used.

The run report lists the windows within the next `DATEV_MAINTENANCE_LOOKAHEAD_DAYS` days (default 30), each with the update date, the update and the window, and states the rule as plain text ("why this window"). The parser is tolerant: malformed `DTSTAMP` values (seen in practice: seven digits in the time part) produce one warning and are ignored, events without a start date are skipped with a warning.

### Newsletter draft

With `OUTPUT=newsletter` (or `OUTPUT=html,newsletter`) the run also produces the newsletter mail, for one of two audiences (`NEWSLETTER_AUDIENCE`):

| | `reviewers` (default): review draft | `customers`: approved version |
| --- | --- | --- |
| Header | Logo, title, date range, note that a person reviews the draft before sending | Logo, title, date range |
| Each item | Title as link, **summary** and **"Why this matters"**, score badge (`8/10` with `7 + 1` below), "Agent's reasoning (for reviewers)" verbatim, products, status and GA month, link to the roadmap | Title as link, **summary** and **"Why this matters"**, products, availability ("Preview: October 2026 · Available: January 2027"), link to the roadmap |
| Maintenance windows | One line per window ("DATEV update on Thu 29 Oct: Sun 1 Nov, 19:00 – Mon 2 Nov, 07:00") and the rule | The same lines and "DATEV systems are not available during this window." |
| Footer | Run id, answering models, "Every item carries its reason.", repository link | Sender line, repository link |
| Subject | "… (draft)" | without "(draft)" |

Summary and "Why this matters" are written by the model in its own words for end users; the agent's reasoning is the rating reasoning and is shown to reviewers only.

<img src="assets/newsletter-review.png" alt="Review draft of the newsletter in Mailpit: draft note, the item SharePoint Copilot Search with summary and why this matters, score badge 8/10 with components 7 + 1 and the agent's reasoning for reviewers, maintenance windows with the rule, and a footer with run id and answering model" width="600">

*Review draft for the newsletter team: score 8/10 (7 + 1) and the agent's reasoning.*

Summaries use their own prompt and strict JSON answer (`summary`, `whyItMatters`); the rating prompt is unchanged. The item is sent between the same markers as for the rating, and an answer that repeats 8 or more consecutive words of the item is rejected (one retry). A failed summary does not stop the run: the item appears without summary, and the run log has a warning.

**Mail format:** table layout, 600 px, inline CSS and `bgcolor` only, text in table cells (no `<p>` margins), `mso-line-height-rule` for Outlook for Windows, no external resources, no scripts, no tracking, plus a plain-text part. Checked with the HTML check of Mailpit. The logo is embedded as a CID attachment. Dark theme with colors derived from the logo (`config/brand.json`); all text passes WCAG AA (4.5:1) on both background colors, checked by a test. Fonts: Calibri, Carlito, Arial, Helvetica, sans-serif.

**Never real mail:** every run writes `data/out/<runId>.newsletter-<audience>.eml`, a review copy `.html` and `.txt`. Mail is sent only if `NEWSLETTER_SMTP_HOST` is set, and only to `localhost`/`127.0.0.1` unless `NEWSLETTER_ALLOW_REMOTE=true`. We use [Mailpit](https://mailpit.axllent.org/) on `localhost:1025`.

**Render again without model calls:** `scripts/render-newsletter.ts` rebuilds the report from a run log and the run's snapshot and renders both audiences (`--send` sends them to the local catcher).

**Language:** `NEWSLETTER_LANGUAGE=de` switches labels and summaries to German. The rating reasoning keeps `RATING_LANGUAGE`; for a fully German draft set `RATING_LANGUAGE=de` as well.

## Prefilter rules

Rules run in this order; the first rule that drops an item decides, and its id and reason go into the run log. Numbers: 2026-10-23 snapshot (2,163 items) with the defaults `PREFILTER_NEW_DAYS=8` and `PREFILTER_HORIZON_MONTHS=3`.

| Rule id | Drops an item when | Example reason | Dropped on the snapshot |
| --- | --- | --- | --- |
| `required-fields` | title or URL is missing | "missing title or url" | 0 |
| `VF-NEU` | it was not modified in the last N days (rolling window) | "modified 2026-10-09, older than 8 days" | 1,817 |
| `VF-CLOUD` | no cloud instance contains "Worldwide" | "no Worldwide cloud (GCC, GCC High, DoD)" | 13 |
| `VF-STATUS` | its status is "Cancelled" | "status Cancelled" | 1 |
| `VF-PRODUCT` | **all** its products are out of scope (list in `config/profile.m365.json`); mixed items stay | "all products out of scope: Power Automate" | 204 |
| `VF-HORIZONT` | it is not launched or rolling out and its GA month is more than M months ahead | "GA 2027-02 beyond horizon 2027-01" | 13 |
| `VF-LIMIT` | more than `RATE_MAX_ITEMS` items remain (keeps the most recently modified) | "rank 4 of 115 by modified date (…), limit 3" | depends on configuration |

Result on the snapshot: **115 of 2,163 items** reach the model. Items that are not live yet but whose GA month has passed are kept with the note "GA … passed, still in development". `RATE_ITEM_IDS` restricts a run to selected items; they still pass through all rules, and a dropped item keeps its rule id. Offline check: `npx tsx scripts/prefilter-report.ts <snapshot>` prints these counts for any saved snapshot.

`VF-NEU` uses the roadmap field `modified`, not `created`: `created` is not the announcement date (many items share timestamps from bulk updates).

## Scoring

The model never returns a score. It returns **components** as strict JSON, and the code computes the score:

| Component | Values (from `config/profile.m365.json`) |
| --- | --- |
| `baseValue` | 0: no relation to Microsoft 365 for this audience · 2: marginal relation · 4: Microsoft 365 topic, but no core product is the subject · 7: a core product is the subject |
| `actionBonus` | 0: pure information · 1: concrete benefit or recommendation without a date · 2: action needed, date more than 7 days away · 3: acute (deadline within 7 days, or something stops working) |
| `excluded` | true for "not relevant" topics (admin-only, configuration, compliance, IT operations) |

Core products in the profile: Copilot, Teams, SharePoint, Outlook, OneDrive, Exchange Online.

- **Score** = `baseValue + actionBonus`, capped in code: base 0 → 0, base 2 → max 3, base 4 → max 6, base 7 → max 10; `excluded` → 0. Items with a score of **5 or more** go into the report's main section.
- **Strict answers:** exactly the five fields with allowed values; free text before a closing `</think>` or around the JSON object is discarded (only its length is logged). An invalid answer gets one more attempt with the error named; after that the item is marked "rating failed" and **never gets a score**.
- **Transport:** 120 s timeout per request, one retry on timeout, network error or HTTP 5xx; error messages never contain the token.
- **Prompt injection:** the item is sent as a JSON object between fixed markers, marker strings are removed from the text, and the model is told to ignore instructions inside the item. Only title, status, products, GA and preview month and the summary (max. 4,000 characters) are sent; no URL, no raw record. The model has **no tools and no credentials**.

## Model and routing transparency

The agent requests `nvidia/nemotron-3.5-lightning-30b-a3b`. Nightshift may answer with a different Nemotron model: its response metadata shows that a concrete model id is handled in `meterless/auto` mode, where a learned router races candidates and picks one. In our runs most answers came from `nvidia/nemotron-3-ultra-550b-a55b`, some from `nvidia/nemotron-3.5-super-vl-120b-a12b`, and rarely from the requested model (1 of 21 ratings in the [measurement](#measurement-against-labelled-test-sets)).

The agent therefore logs, per rating, the model that answered (`meterless.routed_model`), the latency reported by Meterless and the receipt id. `RATING_STRICT_MODEL=true` (the default) rejects any rating from another model than the requested one; development runs use `false`. Observed latency: 25–80 s per rating. `scripts/nightshift-probe.ts` documents the request variants we tested (CLAUDE.md, "Known issue: model routing").

## Measurement against labelled test sets

`scripts/measure-testsets.ts` compares the agent's decision with human labels. The agent says
"relevant" if an item passes the prefilter and scores 5 or more; a failed rating counts as
"not relevant". The prefilter runs as of each item's rating date (VF-NEU and VF-LIMIT off),
and the rating uses the rating date as "today". Data: the saved snapshot of 2026-10-23, no new
query. Run on 2026-10-26, 21 ratings, none failed.

| Set | n | TP | FP | FN | TN | Recall (relevant) | Precision | Accuracy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Round 1: calibration set (rated 2026-10-16) | 15 | 6 | 1 | 0 | 8 | 100 % | 86 % | 93 % |
| Round 2: holdout set (rated 2026-10-19) | 15 | 1 | 4 | 0 | 10 | 100 % | 20 % | 73 % |
| Combined | 30 | 7 | 5 | 0 | 18 | 100 % | 58 % | 83 % |

- **No relevant item was missed** on either set: recall is 100 %, at the prefilter and at the
  rating stage.
- **Precision on the holdout set is 20 %.** All five false positives follow one pattern: a
  small feature in a core product (for example pinch to zoom on shared screens in Teams, or a
  PDF presentation mode in the OneDrive iPad app) gets `baseValue` 7 because a core product is
  the subject, plus `actionBonus` 1 for "a concrete benefit once available". The reasoning
  for these items is near-identical; only the feature and the GA month change.
- **Why recall matters more here:** a person reviews every newsletter draft. A false positive
  costs a few seconds to remove; a missed item never reaches the reviewer.
- **Answering models:** the requested `nvidia/nemotron-3.5-lightning-30b-a3b` answered once;
  `nvidia/nemotron-3-ultra-550b-a55b` answered 18 times and `nvidia/nemotron-3.5-super-vl-120b-a12b`
  twice (see [routing](#model-and-routing-transparency)).
- **Horizon:** VF-HORIZONT with M=3 and M=4 gives the same result on these sets (the only item
  it drops has GA 2027-06, beyond both), so the choice of M is not decidable from them.

**Limitations of this measurement**

- Round 1 is the calibration set: the prefilter rules were derived from it.
- The two rounds were labelled by different people with different strictness: round 1 by a
  domain expert, round 2 by the team.
- 30 items, 7 of them relevant: a small sample.
- VF-HORIZONT counts whole months inclusive; this was decided on 2026-10-23, after the holdout
  case 573696 (GA 2027-01) was known, so the holdout result for that rule is not fully independent.
- The snapshot shows the roadmap on 2026-10-23, not on the rating date; two items were modified
  after their rating date.

**Next step (not done):** change the rubric so that a small feature in a core product does not
reach the threshold on its own, and measure that change on a new labelled round. The rubric is
unchanged until then.

## Already reported: H-MEM memory

With `MEMORY=hmem` the agent checks each item against the memory of earlier runs, in two stages:

1. **Exact URL:** an item whose roadmap URL is already stored counts as reported.
2. **Similarity:** cosine similarity of H-MEM embeddings over title, platforms and clouds. The threshold is deliberately strict (`0.999`), because suppressing a new item is worse than repeating one. It was calibrated on the 2026-10-23 roadmap snapshot: identical titles often belong to different platform or cloud variants, so these are part of the compared text.

The run report lists every item that was skipped as already reported, with the stage that matched, the memory record and the similarity. Items are only written to memory with `MEMORY_MARK=true`, so development runs do not change it. The memory lives in `MEMORY_DIR` (default `data/memory/hmem`, ignored by Git). The H-MEM sleep cycle, dreaming and conflict scans are never run; no model or API key is involved.

**Engine requirement:** Meterless (sponsor) confirmed in the HackOS "Help Meterless" channel on 2026-10-23 that the vendored reference in a working feature satisfies the engine requirement. Proof in the repository:

- `npm run conformance`: the vendored engine passes the H-MEM conformance suite, **13/13** checks.
- Two-run test (`test/hmem.test.ts`, "demo proof"): run 1 reports item 573696 and remembers it; run 2 a week later skips it as already reported (`via url`, record `mem-1`) and the HTML report shows "Already reported (1)".

**Limitation:** the vendored H-MEM reference uses a deterministic hash embedder (a bag of words, not a language model). The similarity stage therefore only catches re-published duplicates with (nearly) the same wording, not paraphrases, and the reference tokenizer ignores one-character words. A real embedder is future work.

## Sponsor technology and AI tools

| Technology | What it does here | How we prove it |
| --- | --- | --- |
| **Zetaris** (local, Docker) | Read and query layer: registers the public Microsoft 365 Roadmap API as a Lightning REST table (`zetaris/m365_roadmap.sql`); the agent queries it with SQL over the Zetaris REST API and writes nothing back | Each run saves the raw Zetaris response to `data/snapshots/` before mapping, so runs and the test-set measurement are reproducible; `scripts/zetaris-probe.ts` shows the response shape |
| **Meterless Nightshift** | OpenAI-compatible runtime for all model calls | Per rating: answering model, latency, Meterless receipt id and signature in the run log; optional strict mode rejects ratings from another model |
| **NVIDIA Nemotron** (via Nightshift) | Rates every item that passes the prefilter and writes the short reader summaries | Answering Nemotron model logged per rating and per summary |
| **Meterless H-MEM** | Memory of items reported in earlier runs: exact URL first, then H-MEM similarity with a strict threshold; reference vendored unchanged (Apache-2.0, commit `1742dec`) | Conformance 13/13 (`npm run conformance`) and the two-run test; Meterless confirmed in the HackOS "Help Meterless" channel that this use meets the engine requirement |

**AI tools used for development:** Claude Code (Anthropic, Opus 5.5) as coding assistant. Cursor was installed and set up before the build window; following the organizer announcement of 2026-10-22 that Cursor is optional, we developed with Claude Code.

The full statement for the submission form (rule 6.4) is in [`docs/sponsor-statement.md`](docs/sponsor-statement.md).

## Quick start

**Prerequisites:** Node.js 22 or newer; for live runs a local Zetaris install ([setup guide](https://github.com/zetaris/getting-started)) and Meterless Nightshift with an NVIDIA provider key configured inside Nightshift.

```bash
npm install
npm test          # 83 tests, no network
npm run run       # full pipeline with stub adapters, writes data/out/<run>.html
```

For live runs:

1. Run the statements in `zetaris/m365_roadmap.sql` one by one in the Zetaris SQL Editor.
2. Copy `.env.example` to `.env` and fill in the values. `.env` is ignored by Git.
3. Set `SOURCE=zetaris` and `RATER=nightshift` (in `.env` or for one run).

### Configuration

| Variable | Meaning | Default |
| --- | --- | --- |
| `ZETARIS_REST_URL` | Zetaris REST API, e.g. `http://localhost:8888/api/v1.0` | – |
| `ZETARIS_ORG_ID` | Zetaris organisation id (`1` on a local install) | – |
| `ZETARIS_API_KEY` | Zetaris API key | – |
| `METERLESS_BASE_URL` | Nightshift base URL, e.g. `http://127.0.0.1:8088/v1` | – |
| `METERLESS_RUNTIME_TOKEN` | Nightshift API key from the Nightshift console | – |
| `METERLESS_MODEL` | Requested model | – (we use `nvidia/nemotron-3.5-lightning-30b-a3b`) |
| `METERLESS_APP` | `meterless-app` header; must be an app name registered in the Nightshift console | – |
| `METERLESS_SCOPE` | `meterless-scope` header | – (we use `user`) |
| `SOURCE` | News source: `stub` or `zetaris` | `stub` |
| `ZETARIS_ROW_LIMIT` | Row limit for the roadmap query; a warning is logged if it is reached | `5000` |
| `PREFILTER_NEW_DAYS` | VF-NEU window in days | `8` |
| `PREFILTER_HORIZON_MONTHS` | VF-HORIZONT: GA months ahead for items not live yet | `3` |
| `RATE_MAX_ITEMS` | VF-LIMIT: at most this many items go to the model | unlimited |
| `RATE_ITEM_IDS` | Comma-separated roadmap ids; only these go to the model | – |
| `RATER` | Rating model: `stub` or `nightshift` | `stub` |
| `RATING_LANGUAGE` | Language of the reasoning | `en` |
| `RATING_PROFILE` | Relevance profile | `config/profile.m365.json` |
| `RATING_STRICT_MODEL` | Reject ratings from another model than requested | `true` |
| `NIGHTSHIFT_TIMEOUT_MS` | Timeout per Nightshift request | `120000` |
| `OUTPUT` | Comma-separated: `html` (run report in `data/out/`), `console`, `newsletter` (mail draft) | `html` |
| `NEWSLETTER_LANGUAGE` | Labels and summaries of the newsletter: `en` or `de` | `en` |
| `NEWSLETTER_AUDIENCE` | `reviewers` (draft with scores and reasoning) or `customers` (approved version) | `reviewers` |
| `NEWSLETTER_FROM` | Sender address | `news-agent@localhost` |
| `NEWSLETTER_TO` | Recipient address | `review@localhost` |
| `NEWSLETTER_SMTP_HOST` | SMTP host; unset: files only, no mail | – (off) |
| `NEWSLETTER_SMTP_PORT` | SMTP port | `1025` |
| `NEWSLETTER_ALLOW_REMOTE` | Allow SMTP hosts other than localhost | `false` |
| `BRAND_LOGO_PATH` | Logo embedded in the newsletter | `assets/3net-logo.png` |
| `MEMORY` | "Already reported" store: `none` or `hmem` | `none` |
| `MEMORY_DIR` | Folder of the H-MEM memory | `data/memory/hmem` |
| `MEMORY_SIMILARITY_THRESHOLD` | Similarity at or above which an item counts as reported | `0.999` |
| `MEMORY_MARK` | Remember reported items for later runs | `false` |
| `DATEV_MAINTENANCE_ICS_PATH` | ICS file with update dates; enables the maintenance windows section | – (off) |
| `DATEV_MAINTENANCE_WEEKDAY` | Weekday of the window | `sunday` |
| `DATEV_MAINTENANCE_START` | Local start time | `19:00` |
| `DATEV_MAINTENANCE_END` | Local end time (next day if not after the start) | `07:00` |
| `DATEV_MAINTENANCE_TZ` | Time zone of the window | `Europe/Berlin` |
| `DATEV_MAINTENANCE_LOOKAHEAD_DAYS` | Show windows starting within this many days | `30` |
| `DATEV_MAINTENANCE_SAME_DAY` | An update on the window weekday gets that day's window (`true`) or the next week's (`false`) | `true` |

Empty values count as not set.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run run` | One pipeline run (configuration from `.env` and the environment) |
| `npm test` | All tests (no network) |
| `npm run typecheck` | Type check of the project and of the vendored H-MEM code |
| `npm run conformance` | H-MEM conformance suite against the vendored engine |
| `npx tsx scripts/prefilter-report.ts data/snapshots/<file>.json --ids 573696` | Drops per rule for a saved snapshot, and the decision for selected ids (offline) |
| `npx tsx scripts/measure-testsets.ts --dry-run` | Prefilter result per test item and the number of model calls (offline); without `--dry-run` it rates via Nightshift and writes JSON and HTML to `data/out/` (live) |
| `npx tsx scripts/render-newsletter.ts --run data/runs/<runId>.json --snapshot data/snapshots/<file>.json --send` | Renders the newsletter for both audiences from a run log, without model calls; `--send` to the local SMTP catcher (offline except SMTP to localhost) |
| `npx tsx scripts/zetaris-probe.ts` | One Zetaris query with 5 rows; prints the response shape (live) |
| `npx tsx scripts/nightshift-probe.ts data/snapshots/<file>.json H5` | One Nightshift request variant; prints only model, duration and routing metadata (live) |

### Demo: "already reported" across two runs

Bash syntax; the demo uses its own memory folder and a wider VF-NEU window so that item 573696 (modified 2026-10-15) still passes:

```bash
# Run 1: rate 573696 and remember it
SOURCE=zetaris RATER=nightshift RATING_STRICT_MODEL=false PREFILTER_NEW_DAYS=30 \
MEMORY=hmem MEMORY_DIR=data/memory/demo MEMORY_MARK=true RATE_ITEM_IDS=573696 npm run run

# Run 2: same command; the report shows "Already reported (1)" (via url) instead of a new rating
```

The same flow is covered by the two-run test and was run locally with the stub adapters (`SOURCE=stub RATER=stub MEMORY=hmem MEMORY_MARK=true`). Recorded live on 2026-10-23: run 1 rated 573696 (score 8, answering model `nvidia/nemotron-3-ultra-550b-a55b`, receipt `rcpt_req_jk2wk5mu`) and remembered it; run 2 skipped it as already reported (`via url`, record `mem-1`) without calling the model.

## Testing

- **119 tests** in 13 files (`test/`), run with the Node.js test runner via `tsx`. No test uses the network: Zetaris and Nightshift calls go to injected fake `fetch` functions, and the H-MEM tests replace `fetch` with one that throws.
- **Covered:** field mapping from a real (shortened) Zetaris response; HTML stripping and entity decoding; snapshot before mapping and the row-limit warning; every prefilter rule with boundaries (window edge, year change, unknown status, mixed products, `RATE_ITEM_IDS`, `VF-LIMIT`); strict answer parsing (text around the JSON, `</think>`, invalid values), score caps, retries on invalid answers, timeouts and HTTP 5xx, strict model check, receipt metadata without receipt content, prompt-injection markers; failed ratings never scored or reported; HTML escaping and links; H-MEM stages, persistence, ledger without sleep or dreaming, and the two-run proof; maintenance windows from a synthetic ICS file (folded lines, malformed `DTSTAMP`, update on a Saturday or Sunday with both same-day settings, year change, clock change, nothing upcoming); test-set validation and metrics; summaries (strict JSON, copy check, retry, only above the threshold, a failed summary does not stop the run); newsletter for reviewers and customers (escaping of script and img in all text, only http(s) links, no external resources, Outlook line height, CID logo in the `.eml`, SMTP host guard, empty states, plain-text part, English and German, availability line, WCAG AA contrast of the brand colors); report rebuilt from a run log equals the run's report; configuration parsing (empty values count as not set).
- **Type check** (`npm run typecheck`) and **H-MEM conformance** (`npm run conformance`, 13/13).

## Security and data

- **Secrets** live only in `.env`, which is ignored by Git and blocked for Claude Code (`.claude/settings.json`). Error messages and logs never contain tokens or keys.
- **Public sources only.** The Microsoft 365 Roadmap records contain no personal fields; the prompt gets a fixed list of fields.
- **Untrusted content:** source text is treated as data. In the prompt it is JSON-encoded between markers; in the HTML report all text is escaped and only `http(s)` URLs become links.
- **No personal data** in code, configuration or documentation.
- **Local data:** snapshots, run logs, reports and the H-MEM memory are written under `data/`, which is ignored by Git.

## Limitations and next steps

- **Routing and latency:** Nightshift answers with a routed Nemotron model and takes 25–80 s per rating; ratings run one after another. A full run (115 items on the snapshot) takes a long time; `RATE_MAX_ITEMS` and `RATE_ITEM_IDS` limit it.
- **Newsletter:** a draft for review, sent only to a local SMTP catcher; there is no mailing list, no unsubscribe and no real delivery. The rating reasoning stays in `RATING_LANGUAGE`.
- **Similarity** in H-MEM uses a hash embedder (see [limitation](#already-reported-h-mem-memory)).
- **Calibration:** measured on two labelled rounds, see [Measurement](#measurement-against-labelled-test-sets); precision on small features in core products is the open issue.
- **Zetaris:** `CREATE SCHEMASTORE VIEW` on the REST table fails with "Bad Request"; the agent sends the SELECT directly.

## Pre-existing components and third-party code

No project code was written or committed before the build window opened on 22 October 2026.

- The Zetaris REST table follows the pattern of the recipes in [zetaris/getting-started](https://github.com/zetaris/getting-started) (Apache-2.0).
- **H-MEM reference implementation** (vendored, unchanged) in [`vendor/hmem/`](vendor/hmem/README.md): from [Meterless/Meterless](https://github.com/Meterless/Meterless), path `engines/hmem/reference`, commit `1742dec56a66e58eef9dda2d2b865823758ca8cd` (latest on `main` when downloaded), downloaded 2026-10-23 via degit, version 0.1.0, Apache-2.0. Copied with its license, spec (`AGENTS.md`) and conformance suite; `npm run conformance` checks it. Our adapter around it is in `src/adapters/hmem/`.
- **[nodemailer](https://nodemailer.com/)** 10.2.1 (MIT-0, no dependencies), pinned: builds the newsletter `.eml` (MIME, CID logo) and sends it via SMTP to the local catcher. `@types/nodemailer` 8.0.2 (MIT) for the type check.
- **Labelled test sets** (declared, not in this repository): round 1 rated by a domain expert; round 2 rated by the team before the agent saw the items. They are used to calibrate the relevance scores.

### Repository layout

```
config/profile.m365.json  Relevance profile: audience, core products, out-of-scope products, rubric
config/brand.json         Newsletter colors (dark theme from the logo), font stack, repository link
docs/sponsor-statement.md Sponsor technology statement for the submission form (rule 6.4)
scripts/                  Conformance runner wrapper, test-set measurement, offline/live probes
src/domain/               Types, relevance profile and brand loaders, maintenance window rule
src/ports/                Interfaces: news source, memory store, rating model, output
src/adapters/             Zetaris, Nightshift, H-MEM, HTML report, newsletter mail, ICS calendar, stubs
src/measure/              Test-set measurement (metrics and report)
src/pipeline/             Prefilter rules and the pipeline run
src/main.ts               Entry point (configuration from .env)
test/                     Tests and a shortened real Zetaris response as fixture
vendor/hmem/              Vendored H-MEM reference (third-party, Apache-2.0, unchanged)
zetaris/m365_roadmap.sql  Zetaris REST table and queries for the Microsoft 365 Roadmap
CLAUDE.md                 Project context for Claude Code
PROGRESS.md               Daily progress log
```

## Data sources

| Source | Access | Use |
| --- | --- | --- |
| [Microsoft 365 Roadmap](https://www.microsoft.com/microsoft-365/roadmap) | Public JSON API, no authentication | Titles, descriptions (used for rating only) and links to the original items; own short summaries are planned; terms of use are under review |

## License

To be decided.
