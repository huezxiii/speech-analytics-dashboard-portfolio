# Speech Analytics & Customer Intelligence Dashboard (Sanitized Portfolio Edition) — Project Specification

## 1. Project Overview & Objective
This specification defines the plan for creating a **sanitized, white-labeled public portfolio version** of the existing `callminer-speech-analytics-dashboard`. 

The goal is to clone the exact feature set, user interface, desktop preprocessor, and Power BI export pipeline of the original application while **stripping all proprietary company information, corporate branding, vendor references, internal employee names, and specific product data**.

> **STRICT CONSTRAINT**: No new domains, multi-preset engines, or extra features are to be added. This is a 1:1 functional clone of the speech analytics dashboard, scrubbed clean for public portfolio demonstration.

---

## 2. Directory & Path Specification
* **Reference Directory (Private Codebase)**: `D:\Projects\callminer-speech-analytics-dashboard` *(Read-only reference for architecture, core logic, layout structure, and test suites)*
* **Target Portfolio Directory (New Public Repo)**: `D:\Projects\speech-analytics-dashboard-portfolio` *(All sanitized code, assets, and documentation will be initialized here)*

---

## 3. Sanitization & White-Labeling Rules

| Domain Item | Original Value in Reference Code | Sanitized Portfolio Replacement |
| :--- | :--- | :--- |
| **Company & Brand Name** | Dexcom / GBS Center of Expertise | **Acme Analytics** or **OmniAnalytics CoE** |
| **Company Logo / Header Mark** | Dexcom brand logo & text PNGs | `<svg>` Placeholder or `[YOUR_LOGO_HERE]` asset slot |
| **Brand Color Tokens** | Dexcom Forest Green (`#48B040`), Honeydew (`#C7E4D5`) | CSS Theme Variables (`--brand-primary: #1e293b;`, `--brand-accent: #0284c7;`) |
| **Product / Incident Copy** | G7 iOS App Update v2.1.0 pairing error spike | **Mobile App Update v2.1.0 Connection Incident** |
| **Employee / Author Names** | Nadine Bilog, Wesley Taguinod, etc. | **Analytics Architect** / **Operations Director** |
| **Mock Transcript Text** | Specific hardware/medical device pairing terms | Generic contact center phrases (*"connect issue"*, *"account access"*, *"billing query"*) |
| **Executable Name** | `CallMinerPreprocessor.exe` | **SpeechAnalyticsPreprocessor.exe** |

---

## 4. Core Features & Scope (Identical 1:1 Functionality)

### 4.1 Local-First Static Web Dashboard (`index.html`, `charts.js`, `stats.js`)
* **Zero-Auth, Offline Execution**: Parses CSV client-side via `PapaParse`, persists dataset state in `IndexedDB`.
* **Tab 1: Executive Summary Hub**:
  * Strategic KPI Banner Cards (Total Volume, Avg Silence %, Sentiment Index, First Contact Resolution).
  * Dual-Axis Line/Bar Chart correlating Daily Call Volume and Customer Sentiment Score over time.
  * Category Distribution Stacked Bar Chart & FCR vs. Sentiment Scatter Plot.
  * Dynamic incident alert banner and data-driven "so what" narrative callouts.
* **Tab 2: Ops & QA Command**:
  * Silence % vs. Agent QA Score correlation scatter plot.
  * Horizontal Queue Efficiency Leaderboard and Call Volume Breakdown.
  * Talk-to-Silence Conversational Balance (nested doughnut chart).
  * Silence Duration Frequency Histogram (5-bucket bimodal distribution).
* **Tab 3: Compliance & Coaching**:
  * Policy & Verification Adherence Gauge (half-doughnut).
  * 5-Axis Agent Behavioral Radar Chart (Empathy, Quality, Silence, Compliance, Resolution).
  * Acoustic Stress & Agitation Timeline curve.
  * Linguistic Empathy Correlation bar chart.
* **Tab 4: CallMiner NLP Query Sandbox**:
  * Interactive Boolean and Proximity (`W/15`, `AND`, `OR`, `NOT`) query parser.
  * Real-time Precision and Recall evaluator against parsed transcript rows.
  * Query Hit Velocity trend line and Keyword Proximity Distance scatter plot.
  * Live transcript snippet result grid with search keyword highlighting.

### 4.2 Companion Desktop Preprocessing App (`preprocess_core.py`, `gui/app.py`, `preprocess_cli.py`)
* **Pure Python Core (`preprocess_core.py`)**:
  * Single-source schema validation and 15-column transformation rules with zero CLI or GUI dependencies.
  * Headless contract methods: `validate()`, `preview()`, `process_file()`, `combine()`.
* **Desktop UI Shell (`gui/app.py`)**:
  * Built on `pywebview` with native file/folder selection dialogs delegating to testable setters.
  * Side-by-side raw vs. transformed 20-row preview table with diff cell highlighting.
* **Standalone Binary Build (`build/preprocessor.spec`)**:
  * Single-file PyInstaller build (`SpeechAnalyticsPreprocessor.exe`) with pre-flight Evergreen WebView2 runtime detection.

### 4.3 Programmatic Power BI Export Engine (`powerbi.js`)
* **Client-Side `.pbip` ZIP Export**:
  * Generates complete Microsoft Power BI Project packages in-browser using `JSZip`.
  * TMDL Semantic Model (`Calls.tmdl`, `DateTable.tmdl`, `SilenceBuckets.tmdl`, `EmpathyBuckets.tmdl`) with duration-weighted DAX measures.
  * PBIR Report Definitions across 4 synchronized pages (Executive Hub, Ops/QA Command, Compliance & Coaching, and Call Detail Drill-Through Target Page).
* **Automated Verification Gates**:
  * Structural test gates (`check:pbi`, `check:date`, `check:weighted`, `check:drill`, `check:columns`) asserting field reference resolution and schema validity before export.

---

## 5. Directory Blueprint for the Sanitized Repository

```text
D:\Projects\speech-analytics-dashboard-portfolio\
├── .planning/                     # GSD Project Memory
│   ├── PROJECT.md                 # Portfolio Project Scope & Charter
│   ├── STATE.md                   # Current Session State & Decisions
│   ├── ROADMAP.md                 # Milestone & Phase Tracker
│   └── REQUIREMENTS.md            # Requirement Traceability Matrix
├── AGENTS.md                      # Portable Agent Memory & Token-Efficiency Contract
├── generate_mock_data.py          # Synthetic Data Generator (Anonymized Transcripts)
├── preprocess_core.py             # Pure Python Transformation Core
├── preprocess_cli.py              # CLI Shell for Preprocessor
├── index.html                     # Main Web Dashboard Entry Point (Sanitized Theme)
├── stats.js                       # Client-Side KPI Aggregations & Analytics Engine
├── charts.js                      # Chart.js Visualizations & ARIA Accessibility
├── powerbi.js                     # Power BI PBIP/TMDL/PBIR Generator
├── vendor/                        # Vendored Third-Party Libraries (PapaParse, JSZip)
├── gui/                           # Desktop GUI Shell
│   ├── app.py                     # pywebview Controller & RPC Bridge
│   └── web/                       # Local UI Assets (HTML/CSS/JS)
├── build/                         # Packaging Assets
│   └── preprocessor.spec          # PyInstaller Spec File
├── tests/                         # Automated Test Suite
│   ├── test_core.py               # Preprocessor Core Unit Tests
│   ├── test_parity.py             # Byte-Parity Golden Test Suite
│   └── test_powerbi.py            # Power BI Export Structural Gates
└── README.md                      # Professional Portfolio Showcase Guide & Architecture Notes
```

---

## 6. Execution Contract (`AGENTS.md`)
Every AI coding session must follow these guidelines:
1. **Sanitization Audit**: Before writing any file to `D:\Projects\speech-analytics-dashboard-portfolio`, verify that no company-specific names, internal employee names, or proprietary strings are present.
2. **Preflight Discovery**: Discover workspace state at session start; do not assume file existence.
3. **Targeted Symbol Reads**: Never run full `cat` reads on large files; query targeted line ranges or symbols.
4. **Deterministic Gate Checks**: Run `python -m pytest -q` and `npm run check:pbi` before marking any milestone phase as complete.
