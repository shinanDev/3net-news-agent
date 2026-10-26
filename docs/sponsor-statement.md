# Sponsor technology statement (rule 6.4)

Text for the HackOS submission form, as of 2026-10-26.

## Zetaris (data layer)
We run Zetaris locally in Docker and register the public Microsoft 365 Roadmap API as a Lightning REST table (zetaris/m365_roadmap.sql). The agent queries it with SQL through the Zetaris SQL editor REST API (LATERAL VIEW explode, one row per roadmap item, 2,163 items on 2026-10-23). Every run saves the raw Zetaris response as a snapshot before mapping, so each run and our test-set measurement are reproducible. Zetaris is our read and query layer; the agent writes nothing back.

## Meterless (runtime and engine)
Meterless Nightshift is the runtime for every model call (OpenAI-compatible, with the meterless-app and meterless-scope headers). Per rating we store the routed model, the latency and the Meterless receipt id and signature, so every score can be traced to the model that produced it. Nightshift routes requests via its learned router; we log the answering model instead of hiding it, and an optional strict mode rejects ratings from any other model.
Meterless Engine H-MEM powers the "already reported" feature: the reference implementation is vendored unchanged (Apache-2.0, commit 1742dec) and used through a small adapter: exact URL first, then H-MEM similarity with a calibrated, strict threshold. Proof: the H-MEM conformance suite passes 13/13, and a two-run test shows run 2 skipping an item reported in run 1. Meterless confirmed in the HackOS "Help Meterless" channel that this use meets the engine requirement.

## NVIDIA (model)
NVIDIA Nemotron models, served through Nightshift's NVIDIA provider, rate every item that passes the rule-based prefilter and write the short reader summaries. Answering models in our runs: nemotron-3-ultra-550b-a55b, nemotron-3.5-super-vl-120b-a12b and nemotron-3.5-lightning-30b-a3b.

## Cursor and other tools
Cursor was installed and set up before the build window. Following the organizer announcement of 2026-10-22 that Cursor is optional, we developed the project with Claude Code (Anthropic).

## What is unique
Our use of the sponsor technology is about evidence: Zetaris snapshots show what came in, Nightshift receipts show which model rated each item, and H-MEM shows why an item was skipped as already reported. The model never sets the score itself: it returns components, the code computes the score, and every prefilter drop carries a rule id and a reason.
