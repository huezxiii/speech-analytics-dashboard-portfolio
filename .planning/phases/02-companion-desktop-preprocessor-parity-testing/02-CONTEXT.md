# Phase 2: Companion Desktop Preprocessor & Parity Testing - Context

**Gathered:** 2026-09-17
**Status:** Ready for planning
**Mode:** Autonomous / Smart Discuss

<domain>
## Phase Boundary

Deliver companion desktop preprocessor with strict Core/Shell separation, CLI batch interface, pywebview GUI with side-by-side preview and diff highlighting, PyInstaller spec for standalone executable `SpeechAnalyticsPreprocessor.exe`, and unit/parity test suites.
</domain>

<decisions>
## Implementation Decisions

### Architectural Separation
- **Core (`preprocess_core.py`)**: Pure Python standard library only (`csv`, `collections`, `re`, `itertools`). Zero external dependencies, zero UI imports. Exposes `validate()`, `preview()`, `process_file()`, `combine()`, and `write_csv()`.
- **CLI (`preprocess_cli.py`)**: Headless batch runner parsing command-line options (`--input`, `--output`, `--combine`) for CI/CD and terminal automation.
- **GUI (`gui/app.py`, `gui/web/`)**: `pywebview` desktop app. JS RPC calls Python backend methods. Shows side-by-side source vs. transformed 20-row preview with diff cell highlighting.

### Sanitization Contract
- Executable name: `SpeechAnalyticsPreprocessor.exe` (scrubbed of CallMiner/Dexcom).
- Window title: `Acme Analytics - Speech Analytics Preprocessor`.
- Theme: Dark theme aligned with `brand.css` Slate / Sky color palette.

### Test Strategy
- Unit tests (`tests/test_core.py`): Complete test coverage of column extraction, missing column detection, regex number normalization, and multi-file combination.
- Golden Parity tests (`tests/test_parity.py`): Validates that CLI, Core, and GUI transformations produce identical byte-for-byte outputs on sample datasets.

</decisions>

<code_context>
## Existing Code Insights

- Reference implementation: `d:\Projects\callminer-speech-analytics-dashboard\preprocess_core.py`, `gui/app.py`, `gui/web/`.
- Must sanitize any remaining CallMiner or Dexcom references in window titles, HTML headings, and error strings.
</code_context>

<specifics>
## Specific Requirements

- PREP-01: Core/Shell separation in `preprocess_core.py`.
- PREP-02: Headless batch runner `preprocess_cli.py`.
- PREP-03: `gui/app.py` with `pywebview` and diff highlighting.
- PREP-04: `build/preprocessor.spec` targeting `SpeechAnalyticsPreprocessor.exe`.
- TEST-01: Comprehensive unit tests in `tests/test_core.py`.
- TEST-02: Byte-parity tests in `tests/test_parity.py`.
</specifics>

<deferred>
## Deferred Ideas

- None. Strictly 1:1 functional clone.
</deferred>
