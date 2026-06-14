# MARROW — The Target

### A living vision document. This is the destination, not the route.

> Working title: **MARROW** — the marrow inside the spine; the tissue that makes all the blood.

**Status of this document.** This is the permanent north star. It describes the *finished* organism as if it already exists. It is deliberately **not** a roadmap, a backlog, or a spec — those are temporary and live elsewhere (`docs/adr/` for decisions, `CLAUDE.md` for operational context). When reality and this document disagree, this document is the direction we are still walking toward. We edit it only when the *vision itself* gets sharper, never to record what we happened to build this week.

**How to read it.** Sections 1–3 are the soul: the one idea, the feeling, and the invariants that must never be violated. Section 4 walks the body, organ by organ — each described by *what it does and what you experience*, not how it is wired. Sections 5–7 are the moments that define it, the boundaries that protect it, and the end-state in one breath. If you are an engineer (human or agent) deciding how to build something, the invariants in Section 3 outrank every other instinct.

-----

## 1. The one idea

A helpdesk ticket is an object with attributes that moves through states, driven by rules, fed by channels, remembered forever. So is an invoice. So is a contract, a lead, an incident, an onboarding case, a maintenance dispatch, a compliance review, a tender. **They are all the same shape.**

The industry built a separate seven-figure application for each one — CRM, DMS, ITSM, AP automation, HR, GRC, field service — and then, in the AI era, bolted a chatbot onto each silo. We do the opposite. **MARROW is one substrate that *becomes* any of these categories** by changing only its schema, its workflows, and which organs are active. Not a suite of apps. Configurations of a single living engine.

On top of that substrate runs an **autonomous agent** that senses incoming work, reasons about it, acts to resolve it, remembers everything it ever did, and gets measurably better every night — while being able to prove every decision it made.

The category we are claiming is not “ticketing.” It is **Autonomous Operations**: the agent-native, sovereign back-office that resolves your work itself and remembers all of it.

-----

## 2. What it feels like

The finished product is best understood through the moments it creates.

**A law firm, Monday morning.** A prospective client emails a messy description of their case with three PDFs attached. By the time the intake clerk opens her screen, the matter already exists: parties extracted, conflict-check run against the firm’s history, documents classified and filed, a draft intake summary written, a suggested fee range attached, and a calendar hold proposed. She reads, adjusts one thing, approves. What used to be forty minutes is ninety seconds. And six months later, when a related matter comes in, MARROW already knows the connection — because it never forgot.

**A medical practice front desk, on the phone.** A patient calls at 7:58, two minutes before opening. MARROW answers in natural German, recognizes the returning patient, understands “my knee is worse since the injection,” checks the calendar, offers two slots, books one, and notes the symptom thread on the patient’s record — the same record the doctor will see, the same thread that started three months ago. No hold music. No “press 1.” The human at the desk sees a clean log of what happened and why, and steps in only for the one call that needs a human.

**A trades dispatcher, after hours.** A burst pipe at 23:40. MARROW takes the call, classifies it as an emergency, pulls the customer’s history, dispatches the on-call technician with the address and the prior service notes, sends the customer a confirmation, and logs the whole chain. Next time this customer calls, it remembers the boiler, the layout, the last fix. The dispatcher wakes up to a resolved incident, not a missed call.

**The founder, any afternoon.** She types into a single box: *“Why did we approve the Henkel discount last quarter, and who signed off?”* MARROW answers in a sentence, with the exact decision, the person, the timestamp, and a link to the moment it happened — reconstructed from the system’s own memory, not guessed. Then: *“From now on, any refund over €1,000 needs a human.”* The rule is live before she finishes her coffee. She never opened a settings menu.

**The auditor, once a year.** He asks how the AI decided to auto-approve a particular case. MARROW replays it: the exact context it saw, the reasoning it followed, the confidence it had, the tools it called, the human who did or didn’t intervene. Not a log of *what* changed — a reconstruction of *why*. The audit takes minutes. This is the feeling that lets a regulated business trust an autonomous agent at all: **nothing is a black box, because nothing was ever thrown away.**

The thread through all of it: **it acts on its own, it remembers everything, and it can always show its work.**

-----

## 3. What must always be true — the invariants

These are non-negotiable. Any feature, shortcut, or dependency that violates one of these is wrong, no matter how convenient. If everything else in this document is forgotten, keep these.

1. **The Mark is the single source of truth, and it is append-only.** Every perception, decision, action, and state change is an immutable event. The “current state” of any object is a *projection* computed from those events — never the other way around. We never have a mutable record with a log stapled to the side. The log *is* the system.
1. **Glass-box, always.** Every autonomous action can be reconstructed from the Mark: the context it saw, the reasoning it used, the confidence it held, the tools it called. If a decision cannot be explained from the substrate, it should not have been allowed to happen.
1. **Autonomous never means unsupervised.** The agent acts on its own *above* a confidence threshold and escalates below it. Thresholds are tunable per action type. Human corrections in the grey zone flow back into memory. An autonomous agent without confidence gates is a hallucination machine with an audit log — we are the opposite.
1. **It learns over night, without retraining.** Every resolved case becomes retrievable precedent for future cases. The system improves because its own memory grows richer, not because someone fine-tunes a model. Tomorrow it is better than today, by construction.
1. **Sovereign by default.** Data *and* inference can run in the EU or on the customer’s own infrastructure. Self-hostable is not a future enterprise tier; it is the spine. This is the one moat the global cloud incumbents structurally cannot cross.
1. **A citizen of the agent ecosystem, not a silo.** MARROW both *consumes* external tools and *exposes* its own objects and actions as tools, over open standards (MCP). Other agents — including general assistants — can drive it. It is never a walled garden.
1. **One substrate, not ten apps.** New domains are reached by reconfiguring the object model and workflows, not by forking the codebase or spinning up a parallel product. If we ever find ourselves building “the CRM version” as a separate thing, we have lost the plot.
1. **Deliberate boredom in the plumbing, ambition in the behavior.** The substrate is built from the most boring, durable primitives that work. The *intelligence and the experience* are where we are bold. We never reach for exotic infrastructure to feel advanced.

-----

## 4. The organism — module by module

Each organ is described by what it is, what it does, and what you experience. Implementation — libraries, frameworks, exact stack — is intentionally absent. That is for the build to discover.

### The Spine — *the Mark*

The substrate everything else stands on. An append-only event log in which every object’s entire life is recorded as an unbroken sequence of immutable events; current state is a projection folded from them. This single structure is, at once, five things that conventional software keeps in five separate systems: the **durable-execution journal** (so long-running work survives restarts and can resume), the agent’s **memory** (episodic and long-term), the **audit trail**, the **simulation substrate** (the Time Machine), and the **learning signal**. The Mark is not a feature of MARROW. The Mark *is* MARROW; the rest are organs attached to it. Everything that matters in the product — trust, memory, self-improvement, time travel — is a consequence of this one decision.

### The Senses — *Intake Understanding*

Every inbound, on every channel — email, PDF, structured e-invoice, phone call, web form, chat, a photo of a delivery note — is *understood* at the moment it arrives: classified, entities extracted, intent recognized, routed to the right object, summarized. The quiet radical idea here is unification: support triage, document extraction, and data entry are revealed to be **the same capability**, applied to different inputs. You throw anything at MARROW and it knows what it is and what to do with it. Raw mess in; structured, actionable object out.

### The Cortex — *the agent runtime*

The disciplined autonomous loop: plan → act → observe → reflect. It is lean on purpose — no barocque twenty-agent swarm, which is exactly where most autonomous demos die in production. It spawns focused sub-agents only when a task genuinely fans out (breadth — parallel research or extraction); depth stays single-threaded and coherent. Its real craft is not the model but **context engineering**: at every step the working context is freshly assembled from the Mark — the relevant precedents, the current object state, the retrieved knowledge — rather than everything being dumped in at once. Each step is checkpointed into the Mark, so a case that takes hours survives restarts, retries safely, and resumes exactly where it stopped. The Cortex is model-agnostic and routes deliberately: a strong model to orchestrate, cheaper ones for narrow sub-tasks.

### The Hands — *action, including voice*

MARROW does not just understand and advise — it *acts*. It drafts and sends replies, generates compliant documents, books appointments, and executes operations in other systems: through APIs, through agent tools, and where no API exists, by driving the interface the way a person would. And its most distinctive hand is **voice**: it places and answers calls in natural language. An inbound call becomes an object, becomes a resolution, becomes a callback — end to end, with the whole chain remembered.

### The Nervous System — *the MCP fabric*

Two directions, both essential. MARROW **consumes** the organization’s existing tools as standard agent tools — calendar, accounting, payments, ERP, whatever already runs the business. And it **exposes** its own objects and actions as a standard tool server, so the company’s *other* agents, and even general-purpose assistants, can reach into it. The substrate becomes the **body**; these are the nerves to everything else. MARROW is the agentic hub that orchestrates the company’s whole tool estate instead of adding one more island to it.

### The Immune System — *glass-box trust*

The trust layer, and quietly the real wedge. Three things, all nearly free because the Mark already exists: **traceability** (every autonomous action reconstructable from the substrate — the standing answer to “explain this decision”); **confidence-gated autonomy with human-in-the-loop** (act above the line, escalate below, learn from the corrections); and **sovereignty** (data and inference in the EU or on-prem). The thesis underneath: in the autonomous-agent era, capability is no longer scarce — **trust** is. The Mark produces trust as a by-product. This is what locks out the cloud-only incumbents.

### The Language Center — *the policy compiler*

You do not click conditions in an admin panel. You *describe* the process in plain language — *“incoming complaints over €500 go to the team lead, otherwise auto-answer from the knowledge base, escalate after 48 hours”* — and MARROW compiles it into live workflows and agent behavior. The same idea as the best enterprise agents’ natural-language operating procedures, but compiled onto a sovereign, inspectable substrate instead of disappearing into a cloud black box. Process design becomes a conversation.

### The Skin — *how humans see and steer it*

An autonomous system still needs a face for the humans who oversee it. The Skin is calm and confidence-shaped: it surfaces what the agent did, what it is about to do, and what is waiting on a human — never a cluttered wall of every field. It is where someone watches the agent work, adjusts a threshold, reads a trace, takes over the one case that needs them, and otherwise gets out of the way. The feeling is supervision without micromanagement: you are flying the organism, not doing its job.

-----

## 5. The signature moments

The capabilities that, on their own, make someone say “I have not seen software do this.”

- **The Time Machine.** Before the agent ever goes live, it runs against the customer’s *real* history — the last ten thousand cases, invoices, calls — in a sandbox, and shows exactly how it would have handled them, with a resolution rate and a trace for every decision. This is the moment a jaw drops, and simultaneously the lever that de-risks autonomy enough to buy: not “trust us blindly,” but “check it against your own past.”
- **The inbox that empties itself.** An ambient agent watches the event stream and acts *before* a human looks, so the queue is shorter every time you check it.
- **One truth across every channel.** A customer emails, then calls, then sends a PDF — MARROW knows it is the same matter, across time and medium, with full memory.
- **Ask your company.** A single box answers any question about the operation with citations drawn from the system’s own memory: *“why did we decide this?”* → an answer with proof from the Mark.
- **Schema-morph.** The same engine becomes a helpdesk, then an invoice-automation tool, then an intake system, before your eyes — by reconfiguring objects, not rewriting code. The collapse thesis, demonstrated live.

-----

## 6. What MARROW is not

Boundaries that keep the target honest and protect the build from drifting.

- **Not a chatbot bolted onto an app.** The intelligence lives in the substrate, not in a widget on the side.
- **Not unsupervised autonomy.** It acts confidently within gates and escalates honestly; it never confuses “autonomous” with “left alone.”
- **Not a fork of a mutable-state monolith.** The whole thesis requires the event log to *be* the truth. We learn from prior art’s domain wisdom, but the Mark is built clean.
- **Not another silo.** It joins the agent ecosystem as a tool that speaks and listens over open standards; it does not wall itself off.
- **Not exotic for its own sake.** Boring, durable plumbing under bold behavior. Complexity is spent on intelligence and trust, nowhere else.

-----

## 7. The end-state, in one breath

A sovereign, agent-native back-office that you point at any kind of incoming work — a case, an invoice, a call, a contract — and it senses, understands, decides, and acts on its own; it remembers everything it has ever done, so it grows sharper every night without anyone retraining it; and because its memory *is* its audit trail, it can prove every decision it ever made. It runs in your own walls, speaks to every other tool you own, and turns from a helpdesk into a finance engine into a dispatch system by changing its shape, not its code. The first of its kind you can actually trust — because it never forgets, and it never hides.

-----

## Appendix — the organs in plain words

|Organ                  |In plain words                 |Its job                                                                                |
|-----------------------|-------------------------------|---------------------------------------------------------------------------------------|
|**The Mark** (Spine)   |Append-only event memory       |Single source of truth; state, memory, audit, simulation, and learning in one substrate|
|**The Senses**         |Universal intake understanding |Turn any inbound (mail, PDF, call, form, image) into a structured, actionable object   |
|**The Cortex**         |The agent runtime              |Plan → act → observe → reflect; disciplined, context-engineered, resumable autonomy    |
|**The Hands**          |Multimodal action (incl. voice)|Draft, send, generate, book, execute — across APIs, tools, UIs, and the phone          |
|**The Nervous System** |MCP fabric                     |Consume the company’s tools; expose MARROW’s own as tools for other agents             |
|**The Immune System**  |Glass-box trust                |Traceability, confidence gates + human-in-the-loop, EU/on-prem sovereignty             |
|**The Language Center**|Policy compiler                |Describe a process in plain language; it becomes live workflow and agent behavior      |
|**The Skin**           |Human surfaces                 |Watch, steer, adjust, and take over — supervision without micromanagement              |

-----

*This document is the destination. The route is discovered in the building of it.*