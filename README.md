# 3NET News Agent

A weekly news agent that reads public sources, scores every item for relevance to newsletter topics, explains each score with a short reason and the source, remembers what was already reported, and renders a newsletter draft.

Built for the **Open Agent Hackathon 2026** (GenAI.Works), track **The Agent That Can Explain Why**.

> **Status:** work in progress during the build window (22–27 October 2026). Daily progress is logged in [PROGRESS.md](PROGRESS.md).

## How it works

| Step | What happens | Status |
| --- | --- | --- |
| 1. Fetch | Microsoft 365 Roadmap items are read through Zetaris (SQL over REST) | Data access working |
| 2. Pre-filter | Rule-based filter without AI (keywords, dates, status) | Planned |
| 3. Already reported? | Exact URL match first, then similarity search in H-MEM memory | Planned |
| 4. Score | Nemotron via Meterless Nightshift returns topic group, score 0–10, reason and source per item | Model connection working |
| 5. Filter and summarise | Items above the threshold get a short summary | Planned |
| 6. Render | Newsletter draft as HTML mail, sent only to a local SMTP catcher | Planned |

## Stack

| Layer | Tool | Role in this project |
| --- | --- | --- |
| Data | [Zetaris](https://github.com/zetaris/getting-started) (local, Docker) | Registers the public Microsoft 365 Roadmap API as a REST table; the agent queries it with SQL |
| Build | Claude Code (Opus 5.5) in PyCharm | Coding assistant |
| Build | [Meterless Engine H-MEM](https://github.com/Meterless/Meterless/tree/main/engines/hmem) | Memory of items reported in earlier weekly runs |
| Power | [Meterless Nightshift](https://meterless.ai) | OpenAI-compatible runtime the agent calls |
| Power | NVIDIA Nemotron (`nvidia/nemotron-3.5-lightning-30b-a3b`) | Scoring and summaries |

Language: TypeScript (Node.js LTS).

## Design principles

- **Explainable output:** every item in the newsletter carries its score, a short reason and a link to the source.
- **The model has no tools and no credentials.** It only scores and summarises text, which limits the impact of prompt injection from feed content.
- **Public sources only.** Personal fields (for example author names) are removed before text reaches the model.
- **Ports and adapters:** storage, model and output are behind interfaces, so a run without sponsor components is possible (planned).
- **Secrets stay local:** all keys live in `.env`, which is ignored by Git and blocked for Claude Code (`.claude/settings.json`).

## Repository layout

```
.claude/settings.json     Claude Code permissions (denies reading .env)
zetaris/m365_roadmap.sql  Zetaris REST table and queries for the Microsoft 365 Roadmap
README.md                 This file
PROGRESS.md               Daily progress log
```

## Setup (draft)

Prerequisites:

- Node.js LTS
- Docker Desktop with a local Zetaris install ([setup guide](https://github.com/zetaris/getting-started))
- Meterless Nightshift with an NVIDIA provider key configured inside Nightshift

Steps:

1. Run the statements in `zetaris/m365_roadmap.sql` one by one in the Zetaris SQL Editor.
2. Copy `.env.example` to `.env` and fill in the Zetaris REST URL and API key, the Nightshift base URL and runtime token, and the model id. (`.env.example` follows.)
3. Run the agent (command follows).

## Pre-existing components and third-party code

No project code was written or committed before the build window opened on 22 October 2026.

- The Zetaris REST table follows the pattern of the recipes in [zetaris/getting-started](https://github.com/zetaris/getting-started) (Apache-2.0).
- The H-MEM implementation will be based on the reference in [Meterless/Meterless](https://github.com/Meterless/Meterless) (Apache-2.0). (planned)
- A small labelled test set of real news items for calibrating the relevance scores will be declared here once added. (planned)

## Sponsor technology and AI tools

- **Zetaris:** data layer for the Microsoft 365 Roadmap (see `zetaris/m365_roadmap.sql`).
- **Meterless Nightshift:** primary AI provider of the agent.
- **Meterless H-MEM:** engine for the "already reported" feature. (planned)
- **NVIDIA Nemotron:** model behind the scoring, served through Nightshift.
- **Claude Code:** used for development. Per the organiser announcement of 22 October 2026, Cursor is optional.

## Data sources

| Source | Access | Use |
| --- | --- | --- |
| [Microsoft 365 Roadmap](https://www.microsoft.com/microsoft-365/roadmap) | Public JSON API, no authentication | Titles, own short summaries and links to the original items; terms of use are under review |

## License

To be decided.
