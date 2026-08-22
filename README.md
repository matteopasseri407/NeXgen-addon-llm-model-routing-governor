# LLM Model Routing Governor

An n8n workflow that keeps a nine-role model routing table current, every 12 hours, without anyone maintaining a list.

It reads what each coding CLI can actually invoke, joins that against a third-party benchmark API, cuts everything below a reference model, and picks a primary plus two fallbacks per role — each on a different billing pool, so one exhausted quota cannot take out the whole route.

Ten nodes, no LLM in the decision path, and the write is transactional.

## Optional add-on for NeXgen Engine

This repository is an **optional module for [NeXgen Engine](https://github.com/matteopasseri407/NeXgen-Engine)**, recommended when you run several model providers at once (Claude, Codex, AGY, OpenCode Go, Zen, Ollama...) and need the "which model for which job" answer to track a moving catalog by itself.

The engine is fully functional without it — the council simply stays inert without a routing document. With the add-on installed, the engine consumes the routed table directly: `council propose` reads the block this workflow maintains and proposes the current per-role candidates against your local seats (see the *Everything you need to run it* section).

---

## The problem it solves

A setup that uses several models has to answer "which model for which job" continuously, not once. Models ship, prices move, a vendor swaps the build behind a slug. Answering by hand means the table is always weeks stale; answering by asking a model means trusting a model's opinion about models.

The previous version of this workflow answered it by scraping the benchmark site. That broke: the per-model pages sit behind bot protection and return `HTTP 403` with a challenge page, while the API returns `success: true` — so it "worked" 27 times, collected 27 block pages, and surfaced the failure much later as a data problem. That failure is why this version exists.

## Architecture

```
CLIs on laptops/desktops          →  a note in a Git-backed vault
(opencode, agy, codex, claude,       (each machine publishes its own block)
 ollama — often powered off)
                                          ↓
                        VPS, every 12 hours:  read the note via MCP
                                      +  benchmark API (590 models)
                                      →  floor
                                      →  per-role profiles
                                      →  transactional write
```

**The data flows toward the server, not from it.** The workflow runs on a VPS; the machines that have the CLIs are endpoints that are switched off most of the time. At the moment the schedule fires there is nothing to probe. So each machine publishes what it can invoke into a vault note when it happens to be on, and the workflow reads that. The VPS never reaches into a laptop.

The inventory is per host, and that is load-bearing rather than cosmetic: one machine has a local model and another doesn't, so a role restricted to local models is assignable on one and not the other. A single merged inventory would misreport both.

All four cloud channels are introspectable, so no list is maintained by hand:

| Channel | How its models are read |
| --- | --- |
| `opencode` | `opencode models` |
| `agy` | `agy models` — answers intermittently, so the publisher retries |
| `codex` | `~/.codex/models_cache.json`, field `slug` |
| `claude` | the standard set plus the plan's extra options cache |

The version this replaced kept a hand-written list instead, and that list claimed a model the channel had already stopped serving. A list maintained by hand describes the past.

## The floor is a model, not a number

Everything scoring below a **reference model** is cut. The reference is the cheapest model that is already good enough — if it costs almost nothing, accepting something worse to save on an already-negligible amount buys nothing.

Two consequences worth the design:

- The threshold **updates itself**. When the vendor refreshes the reference model's build, the floor rises and more models drop out, with no edit anywhere.
- It cannot exclude itself, which makes the rule stable rather than circular.

Local models are floored separately against a local reference, because a local model's value is not its ranking — it is that the data never leaves the machine.

The floor applies to the three chosen slots but **not** to the emergency tier, where the question is not "is this the best" but "is this better than nothing".

## Nine roles, each with its own tests and its own cost policy

One weighted formula for every role does not survive contact with reality: choosing a model for an architecture decision and choosing one for repetitive triage are different questions, not the same question with the weights nudged.

So each role declares which benchmarks represent its work, and which of three cost policies applies:

| Policy | Behavior | Used by |
| --- | --- | --- |
| **quality-first** | cost does not enter the calculation at all | roles where a mistake costs hours, not tokens |
| **ratio** | capability per unit cost — an actual ratio, not a weighted sum | medium-difficulty, high-volume work |
| **cheap-first** | cheapest first, quality only as tiebreak — two ordered keys | easy repetitive work |

Roles are matched to benchmarks by what the work actually is: long-context reasoning for architecture, agentic tool-use for workflow building, a coding index for day-to-day patches, terminal-task success for infrastructure, instruction-following for bulk transforms. Where no relevant benchmark exists — front-end work, prose — the role falls back to declared priors, and the output says so per row instead of implying a measurement that isn't there.

**Selecting a benchmark is itself a decision with a failure mode.** Given two benchmarks measuring the same capability, the weight goes on the one with better coverage. Using the sparser variant silently penalizes every model that lacks it: the top model lost a role to one costing twice as much, purely because it was missing one measurement.

## Personal data: local only, or unassigned

The role for personal and NDA work accepts **local models only**. Neither a vendor's jurisdiction nor a zero-retention clause makes a cloud model acceptable for personal data — the data leaves the machine, and that is the whole question.

If no local model is available on the hosts that published, the role is reported as **unassigned**. There is deliberately no cloud fallback. A visible gap is worth more than a route that quietly sends personal data somewhere it shouldn't go.

## Four measurement bugs, and why they matter more than the code

Every one of these looked correct on the page and only appeared when the formula was run against real numbers. They are the same family of error wearing four different faces.

**Relative normalization crushes a filtered set.** Min-max against the surviving candidates forces the weakest to 0 and the best to 100. After the floor removed the weak models, a real 15% gap between two good models became 0 versus 100 — and the ratio policy started electing the *most expensive* model, which is the negation of what a ratio is for. Fixed by scoring on absolute scales, which are also stable when a model enters or leaves the catalog.

**A ceiling below the real maximum erases the top.** The index scale was capped just under the best model's score, so the two best models both saturated at 100 and became indistinguishable — and a quality-first role picked the one costing twice as much, at apparent parity.

**A sparse benchmark as the load-bearing signal** penalizes absence rather than weakness. See above.

**Dropping a missing term and reweighting rewards not being measured.** This one is the subtlest and it inverted the previous bug: excluding an absent term looks prudent, but when the *present* value is below average, having no measurement becomes an advantage. A weaker model with unmeasured throughput displaced a stronger one whose throughput was measured and merely mediocre. Fixed by substituting the pool median: an absent value is then neither a penalty nor a bonus, it just says "unknown, assume typical".

The lesson is not any single fix. It is that a scoring function looks right until you run it on real data and check which model wins and why — which is why this repository ships a test that does exactly that.

## Reliability

**The write is transactional.** The target document is read for its content hash; that hash travels with the update. A concurrent edit makes the write fail rather than silently overwrite someone else's change.

**Nothing is rewritten when nothing changed.** The catalog is fingerprinted; an unchanged fingerprint ends the run before the write. A recurring schedule would otherwise produce a commit every run saying the same thing.

**The decision path contains no LLM.** The version this replaced had a model propose the assignments, with an allow-list to catch invented names. Once the benchmarks became structured and the per-role tests explicit, the model had nothing left to add except cost and a hallucination surface. Removing it made the system better — the interesting change here is a deletion.

Reads are retried; both outbound fetches are time-boxed. The non-idempotent write is deliberately **not** retried: the hash guard would make a second attempt fail even after the first succeeded, reporting an error for a completed write.

## Verified end to end

Three executions against the real API and the real vault:

| Run | Outcome |
| --- | --- |
| 1 | **failed** — the MCP node wraps its reply in an envelope that one code node unwrapped and another didn't |
| 2 | **wrote** the table: 590 models in, 15 above the floor, 18 cut |
| 3 | **succeeded without writing** — the write node does not appear in the execution data at all, because the fingerprint guard ended the run first |

The first failure is the reason the test harness in this repository extracts the deployed node code *from the database* and runs it against real inputs, rather than testing a local copy. The original harness had simulated the MCP reply in the wrong shape and so could not have caught it.

## What's in here

```
workflows/model-routing-governor-demo.json   the workflow, importable (12 nodes, v4.16 logic)
lib/                                          scoring logic exactly as deployed (extracted from the workflow)
test/e2e.js                                   runs the deployed code on real inputs
scripts/governor-publish-inventory.py         per-host publisher of the model inventory (Python 3)
systemd/                                      timer + service that run the publisher at boot and daily
```

`lib/` is not a second implementation: both files are the exact `jsCode` of the
workflow's Code nodes, so the readable copy can never drift from what runs.

## Everything you need to run it

**1. The workflow** — import it, then replace the two placeholders with your own:

```
n8n → Workflows → Import from File → workflows/model-routing-governor-demo.json
```

- The `Read host inventory`, `Read CRM` and `Update CRM transactionally` MCP
  nodes point at `https://<your-vault-library-mcp-endpoint>/mcp`: put your
  vault-library MCP server URL there. The note paths they read and write are
  `03-INFRA/council-model-inventory.md` (per-host inventories) and
  `04-NOW/model-cost-crm.md` (the routed table).
- Create two credentials with these exact names: `Vault Library MCP`
  (HTTP Bearer Auth, for the MCP server) and `Artificial Analysis`
  (HTTP Header Auth, `x-api-key`, your benchmark API key).
- The schedule ships disabled: enable it only after a manual test run.

**2. The per-host publisher** — each machine that owns the CLIs publishes what
it can invoke; the workflow reads the note, never the machines:

```
mkdir -p ~/03-INFRA && cp scripts/governor-publish-inventory.py ~/03-INFRA/
cp systemd/governor-inventory.* ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now governor-inventory.timer
```

The publisher commits and pushes the note to `$KNOWLEDGE_VAULT_REMOTE`
(default `origin`). At boot (5 min in) and daily it re-probes opencode, agy,
codex, claude and ollama, and rewrites only this host's block of the note.

**3. The council (optional)** — the routing table is a proposal, not an
assignment. The NeXgen Engine council reads it: set its
`seats.yaml` `routing.decision_file` to the governed note and the per-role
candidates appear in `council propose`, verified against your local seats.

## What this is not

- **Not a request router.** It maintains a routing *table* on a schedule. It does not sit in front of inference calls and dispatch them.
- **Not a benchmark contribution.** It consumes someone else's measurements and is only as good as they are. Where a benchmark stands in for a capability it doesn't directly measure — hard reasoning as a proxy for debugging skill — that is an assumption, and the weakest link in the design.
- **Not tuned for anyone else.** The role definitions, the priors, and the channel list describe one working setup. They are in plain code rather than buried in a prompt precisely so that replacing them is an edit.

## Sintesi in italiano

Modulo **opzionale per NeXgen Engine**, consigliato a chi usa piu' provider insieme: un workflow n8n che tiene aggiornata una tabella di routing su nove ruoli, ogni 12 ore, senza che nessuno mantenga una lista a mano. Il motore funziona anche senza; con il modulo, il council legge la tabella direttamente (`decision_file`).

L'inventario viaggia **dai PC verso il server**, non il contrario: il workflow gira su una VPS e le macchine con i CLI sono endpoint spenti quasi sempre, quindi ognuna pubblica cosa sa invocare in una nota del vault e la VPS legge quella.

Il pavimento non è una soglia scelta a mano ma un **modello di riferimento**: costa quasi nulla, quindi accettare qualcosa di peggiore per risparmiare su una cifra già nulla non ha senso. E si alza da sé quando il fornitore aggiorna quella build.

Ogni ruolo ha i suoi benchmark e una fra tre politiche di costo: dove sbagliare costa ore il prezzo non entra nel calcolo, dove il volume conta si guarda il rapporto, dove il lavoro è facile decide il prezzo. Per i dati personali valgono **solo i modelli locali**, e se non ce ne sono il ruolo resta dichiaratamente non assegnato: non esiste un ripiego cloud.

La parte che vale più del codice sono i quattro errori di normalizzazione documentati sopra. Tutti sembravano corretti a leggerli e sono usciti solo eseguendo la formula su numeri veri.

## License

PolyForm Noncommercial 1.0.0 — see [LICENSE](LICENSE).
