# Proposal Presentation — SG-Anchored, Resume-Grade Candidate Solutions

## Context

The AD Project (NUS-ISS GDipSA) is a hackathon-style, 4-week build. The first graded touchpoint
is the **Proposal Presentation** (MS Teams, *middle of Week 1*; Assessment Section A — Feasibility
Study & Product Usability, marked by SA Lecturers). Per the brief
([AD Project Instructions_updated.pdf](AD%20Project%20Instructions_updated.pdf), slide 27) it must
deliver four things: the proposed **digital solution**, a **brief problem statement**, a
**high-level use-case diagram**, and **technology implementation for each use case**.

This version refines the earlier candidate slate against two goals the team set:
**(1) real Singapore context** — every candidate is anchored to actual SG agencies, national
initiatives, and market conditions; and **(2) resume / LinkedIn impact** — the flagship is chosen
to maximise 2026 SG hiring demand and differentiation, not just academic fit. The chosen flagship
is the single **most hireable** option (see rationale below). It stays independent of the existing
**ResolveOps** proposal ([ResolveOps Proposal Plan.md](ResolveOps%20Proposal%20Plan.md)).

> **What changed from the previous version:** dropped EduMentor (education apps are common and
> originality-risky) and CommServe (lower hiring signal); ClinicFlow's no-show idea is folded into
> a note under CareCircle. Added three higher-hireability, SG-anchored domains — **RegTech**,
> **ESG/Climate tech**, **GovTech** — and re-anchored the retained CareCircle and SkillBridge to
> real SG programmes.

### Hard constraints every candidate must satisfy (from the brief)

- **Five mandated pillars** through **one common backend**: Agentic AI · Mobile · Web · Machine
  Learning · Data Visualisation (dashboard).
- **Cloud deployment** of one or more features; presented as **one cohesive product** (slide 18).
- **Original** (no reused CA project, slide 7) and feasible as a **4-week MVP on synthetic data**.
- Must clearly **distinguish agentic AI vs ML vs human decision** (slide 18) — this is also the
  most resume-relevant "responsible AI / human-in-the-loop" narrative for 2026 hiring.

---

## ✅ DECISION — LOCKED IN: ComplyDesk

The team has committed to **F1 — ComplyDesk** as the proposal. Deliverables are built and live in
the [`ComplyDesk Proposal/`](ComplyDesk%20Proposal/) folder:

- **`ComplyDesk Proposal.pptx`** — 4 slides: title; description + stakeholder value; use-case
  diagram + backlog summary; and a **prototype-screens slide** (all 5 Figma screens with role
  captions + the "why nav differs by role" explanation).
- **`ComplyDesk Product Backlog.xlsx`** — 71 features / 11 epics, prioritised (34 Must · 28 Should
  · 9 Could) with pillar, technology, business value, story points, target sprint, acceptance
  criteria; plus Sprint-Plan summary and Legend sheets.
- **`ComplyDesk Use Case Diagram.png`** — high-level UML use-case diagram (embedded in the deck).
- **Figma prototype screens** — 5 hi-fi screens (SME onboarding, analyst alert queue, investigation
  workspace, MLRO mobile approval, compliance dashboard):
  [figma.com/design/hKpeTICgILcqY6TzAVB7rH](https://www.figma.com/design/hKpeTICgILcqY6TzAVB7rH)
  (in the **SA62_Team4** Figma team).

**Pre-submission checklist:** ✅ originality check passed · ✅ synthetic dataset confirmed
(SAML-D, see next section) · ✅ Figma prototype screens done. Remaining: drop screenshots of the
Figma screens onto the deck's optional prototype slide if desired.

**Prototype navigation — two apps, role-accurate (by design).** The 5 screens deliberately belong
to two products with *different* navigation — the differences are intentional, not inconsistency,
and reflect segregation-of-duties (which matters for AML / MAS FEAT). Each frame is captioned on
the Figma canvas with its app + persona.

| Screen | App | Persona | Navigation |
|---|---|---|---|
| ① SME onboarding (mobile) | ComplyDesk **for Business** | SME applicant (external) | Home · Onboarding · Documents · Profile |
| ② Alert queue (web) | ComplyDesk **Console** | Compliance analyst | Home · Alerts · Cases · Onboarding · Reports · Profile |
| ③ Investigation (web) | ComplyDesk **Console** | Compliance analyst | Home · Alerts · Cases · Onboarding · Reports · Profile |
| ④ MLRO approvals (mobile) | ComplyDesk **Console** | MLRO / approver | Home · Approvals · Cases · Profile |
| ⑤ Compliance dashboard (web) | ComplyDesk **Console** | MLRO / approver | Home · Alerts · Cases · **Approvals · Admin** · Reports · Profile |

Key differences: the **customer app** (external SME) never exposes internal alerts/cases; only the
**MLRO** sees **Approvals** and **Admin** — analysts do not. `Home` and `Profile` are common across
all apps, giving a shared design language without collapsing the roles.

---

## ComplyDesk — Synthetic Dataset (✅ confirmed available)

Real bank transaction data is impossible to obtain, but several **public, labelled, synthetic**
AML datasets exist and are suitable for training/evaluating the ML risk model and demoing the
product. Confirmed options, easiest-first:

| Option | What it is | Why / when to use | Access |
|---|---|---|---|
| **SAML-D** *(recommended)* | Single labelled CSV — **9.5M transactions, 12 features, 28 typologies** (17 suspicious), ~0.1% flagged. Built with input from AML specialists. | Easiest for a 4-week build: download one CSV, train directly, no simulation. Realistic **class imbalance** gives a strong talking point (precision/recall/ROC-AUC, handling imbalance). | [Kaggle: SAML-D](https://www.kaggle.com/datasets/berkanoztas/synthetic-transaction-monitoring-dataset-aml) · [GitHub](https://github.com/BOztasUK/Anti_Money_Laundering_Transaction_Data_SAML-D) |
| **IBM Transactions for AML** | Ready-made CSVs (LI / HI illicit ratios × small/medium/large), millions of accounts & transactions. | Good alternative / larger scale; bank-transfer style with clear labels. | [Kaggle: IBM AML](https://www.kaggle.com/datasets/ealtman2019/ibm-transactions-for-anti-money-laundering-aml) |
| **IBM AMLSim** (generator) | Multi-agent simulator generating synthetic transactions with **8 known laundering patterns** + graph structure. | Use only if you need to *customise* patterns/volume; requires running the simulator. | [GitHub: IBM/AMLSim](https://github.com/IBM/AMLSim) |

**Recommendation:** commit to **SAML-D** as the primary dataset (one download, labelled, demoable),
with the IBM Kaggle set as a backup. All are synthetic — no real individuals — so there is no
privacy/compliance issue to disclose beyond the standard "synthetic-data limitations" note. The
~0.1% suspicious rate is realistic and lets the team show they can handle **imbalanced
classification** (class weights / SMOTE, and evaluating on precision/recall/F1/ROC-AUC rather than
accuracy) — a credible, resume-worthy ML talking point.

---

## Flagship recommendation (the "most hireable" pick)

**F1 — ComplyDesk · SME Onboarding & AML Compliance Copilot (RegTech).**

**Why this is the most hireable in the 2026 SG market:** Singapore is Asia's leading financial
centre, and RegTech/compliance is one of the deepest, best-funded tech-hiring pools —
incumbent banks (DBS, OCBC, UOB), digital banks (**GXS Bank, Trust Bank, MariBank**), insurers,
payments and wealthtech firms are all hiring for AI-driven KYC/AML, fraud, and compliance
automation. MAS actively promotes **responsible AI in finance** via the **FEAT principles**
(Fairness, Ethics, Accountability, Transparency), the **Veritas** initiative, and **Project
MindForge** (a GenAI risk framework for the financial sector). A project that demonstrates an
**agentic compliance copilot with explainable ML risk scoring, mandatory human-in-the-loop
approval, and a full audit trail** maps almost one-to-one onto what these employers are hiring
for — and few student teams attempt RegTech, so it differentiates strongly.

**Resume / LinkedIn line it earns you:**
> *"Built an agentic AML-compliance copilot: explainable ML transaction-risk scoring + a
> human-in-the-loop investigation agent that drafts suspicious-transaction narratives, deployed
> on AWS with CI/CD and OWASP security testing. Aligned to MAS FEAT responsible-AI principles."*

### Evidence & statistics backing this pick

*(Use these to justify the problem, the SG relevance, and the hiring case. Source quality is
flagged — authoritative regulator/press vs. industry-vendor estimates — so you can cite accordingly.)*

**The problem is large and expensive (motivates the false-positive-reduction value prop):**
- Legacy rule-based transaction monitoring produces **~90–95% false positives** (large institutions
  up to ~95%; smaller banks ~42%) — [Retail Banker International](https://www.retailbankerinternational.com/comment/hidden-cost-of-aml-how-false-positives-hurt-banks-fintechs-customers/)
  · [FluxForce false-positive data](https://www.fluxforce.ai/statistics/false-positive-rates-transaction-monitoring) *(industry estimate)*.
- Each alert costs **~US$25–50 and ~30 min** to investigate — [FluxForce](https://www.fluxforce.ai/statistics/false-positive-rates-transaction-monitoring) *(industry estimate)*.
- Money laundering is estimated at **2–5% of global GDP (~US$0.8–2.0T/yr)** — UNODC, as cited in
  [Altman et al., 2023 (arXiv:2306.16424)](https://arxiv.org/abs/2306.16424).

**It's a live regulatory priority in Singapore (grounds the SG relevance):**
- Singapore's **2023 money-laundering case — ~S$3B (US$2.2B) in assets seized**, Asia's largest —
  [OCCRP](https://www.occrp.org/en/news/singapore-recovers-billions-of-dollars-in-money-laundering-case).
- In **July 2025 MAS penalised 9 banks/financial institutions S$27.45M** over that case —
  [CNBC](https://www.cnbc.com/2025/07/04/singapore-monetary-authority-penalizes-9-banks-institutions-for-2023-money-laundering-case.html).
  Compliance modernisation is therefore an active board-level concern, not a hypothetical.
- MAS actively mandates **responsible AI** in finance: [FEAT](https://www.mas.gov.sg/publications/monographs-or-information-paper/2018/feat)
  · [Veritas](https://www.mas.gov.sg/schemes-and-initiatives/veritas) · [Project MindForge](https://www.mas.gov.sg/schemes-and-initiatives/project-mindforge).

**The hiring demand is real (grounds the "most hireable" claim):**
- Singapore's financial sector is set to **grow ~4–5%/yr and hire ~3,000–4,000 people annually**;
  **2,500+ licensed financial institutions** employing **~200,000** people —
  [MAS Jobs & Skills](https://www.mas.gov.sg/development/jobs-and-skills) · [MyCareersFuture](https://content.mycareersfuture.gov.sg/financial-banking-jobs-singapore-hiring-industry-transformation-map/).
- MAS committed **S$400M (2021–2025)** to finance-professional training, and continues to flag
  **talent shortages** in the sector — [MAS parliamentary reply, 2025](https://www.mas.gov.sg/news/parliamentary-replies/2025/oral-reply-to-parliamentary-question-on-talent-shortage-in-the-financial-sector)
  · [SFA Singapore Technology Talent Report 2024 (PDF)](https://singaporefintech.org/wp-content/uploads/2024/11/SFA-Singapore-Technology-Talent-Report-2024.pdf).

**How to deploy in the pitch:** open the problem slide with the **~90–95% false-positive** figure
and the **S$3B / S$27.45M** Singapore facts (relatable, local, recent); close the feasibility slide
by tying the build to MAS's responsible-AI mandate and the sector's hiring demand.

Runner-up for social impact: **F2 — CareCircle** (HealthTech). If the team prefers a
mission-driven story over finance, CareCircle is the strongest alternative (aging population +
Healthier SG), with a slightly more natural mobile UX and equally clean AI/ML/human separation.

---

## ComplyDesk — Plain-English Glossary (know these before you pitch)

The flagship uses finance-compliance jargon. Here's what each term means and why it matters to
the project — enough to explain it confidently to reviewers who may not be finance specialists.

### The compliance domain

| Term | Plain-English meaning | Why it matters to ComplyDesk |
|---|---|---|
| **KYC — Know Your Customer** | The mandatory process a bank runs to verify *who a customer is* before/while doing business (identity documents, ownership, source of funds). | ComplyDesk's onboarding flow: the SME uploads KYC documents; the system verifies and flags gaps. |
| **AML — Anti-Money Laundering** | Laws and controls that stop criminals disguising illegally obtained money as legitimate funds. | The whole reason transaction monitoring exists; the product's core purpose. |
| **CFT — Countering the Financing of Terrorism** | Companion rules to AML that block funds flowing to terrorism. Usually written together as "AML/CFT". | Same monitoring engine; part of the regulatory obligation banks must meet. |
| **Transaction monitoring** | Automatically scanning customer transactions for suspicious patterns (e.g., sudden large transfers, structuring). | ComplyDesk's ML model scores transactions and raises **alerts**. |
| **Alert / False positive** | An "alert" is a flagged transaction needing review. A "false positive" is an alert that turns out to be innocent. | Banks drown in false positives; reducing them is ComplyDesk's headline value. |
| **MLRO — Money Laundering Reporting Officer** | The senior person legally responsible for a firm's AML program and for approving/filing suspicious-activity reports. | The human approver in the loop — the role that signs off ComplyDesk's recommendations. |
| **SAR / STR — Suspicious Activity / Transaction Report** | The formal report a firm files to the authorities when it suspects money laundering. In Singapore, STRs go to the **STRO** (Suspicious Transaction Reporting Office, part of the Police/CAD). | ComplyDesk's agent **drafts** the STR narrative; the MLRO reviews and approves before it's used. |
| **MAS — Monetary Authority of Singapore** | Singapore's central bank *and* financial regulator. | Sets the AML/CFT rules and the responsible-AI expectations ComplyDesk aligns to. |

### The responsible-AI framing (this is what makes the resume line strong)

| Term | Plain-English meaning | Why it matters to ComplyDesk |
|---|---|---|
| **FEAT principles** | MAS guidance (published 12 Nov 2018) for using AI & data analytics responsibly in finance — **F**airness, **E**thics, **A**ccountability, **T**ransparency. Key idea: keep **human oversight** over consequential decisions and be able to **explain** AI-driven outcomes. | ComplyDesk is deliberately designed to satisfy FEAT: explainable scores (Transparency), a human approves every decision (Accountability/Ethics). |
| **Veritas** | An industry consortium MAS commissioned to turn FEAT's principles into concrete, measurable tools and assessment methods. | Shows FEAT isn't abstract — there are real methods you can name when justifying the design. |
| **Project MindForge** | A MAS-led industry initiative (from 2023) that built a **risk framework for generative AI** in finance; a whitepaper (Jan 2024) defined seven risk dimensions, and a phase-two **AI Risk Management Toolkit** followed in 2026. | Directly relevant if ComplyDesk uses a GenAI agent — you can point to a real SG framework governing exactly that. |

### The technical terms

| Term | Plain-English meaning | Why it matters to ComplyDesk |
|---|---|---|
| **ML model vs Agentic AI** | An **ML model** takes inputs and returns a number/label (here: a risk score). An **AI agent** is an LLM-driven program that *gathers context, calls tools (including the ML model), and drafts an action* — but doesn't decide alone. | The brief demands you distinguish them; ComplyDesk shows both plus a human, cleanly separated. |
| **Human-in-the-loop (HITL)** | A design where the AI proposes and a human approves/edits/rejects before anything happens. | ComplyDesk's core safety guarantee and its FEAT-alignment story. |
| **XGBoost** | A popular, high-performing machine-learning algorithm for tabular data (good for risk/fraud scoring). | The candidate model for transaction-risk scoring. |
| **Explainable AI / SHAP** | Techniques that show *why* a model gave a score (which features pushed it up/down). **SHAP** is the most common method. | Lets ComplyDesk show the analyst the reasons behind each alert — the Transparency requirement. |
| **AMLSim (synthetic data)** | An open framework that generates fake-but-realistic transaction datasets with labelled money-laundering patterns. | Lets the team train/demo the ML model without needing real (impossible-to-get) bank data. |

### Glossary — sources & further reading

Authoritative references for the terms above (cite these in the proposal/report).

**Compliance & regulation (Singapore + global)**
- **KYC / AML / CFT** — [MAS: Anti-Money Laundering & CFT](https://www.mas.gov.sg/regulation/anti-money-laundering-and-countering-the-financing-of-terrorism) · [FATF — global AML/CFT standard-setter](https://www.fatf-gafi.org)
- **MLRO** — the Money Laundering Reporting Officer role is required under MAS AML/CFT Notices (e.g. Notice 626); overview via [MAS Regulation](https://www.mas.gov.sg/regulation)
- **SAR / STR, STRO, SONAR** — [STRO — Singapore's Financial Intelligence Unit (SPF / Commercial Affairs Dept)](https://www.police.gov.sg/Advisories/Commercial-Crimes/Suspicious-Transaction-Reporting-Office) · [SONAR — the STR filing platform](https://www.police.gov.sg/sonar)
- **MAS** — [Monetary Authority of Singapore](https://www.mas.gov.sg)

**Responsible AI in finance (MAS)**
- **FEAT principles** — [MAS FEAT Principles (2018)](https://www.mas.gov.sg/publications/monographs-or-information-paper/2018/feat)
- **Veritas** — [MAS Veritas Initiative](https://www.mas.gov.sg/schemes-and-initiatives/veritas) · [Veritas Toolkit (GitHub)](https://github.com/veritas-toolkit)
- **Project MindForge** — [MAS Project MindForge](https://www.mas.gov.sg/schemes-and-initiatives/project-mindforge)

**Technical methods & tools**
- **XGBoost** — [documentation](https://xgboost.readthedocs.io) · [Chen & Guestrin, 2016 — arXiv:1603.02754](https://arxiv.org/abs/1603.02754)
- **SHAP (explainability)** — [documentation](https://shap.readthedocs.io) · [Lundberg & Lee, 2017 — arXiv:1705.07874](https://arxiv.org/abs/1705.07874)
- **Human-in-the-loop (agent control)** — [LangGraph human-in-the-loop docs](https://docs.langchain.com/oss/python/langchain/human-in-the-loop)
- **AMLSim / synthetic AML data** — [IBM/AMLSim (GitHub)](https://github.com/IBM/AMLSim) · plus SAML-D & IBM datasets in the "Synthetic Dataset" section above

---

## MAS Responsible-AI Initiatives — Deep Dive (from the MAS primary sources)

*Now sourced directly from the MAS PDFs in [`mas_publications/`](mas_publications/) — primary
documents, not secondary analyses. This makes ComplyDesk's "explainable + human-in-the-loop" design
a genuine, citable selling point.*

### FEAT Principles (first published 2018; updated 7 Feb 2019)
Full title: *"Principles to Promote Fairness, Ethics, Accountability and Transparency (FEAT) in the
Use of AI and Data Analytics in Singapore's Financial Sector."* Co-created with the **FEAT Committee**
and aligned to the **PDPC/IMDA Model AI Governance Framework**. It defines **AIDA** as "AI or data
analytics… technologies that assist or replace human decision-making," and sets out **14 principles**
across the four areas. Firms calibrate controls by **materiality** (extent of automation, model
complexity, severity/probability of impact, monetary & regulatory impact, recourse options).

The 14 principles in brief:
- **Fairness (1–4):** no unjustified systematic disadvantage; justified use of personal attributes;
  data/models regularly validated for accuracy and to minimise unintentional bias.
- **Ethics (5–6):** AIDA use aligned to the firm's ethics; AIDA decisions held to *at least* the
  ethical standard of human decisions.
- **Accountability (7–11):** internal approval by an appropriate authority; accountability for
  in-house *and* third-party models; Board/management awareness; plus external channels for data
  subjects to query, appeal, and request review.
- **Transparency (12–14):** proactive disclosure of AIDA use; on request, clear explanations of what
  data is used, how it affects the decision, and its consequences.

**Three FEAT details that directly strengthen ComplyDesk's pitch:**
1. **Explanations ≠ exposing IP (§8.2):** "clear explanations do not necessitate exposure of
   intellectual property or publishing of proprietary source codes" — so SHAP-style reasons shown to
   *analysts* satisfy Transparency without leaking the model.
2. **Fraud/AML can justify *less* external transparency (Illustration 13, §8.4):** a firm using AIDA
   for fraud detection / "red flags" may — given model-manipulation risk — *decide not to disclose
   model details*. → ComplyDesk does exactly this: **internal** explainability for analyst/MLRO, **no**
   model exposure to the customer. Citing this shows sophisticated, regulation-aware design.
3. **Approval scales with materiality (Illustration 8, §7.5):** high-materiality decisions get
   CEO/Board-level approval, with due diligence so approvers understand the model logic — mirrors
   ComplyDesk's MLRO approval gate.

Source: [FEAT Principles (2019) — local PDF](mas_publications/FEAT%20Principles%20Updated%207%20Feb%2019.pdf)
· [MAS page](https://www.mas.gov.sg/publications/monographs-or-information-paper/2018/feat).

### Veritas Initiative (inaugurated 2019)
An MAS-led collaboration with financial institutions to **operationalise FEAT** into "specific and
usable methodologies and toolkits." It produced the **FEAT Assessment Methodology** (Fairness;
Ethics & Accountability; Transparency), an open-source **Veritas Toolkit**, and worked **case
studies** — the full document set (Veritas Documents 1–6) is in `mas_publications/`. → Gives
ComplyDesk named, citable assessment methods. Sources: local Veritas PDFs
· [MAS Veritas](https://www.mas.gov.sg/schemes-and-initiatives/veritas) · [Veritas Toolkit (GitHub)](https://github.com/veritas-toolkit).

### Project MindForge (2023– ) — responsible **generative** AI
Builds on Veritas to address **generative-AI** risks that go beyond the 2018 FEAT scope. **Consortium
(per the whitepaper): MAS, Citi, DBS, HSBC, OCBC, Standard Chartered, UOB, plus Accenture, Google and
Microsoft, and the Association of Banks in Singapore (ABS).** Phase-1 output: the whitepaper
*"Emerging Risks and Opportunities of Generative AI for Banks — A Singapore Perspective"* (executive
summary Nov 2023; full paper published early 2024). It maps GenAI risk across **seven risk
dimensions** (Table 1.1):

1. **Fairness and Bias** — unrepresentative/biased inputs (esp. internet-sourced foundation-model data).
2. **Ethics and Impact** — value misalignment, dark patterns, toxic outputs, sustainability.
3. **Accountability and Governance** — unclear third-party accountability, **inadequate human oversight**.
4. **Transparency and Explainability** — lack of explainability, anthropomorphism, weak recourse.
5. **Legal and Regulatory** — data sovereignty, ownership, IP, privacy, record-keeping.
6. **Monitoring and Stability** — **hallucination / fabrication**, overconfidence, model staleness/degradation.
7. **Cyber and Data Security** — data poisoning, adversarial & model-inference attacks, data leakage.

It also defines **seven technology-consideration dimensions** for enterprise GenAI (Foundation Model
& Infrastructure; Data Architecture; Orchestration & Integration; Operations & Industrialised
Development; Enterprise Readiness & Security; Environmental & Sustainability Impact; RAI Components)
and a **platform-agnostic reference architecture** whose crucial rule is: *"at every step… meaningful
guardrails against unwanted system behaviour, and some degree of human oversight to backstop technical
safety measures."* → ComplyDesk uses a **Gen-AI agent**, so this is the exact SG framework governing
it. Sources: [Emerging Risks… GenAI for Banks — Executive Summary (local PDF)](mas_publications/Executive%20Summary%20-%20Emerging%20Risks%20and%20Opportunities%20of%20Generative%20AI%20for%20Banks.pdf)
· [full whitepaper (local PDF)](mas_publications/Emerging%20Risks%20and%20Opportunities%20of%20Generative%20AI%20for%20Banks.pdf)
· [MAS Project MindForge](https://www.mas.gov.sg/schemes-and-initiatives/project-mindforge).

### AI Risk Management Toolkit (2026) — the latest output
MindForge's Phase-2 deliverable, covering traditional, generative **and agentic AI**: an **AI Risk
Management Executive Handbook**, an **Operationalisation Handbook**, and **Implementation Examples**
— all in `mas_publications/`. → The most current artifact, and proof that **agentic AI is explicitly
in MAS's scope**. See also [Allen & Gledhill analysis](https://www.allenandgledhill.com/sg/publication/articles/32846/mas-launches-ai-risk-management-toolkit-for-financial-services-sector).

### How ComplyDesk maps to the MindForge 7 risk dimensions (a strong responsible-AI slide)

| MindForge GenAI risk dimension | ComplyDesk mitigation (backlog refs) |
|---|---|
| **Accountability & Governance** — inadequate human oversight | Mandatory human-in-the-loop approval gate + immutable audit trail (CD-039, CD-057) |
| **Monitoring & Stability** — hallucination in a drafted STR | Agent *drafts only*; human verifies; RAG grounds the narrative in AML rules (CD-037, CD-040, CD-043) |
| **Transparency & Explainability** | SHAP reasons for every ML score; agent drafts clearly labelled as AI (CD-028, CD-030) |
| **Fairness & Bias** | Held-out evaluation; caution on location/behaviour features (cf. counterfactual-fairness paper) |
| **Cyber & Data Security** | Prompt guardrails, secrets management, dependency/container scans (CD-042, CD-066, CD-069) |
| **Legal & Regulatory** | Synthetic data only; PDPA retention controls; no model exposure to customers (CD-059) |

This mapping shows ComplyDesk was designed against **Singapore's own GenAI risk framework**, not
generic "responsible AI" — a defensible, differentiating point for the assessors.

> **Note on dates:** the FEAT (2018/2019), Veritas (2019), and MindForge (2023; exec-summary Nov
> 2023, full whitepaper early 2024) dates above are taken from the **primary MAS documents**;
> the 2026 toolkit date is from MAS's release. Where earlier secondary analyses gave differing
> phase dates, prefer the primary PDFs in `mas_publications/`.

---

## ComplyDesk vs. the Real Market (existing solutions & current practice)

**Be upfront: ComplyDesk is not a novel invention — it's a student-scale build of a pattern the
industry is actively rolling out right now.** That's a strength, not a weakness: it proves the
concept is real, commercially validated, and squarely on the 2026 hiring roadmap. Own this in the
pitch — say "here's what industry does; here's our integrated MVP of the same idea."

### Commercial platforms already doing this

| Vendor / platform | What it does | Relevance to ComplyDesk |
|---|---|---|
| **NICE Actimize** | Entity-centric AML suites with ML-driven suspicious-activity monitoring and full auditability, for large banks. | The enterprise version of ComplyDesk's monitoring + audit trail. |
| **ComplyAdvantage** (Mesh) | Real-time screening and risk data with adaptive ML risk signals across jurisdictions. | Mirrors the ML risk-scoring pillar. |
| **Feedzai** | Large-bank transaction fraud + AML with anomaly detection and link analysis. | Same ML anomaly-detection idea. |
| **Hummingbird** | Case management + **AI-assisted investigation workflows** + automated regulatory filing. | Closest analogue to ComplyDesk's analyst workspace + agent-drafted reports. |
| **Nasdaq Verafin, SAS, Napier AI, Lucinity** | Other established AML / financial-crime platforms with ML and increasingly GenAI features. | Shows a crowded, well-funded market = real hiring demand. |

### Current industry direction (2025–2026) — exactly what ComplyDesk demonstrates

- **GenAI as a "copilot," not an adjudicator:** banks use GenAI to **draft SAR/STR narratives and
  case notes**, but a human compliance officer always reviews before filing — the exact
  human-in-the-loop design ComplyDesk uses.
- **RAG for regulatory grounding:** flagged transactions are linked to the relevant AML rules and a
  natural-language justification is generated, keeping narratives consistent with regulation.
- **False-positive reduction:** ML is used to cut the flood of false alerts so analysts focus on
  genuine risk — ComplyDesk's headline metric.
- **Agentic AI is the emerging frontier:** McKinsey frames agentic AI as the next step in KYC/AML
  transformation, and academic work (e.g., "Co-Investigator AI") builds agentic frameworks for
  faster, more accurate SAR generation — validating ComplyDesk's agent design as current, not speculative.

### How ComplyDesk stays a legitimate, original *student* project

- **Different customer:** enterprise tools target big banks; ComplyDesk targets an **SME-onboarding
  digital-bank scenario** — a narrower, demoable slice.
- **Integrated across all five mandated pillars** (mobile + web + ML + agent + dashboard on one
  backend) — commercial tools are web-only; the mobile SME-onboarding + MLRO-approval angle is the
  team's own framing.
- **Original as a CA project:** it reuses no prior student work (the brief's actual originality
  test), and runs entirely on **synthetic data** — no real bank integration claimed.
- **Honest scope:** the pitch should say ComplyDesk *replicates the industry pattern at MVP scale to
  demonstrate the tech*, not that it competes with Actimize.

*Sources: Chartis/PwC AML vendor spotlight; ComplyAdvantage; Moody's & Wolters Kluwer AML-2025
outlooks; McKinsey "agentic AI in KYC/AML"; arXiv "Co-Investigator AI". See the reply for links.*

---

## Related Academic Work (arXiv) — grounds the design & seeds the report references

Directly relevant papers, mapped to ComplyDesk components. Cite these in the proposal's
"related work" and the final report to show the approach is research-grounded.

| ComplyDesk element | Paper (year) | arXiv |
|---|---|---|
| **Agentic AI copilot** drafting STR narratives w/ human review | Co-Investigator AI: Agentic AI for Trustworthy AML Compliance Narratives (2025) | [2509.08380](https://arxiv.org/abs/2509.08380) |
| **Synthetic dataset** choice + realistic imbalance | Realistic Synthetic Financial Transactions for AML (Altman et al., 2023) — the IBM/AMLworld data | [2306.16424](https://arxiv.org/abs/2306.16424) |
| Alternative **data generator** (custom typologies) | Tide: A Customisable Dataset Generator for AML Research (2026) | [2603.01863](https://arxiv.org/abs/2603.01863) |
| Justifying **synthetic-data limits** disclosure | Hybrid Data can Enhance the Utility of Synthetic Data for AML (2025) | [2509.18499](https://arxiv.org/abs/2509.18499) |
| **False-positive reduction** (headline value) | AML Alert Optimization Using Machine Learning with Graphs (Feedzai, 2021) | [2112.07508](https://arxiv.org/abs/2112.07508) |
| **Feature engineering** for the risk model | Time-Frequency based Suspicious Activity Detection for AML (2020) | [2011.08492](https://arxiv.org/abs/2011.08492) |
| **Graph/GNN extension** + linked-case detection (backlog CD-021) | Finding Money Launderers Using Heterogeneous GNNs (2023) | [2307.13499](https://arxiv.org/abs/2307.13499) |
| Foundational **graph AML** (Elliptic dataset) | Scalable Graph Learning for AML: A First Look (Weber, Suzumura et al., 2018) | [1812.00076](https://arxiv.org/abs/1812.00076) |
| **Responsible AI / fairness** (maps to MAS FEAT "Fairness") | Counterfactual Methods for Detecting Unfairness in AML Algorithms (2026) | [2607.05101](https://arxiv.org/abs/2607.05101) |

**How to use these:** the *Co-Investigator AI* paper is the single strongest citation — it validates
the exact agentic + human-in-the-loop pattern. The *Altman et al.* synthetic-data paper backs the
dataset decision. The *Feedzai alert-optimization* paper substantiates the false-positive-reduction
claim. Keep the GNN papers as "future work" (the 4-week MVP uses tabular XGBoost, not graphs).

### Skim notes (key takeaways + citeable facts)

- **Co-Investigator AI (2509.08380):** an agentic SAR framework with *specialised sub-agents*
  (planning, crime-type detection, external-intelligence, compliance-validation), dynamic memory,
  an "AI-Privacy Guard" for sensitive data, and an *Agent-as-a-Judge* real-time validation agent —
  **humans stay in the loop to review/refine drafts.** This is almost a blueprint for ComplyDesk's
  copilot; cite it for the agent design *and* borrow the "validation agent" idea as a stretch goal.
- **Altman et al. (2306.16424):** agent-based generator calibrated to real transactions; public
  datasets. Two quotable facts: **UN estimates 2–5% of global GDP (~US$0.8–2.0T) is laundered
  yearly** (problem-statement stat), and **synthetic data can beat real data for benchmarking
  because its ground-truth labels are complete** (real laundering often goes undetected) — a strong
  rebuttal to "why not real data?".
- **Tide (2603.01863):** graph generator with structural **and temporal** patterns; reference sets
  at 0.10%/0.19% illicit. Notably, **XGBoost was the top model at higher fraud prevalence
  (PR-AUC 85.12)** while LightGBM led at very low ratios — supports the XGBoost MVP choice and the
  use of **PR-AUC**, not accuracy, under imbalance.
- **Hybrid Data (2509.18499):** augmenting synthetic data with public real-world features improves
  model utility while preserving privacy — a concrete methodology if the pure-synthetic model
  underperforms.
- **Feedzai alert optimization (2112.07508):** an ML triage layer *on top of* rules (entity-centric
  + graph features, time-windowed) **cut false positives by 80% while keeping >90% of true
  positives** on a real bank dataset. This is the headline benchmark for ComplyDesk's value prop —
  cite as *literature evidence* (their result, not a promise of ours).
- **Time-Frequency AML (2011.08492):** 2-D time-frequency representations of transactions +
  Random Forest — feature-engineering inspiration beyond raw CRM/time features.
- **Heterogeneous GNN / DNB (2307.13499):** first GNN on a large real-world heterogeneous bank
  network modelling customer relations — the "future work" direction for linked-entity detection.
- **Scalable Graph Learning (1812.00076):** *this is the paper that introduced **AMLSim*** (1M-node
  synthetic graph) — useful provenance when you name AMLSim as a data source.
- **Counterfactual fairness (2607.05101):** uses IBM AMLSim; adds country + average-behaviour
  features and shows **fairness violations are worst for the models that gain the most accuracy from
  those features** — a concrete accuracy-vs-fairness trade-off to cite on the **MAS FEAT "Fairness"**
  point, and a caution about adding location features.

*Caveat: these are abstract-level skims, not full reads — verify specific numbers in-paper before
quoting them in the report.*

---

## SG-Anchored Candidate Slate (5)

### F1 — ComplyDesk · SME Onboarding & AML Compliance Copilot  *(RegTech — FLAGSHIP)*
- **Who:** A digital bank / payments fintech onboarding SME customers and monitoring transactions.
- **SG hooks:** MAS AML/CFT obligations; MAS **FEAT** + **Veritas** + **Project MindForge**;
  digital banks GXS / Trust / MariBank; SG as a global financial hub.
- **Transformation:** Manual KYC document checks + rules-only transaction alerts + analysts
  hand-writing suspicious-transaction reports → an explainable, auditable, AI-assisted workflow.
- **Actors:** SME applicant (mobile), compliance analyst (web), MLRO/approver (web + mobile
  approvals), admin.
- **Mobile:** SME uploads KYC docs and tracks onboarding status; MLRO approves/escalates alerts on the go.
- **Web:** Analyst case queue, alert investigation workspace, agent-drafted narrative review/edit.
- **ML:** Explainable transaction-risk / anomaly classifier (feature attributions per alert) on
  synthetic transaction data.
- **Agentic AI:** Investigation copilot gathers customer + transaction context via approved tools,
  calls the ML model, and **drafts** the case narrative / SAR-style report and a recommended
  disposition — **the analyst/MLRO approves, edits, or rejects** (human-in-the-loop, FEAT-aligned).
- **Dashboard:** Alert volumes, false-positive rate, ageing cases, risk distribution, SLA breaches.
- **Data risk:** Low — synthetic AML/transaction datasets are well-established and defensible.
- **Originality:** High — RegTech is rarely attempted by student teams.

### F2 — CareCircle · Coordinated Home & Community Eldercare  *(HealthTech — runner-up)*
- **Who:** A social-service agency (VWO) delivering home care to seniors.
- **SG hooks:** **Healthier SG** (MOH preventive-care strategy); **Agency for Integrated Care
  (AIC)**; projected **~1 in 4 residents aged 65+ by 2030**; strong social resonance.
- **Transformation:** Paper visit-logs + WhatsApp coordination + reactive crisis response →
  unified digital care coordination with proactive risk flags.
- **Actors:** Care coordinator (web), home-care staff (mobile), nurse/supervisor, family member, admin.
- **Mobile:** Staff log visits, vitals, checklists, and photo evidence (offline-tolerant).
- **Web:** Coordinator rosters, reviews/approves AI care-plan drafts, manages clients.
- **ML:** Senior deterioration / hospitalisation-risk classifier from vitals trend, visit history,
  missed-visit patterns.
- **Agentic AI:** Drafts/updates the care plan and next-visit tasks from latest notes + history and
  recommends escalation — **coordinator approves**.
- **Dashboard:** At-risk clients, visit compliance, workload balance, incident trends.
- **Data risk:** Low. **Originality:** High.
- *Note:* the earlier **ClinicFlow** no-show-prediction idea can be borrowed here as a secondary ML
  feature (predicting missed home visits) if the team wants an extra, textbook-clean classifier.
- **Key terms:** *ADL* (Activities of Daily Living — bathing, dressing, mobility); *care plan*
  (documented tasks/goals per client); *deterioration / hospitalisation risk*; *VWO* (Voluntary
  Welfare Organisation — SG non-profit care provider).
- **Market & current practice:** AI-in-elderly-care was ~US$6.5B in 2025, forecast ~US$25B by 2033.
  **CarePredict** (Tempo wearable + ML predicts falls/UTIs; peer-reviewed 69% fewer falls, 39% fewer
  hospitalisations), **AlayaCare** (LLM assistant + hospitalisation-risk prediction), **WellSky**
  (home-health admin); agentic eldercare is an active research frontier. *Differentiation:* most
  tools rely on **IoT wearables** or target large home-health agencies — CareCircle uses
  **visit-log/vitals data (no hardware)** in a **VWO** context, which is feasible and distinct for a
  student demo.

### F3 — CivicAssist · Municipal Service-Request Triage  *(GovTech)*
- **Who:** A town council / municipal services function handling resident feedback.
- **SG hooks:** **Smart Nation 2.0** (2024); **OneService** app / Municipal Services Office;
  **LifeSG**; strong public-sector / GovTech hiring identity.
- **Transformation:** Free-text complaints across phone/app + manual routing + slow follow-up →
  AI-triaged, auto-routed, SLA-tracked case management.
- **Actors:** Resident (mobile), municipal officer (web), team lead (dashboard), admin.
- **Mobile:** Residents report issues with photo + location and track resolution.
- **Web:** Officer reviews AI category/priority + routing suggestion and manages cases.
- **ML:** Case category classifier + SLA-breach-risk prediction.
- **Agentic AI:** Drafts the classification, routing, and resident reply; **officer approves**.
- **Dashboard:** Case volumes by category/estate, resolution time, SLA risk, recurring hotspots.
- **Data risk:** Low. **Originality:** Moderate — resembles a triage pattern (differentiate from
  ResolveOps by the civic domain + resident-facing mobile app + reply drafting).
- **Key terms:** *311 / service request* (non-emergency municipal issue reporting); *CRM* (case
  management system); *MSO* (Municipal Services Office); *SLA* (resolution-time target).
- **Market & current practice:** Mature — **SeeClickFix / CivicPlus** is the dominant 311 CRM.
  **Critical for SG:** the **OneService** app (MSO + GovTech) *already* uses ML to auto-classify
  complaints, extract details, and route to the right agency — i.e., CivicAssist's core already
  exists as a **deployed SG government service**. *Differentiation risk: HIGH* — hard to look
  original next to OneService; would need a sharper twist (agent-drafted resident replies +
  predictive hotspot analytics) to stand apart.

### F4 — GreenLedger · SME Carbon & ESG Reporting Assistant  *(ESG / Climate Tech)*
- **Who:** An SME that must report emissions/ESG to comply or to supply larger buyers.
- **SG hooks:** **SG Green Plan 2030**; **SGX mandatory climate-related disclosures**;
  EnterpriseSG **Enterprise Sustainability Programme**; MAS green-finance / Project Greenprint.
- **Transformation:** Spreadsheet-based, error-prone, once-a-year ESG data collection →
  continuous, AI-assisted emissions tracking and report drafting.
- **Actors:** Data-entry staff (mobile), sustainability lead (web), management (dashboard), auditor.
- **Mobile:** Staff capture activity data (utility bills, fuel, travel) via photo/quick entry.
- **Web:** Sustainability lead reviews AI-computed emissions + agent-drafted disclosure narrative.
- **ML:** Emissions-estimation / anomaly detection on activity data (flag implausible entries).
- **Agentic AI:** Maps activity data to emission factors, computes footprint, and **drafts** the
  disclosure narrative + reduction recommendations — **sustainability lead approves**.
- **Dashboard:** Scope 1/2/3 breakdown, trend vs target, hotspots, disclosure readiness.
- **Data risk:** Low–moderate (emission-factor mapping needs care). **Originality:** High —
  ESG + agentic AI is emerging and differentiated; growing SG hiring in sustainability tech.
- **Key terms:** *Scope 1/2/3 emissions* (direct / purchased-energy / value-chain); *emission
  factor* (multiplier converting activity data to CO₂e); *GHG Protocol* (the standard); *SGX
  climate disclosure* (mandatory listed-company reporting).
- **Market & current practice:** Crowded, fast-growing — **Persefoni, Watershed, Normative,
  Greenly** (SMB), and notably **Unravel Carbon (Singapore)**, which already offers **AI agents**
  automating data collection → emissions calc → audit prep → disclosure. SGX mandates climate
  reporting. *Differentiation risk: moderate–high* — Unravel Carbon (an SG success story) occupies
  almost exactly this vision; upside is strong SG hiring relevance, downside is low novelty.

### F5 — SkillBridge · Workforce Upskilling & Internal Mobility  *(HR / Talent Tech)*
- **Who:** An SME or enterprise HR / L&D function in a tight SG labour market.
- **SG hooks:** **SkillsFuture Singapore (SSG)**, **SkillsFuture Level-Up** (mid-career),
  national reskilling push; persistent tech/skills shortages.
- **Transformation:** Spreadsheet skills matrices + ad-hoc training → AI-driven skills-gap
  detection and personalised learning paths.
- **Actors:** Employee (mobile microlearning), manager (web), L&D admin (web), leadership (dashboard).
- **Mobile:** Micro-assessments, learning progress, self-declared skills.
- **Web:** Manager reviews/approves AI learning-path drafts and training plans.
- **ML:** Attrition-risk or role-readiness (skills-gap-to-target) prediction.
- **Agentic AI:** Generates a personalised learning path from gaps + role targets + course catalog
  and suggests internal mobility; **manager approves**.
- **Dashboard:** Skills heatmap, gap coverage, training ROI, attrition risk.
- **Data risk:** Low–moderate. **Originality:** Moderate.
- **Key terms:** *skills taxonomy / graph* (structured map of skills); *internal mobility* (moving
  staff into new internal roles); *talent marketplace* (platform matching people to roles/gigs);
  *reskilling / upskilling*.
- **Market & current practice:** Established enterprise category — **Gloat** (AI talent marketplace;
  clients incl. Standard Chartered) and **Eightfold AI** (skills graph on ~1.6B profiles), both of
  which **added agentic AI in 2025** (proactive matching, capability-gap flagging); **Degreed** for
  learning. *Differentiation risk: moderate–high* — the agentic-skills space is well-occupied;
  SkillsFuture gives an SG hook but the ML/sell story is the weakest of the five.

---

## Selection Framework (re-ranked with market-research evidence)

Score 1–5 (5 best). This version adds a **market-differentiation** criterion (×3) informed by the
existing-solutions research above — how distinct the *student build* stays next to what's already
deployed, **especially in Singapore**. That single row is what moved the rankings.

| Criterion (weight) | F1 ComplyDesk | F2 CareCircle | F3 CivicAssist | F4 GreenLedger | F5 SkillBridge |
|---|---|---|---|---|---|
| 4-week MVP feasibility (×3) | 4 | 4 | 4 | 3 | 4 |
| Natural fit of all 5 pillars (×3) | 4 | 5 | 4 | 4 | 4 |
| Demonstrable on synthetic data (×3) | 5 | 4 | 5 | 4 | 4 |
| Low real-data dependency (×2) | 5 | 5 | 5 | 4 | 4 |
| Clean, explainable ML target (×2) | 5 | 4 | 4 | 3 | 3 |
| Clear agent-vs-ML-vs-human split (×2) | 5 | 5 | 4 | 4 | 4 |
| Originality vs past CA projects (×2) | 5 | 5 | 3 | 5 | 4 |
| Real SG-context strength (×2) | 5 | 5 | 5 | 5 | 4 |
| Resume/LinkedIn + 2026 SG hiring demand (×3) | 5 | 4 | 4 | 4 | 3 |
| Sell-ability / transformation story (×2) | 5 | 5 | 4 | 4 | 3 |
| **Differentiation vs deployed/commercial solutions (×3)** *(new)* | 4 | 4 | **2** | **2** | 3 |
| **Weighted total (max 135)** | **126** | **121** | **107** | **101** | **98** |

**What the market research changed (and why):**
- **F1 ComplyDesk (126) — still #1.** A huge, well-funded market (Actimize, Hummingbird, Feedzai)
  *validates* relevance and hiring demand, while the SME + mobile + all-five-pillars framing keeps
  the student build distinct. No deployed SG-government equivalent. Differentiation = 4.
- **F2 CareCircle (121) — reinforced #2.** Commercial eldercare AI exists but leans on **IoT
  wearables** (CarePredict) or targets big home-health agencies; the **no-hardware, VWO, visit-log**
  angle survives scrutiny. Differentiation = 4.
- **F3 CivicAssist (107) — dropped.** Singapore's **OneService** already does the core
  (ML classify + route) as a live government service, so a student clone looks unoriginal despite
  strong demonstrability. Differentiation = 2.
- **F4 GreenLedger (101) — dropped.** **Unravel Carbon (SG)** already ships agentic ESG end-to-end;
  strong SG hiring relevance but low novelty. Differentiation = 2.
- **F5 SkillBridge (98).** Gloat/Eightfold added agentic AI in 2025 and own the category; weakest
  ML/sell story keeps it last. Differentiation = 3.

**Verdict (unchanged at the top, sharper underneath):** Lead with **F1 ComplyDesk**; keep
**F2 CareCircle** as the genuine social-impact alternative. Use **F3 CivicAssist** or **F4
GreenLedger** *only* as the "alternatives considered" slide — and if a reviewer asks about them,
proactively name OneService / Unravel Carbon and explain your differentiation, rather than being
caught out. The market evidence widened the gap: the top two are the only two whose
student-differentiation holds up under questioning.

---

## Proposal Guidelines — Required Deliverable

The proposal must be a **1–2 slide PowerPoint** covering, at minimum:

1. **Project Title**
2. **Project Description** — including the **value your project provides to the stakeholder(s)**
3. **A high-level Use Case Diagram**
4. **A Product Backlog** — the proposed features **and the technologies involved**
5. **Some prototype screens** created in Figma or another tool *(optional)*

Keep it to 1–2 dense slides: title + description + value on the first; use-case diagram, backlog
table, and (optional) prototype thumbnails on the second. The backlog's "technologies involved"
column is what satisfies the brief's *"technology implementation for each use case"* (slide 27),
and it must visibly cover all five pillars + common backend + a cloud-deployable feature.

---

## Worked Example — Filling the Guidelines for the Flagship (ComplyDesk)

Use this as the drop-in content for the two slides. Swap to F2 CareCircle if you pick the
social-impact route — the same structure applies.

### 1. Project Title
**ComplyDesk — an AI-assisted SME onboarding & AML compliance copilot.**

### 2. Project Description + stakeholder value
A single platform that transforms manual KYC checks and rules-only transaction alerts into an
explainable, auditable, AI-assisted workflow — with a human compliance officer approving every
decision (MAS FEAT–aligned).

| Stakeholder | Value delivered |
|---|---|
| Compliance analyst | Agent drafts the case narrative + recommended disposition → less manual write-up, faster clearance |
| MLRO / approver | Explainable risk scores + full audit trail → confident, defensible sign-off, on mobile |
| SME customer | Faster, transparent digital onboarding with status tracking |
| The bank / regulator | Lower false-positive load, consistent decisions, MAS-aligned auditability |

### 3. High-level Use Case Diagram (draw as UML; text form below)
- **SME applicant:** submit KYC documents, track onboarding status.
- **Compliance analyst:** review alert queue, investigate case, review/edit agent-drafted narrative, disposition case.
- **MLRO / approver:** approve or escalate case *(includes: view risk explanation + audit trail)*.
- **Admin:** manage users, roles, and risk rules.
- `Investigate case` **includes** → retrieve customer/transaction context, run ML risk score, draft narrative.
- `Disposition / escalate` executes **only after human approval** (the human-in-the-loop gate).

*(Render in draw.io, PlantUML, or Figma; put the system boundary "ComplyDesk" around the use cases.)*

### 4. Product Backlog (features + technologies + priority)

| # | Feature (epic) | Pillar | Technologies involved | MoSCoW |
|---|---|---|---|---|
| 1 | Auth & role-based access (analyst / MLRO / admin) | Backend | Spring Boot, Spring Security/JWT, PostgreSQL | Must |
| 2 | SME onboarding & KYC document upload + status | Mobile | React Native, Spring Boot REST, S3 storage | Must |
| 3 | Analyst alert queue & case investigation workspace | Web | React, Spring Boot APIs, PostgreSQL | Must |
| 4 | Transaction risk scoring (explainable) | Machine Learning | Python FastAPI, XGBoost, SHAP explanations | Must |
| 5 | Investigation copilot — context gather + narrative draft | Agentic AI | LLM agent (LangGraph) with tools + human-in-the-loop | Must |
| 6 | Compliance analytics dashboard | Data Visualisation | React + Chart.js (alerts, false-positive rate, ageing, SLA) | Must |
| 7 | Audit trail & immutable case history | Backend | Spring Boot audit events, PostgreSQL | Must |
| 8 | MLRO mobile approvals & escalation | Mobile | React Native, push notifications | Should |
| 9 | Cloud deployment + CI/CD + security testing | DevSecOps | AWS (App Runner/RDS/S3), GitHub Actions, OWASP/dependency scan | Must |
| 10 | Duplicate / similar-case suggestion | ML/Backend | vector similarity over case history | Could |

This one table covers all five mandated pillars, the common Spring Boot backend, and a
cloud-deployable feature — i.e., the "technology per use case" evidence in a single view.

### 5. Prototype screens *(optional — Figma)*
If time allows, mock 3–4 hero screens: (a) SME mobile KYC upload + status tracker;
(b) analyst web investigation workspace showing the agent-drafted narrative with edit/approve;
(c) MLRO mobile approval card with risk explanation; (d) compliance dashboard. Even low-fidelity
wireframes strengthen the pitch and seed the Sprint 0 UI-design deliverable.

> **Note on scope vs. talk-track:** the graded artifact is these 1–2 slides. When *presenting*
> them (~8–10 min), lead with the before→after transformation story, walk one case end-to-end
> (event → ML score → agent draft → human approval → dashboard update), and close on 4-week MVP
> feasibility + the endorsement you're requesting. The *end-of-Week-1 Sprint 0 showcase*
> (slides 10–11) later expands the same backlog and prototype screens — no rework needed.

---

## Verification / How to validate

1. **Originality gate (do first):** check the chosen title/concept against previous CA project
   lists and confirm with the AD Project coordinator (slide 7). Apply to F1 and the F2 fallback.
2. **Advisor sanity-check:** walk the ranked slate + recommendation past the assigned SA advisor
   in the first Week-1 consult (weekly advisor contact required, slide 25).
3. **Pillar coverage audit:** for the chosen candidate, tick off all five pillars + common backend
   + a named cloud-deployable feature; if any pillar feels bolted-on, reconsider.
4. **ML defensibility:** confirm a real prediction target with defined label, features, and an
   evaluation plan (precision/recall/F1/ROC-AUC on held-out synthetic data); disclose synthetic-data limits.
5. **Synthetic-data sourcing:** for ComplyDesk, confirm access to a synthetic AML/transaction
   dataset (e.g., AMLSim-style generators) before committing.
6. **Demo dry-run thought experiment:** can you narrate one case end-to-end (event → ML score →
   agent draft → human approval → mobile action → dashboard update) in under 2 minutes? If yes,
   both the pitch and the resume story will land.

## Assumptions

- No instructor theme is fixed; if one is announced, re-score the slate against it — the five
  domains (finance, health, civic, sustainability, workforce) cover most likely themes.
- "Most hireable" is judged on 2026 SG tech-hiring depth + resume differentiation; RegTech leads,
  with HealthTech, GovTech, and ESG close behind.
- Team has a mobile framework, a web framework, a JVM/Python backend, a Python ML service, a
  charting library, a cloud target, and CI/CD available; exact choices are a Sprint-0 decision.
- SG references (Healthier SG, AIC, MAS FEAT/Veritas/MindForge, SkillsFuture, SG Green Plan 2030,
  SGX climate disclosure, Smart Nation 2.0 / OneService) are cited as real national context;
  verify the latest specifics before the pitch.
- Slide content and visual artifacts remain out of scope for this document.
