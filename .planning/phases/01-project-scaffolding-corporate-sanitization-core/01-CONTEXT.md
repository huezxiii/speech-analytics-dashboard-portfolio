# Phase 1: Project Scaffolding & Corporate Sanitization Core - Context

**Gathered:** 2026-09-17
**Status:** Ready for planning
**Mode:** Autonomous / Smart Discuss

<domain>
## Phase Boundary

Establish clean project skeleton, brand tokens, third-party vendor dependencies, package.json/pytest test environments, and anonymized synthetic transcript generator adhering to the 15-column schema.
</domain>

<decisions>
## Implementation Decisions

### Brand & Visual Identity
- **Primary Brand Name:** "Acme Analytics" (with sub-brand "OmniAnalytics CoE" for contact center operations).
- **Color Palette Tokens:**
  - `--brand-primary: #0f172a;` (Slate 900)
  - `--brand-surface: #1e293b;` (Slate 800)
  - `--brand-accent: #0284c7;` (Sky 600)
  - `--brand-accent-glow: rgba(2, 132, 199, 0.25);`
  - `--brand-success: #10b981;`
  - `--brand-warning: #f59e0b;`
  - `--brand-danger: #ef4444;`
- **Logo:** Clean SVG vector logo placeholder for "Acme Analytics" with customizable header mark.

### Vendor Asset Strategy
- Third-party libraries (PapaParse, JSZip, Chart.js) are strictly vendored in `vendor/` to allow 100% zero-auth, offline-first execution without external CDN requests.
- Library files: `vendor/papaparse.min.js`, `vendor/jszip.min.js`, `vendor/chart.umd.min.js`.

### 15-Column Canonical Data Contract
1. `Call ID` (e.g. `CALL-10001`)
2. `Date` (`YYYY-MM-DD`)
3. `Agent Name` (sanitized generic: "Agent Alpha", "Agent Smith", "Alex Rivera", etc.)
4. `Customer Sentiment Score` (-1.0 to +1.0)
5. `Silence %` (0.0 to 100.0)
6. `First Contact Resolution` (Binary Yes/No or 1/0)
7. `Call Duration (s)` (integer seconds)
8. `Queue Name` ("Tier 1 Support", "Billing & Payments", "Technical Escalations", "Account Inquiries", "Retention")
9. `Adherence %` (0.0 to 100.0)
10. `Empathy Score` (0.0 to 100.0)
11. `Agitation Level` ("Low", "Medium", "High", "Critical")
12. `Customer Escalation` ("Yes", "No")
13. `Reason for Call` ("Mobile App Connectivity", "Billing Dispute", "Password Reset", "Order Tracking", "Subscription Renewal")
14. `Transcript Snippet` (Generic customer-agent dialogue excerpt sanitized of medical/proprietary terms)
15. `QA Evaluation Score` (0.0 to 100.0)

### Synthetic Data Generator (`generate_mock_data.py`)
- Python script generating realistic, statistically distributed synthetic records.
- Includes bimodal silence distribution (normal calls vs. long hold/incident calls).
- Includes the "Mobile App Update v2.1.0 Connection Incident" cluster (spike in volume, lower sentiment, high escalation for that specific reason).
- Deterministic seed (`--seed 42`) option for repeatable golden testing.

### Project Dependencies & Environments
- `package.json`: Node-based gate runner scripts (`npm test`, `npm run check:pbi`, etc.).
- Python: `pytest` configuration and `requirements.txt` (or dev dependencies for `pywebview`, `pytest`, `pyinstaller`).

</decisions>

<code_context>
## Existing Code Insights

- Reference private repo: `d:\Projects\callminer-speech-analytics-dashboard`
- Source files for reference:
  - `generate_mock_data.py` in reference repo contains statistical formulas and transcript snippet generators.
  - Vendor files in reference repo `vendor/` contain minified libraries.
- Sanitization rules must strictly filter out: "Dexcom", "G7", "G6", "CLARITY", employee names ("Nadine Bilog", "Wesley Taguinod"), proprietary pairing error strings.
</code_context>

<specifics>
## Specific Requirements

- SAN-01: Zero proprietary branding.
- SAN-02: Universal design system tokens in CSS.
- SAN-03: Zero PII in transcripts or agent records.
- MOCK-01: 15-column schema compliance.
- MOCK-02: Statistically realistic distributions and incident spike simulation.
</specifics>

<deferred>
## Deferred Ideas

- None. Strictly 1:1 functional scope.
</deferred>
