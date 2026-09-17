// powerbi.js
// Houses the Power BI export generation logic

var PBI_PROJECT_NAME = 'SpeechAnalytics';
var PBI_ROOT = 'powerbi';
// 4.2 is what the Desktop-authored baseline emits (powerbi/test.SemanticModel/definition.pbism).
// This constant previously read '4.0' and was never referenced — definition.pbism hardcoded "4.2"
// independently, leaving no way to tell which value was authoritative (18-REVIEW WR-02).
const PBI_PBISM_VERSION = '4.2';
const PBI_PBIR_VERSION = '4.0';
const PBI_COMPATIBILITY_LEVEL = 1606;

// Microsoft Store build used for Phase 18 MODEL-07 round-2 confirmation and Phase 22 Desktop proof.
// Changing this requires re-running the Desktop proof rather than editing a string.
var PBI_VERIFIED_DESKTOP_VERSION = '2.157.879.0';

// Single-sourced PII exposure disclosure statement (Phase 33, DRILL-04, D-03).
// Rendered on Call Detail canvas piiNotice slot and in distribution README.md.
var PBI_PII_EXPOSURE_STATEMENT = 'Call Detail displays unaggregated call transcripts and agent identifiers verbatim. Page hiding is navigation-only, not an access boundary; this report has no row-level security (RLS), and all data is accessible to anyone with file access.';

// D-07, D-08, D-09(a), TGT-01: Disclosure constants for target reference lines.
var PBI_TARGET_DEFAULT_DISCLOSURE = 'generator default, not a published organizational target';
var PBI_TARGET_DATA_DERIVED_DISCLOSURE = 'whole-dataset rate computed from the loaded data, not an organizational target';

// D-19, D-20, EXT-03: Disclosure constants for export scope mode.
// The mode is disclosed in three places (README line, filename suffix, and README_REQUIRED_CONTENT needle).
// Full-dataset mode states itself explicitly because a silent absence is not a disclosure.
// The export mode defaults to full dataset so every existing caller is unaffected.
var PBI_EXPORT_MODE_FULL = 'full';
var PBI_EXPORT_MODE_FILTERED = 'filtered';
var PBI_EXPORT_SCOPE_README_PREFIX = 'Export scope: ';

// D-13: Manifest of required content within the distribution README.md.
// Declared as var so it attaches to the sandbox global object in vm contexts.
var README_REQUIRED_CONTENT = [
    {
        label: 'preview-features-menu-path',
        needle: 'File > Options and settings > Options > Preview features'
    },
    {
        label: 'toggle-pbip-save-option',
        needle: 'Power BI Project (.pbip) save option'
    },
    {
        label: 'toggle-tmdl-format',
        needle: 'Store semantic model using TMDL format'
    },
    {
        label: 'toggle-pbir-format',
        needle: 'Store reports using enhanced metadata format (PBIR)'
    },
    {
        label: 'restart-instruction',
        needle: 'Power BI Desktop must be restarted after enabling the preview toggles'
    },
    {
        label: 'verified-desktop-version',
        needle: PBI_VERIFIED_DESKTOP_VERSION
    },
    {
        label: 'troubleshoot-repair-prompt',
        needle: 'Repair prompt on open'
    },
    {
        label: 'troubleshoot-folder-moved',
        needle: 'Folder moved after extraction'
    },
    {
        label: 'troubleshoot-path-zip-root',
        needle: 'CsvFolderPath pointed at the extracted ZIP root'
    },
    {
        label: 'troubleshoot-path-csv-file',
        needle: 'CsvFolderPath pointed directly at the CSV file'
    },
    {
        label: 'troubleshoot-toggles-disabled',
        needle: 'Preview toggles not enabled or Desktop not restarted'
    },
    {
        label: 'relative-window-system-date-disclosure',
        needle: "Relative-date windows are measured against your computer's current system date"
    },
    {
        label: 'drill-pii-exposure',
        needle: PBI_PII_EXPOSURE_STATEMENT
    },
    {
        label: 'target-line-generator-defaults',
        needle: PBI_TARGET_DEFAULT_DISCLOSURE
    },
    {
        label: 'target-line-data-derived',
        needle: PBI_TARGET_DATA_DERIVED_DISCLOSURE
    },
    {
        label: 'export-scope-mode',
        needle: PBI_EXPORT_SCOPE_README_PREFIX
    },
    {
        label: 'troubleshoot-axis-floor',
        needle: 'A bar or line point is missing on a chart whose subtitle reads Axis starts at N'
    }
];
let isExportingPbi = false;

// Single source of TMDL dataType / M type / summarizeBy / isHidden per column.
// Names and order MUST match index.html REQUIRED_COLUMNS exactly (MODEL-02 ordering).
// From Phase 32 (D-09, D-10, D-11, D-12, D-13, MODEL-08), every Calls column is in exactly one
// deliberate state: visible with a consumer, visible with a declared forward reference
// (e.g. `reserved for <REQ-ID>, Phase <N>`), or hidden with a recorded reason. The reason is emitted
// into Calls.tmdl as a `///` description line so that it is readable from the model itself rather
// than living only in this generator script. Plan 32-04 installs a standing gate over this invariant.
// `var` (not `const`) so this attaches to the vm sandbox's global object for verification harnesses.
var COLUMN_MANIFEST = [
    // Timestamp cell shape confirmed via Papa.unparse on the real dashboard-ready.csv rows: "2026-08-20 00:07:05"
    // (space-separated YYYY-MM-DD HH:mm:ss, year-month-day order is locale-unambiguous), so `type datetime` + en-US parses cleanly.
    { name: 'Timestamp', tmdlType: 'dateTime', mType: 'type datetime', summarizeBy: 'none', isHidden: false },
    { name: 'Contact_ID', tmdlType: 'string', mType: 'type text', summarizeBy: 'none', isHidden: false, description: 'Unique call contact identifier surfaced on Call Detail drill-through table and bound as drill-through field' },
    { name: 'Agent_ID', tmdlType: 'string', mType: 'type text', summarizeBy: 'none', isHidden: false },
    { name: 'Queue_Name', tmdlType: 'string', mType: 'type text', summarizeBy: 'none', isHidden: false },
    { name: 'Call_Duration (s)', tmdlType: 'int64', mType: 'Int64.Type', summarizeBy: 'average', isHidden: false },
    { name: 'Silence_Duration (s)', tmdlType: 'int64', mType: 'Int64.Type', summarizeBy: 'average', isHidden: false },
    { name: 'Silence_Pct', tmdlType: 'double', mType: 'type number', summarizeBy: 'average', isHidden: true, description: 'superseded by duration-weighted Avg Silence % (EXT-02, Phase 32)' },
    { name: 'Max_Agitation_Score', tmdlType: 'int64', mType: 'Int64.Type', summarizeBy: 'average', isHidden: false, description: 'Surfaced on Compliance & Coaching page as the basis of the Avg Max Agitation measure plotted by lineAgitationCurve' },
    { name: 'Primary_Category', tmdlType: 'string', mType: 'type text', summarizeBy: 'none', isHidden: false },
    { name: 'Customer_Sentiment', tmdlType: 'int64', mType: 'Int64.Type', summarizeBy: 'average', isHidden: false },
    { name: 'Agent_Quality', tmdlType: 'int64', mType: 'Int64.Type', summarizeBy: 'average', isHidden: false },
    { name: 'Compliance_Risk', tmdlType: 'string', mType: 'type text', summarizeBy: 'none', isHidden: false, sortByColumn: 'Compliance_Risk_Order' },
    { name: 'Empathy_Score', tmdlType: 'int64', mType: 'Int64.Type', summarizeBy: 'average', isHidden: false, description: 'Surfaced on Compliance & Coaching page for Avg Empathy Score measure and Empathy_Bucket calculated column' },
    { name: 'FCR_Flag', tmdlType: 'int64', mType: 'Int64.Type', summarizeBy: 'none', isHidden: false },
    { name: 'Call_Summary_Transcript', tmdlType: 'string', mType: 'type text', summarizeBy: 'none', isHidden: false, description: 'Verbatim call transcript text surfaced on Call Detail drill-through table; unaggregated text with no RLS boundary' }
];

// Model-only derived columns added inside the Calls table in Power Query M script (D-01).
// Deliberately absent from COLUMN_MANIFEST and the shipped CSV to preserve CSV/M agreement (CR-01).
// `var` (not `const`) so this attaches to the vm sandbox's global object for verification harnesses.
var CALLS_DERIVED_COLUMNS = [
    {
        name: 'Call_Date',
        tmdlType: 'dateTime',
        mType: 'type date',
        mExpression: 'each DateTime.Date([Timestamp])',
        summarizeBy: 'none',
        isHidden: false
    },
    // D-10: Ordinal sort key for Compliance_Risk (No Risk: 1, Low Risk: 2, Medium Risk: 3, High Risk: 4).
    // Derived in Power Query M rather than as a DAX calculated column to avoid Analysis Services
    // circular dependency error PFE_XL_CALCCOLUMN_CIRCULAR_DEPENDENCIES when Compliance_Risk
    // has sortByColumn: Compliance_Risk_Order.
    {
        name: 'Compliance_Risk_Order',
        tmdlType: 'int64',
        mType: 'Int64.Type',
        mExpression: 'each if [Compliance_Risk] = "No Risk" then 1 else if [Compliance_Risk] = "Low Risk" then 2 else if [Compliance_Risk] = "Medium Risk" then 3 else 4',
        summarizeBy: 'none',
        isHidden: true,
        description: 'Sort order helper for Compliance_Risk with no direct visual use'
    }
];

// Calculated columns evaluated by the Tabular engine (D-05).
// Distinct from CSV-sourced columns (COLUMN_MANIFEST) and Power-Query-derived columns (CALLS_DERIVED_COLUMNS).
// Calculated columns carry an '=' DAX expression, have no sourceColumn line, and never appear in the CSV
// or the M partition, preserving CSV/M agreement (CR-01) by construction.
// Decisions:
// (a) Single-line DAX takes the unambiguous documented TMDL form and sidesteps assumption A3.
// Confirmed empirically in Power BI Desktop 2.157.879.0 (26.08, August 2026) on 2026-09-03: model loads cleanly without error, Silence_Bucket and Silence_Bucket_Order sort correctly.
// (b) Null, blank or negative Silence_Duration (s) compares as less than 15 in DAX and lands in 0-15 bucket with order 1 (decided fall-through).
// (c) The numeric thresholds (15, 30, 60, 120) are allowed literals under QUAL-03 per D-08.
// `var` (not `const`) so this attaches to the vm sandbox's global object for verification harnesses.
var CALLS_CALCULATED_COLUMNS = [
    {
        name: 'Silence_Bucket',
        tmdlType: 'string',
        summarizeBy: 'none',
        isHidden: false,
        sortByColumn: 'Silence_Bucket_Order',
        dax: 'SWITCH(TRUE(), \'Calls\'[Silence_Duration (s)] < 15, "0-15", \'Calls\'[Silence_Duration (s)] < 30, "15-30", \'Calls\'[Silence_Duration (s)] < 60, "30-60", \'Calls\'[Silence_Duration (s)] < 120, "60-120", "120+")'
    },
    {
        name: 'Silence_Bucket_Order',
        tmdlType: 'int64',
        summarizeBy: 'none',
        isHidden: true,
        description: 'Sort order helper for Silence_Bucket with no direct visual use',
        dax: 'SWITCH(TRUE(), \'Calls\'[Silence_Duration (s)] < 15, 1, \'Calls\'[Silence_Duration (s)] < 30, 2, \'Calls\'[Silence_Duration (s)] < 60, 3, \'Calls\'[Silence_Duration (s)] < 120, 4, 5)'
    },
    // D-08: Empathy bucket calculated columns for linguistic empathy correlation.
    // (a) Numeric thresholds (20, 40, 60, 80) reproduce charts.js:381-390 exactly.
    // (b) Comparator is '<=' because charts.js uses descending strict '>' (e>80 ... else if e>20).
    // (c) Fall-through arm is "81-100" (order 5), matching null, blank or >80 empathy scores.
    // Confirmed single-line DAX to avoid TMDL InvalidLineType parse error.
    {
        name: 'Empathy_Bucket',
        tmdlType: 'string',
        summarizeBy: 'none',
        isHidden: false,
        sortByColumn: 'Empathy_Bucket_Order',
        dax: 'SWITCH(TRUE(), \'Calls\'[Empathy_Score] <= 20, "0-20", \'Calls\'[Empathy_Score] <= 40, "21-40", \'Calls\'[Empathy_Score] <= 60, "41-60", \'Calls\'[Empathy_Score] <= 80, "61-80", "81-100")'
    },
    {
        name: 'Empathy_Bucket_Order',
        tmdlType: 'int64',
        summarizeBy: 'none',
        isHidden: true,
        description: 'Sort order helper for Empathy_Bucket with no direct visual use',
        dax: 'SWITCH(TRUE(), \'Calls\'[Empathy_Score] <= 20, 1, \'Calls\'[Empathy_Score] <= 40, 2, \'Calls\'[Empathy_Score] <= 60, 3, \'Calls\'[Empathy_Score] <= 80, 4, 5)'
    }
];

// D-18, T-24-21: Derive SILENCE_BUCKET_DIMENSION from CALLS_CALCULATED_COLUMNS DAX strings
// at generation time rather than hardcoding a second source of truth.
function deriveSilenceBucketDimension() {
    const bucketCol = CALLS_CALCULATED_COLUMNS.find(c => c.name === 'Silence_Bucket');
    const orderCol = CALLS_CALCULATED_COLUMNS.find(c => c.name === 'Silence_Bucket_Order');
    if (!bucketCol || !orderCol) {
        throw new Error('deriveSilenceBucketDimension: Silence_Bucket or Silence_Bucket_Order missing from CALLS_CALCULATED_COLUMNS');
    }
    const labelMatches = bucketCol.dax.match(/"[^"]+"/g);
    if (!labelMatches || labelMatches.length === 0) {
        throw new Error('deriveSilenceBucketDimension: Failed to parse bucket labels from Silence_Bucket DAX');
    }
    const labels = labelMatches.map(s => s.slice(1, -1));

    // Order matches: numbers following comma in the SWITCH expression
    const orderMatches = orderCol.dax.match(/,\s*\d+/g);
    if (!orderMatches || orderMatches.length === 0) {
        throw new Error('deriveSilenceBucketDimension: Failed to parse order values from Silence_Bucket_Order DAX');
    }
    const orders = orderMatches.map(s => parseInt(s.replace(/[^0-9]/g, ''), 10));

    if (labels.length !== orders.length) {
        throw new Error(`deriveSilenceBucketDimension: Arity mismatch between labels (${labels.length}) and orders (${orders.length})`);
    }

    const seenLabels = new Set();
    const result = [];
    for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        if (seenLabels.has(label)) {
            throw new Error(`deriveSilenceBucketDimension: Duplicate label detected: ${label}`);
        }
        seenLabels.add(label);
        result.push({ label: label, order: orders[i] });
    }
    return result;
}

var SILENCE_BUCKET_DIMENSION = deriveSilenceBucketDimension();

// D-08 step 2: Derive EMPATHY_BUCKET_DIMENSION from CALLS_CALCULATED_COLUMNS DAX strings
// at generation time rather than hardcoding a second source of truth.
function deriveEmpathyBucketDimension() {
    const bucketCol = CALLS_CALCULATED_COLUMNS.find(c => c.name === 'Empathy_Bucket');
    const orderCol = CALLS_CALCULATED_COLUMNS.find(c => c.name === 'Empathy_Bucket_Order');
    if (!bucketCol || !orderCol) {
        throw new Error('deriveEmpathyBucketDimension: Empathy_Bucket or Empathy_Bucket_Order missing from CALLS_CALCULATED_COLUMNS');
    }
    const labelMatches = bucketCol.dax.match(/"[^"]+"/g);
    if (!labelMatches || labelMatches.length === 0) {
        throw new Error('deriveEmpathyBucketDimension: Failed to parse bucket labels from Empathy_Bucket DAX');
    }
    const labels = labelMatches.map(s => s.slice(1, -1));

    const orderMatches = orderCol.dax.match(/,\s*\d+/g);
    if (!orderMatches || orderMatches.length === 0) {
        throw new Error('deriveEmpathyBucketDimension: Failed to parse order values from Empathy_Bucket_Order DAX');
    }
    const orders = orderMatches.map(s => parseInt(s.replace(/[^0-9]/g, ''), 10));

    if (labels.length !== orders.length) {
        throw new Error(`deriveEmpathyBucketDimension: Arity mismatch between labels (${labels.length}) and orders (${orders.length})`);
    }

    const seenLabels = new Set();
    const result = [];
    for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        if (seenLabels.has(label)) {
            throw new Error(`deriveEmpathyBucketDimension: Duplicate label detected: ${label}`);
        }
        seenLabels.add(label);
        result.push({ label: label, order: orders[i] });
    }
    return result;
}

var EMPATHY_BUCKET_DIMENSION = deriveEmpathyBucketDimension();

var PBI_DELTA_BASELINE_LABEL = 'vs prior period';
var PBI_DELTA_EMPTY_STATE_LABEL = 'select a date range to compare';
var PBI_DELTA_NO_PRIOR_LABEL = 'no prior period';

// D-14: The only strings a title measure may fall back to. A title measure must never return
// a blank value because a blank title renders as an empty header (NARR-03).
// Neither constant may contain an apostrophe or a double quote.
var PBI_TITLE_EMPTY_STATE_LABEL = 'No calls in the selected range';
var PBI_TITLE_NO_PRIOR_PERIOD_LABEL = 'no prior period available for comparison';

// Phase 31 D-18: window mode selected by Desktop spike (see 31-DESKTOP-FINDINGS.md).
var PBI_POP_PRIOR_WINDOW_MODE = 'datesbetween';
var PBI_POP_DELTA_NAME_SUFFIXES = ['Delta %', 'Delta pts'];
var PBI_POP_SANCTIONED_DATE_ANCHOR = "CALCULATE(MAX('Calls'[Call_Date]), ALL('Calls'))";

function isPopDeltaMeasureName(name) {
    if (typeof name !== 'string') return false;
    for (var i = 0; i < PBI_POP_DELTA_NAME_SUFFIXES.length; i++) {
        var suffix = PBI_POP_DELTA_NAME_SUFFIXES[i];
        if (name.length >= suffix.length && name.slice(-suffix.length) === suffix) {
            return true;
        }
    }
    return false;
}

function buildPriorPeriodWindowPreambleDax() {
    var priorWindowDax = (PBI_POP_PRIOR_WINDOW_MODE === 'datesbetween')
        ? "VAR _priorWindow = DATESBETWEEN('DateTable'[Date], _minD - _n, _minD - 1)"
        : "VAR _priorWindow = DATEADD('DateTable'[Date], -_n, DAY)";
    return [
        "VAR _lastDataDate = CALCULATE(MAX('Calls'[Call_Date]), ALL('Calls'))",
        "VAR _minD = MIN('DateTable'[Date])",
        "VAR _maxD = MIN(MAX('DateTable'[Date]), _lastDataDate)",
        "VAR _n = DATEDIFF(_minD, _maxD, DAY) + 1",
        priorWindowDax
    ].join('\n');
}

function buildPriorPeriodDeltaDax(baseMeasureName, arithmetic, scale) {
    if (arithmetic !== 'ratio' && arithmetic !== 'points') {
        throw new Error('Unsupported arithmetic mode in buildPriorPeriodDeltaDax: ' + arithmetic + '; expected "ratio" or "points"');
    }
    var preamble = buildPriorPeriodWindowPreambleDax();
    var selectionLine = "VAR _selection = [" + baseMeasureName + "]";
    var priorLine = "VAR _prior = CALCULATE([" + baseMeasureName + "], _priorWindow)";
    var expr;
    if (arithmetic === 'ratio') {
        expr = "DIVIDE(_selection - _prior, _prior)";
    } else if (arithmetic === 'points') {
        if (scale === 100) {
            expr = "(_selection - _prior) * 100";
        } else {
            expr = "_selection - _prior";
        }
    }
    var returnLine = "RETURN IF(ISBLANK(_selection) || ISBLANK(_prior), BLANK(), " + expr + ")";
    return [preamble, selectionLine, priorLine, returnLine].join('\n');
}

var PBI_WEIGHTED_COUNTROWS_MARKER = 'COUNTROWS';

var PBI_WEIGHTED_MEASURE_SPECS = [
    {
        name: 'Avg Silence %',
        numerator: 'Silence_Duration (s)',
        denominator: 'Call_Duration (s)'
    },
    {
        name: 'Avg Handle Time (s)',
        numerator: 'Call_Duration (s)',
        denominator: PBI_WEIGHTED_COUNTROWS_MARKER
    }
];

function buildWeightedRatioDax(numeratorColumn, denominator) {
    if (typeof numeratorColumn !== 'string' || !numeratorColumn.trim()) {
        throw new Error('buildWeightedRatioDax: numeratorColumn must be a non-empty string');
    }
    if (typeof denominator !== 'string' || !denominator.trim()) {
        throw new Error('buildWeightedRatioDax: denominator must be a non-empty string');
    }
    var numExpr = "SUMX('Calls', 'Calls'[" + numeratorColumn + "])";
    var denExpr = (denominator === PBI_WEIGHTED_COUNTROWS_MARKER)
        ? "COUNTROWS('Calls')"
        : "SUMX('Calls', 'Calls'[" + denominator + "])";
    return "DIVIDE(" + numExpr + ", " + denExpr + ")";
}

// Seven locked measures for the Calls table (D-14 through D-18).
var CALLS_MEASURES = [
    { name: 'Total Calls', dax: "COUNTROWS('Calls')", formatString: '#,##0' },
    // Note on Handle Time Restatement (Phase 32 D-05, D-06):
    // This rewrite is presentational only. The previous plain-mean expression was not an
    // average-of-an-average because it averaged an extensive per-call column rather than a
    // pre-computed ratio, and was therefore already arithmetically identical to the sum over the
    // row count. The rewrite exists so the Plan 32-02 structural gate can assert one expression
    // shape across both weighted Executive Hub measures and so the spot-check worksheet has a
    // control value that must not move.
    { name: 'Avg Handle Time (s)', dax: buildWeightedRatioDax('Call_Duration (s)', PBI_WEIGHTED_COUNTROWS_MARKER), formatString: '#,##0.0"s"' },
    // Note on Percentage Conventions (Phase 22 D-07, Phase 32 D-01):
    // The model previously maintained two distinct percentage formatting conventions: a 0-1 ratio/fraction
    // convention for flag/count averages ('FCR Rate', 'Compliance Risk Rate') formatted with '0.0%', and a
    // pre-scaled 0-100 convention for 'Avg Silence %' which averaged the legacy pre-scaled Silence_Pct column.
    // Phase 32 D-01 retired the pre-scaled convention and replaced row-averaged silence with duration-weighted
    // silence (total silence seconds divided by total call seconds), returning a true 0-1 fraction.
    // Every percentage measure in the model is now a 0-1 fraction formatted with '0.0%', and the pre-scaled
    // 0-100 convention has no live instance left in the model.
    { name: 'FCR Rate', dax: "AVERAGE('Calls'[FCR_Flag])", formatString: '0.0%' },
    { name: 'Avg Silence %', dax: buildWeightedRatioDax('Silence_Duration (s)', 'Call_Duration (s)'), formatString: '0.0%' },
    { name: 'Avg QA Score', dax: "AVERAGE('Calls'[Agent_Quality])", formatString: '0.0' },
    { name: 'Avg Sentiment', dax: "AVERAGE('Calls'[Customer_Sentiment])", formatString: '+0.0;-0.0;0.0' },
    { name: 'Avg Max Agitation', dax: "AVERAGE('Calls'[Max_Agitation_Score])", formatString: '0.0' },
    { name: 'Avg Empathy Score', dax: "AVERAGE('Calls'[Empathy_Score])", formatString: '0.0' },
    {
        name: 'Compliance Risk Rate',
        // Multi-line DAX. Uses plain code-style indentation (spaces) here; buildTmdlMeasureBlock applies
        // the TMDL-required tab prefix via indentTmdlBlock, exactly as buildCallsPartitionSource does for
        // the M query below. A bare multi-line expression (no triple-backtick block) is a TMDL
        // InvalidLineType parse error confirmed against real Power BI Desktop (18-03 defect A).
        dax: "DIVIDE(\n    CALCULATE(COUNTROWS('Calls'), 'Calls'[Compliance_Risk] <> \"No Risk\"),\n    COUNTROWS('Calls')\n)",
        formatString: '0.0%'
    },
    // TGT-03, D-04: Whole-dataset flagged-call rate reference measure.
    // ALL('Calls') clears filters on the expanded Calls table, including DateTable through
    // the many-to-one relationship, so the measure reads the whole loaded dataset regardless of date slicers.
    // Matches the existing PBI_POP_SANCTIONED_DATE_ANCHOR precedent.
    {
        name: 'Compliance Risk Rate (All Data)',
        dax: "CALCULATE([Compliance Risk Rate], ALL('Calls'))",
        formatString: '0.0%'
    },
    // --- Phase 31 Period-over-Period Delta Measures (D-01, D-02, D-06, D-07) ---
    // Baseline is the immediately preceding window of identical length resolved through DateTable.
    // Elapsed-days anchor is CALCULATE(MAX('Calls'[Call_Date]), ALL('Calls')) rather than system clock.
    // Per-day normalization dropped because equal-length windows make it redundant.
    {
        name: 'Total Calls Delta %',
        dax: buildPriorPeriodDeltaDax('Total Calls', 'ratio', 1),
        formatString: '+0.0%;-0.0%;0.0%'
    },
    {
        name: 'Avg Handle Time Delta %',
        dax: buildPriorPeriodDeltaDax('Avg Handle Time (s)', 'ratio', 1),
        formatString: '+0.0%;-0.0%;0.0%'
    },
    {
        // Renamed from Avg Silence Delta %: point subtraction on a 0-to-1 ratio (scaled by 100) (Phase 22 D-06, Phase 32 D-01, D-03)
        name: 'Avg Silence Delta pts',
        dax: buildPriorPeriodDeltaDax('Avg Silence %', 'points', 100),
        formatString: '+0.0"pts";-0.0"pts";0.0"pts"'
    },
    {
        // Renamed from FCR Rate Delta %: point subtraction on a 0-to-1 ratio (scaled by 100) (D-06)
        name: 'FCR Rate Delta pts',
        dax: buildPriorPeriodDeltaDax('FCR Rate', 'points', 100),
        formatString: '+0.0"pts";-0.0"pts";0.0"pts"'
    },
    {
        name: 'Avg QA Score Delta %',
        dax: buildPriorPeriodDeltaDax('Avg QA Score', 'ratio', 1),
        formatString: '+0.0%;-0.0%;0.0%'
    },
    {
        name: 'Avg Sentiment Delta %',
        dax: buildPriorPeriodDeltaDax('Avg Sentiment', 'ratio', 1),
        formatString: '+0.0%;-0.0%;0.0%'
    },
    {
        // Renamed from Compliance Risk Rate Delta %: point subtraction on a 0-to-1 ratio (scaled by 100) (D-06)
        name: 'Compliance Risk Rate Delta pts',
        dax: buildPriorPeriodDeltaDax('Compliance Risk Rate', 'points', 100),
        formatString: '+0.0"pts";-0.0"pts";0.0"pts"'
    },
    // --- Phase 24 Plan 05 Additions & Phase 31 Plan 02 Updates (D-03, D-04, D-07, D-10, D-11) ---
    {
        // D-04: Has Active Filter detects any narrowing filter on Calls (date, Category, Queue, Agent).
        // Uses row count comparison against ALL('Calls') rather than ISFILTERED, because ISFILTERED on
        // date column alone would report false even when category/queue/agent slicers narrow the rows.
        name: 'Has Active Filter',
        dax: "VAR _visible = COUNTROWS('Calls')\nVAR _total = CALCULATE(COUNTROWS('Calls'), ALL('Calls'))\nRETURN _visible < _total"
    },
    {
        // D-10/D-11: Has Prior Period detects whether the preceding window of the same length
        // contains any data rows. Uses buildPriorPeriodWindowPreambleDax() so the prior window
        // definition stays in lockstep with the delta measures.
        name: 'Has Prior Period',
        dax: [
            buildPriorPeriodWindowPreambleDax(),
            "VAR _priorRows = CALCULATE(COUNTROWS('Calls'), _priorWindow)",
            "RETURN NOT(ISBLANK(_priorRows)) && _priorRows > 0"
        ].join('\n')
    },
    {
        // D-10: Delta Baseline Label dynamically switches between three states:
        // 1. Unfiltered date range -> invitation to select a date range
        // 2. Filtered date range with empty prior period (e.g. earliest week) -> 'no prior period'
        // 3. Normal filtered date range with populated prior period -> 'vs prior period'
        name: 'Delta Baseline Label',
        dax: `SWITCH(TRUE(), NOT([Has Active Filter]), "${PBI_DELTA_EMPTY_STATE_LABEL}", NOT([Has Prior Period]), "${PBI_DELTA_NO_PRIOR_LABEL}", "${PBI_DELTA_BASELINE_LABEL}")`
    },
    // NARR-01, NARR-03, D-11, D-14: Executive Hub headline dynamic title measure.
    // States current takeaway in words, falling back to named non-blank strings for empty
    // selections or unresolvable prior periods. Table names omit single quotes to avoid apostrophes.
    {
        name: 'Exec Headline Title',
        dax: [
            'VAR _delta = [Total Calls Delta %]',
            'VAR _cat = MAXX(TOPN(1, VALUES(Calls[Primary_Category]), [Total Calls], DESC), Calls[Primary_Category])',
            'RETURN',
            'IF(',
            '    ISBLANK([Total Calls]) || [Total Calls] = 0,',
            `    "${PBI_TITLE_EMPTY_STATE_LABEL}",`,
            '    "Call volume " & IF(',
            '        ISBLANK(_delta),',
            `        "${PBI_TITLE_NO_PRIOR_PERIOD_LABEL}",`,
            '        IF(_delta > 0, "▲", IF(_delta < 0, "▼", "")) & FORMAT(ABS(_delta), "0.0%") & " vs prior period"',
            '    ) & " - " & _cat & " leads"',
            ')'
        ].join('\n')
    },
    // NARR-02, NARR-03, D-11, D-14: Ops/QA Command headline dynamic title measure.
    // States current takeaway in words, falling back to named non-blank strings for empty
    // selections or unresolvable prior periods. Table names omit single quotes to avoid apostrophes.
    {
        name: 'Ops Headline Title',
        dax: [
            'VAR _delta = [Avg QA Score Delta %]',
            'VAR _queue = MINX(TOPN(1, VALUES(Calls[Queue_Name]), [Avg QA Score], ASC), Calls[Queue_Name])',
            'RETURN',
            'IF(',
            '    ISBLANK([Total Calls]) || [Total Calls] = 0,',
            `    "${PBI_TITLE_EMPTY_STATE_LABEL}",`,
            '    "Avg QA score " & IF(',
            '        ISBLANK(_delta),',
            `        "${PBI_TITLE_NO_PRIOR_PERIOD_LABEL}",`,
            '        IF(_delta > 0, "▲", IF(_delta < 0, "▼", "")) & FORMAT(ABS(_delta), "0.0%") & " vs prior period"',
            '    ) & " - " & _queue & " needs attention"',
            ')'
        ].join('\n')
    }
];

// Quote TMDL object names containing '.', '=', ':', apostrophe, or whitespace.
// Doubles any apostrophe inside the name. [CITED: learn.microsoft.com tmdl-overview]
// A name is left bare only when it is unambiguously a plain TMDL identifier: an ASCII letter or
// underscore followed by letters, digits or underscores. Everything else is quoted.
// This replaces an earlier deny-list (/[.=:'\s]/) which read as a general-purpose TMDL quoter but
// only covered the characters the current manifest happens to use — a name starting with a digit,
// or containing '#' or a backtick, slipped through unquoted (18-REVIEW IN-01). An allow-list cannot
// under-quote: anything it does not recognise gets quoted, and over-quoting is always valid TMDL.
// Byte-identical output for every current COLUMN_MANIFEST name.
const TMDL_BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function tmdlNameNeedsQuoting(name) {
    return !TMDL_BARE_IDENTIFIER.test(String(name));
}

function quoteTmdlName(name) {
    if (tmdlNameNeedsQuoting(name)) {
        return "'" + String(name).replace(/'/g, "''") + "'";
    }
    return name;
}

// TMDL `sourceColumn` values use double quotes when the raw name needs quoting.
function tmdlSourceColumnLiteral(name) {
    return tmdlNameNeedsQuoting(name) ? '"' + name + '"' : name;
}

// Tab-indent every non-empty line of a text block by tabCount tabs.
function indentTmdlBlock(text, tabCount) {
    const pad = '\t'.repeat(tabCount);
    return String(text).split('\n').map(function (line) {
        return line.length ? pad + line : line;
    }).join('\n');
}

function buildTmdlDescriptionLines(description) {
    if (description === undefined || description === null || description === '') {
        return [];
    }
    return String(description).split('\n').map(function (line) {
        return '\t/// ' + line;
    });
}

function buildTmdlColumnBlock(col) {
    const lines = ['\tcolumn ' + quoteTmdlName(col.name)];
    lines.push('\t\tdataType: ' + col.tmdlType);
    if (col.isHidden) {
        lines.push('\t\tisHidden');
    }
    lines.push('\t\tsourceColumn: ' + tmdlSourceColumnLiteral(col.name));
    lines.push('\t\tsummarizeBy: ' + col.summarizeBy);
    // D-10: Emit sortByColumn if declared on a manifest column (e.g. Compliance_Risk).
    if (col.sortByColumn) {
        lines.push('\t\tsortByColumn: ' + col.sortByColumn);
    }
    const descLines = buildTmdlDescriptionLines(col.description);
    if (descLines.length > 0) {
        lines.unshift.apply(lines, descLines);
    }
    return lines.join('\n');
}

// Any measure expression containing a newline MUST be emitted as a triple-backtick block, exactly
// like buildCallsPartitionBlock does for the M query. TMDL cannot parse a bare multi-line expression —
// continuation lines classify as `Other!` and Desktop refuses to load the model (18-03 defect A,
// confirmed via real Desktop TMDL parse error on Calls.tmdl line 98). Single-line measures keep the
// existing single-line `measure 'X' = EXPR` form untouched.
function buildTmdlMeasureBlock(measure) {
    const nameLiteral = quoteTmdlName(measure.name);
    let head;
    if (measure.dax.indexOf('\n') !== -1) {
        const indentedExpr = indentTmdlBlock(measure.dax, 2);
        head = '\tmeasure ' + nameLiteral + ' = ```\n' + indentedExpr + '\n\t```';
    } else {
        head = '\tmeasure ' + nameLiteral + ' = ' + measure.dax;
    }
    if (measure.formatString) {
        return head + '\n\t\tformatString: ' + measure.formatString;
    }
    return head;
}

// A calculated column evaluated by the Tabular engine (D-05).
// Emits no sourceColumn line on any path: a calculated column has no upstream column to source from,
// and emitting one makes Desktop fail to load the model (Pitfall 2).
function buildTmdlCalculatedColumnBlock(col) {
    if (!col || !col.dax || typeof col.dax !== 'string' || col.dax.trim() === '') {
        throw new Error(`buildTmdlCalculatedColumnBlock: Column '${col ? col.name : 'unknown'}' is missing required string property 'dax'`);
    }

    const nameLiteral = quoteTmdlName(col.name);
    let head;
    if (col.dax.indexOf('\n') !== -1) {
        const indentedExpr = indentTmdlBlock(col.dax, 2);
        head = '\tcolumn ' + nameLiteral + ' = ```\n' + indentedExpr + '\n\t```';
    } else {
        head = '\tcolumn ' + nameLiteral + ' = ' + col.dax;
    }

    const lines = [head];
    lines.push('\t\tdataType: ' + col.tmdlType);
    if (col.isHidden) {
        lines.push('\t\tisHidden');
    }
    lines.push('\t\tsummarizeBy: ' + col.summarizeBy);
    if (col.sortByColumn) {
        lines.push('\t\tsortByColumn: ' + col.sortByColumn);
    }

    const descLines = buildTmdlDescriptionLines(col.description);
    if (descLines.length > 0) {
        lines.unshift.apply(lines, descLines);
    }

    return lines.join('\n');
}

// M type pairs always use a double-quoted string literal for the column name,
// regardless of whether the name needs TMDL quoting.
function buildTransformColumnTypesPairs() {
    return COLUMN_MANIFEST.map(function (col) {
        return '{"' + col.name + '", ' + col.mType + '}';
    }).join(', ');
}

// Relative File.Contents("data/dashboard-ready.csv") was proven to fail in real Power BI Desktop
// (Microsoft Store build 2.157.879.0, 18-03 D-10 spike): Refresh now on the opened PBIP reported
// "The supplied file path must be a valid absolute path." Power Query's File.Contents rejects the
// relative form outright — there is no project-root working directory for the M engine to resolve
// against. Per D-02/D-04/D-05, the generator now concatenates the CsvFolderPath parameter (see
// CSV_FOLDER_PATH_EXPRESSION_TMDL below) with the constant /data/dashboard-ready.csv suffix.
// The parameter ships unset, and the M guards on that sentinel before touching the filesystem.
// Previously the default was "." — which is a syntactically fine path, so an operator who had not yet
// set the parameter got "The supplied file path must be a valid absolute path", byte-identical to the
// error a genuinely wrong path produces. "Forgot to set it" and "set it wrong" were indistinguishable,
// which is exactly the trap hit during the D-10 spike. Failing on an explicit sentinel lets the model
// say which of the two happened, and say what to do about it.
const CSV_FOLDER_PATH_SENTINEL = '<UNSET>';

function buildCsvFolderPathGuard() {
    const message = 'CsvFolderPath has not been set yet. In Power BI Desktop: Home > Transform data > '
        + 'Edit parameters, set CsvFolderPath to the extracted ' + PBI_PROJECT_NAME + '.SemanticModel '
        + 'folder (the one containing the data folder), select OK, then click Apply changes and Refresh.';
    return '    Configured = if CsvFolderPath = "' + CSV_FOLDER_PATH_SENTINEL + '" then error "'
        + message + '" else CsvFolderPath,';
}

function buildCallsPartitionSource() {
    const pairs = buildTransformColumnTypesPairs();
    const lines = [
        'let',
        buildCsvFolderPathGuard(),
        '    Source = Csv.Document(File.Contents(Configured & "/data/dashboard-ready.csv"), [Delimiter=",", Columns=' + COLUMN_MANIFEST.length + ', Encoding=65001, QuoteStyle=QuoteStyle.Csv]),',
        '    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars=true]),',
        '    Typed = Table.TransformColumnTypes(Promoted, {' + pairs + '}, "en-US")'
    ];

    let lastStep = 'Typed';
    if (typeof CALLS_DERIVED_COLUMNS !== 'undefined' && Array.isArray(CALLS_DERIVED_COLUMNS) && CALLS_DERIVED_COLUMNS.length > 0) {
        lines[lines.length - 1] += ',';
        CALLS_DERIVED_COLUMNS.forEach((col, idx) => {
            const stepName = `Added_${col.name}`;
            const isLast = idx === CALLS_DERIVED_COLUMNS.length - 1;
            const comma = isLast ? '' : ',';
            lines.push(`    ${stepName} = Table.AddColumn(${lastStep}, "${col.name}", ${col.mExpression}, ${col.mType})${comma}`);
            lastStep = stepName;
        });
    }

    lines.push('in');
    lines.push(`    ${lastStep}`);
    return lines.join('\n');
}

// The shipped CSV and the M script that reads it MUST agree on column shape (CR-01, 18-REVIEW).
// `rows` arrives from the caller with whatever keys the user's uploaded CSV happened to have:
// index.html's validateColumns rejects MISSING required columns but permits EXTRA ones, so a
// user CSV carrying one additional field would previously have been serialized straight through
// by Papa.unparse(rows) — producing a 16-column CSV while the M query still declared
// Columns=15 with 15 TransformColumnTypes pairs. Projecting onto COLUMN_MANIFEST here makes the
// two agree by construction rather than by convention: exactly the manifest's columns, in the
// manifest's order, on every run. Extra caller keys are dropped (they are not in the semantic
// model, so they have nowhere to land); absent keys become empty rather than undefined.
// The {fields, data} unparse form is used instead of an array of objects so the header is
// emitted from the manifest even when `rows` is empty — Papa infers fields from the first
// object otherwise, which yields a headerless empty file and a Columns=15 mismatch.
function buildDashboardReadyCsv(rows) {
    const fields = COLUMN_MANIFEST.map(function (col) { return col.name; });
    const data = (rows || []).map(function (row) {
        return fields.map(function (name) {
            const value = row == null ? undefined : row[name];
            return (value === undefined || value === null) ? '' : value;
        });
    });
    return Papa.unparse({ fields: fields, data: data });
}

function buildCallsPartitionBlock() {
    const indentedSource = indentTmdlBlock(buildCallsPartitionSource(), 3);
    return [
        '\tpartition Calls = m',
        '\t\tmode: import',
        '\t\tsource = ```',
        indentedSource,
        '\t\t```'
    ].join('\n');
}

function buildCallsTmdl() {
    const allCols = COLUMN_MANIFEST.concat(typeof CALLS_DERIVED_COLUMNS !== 'undefined' ? CALLS_DERIVED_COLUMNS : []);
    const columnBlocks = allCols.map(buildTmdlColumnBlock).join('\n\n');
    const calcCols = typeof CALLS_CALCULATED_COLUMNS !== 'undefined' ? CALLS_CALCULATED_COLUMNS : [];
    const calculatedColumnBlocks = calcCols.map(buildTmdlCalculatedColumnBlock).join('\n\n');
    const measureBlocks = CALLS_MEASURES.map(buildTmdlMeasureBlock).join('\n\n');
    const partitionBlock = buildCallsPartitionBlock();

    const sections = [
        'table Calls',
        '',
        columnBlocks
    ];
    if (calculatedColumnBlocks) {
        sections.push('', calculatedColumnBlocks);
    }
    sections.push('', measureBlocks, '', partitionBlock, '');
    return sections.join('\n');
}

// D-18, SC8: Dimension table for silence buckets to ensure all 5 buckets render,
// including empty intervals (e.g. 60-120). Sourced from a calculated table DATATABLE expression
// verified empirically in Power BI Desktop 2.157.879.0 (24-DESKTOP-FINDINGS.md).
function buildSilenceBucketsTmdl() {
    const datatableRows = SILENCE_BUCKET_DIMENSION.map(r => `\t\t\t\t\t{ "${r.label}", ${r.order} }`).join(',\n');
    const partitionBlock = [
        '\tpartition SilenceBuckets = calculated',
        '\t\tmode: import',
        '\t\tsource =',
        '\t\t\tDATATABLE(',
        '\t\t\t\t"Bucket_Label", STRING,',
        '\t\t\t\t"Bucket_Order", INTEGER,',
        '\t\t\t\t{',
        datatableRows,
        '\t\t\t\t}',
        '\t\t\t)'
    ].join('\n');

    const sections = [
        'table SilenceBuckets',
        '\tlineageTag: a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        '',
        '\tcolumn Bucket_Label',
        '\t\tdataType: string',
        '\t\tlineageTag: b2c3d4e5-f6a7-8901-bcde-f12345678901',
        '\t\tsummarizeBy: none',
        '\t\tisNameInferred',
        '\t\tsourceColumn: [Bucket_Label]',
        '\t\tsortByColumn: Bucket_Order',
        '',
        '\t\tannotation SummarizationSetBy = Automatic',
        '',
        '\tcolumn Bucket_Order',
        '\t\tdataType: int64',
        '\t\tformatString: 0',
        '\t\tlineageTag: c3d4e5f6-a7b8-9012-cdef-123456789012',
        '\t\tsummarizeBy: none',
        '\t\tisNameInferred',
        '\t\tsourceColumn: [Bucket_Order]',
        '',
        '\t\tannotation SummarizationSetBy = Automatic',
        '',
        partitionBlock,
        '',
        '\tannotation PBI_Id = a1b2c3d4e5f67890abcdef1234567890',
        ''
    ];
    return sections.join('\n');
}

// D-08, Phase 34: Dimension table for empathy buckets to ensure all 5 buckets render,
// including empty intervals (e.g. 0-20 with minimum empathy score 30).
// Sourced from a calculated table DATATABLE expression.
function buildEmpathyBucketsTmdl() {
    const datatableRows = EMPATHY_BUCKET_DIMENSION.map(r => `\t\t\t\t\t{ "${r.label}", ${r.order} }`).join(',\n');
    const partitionBlock = [
        '\tpartition EmpathyBuckets = calculated',
        '\t\tmode: import',
        '\t\tsource =',
        '\t\t\tDATATABLE(',
        '\t\t\t\t"Bucket_Label", STRING,',
        '\t\t\t\t"Bucket_Order", INTEGER,',
        '\t\t\t\t{',
        datatableRows,
        '\t\t\t\t}',
        '\t\t\t)'
    ].join('\n');

    const sections = [
        'table EmpathyBuckets',
        '\tlineageTag: 34e1b0c2-7a4d-4f19-8b36-05c9d2e7a1f4',
        '',
        '\tcolumn Bucket_Label',
        '\t\tdataType: string',
        '\t\tlineageTag: 34e2b1c3-8b5e-4a27-9c48-16d0e3f8b205',
        '\t\tsummarizeBy: none',
        '\t\tisNameInferred',
        '\t\tsourceColumn: [Bucket_Label]',
        '\t\tsortByColumn: Bucket_Order',
        '',
        '\t\tannotation SummarizationSetBy = Automatic',
        '',
        '\tcolumn Bucket_Order',
        '\t\tdataType: int64',
        '\t\tformatString: 0',
        '\t\tlineageTag: 34e3b2c4-9c6f-4b38-ad59-27e1f409c316',
        '\t\tsummarizeBy: none',
        '\t\tisNameInferred',
        '\t\tsourceColumn: [Bucket_Order]',
        '',
        '\t\tannotation SummarizationSetBy = Automatic',
        '',
        partitionBlock,
        '',
        '\tannotation PBI_Id = 34e1b0c27a4d4f198b3605c9d2e7a1f4',
        ''
    ];
    return sections.join('\n');
}

// D-09, D-10, D-11: Dimension table for date dimension, marked as Date table (Time)
// with DAX-computed whole-calendar-year bounds (D-08).
function buildDateTableTmdl() {
    const partitionBlock = [
        '\tpartition DateTable = calculated',
        '\t\tmode: import',
        '\t\tsource =',
        '\t\t\tADDCOLUMNS(',
        '\t\t\t\tCALENDAR(',
        "\t\t\t\t\tDATE(YEAR(MIN('Calls'[Call_Date])), 1, 1),",
        "\t\t\t\t\tDATE(YEAR(MAX('Calls'[Call_Date])), 12, 31)",
        '\t\t\t\t),',
        '\t\t\t\t"Year", YEAR([Date]),',
        '\t\t\t\t"Month_Number", MONTH([Date]),',
        '\t\t\t\t"Month_Name", FORMAT([Date], "MMM")',
        '\t\t\t)'
    ].join('\n');

    const sections = [
        'table DateTable',
        '\tlineageTag: d4e5f6a7-b8c9-0123-def0-234567890123',
        '\tdataCategory: Time',
        '',
        '\tcolumn Date',
        '\t\tisKey',
        '\t\tdataType: dateTime',
        '\t\tformatString: Short Date',
        '\t\tlineageTag: e5f6a7b8-c9d0-1234-ef01-345678901234',
        '\t\tsummarizeBy: none',
        '\t\tisNameInferred',
        '\t\tsourceColumn: [Date]',
        '',
        '\t\tannotation SummarizationSetBy = Automatic',
        '',
        '\tcolumn Year',
        '\t\tdataType: int64',
        '\t\tformatString: 0',
        '\t\tlineageTag: f6a7b8c9-d0e1-2345-f012-456789012345',
        '\t\tsummarizeBy: none',
        '\t\tisNameInferred',
        '\t\tsourceColumn: [Year]',
        '',
        '\t\tannotation SummarizationSetBy = Automatic',
        '',
        '\tcolumn Month_Number',
        '\t\tdataType: int64',
        '\t\tformatString: 0',
        '\t\tlineageTag: a7b8c9d0-e1f2-3456-0123-567890123456',
        '\t\tsummarizeBy: none',
        '\t\tisHidden',
        '\t\tisNameInferred',
        '\t\tsourceColumn: [Month_Number]',
        '',
        '\t\tannotation SummarizationSetBy = Automatic',
        '',
        '\tcolumn Month_Name',
        '\t\tdataType: string',
        '\t\tlineageTag: b8c9d0e1-f2a3-4567-1234-678901234567',
        '\t\tsummarizeBy: none',
        '\t\tisNameInferred',
        '\t\tsourceColumn: [Month_Name]',
        '\t\tsortByColumn: Month_Number',
        '',
        '\t\tannotation SummarizationSetBy = Automatic',
        '',
        partitionBlock,
        '',
        '\tannotation PBI_Id = d4e5f6a7b8c90123def0234567890123',
        ''
    ];
    return sections.join('\n');
}

var PBI_DATE_TABLE_COLUMNS = ['Date', 'Year', 'Month_Number', 'Month_Name'];

// Fixed relationship GUID for deterministic byte-identical export (D-18, T-24-23).
var PBI_SILENCE_RELATIONSHIP_ID = 'cdb6e6a9-c9d1-42b9-b9e0-484a1bc7e123';
var PBI_DATE_RELATIONSHIP_ID = 'f3a7c21d-9b48-4e05-a6d2-71c8ef049b3a';
var PBI_EMPATHY_RELATIONSHIP_ID = '34f0a1b2-c3d4-4e56-9f78-0a1b2c3d4e5f';

// Relationship registry (REFAC-01, D-05, D-06):
// (a) Every id is a hardcoded literal that is a valid stable identifier and distinct from every other entry's,
//     never derived and never randomized, matching the PBI_LOGICAL_IDS rationale directly above.
// (b) Optional fields (cardinality, crossFilteringBehavior, isActive) emit their TMDL line only when the entry
//     defines them, which keeps the existing entry byte-identical.
// (c) Ordering rule: relationship TMDL blocks emit in array order, never sorted.
var PBI_RELATIONSHIPS = [
    {
        id: PBI_SILENCE_RELATIONSHIP_ID,
        fromColumn: 'Calls.Silence_Bucket',
        toColumn: 'SilenceBuckets.Bucket_Label'
    },
    {
        id: PBI_DATE_RELATIONSHIP_ID,
        fromColumn: 'Calls.Call_Date',
        toColumn: 'DateTable.Date',
        crossFilteringBehavior: 'oneDirection'
    },
    {
        id: PBI_EMPATHY_RELATIONSHIP_ID,
        fromColumn: 'Calls.Empathy_Bucket',
        toColumn: 'EmpathyBuckets.Bucket_Label'
    }
];

function buildRelationshipsTmdl() {
    var blocks = [];
    for (var i = 0; i < PBI_RELATIONSHIPS.length; i++) {
        var entry = PBI_RELATIONSHIPS[i];
        var lines = [
            `relationship ${entry.id}`,
            `\tfromColumn: ${entry.fromColumn}`,
            `\ttoColumn: ${entry.toColumn}`
        ];
        if (entry.cardinality !== undefined) {
            lines.push(`\tcardinality: ${entry.cardinality}`);
        }
        if (entry.crossFilteringBehavior !== undefined) {
            lines.push(`\tcrossFilteringBehavior: ${entry.crossFilteringBehavior}`);
        }
        if (entry.isActive !== undefined) {
            lines.push(`\tisActive: ${entry.isActive}`);
        }
        lines.push('');
        blocks.push(lines.join('\n'));
    }
    return blocks.join('\n');
}

// Fixed logicalIds, one per artifact type. Desktop mints these randomly at authoring time, but the
// generator must produce byte-identical output on every run (QUAL-02, 18-02) — `crypto.randomUUID()`
// broke that, and was the last source of run-to-run non-determinism in the file map. It was also an
// availability hazard (18-REVIEW IN-03): randomUUID is a Secure Contexts API, and this dashboard is
// designed to open with no server, so a file:// origin could throw an opaque TypeError deep inside
// JSON construction. Fixed constants remove both problems at once. Desktop only requires a logicalId
// to be a syntactically valid, stable GUID — not any particular derivation — and the two artifacts
// only need to differ from each other, which they do. Same reasoning as PBI_SCAFFOLD_PAGE_ID above.
const PBI_LOGICAL_IDS = {
    SemanticModel: 'b7c1f2a4-3d58-4e6b-9a02-5c8e1d7f40b3',
    Report: 'e93a6d18-2f47-4c85-b1de-70a9c34f2b6e'
};

function buildPlatformFile(type, displayName) {
    const logicalId = PBI_LOGICAL_IDS[type];
    if (!logicalId) {
        throw new Error(`No logicalId registered for artifact type: ${type}`);
    }
    return JSON.stringify({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
        "metadata": {
            "type": type,
            "displayName": displayName
        },
        "config": {
            "version": "2.0",
            "logicalId": logicalId
        }
    }, null, 2);
}

// CsvFolderPath fallback parameter (18-03 D-10 relative-fail branch, D-02/D-04/D-05).
// Shape verified against the official TMDL parameter example (learn.microsoft.com/en-us/analysis-services/tmdl/tmdl-overview,
// "expression Server = \"localhost\" meta [IsParameterQuery=true, ...]"). Default "." is the relative
// location of the SemanticModel folder that contains data/, so a working absolute paste needs only
// one edit, never a rebuild (D-04). Operator paste target is the extracted DexcomAnalytics.SemanticModel
// folder — the folder that CONTAINS data/, not the ZIP root and not the CSV file itself (D-02).
// Default is the sentinel, not "." — see CSV_FOLDER_PATH_SENTINEL above for why. Both sites read the
// same constant so the default and the M guard cannot drift apart.
const CSV_FOLDER_PATH_EXPRESSION_TMDL = 'expression CsvFolderPath = "' + CSV_FOLDER_PATH_SENTINEL + '" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]\n';

// Report theme resource (18-03 continuation, H3 hybrid-test reversal of cad6ec8).
// cad6ec8 removed the report.json themeCollection/resourcePackages reference on the reasoning that
// "nothing in the schema requires themeCollection" and a dangling reference is fixed by dropping it.
// That reasoning was DISPROVED empirically: a hybrid tree (C:\Temp\pbi-h3) built from this generator's
// output but with the Desktop-authored report.json (themeCollection + resourcePackages intact) AND the
// real Fluent2-CY26SU08.json theme file restored opened WITHOUT "Something went wrong" in real Power BI
// Desktop, while the generator's theme-less report.json produced exactly that failure. Power BI Desktop
// REQUIRES the report's base theme resource to resolve — the correct fix for a dangling reference here
// was always to ship the referenced file, not delete the reference (option (b), not cad6ec8's option (a)).
// The baseline Fluent2-CY26SU08.json is 97.2 KB; embedding it in this ~14 KB browser-loaded generator
// would bloat every generated ZIP by ~8x. This constant ships a MINIMAL theme instead: only the "name"
// field, which is the sole field this generator's own reasoning (and the theme schema's example shape)
// treats as unconditionally present. Whether Desktop accepts a name-only theme, or needs more of the
// baseline's shape (dataColors etc.), is NOT yet Desktop-confirmed — this is the open half of H3, staged
// as the pbi-spike-a / pbi-spike-nested trees for the human round-2 session, with a full-theme fallback
// tree (pbi-fulltheme, built from the real baseline file, not embedded here) if the minimal theme fails.
const REPORT_THEME_MINIMAL_JSON = JSON.stringify({
    "name": "Fluent 2 (Preview)"
}, null, 2);

// Acme custom theme (D-01, D-02, D-03, D-05).
// - Custom theme is layered over the untouched base theme (D-01).
// - Asset path is locked (LOCKED for Phases 20-22 per Phase 17 D-15), which ensures pages inherit this theme (D-02).
// - Theme name is the string Desktop shows in View > Themes (D-03). A real Power BI Desktop session confirmed the bare display name `Acme` resolves for a hand-authored `RegisteredResources` custom theme, which closes Phase 19 RESEARCH assumption A1 in favour of the `baseTheme` convention this codebase already proved.
// - This constant is the single source both builders read, which is what the drift probe enforces (D-05).
// - No color value here is computed at runtime or build time per ARCHITECTURE.md:194 / D-12. Every hex is a pasted literal.
// 
// dataColors (D-10, D-13): The four wash-out tokens (#F8F8F8, #C8C7CB, #C7E4D5) and the borderline #DAC6AB are deliberately not in dataColors (D-10).
// Primary_Category has exactly six distinct values in the demo CSV (D-10), so the first six slots alternate green / near-black / light-warm / dark-warm / pale-green / mid-warm to maximise adjacent-slot contrast where it actually matters.
//
// Diverging scale and semantic slots (D-16, D-17, D-18): The theme fixes the three colors and deliberately supplies no numeric range (D-15), so Desktop's auto-range handles whatever a user's uploaded CSV actually contains rather than being clipped to the demo data's -65 to 85. 
// Microsoft's theme schema has no numeric value field for minimum/center/maximum at all and forbids conditional-formatting rules in a custom theme. Therefore, the zero-centered numeric anchoring named by THEME-03 and ROADMAP success criterion 2 is owned by Phase 20/21: the first visual bound to Customer_Sentiment must set an explicit `centerValue` of `0` in its own conditional-formatting JSON, referencing these theme colors. Phase 19 ships the colors only.
// Green means good report-wide (D-18), so a Phase 21 visual bound to Compliance Risk Rate or any other higher-is-worse measure must invert the scale at the visual level.
// 
// Midtone palette direction (D-12, D-13): The canvas is darkened forestgreen (#264B27, forestgreen 70% toward black),
// secondaryBackground is one step lighter (#2D602C, forestgreen 55% toward black) for card/panel surfaces,
// and firstLevelElements is whitesmoke (#F8F8F8) for high contrast. Data marks lead with light forestgreen tints
// (#9AD496, #76C470) to stand out against the green ground. PDF export brightness trade-off is accepted (D-13).
//
// Semantic slots: good uses light forestgreen #9AD496; neutral uses silver #C8C7CB; bad uses warm tan #DAC6AB.
// Zero-centered sentiment diverging trio: maximum #9AD496, center #DAC6AB, minimum #89705D.
// Note: Registered image payloads (e.g. BRAND_ICON_PNG_BASE64, PBI_REGISTERED_IMAGES) are placed in the
// REGISTERED IMAGE PAYLOADS block at the end of this file to keep this readable configuration region uncluttered.
// ACME_TOKENS: Single source of truth mirroring brand.css and index.html (Slate / Sky design system tokens).
var ACME_TOKENS = {
    canvas: '#020617',          // Slate 950: Page canvas ground matching web dashboard
    header: '#0F172A',          // Slate 900: Header band ground
    surface: '#0F172A',         // Slate 900: Card & visual container surfaces
    surfaceElevated: '#1E293B', // Slate 800: Elevated chips / sub-surfaces
    border: '#1E293B',          // Slate 800: Container borders
    borderMuted: '#334155',     // Slate 700: Secondary borders / dividers
    accent: '#0284C7',          // Sky 600: Primary brand accent / chart data marks
    accentLight: '#38BDF8',     // Sky 400: Secondary accent
    accentMid: '#0EA5E9',       // Sky 500: Tertiary accent
    textPrimary: '#F8FAFC',     // Slate 50: High-contrast headings and callouts
    textSecondary: '#94A3B8',   // Slate 400: Labels, secondary axis text, subtitles
    textMuted: '#64748B',       // Slate 500: Muted metadata
    success: '#10B981',         // Emerald 500: High performance / good
    warning: '#F59E0B',         // Amber 500: Moderate / center
    danger: '#EF4444',          // Rose 500: Risk / low performance
    indigo: '#818CF8'           // Indigo 400
};

// Computes an 8-bit source-over composite of hex over pure white (#FFFFFF).
function blendOverWhite(hex, alpha8) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const rComp = Math.round(255 + (r - 255) * alpha8 / 255);
    const gComp = Math.round(255 + (g - 255) * alpha8 / 255);
    const bComp = Math.round(255 + (b - 255) * alpha8 / 255);
    return '#' + [rComp, gComp, bComp].map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0').toUpperCase()).join('');
}

// Derived canvas background: Slate 950 canvas matching the web dashboard (#020617).
var PBI_CANVAS_BACKGROUND = ACME_TOKENS.canvas;

var PBI_THEME = {
    fileName: 'AcmeTheme.json',
    theme: {
        name: 'Acme',
        dataColors: [
            ACME_TOKENS.accent,       // #0284C7: primary brand accent (Sky 600)
            ACME_TOKENS.accentLight,  // #38BDF8: secondary accent (Sky 400)
            ACME_TOKENS.accentMid,    // #0EA5E9: tertiary accent (Sky 500)
            ACME_TOKENS.indigo,       // #818CF8: indigo accent
            ACME_TOKENS.success,      // #10B981: emerald 500
            ACME_TOKENS.warning,      // #F59E0B: amber 500
            ACME_TOKENS.danger,       // #EF4444: rose 500
            ACME_TOKENS.textSecondary // #94A3B8: slate 400 neutral
        ],
        maximum: ACME_TOKENS.accent,
        center: ACME_TOKENS.warning,
        minimum: ACME_TOKENS.danger,
        good: ACME_TOKENS.success,
        neutral: ACME_TOKENS.textSecondary,
        bad: ACME_TOKENS.danger,
        background: PBI_CANVAS_BACKGROUND,
        firstLevelElements: ACME_TOKENS.textPrimary,
        secondaryBackground: ACME_TOKENS.surface,
        tableAccent: ACME_TOKENS.accent,
        textClasses: {
            callout: { fontSize: 26, color: ACME_TOKENS.textPrimary },
            title: { fontSize: 14, color: ACME_TOKENS.textPrimary },
            header: { fontSize: 12, color: ACME_TOKENS.textPrimary },
            label: { fontSize: 10, color: ACME_TOKENS.textSecondary }
        },
        visualStyles: {
            page: {
                "*": {
                    background: [
                        {
                            color: { solid: { color: PBI_CANVAS_BACKGROUND } },
                            transparency: 0
                        }
                    ],
                    outspace: [
                        {
                            color: { solid: { color: PBI_CANVAS_BACKGROUND } },
                            transparency: 0
                        }
                    ]
                }
            },
            "*": {
                "*": {
                    "*": [
                        {
                            wordWrap: true
                        }
                    ],
                    // D-11: Theme sets title typography and alignment but intentionally omits `show`.
                    // Title on/off and title text remain per-visual so a slot without chartTitle cannot
                    // silently fall back to Power BI's auto-generated title.
                    title: [
                        {
                            fontColor: { solid: { color: ACME_TOKENS.textPrimary } },
                            fontSize: 14,
                            alignment: 'left',
                            titleWrap: false
                        }
                    ],
                    subtitle: [
                        {
                            fontColor: { solid: { color: ACME_TOKENS.textSecondary } },
                            fontSize: 11
                        }
                    ],
                    categoryAxis: [
                        {
                            show: true,
                            showAxisTitle: true,
                            labelColor: { solid: { color: ACME_TOKENS.textSecondary } },
                            titleColor: { solid: { color: ACME_TOKENS.textSecondary } },
                            gridlineStyle: 'none'
                        }
                    ],
                    valueAxis: [
                        {
                            show: true,
                            showAxisTitle: true,
                            start: 0,
                            labelColor: { solid: { color: ACME_TOKENS.textSecondary } },
                            titleColor: { solid: { color: ACME_TOKENS.textSecondary } },
                            gridlineStyle: 'none'
                        }
                    ],
                    labels: [
                        {
                            color: { solid: { color: ACME_TOKENS.textPrimary } }
                        }
                    ],
                    background: [
                        {
                            color: { solid: { color: ACME_TOKENS.surface } },
                            transparency: 0
                        }
                    ],
                    border: [
                        {
                            show: true,
                            color: { solid: { color: ACME_TOKENS.border } },
                            radius: 0
                        }
                    ]
                }
            },
            clusteredBarChart: {
                "*": {
                    dataPoint: [
                        {
                            defaultColor: { solid: { color: ACME_TOKENS.accent } }
                        }
                    ]
                }
            },
            columnChart: {
                "*": {
                    dataPoint: [
                        {
                            defaultColor: { solid: { color: ACME_TOKENS.accent } }
                        }
                    ]
                }
            },
            lineChart: {
                "*": {
                    dataPoint: [
                        {
                            defaultColor: { solid: { color: ACME_TOKENS.accent } }
                        }
                    ]
                }
            },
            slicer: {
                "*": {
                    header: [
                        {
                            fontColor: { solid: { color: ACME_TOKENS.textPrimary } }
                        }
                    ],
                    items: [
                        {
                            fontColor: { solid: { color: ACME_TOKENS.textPrimary } }
                        }
                    ],
                    background: [
                        {
                            color: { solid: { color: ACME_TOKENS.surface } },
                            transparency: 0
                        }
                    ],
                    border: [
                        {
                            show: true,
                            color: { solid: { color: ACME_TOKENS.border } },
                            radius: 0
                        }
                    ]
                }
            },
            textbox: {
                "*": {
                    background: [
                        {
                            show: true,
                            color: { solid: { color: ACME_TOKENS.header } },
                            transparency: 0
                        }
                    ],
                    border: [
                        {
                            show: false
                        }
                    ]
                }
            },
            image: {
                "*": {
                    background: [
                        {
                            show: false
                        }
                    ],
                    border: [
                        {
                            show: false
                        }
                    ]
                }
            },
            cardVisual: {
                "*": {
                    "*": [
                        {
                            $id: 'default',
                            displayUnits: 1,
                            labelDisplayUnits: 1,
                            outline: false
                        }
                    ],
                    value: [
                        {
                            fontSize: 26,
                            fontColor: { solid: { color: ACME_TOKENS.textPrimary } }
                        }
                    ],
                    label: [
                        {
                            fontSize: 11,
                            fontColor: { solid: { color: ACME_TOKENS.textSecondary } }
                        }
                    ],
                    padding: [
                        {
                            top: 8,
                            bottom: 8,
                            left: 12,
                            right: 12
                        }
                    ],
                    outline: [
                        {
                            show: false
                        }
                    ],
                    background: [
                        {
                            color: { solid: { color: ACME_TOKENS.surface } },
                            transparency: 0
                        }
                    ],
                    border: [
                        {
                            show: true,
                            color: { solid: { color: ACME_TOKENS.border } },
                            radius: 0
                        }
                    ]
                }
            }
        }
    }
};

// Card visual minimum height (sizing pre-check from Microsoft's first-party card.md, cited in 20-RESEARCH.md).
// A cardVisual requires minimum 114px with 20pt value and 12pt label without title; 120px recommended.
// Reference labels have their own dedicated region (~50% of card) post-GA Nov 2025. Guards against clipping (G-20-2 / UAT Test 2).
const PBI_CARD_MIN_HEIGHT = 114;
var PBI_HEADER_BAND_HEIGHT = 72;


// Layout manifest (D-11, D-04, D-06)
// The 1920x1080 canvas is carved up in one place so overlaps and off-canvas coordinates are checkable structurally (D-11).
// Option A (D-06): The 7 deltaCard slots were folded into native referenceLabel properties on the 7 primary card slots.
// Sizing constraint: Primary cards are 134px high (y: 120-254).
var PBI_EXEC_LAYOUT = [
    { key: 'headerBand', id: '0c1a5e7b3d9f204186ea', kind: 'textbox', layer: 'background', x: 0, y: 0, z: 0, width: 1920, height: PBI_HEADER_BAND_HEIGHT, title: 'Executive Hub', alignment: 'center' },
    { key: 'brandIcon', id: '9c1e4f7a2b58d03e6114', kind: 'image', x: 24, y: 16, z: 1, width: 40, height: 40, itemName: 'brand-icon.png' },
    { key: 'brandWordmark', id: '0d2f5a8b3c6e1749502b', kind: 'image', x: 80, y: 17, z: 2, width: 280, height: 38, itemName: 'brand-text.png' },
    { key: 'relativeDateSlicer', id: 'd3e0a7c19f2b8465ad10', kind: 'slicer', x: 944, y: 88, z: 5, width: 240, height: 88, slicerOptions: { entity: 'DateTable', column: 'Date', mode: 'Relative' } },
    { key: 'dateSlicer', id: 'a0e94b18d5c7360f2b83', kind: 'slicer', x: 1200, y: 88, z: 3, width: 440, height: 88, slicerOptions: { entity: 'DateTable', column: 'Date', mode: 'Between', syncGroup: { groupName: 'DateSync', fieldChanges: true, filterChanges: true } } },
    { key: 'categorySlicer', id: 'b17c60ea294f8d3501ba', kind: 'slicer', x: 1656, y: 88, z: 4, width: 240, height: 88, slicerOptions: { column: 'Primary_Category', mode: 'Dropdown' } },
    { key: 'cardTotalCalls', id: '1b7e4a2c8f60d3591c4b', kind: 'card', x: 24, y: 192, z: 10, width: 252, height: 134, label: 'Call Volume', measure: 'Total Calls', deltaMeasure: 'Total Calls Delta %', deltaDirection: 'normal', baselineLabel: PBI_DELTA_BASELINE_LABEL },
    { key: 'cardAvgHandleTime', id: '2d9f6b0a4e13c78520fa', kind: 'card', x: 294, y: 192, z: 11, width: 252, height: 134, label: 'Avg Handle Time', measure: 'Avg Handle Time (s)', deltaMeasure: 'Avg Handle Time Delta %', deltaDirection: 'invert', baselineLabel: PBI_DELTA_BASELINE_LABEL },
    { key: 'cardAvgSilencePct', id: '3a4c8e15b7d02f96e831', kind: 'card', x: 564, y: 192, z: 12, width: 252, height: 134, label: 'Avg Silence %', measure: 'Avg Silence %', deltaMeasure: 'Avg Silence Delta pts', deltaDirection: 'invert', baselineLabel: PBI_DELTA_BASELINE_LABEL },
    { key: 'cardFcrRate', id: '4f0b23d78a1c5e69b0d4', kind: 'card', x: 834, y: 192, z: 13, width: 252, height: 134, label: 'FCR Rate', measure: 'FCR Rate', deltaMeasure: 'FCR Rate Delta pts', deltaDirection: 'normal', baselineLabel: PBI_DELTA_BASELINE_LABEL },
    { key: 'cardAvgQaScore', id: '5e6d19af03b74c28d5a0', kind: 'card', x: 1104, y: 192, z: 14, width: 252, height: 134, label: 'Avg QA Score (/100)', measure: 'Avg QA Score', deltaMeasure: 'Avg QA Score Delta %', deltaDirection: 'normal', baselineLabel: PBI_DELTA_BASELINE_LABEL },
    { key: 'cardAvgSentiment', id: '6b2708c4e9a15d3f70bc', kind: 'card', x: 1374, y: 192, z: 15, width: 252, height: 134, label: 'Avg Sentiment (-100 to +100)', measure: 'Avg Sentiment', deltaMeasure: 'Avg Sentiment Delta %', deltaDirection: 'normal', baselineLabel: PBI_DELTA_BASELINE_LABEL },
    { key: 'cardComplianceRisk', id: '7c8a35f1602bd94e8a17', kind: 'card', x: 1644, y: 192, z: 16, width: 252, height: 134, label: '% of Calls Flagged', measure: 'Compliance Risk Rate', deltaMeasure: 'Compliance Risk Rate Delta pts', deltaDirection: 'invert', baselineLabel: PBI_DELTA_BASELINE_LABEL },
    { key: 'lineVolumeTrend', id: '8d15e0b96c4a273f01de', kind: 'line', x: 24, y: 342, z: 20, width: 1872, height: 332, chartTitle: 'Call Volume Over Time', titleMeasure: 'Exec Headline Title', axisFloor: 100 },
    // D-16, D-03: Primary category breakdown plots Total Calls sorted descending by value.
    // Space paid out of barPrimaryCategory width (narrowed from 1872 to 1400, leaving 24px gutter before gauge at x=1448).
    // Count axis stays zero-based (no axisFloor) because truncating a count axis misrepresents magnitude (D-17).
    { key: 'barPrimaryCategory', id: '9a3f7c2e5081bd64f29c', kind: 'bar', x: 24, y: 690, z: 21, width: 1400, height: 374, column: 'Primary_Category', measure: 'Total Calls', visualType: 'clusteredBarChart', chartTitle: 'Calls by Category', sort: { field: 'Total Calls', direction: 'Descending' } },
    // TGT-02, D-02, D-03: FCR Rate gauge with native target role projection against FCR Target
    { key: 'gaugeFcrRate', id: '7c1d4a0e9b62f38a5d14', kind: 'gauge', x: 1448, y: 690, z: 22, width: 448, height: 374, measure: 'FCR Rate', axisMin: 0, axisMax: 1, chartTitle: 'FCR Rate vs Target' }
];

// D-07, D-08: deriveDeltaPresentationMeasures maps over PBI_EXEC_LAYOUT card slots and generates
// runtime-signed Label measures carrying the direction glyph (▲/▼) and formatted value.
// Option C: cardValueColorMeasure was refuted, so glyph carries direction alone.
function deriveDeltaPresentationMeasures() {
    const derived = [];
    for (const slot of PBI_EXEC_LAYOUT) {
        if (slot.kind !== 'card' || !slot.deltaMeasure) continue;
        const targetMeasure = CALLS_MEASURES.find(m => m.name === slot.deltaMeasure);
        const fmt = (targetMeasure && targetMeasure.formatString) ? targetMeasure.formatString : '+0.0%;-0.0%;0.0%';
        const escapedFmt = fmt.replace(/"/g, '""');
        const upGlyph = '▲';
        const downGlyph = '▼';

        // Label measure returns glyph + space + formatted delta
        derived.push({
            name: `${slot.deltaMeasure} Label`,
            dax: `VAR _delta = [${slot.deltaMeasure}]\nRETURN IF(ISBLANK(_delta), "-", IF(_delta > 0, "${upGlyph} ", IF(_delta < 0, "${downGlyph} ", "")) & FORMAT(_delta, "${escapedFmt}"))`
        });
    }
    return derived;
}

// Append derived measures to CALLS_MEASURES immediately after PBI_EXEC_LAYOUT definition.
// Must happen before buildCallsTmdl or validation runs.
CALLS_MEASURES.push(...deriveDeltaPresentationMeasures());

// Layout manifest for Ops/QA Command page (D-15).
// Deliberate parallel of PBI_EXEC_LAYOUT rather than consolidation into a page-keyed map (D-15).
// The 1920x1080 canvas is carved up in one place so overlap and off-canvas coordinates are structurally checkable.
// Band height matches PBI_HEADER_BAND_HEIGHT (72px). The Ops page has no delta fold to pay for the band,
// so its 72px comes out of the two bottom bar charts (reduced from 448px to 376px height).
// `var` (not `const`) so this attaches to the vm sandbox's global object for verification harnesses.
var PBI_OPS_LAYOUT = [
    { key: 'headerBand', id: '1a2b3c4d5e6f70819203', kind: 'textbox', layer: 'background', x: 0, y: 0, z: 0, width: 1920, height: PBI_HEADER_BAND_HEIGHT, title: 'Ops/QA Command', alignment: 'center' },
    { key: 'brandIcon', id: '2c3d4e5f60718293a4b5', kind: 'image', x: 24, y: 16, z: 1, width: 40, height: 40, itemName: 'brand-icon.png' },
    { key: 'brandWordmark', id: '3d4e5f60718293a4b5c6', kind: 'image', x: 80, y: 17, z: 2, width: 280, height: 38, itemName: 'brand-text.png' },
    { key: 'relativeDateSlicer', id: 'e4f1b8d2a03c9576be21', kind: 'slicer', x: 712, y: 88, z: 6, width: 240, height: 88, slicerOptions: { entity: 'DateTable', column: 'Date', mode: 'Relative' } },
    // D-12: The date slicer joins the cross-page DateSync group so this page opens on the same populated sub-range
    // the Executive Hub does; queue and agent deliberately do not, because there is nothing on the other page to sync them to.
    { key: 'dateSlicer', id: '2b3c4d5e6f708192a3b4', kind: 'slicer', x: 968, y: 88, z: 3, width: 440, height: 88, slicerOptions: { entity: 'DateTable', column: 'Date', mode: 'Between', syncGroup: { groupName: 'DateSync', fieldChanges: true, filterChanges: true } } },
    { key: 'queueSlicer', id: '3c4d5e6f708192a3b4c5', kind: 'slicer', x: 1424, y: 88, z: 4, width: 232, height: 88, slicerOptions: { column: 'Queue_Name', mode: 'Dropdown' } },
    { key: 'agentSlicer', id: '4d5e6f708192a3b4c5d6', kind: 'slicer', x: 1672, y: 88, z: 5, width: 224, height: 88, slicerOptions: { column: 'Agent_ID', mode: 'Dropdown' } },
    { key: 'scatterSilenceQa', id: '5e6f708192a3b4c5d6e7', kind: 'scatter', x: 24, y: 192, z: 10, width: 1160, height: 480, chartTitle: 'QA Score vs Silence % by Agent', titleMeasure: 'Ops Headline Title', axisFloor: 80 },
    // OPS-04, D-06, D-07, D-15, D-18: Power BI has no native histogram visual; a column chart over a pre-bucketed
    // dimension table is the standard stand-in. showItemsWithNoData alone failed to render the empty 60-120 interval
    // because Silence_Bucket was a calculated column with 0 matching rows (no category existed in the column domain).
    // Sourcing the category from the SilenceBuckets dimension table allows showAll: true to enumerate the full domain (D-18).
    { key: 'columnSilenceBuckets', id: '8192a3b4c5d6e7f8091a', kind: 'column', x: 1200, y: 192, z: 11, width: 696, height: 480, entity: 'SilenceBuckets', column: 'Bucket_Label', measure: 'Total Calls', visualType: 'columnChart', chartTitle: 'Silence Duration Distribution in Seconds', showItemsWithNoData: true },
    // D-10, D-16, D-17: Queue breakdown plots Avg QA Score across all queues (no TopN filter). Descending sort on Avg QA Score and 75 axis floor.
    { key: 'barQueueBreakdown', id: '6f708192a3b4c5d6e7f8', kind: 'bar', x: 24, y: 688, z: 12, width: 928, height: 376, column: 'Queue_Name', measure: 'Avg QA Score', visualType: 'clusteredBarChart', chartTitle: 'Avg QA Score by Queue', sort: { field: 'Avg QA Score', direction: 'Descending' }, axisFloor: 75 },
    // D-09, D-16, D-17, D-20: Agent breakdown plots Avg QA Score limited to 10 lowest agents via native TopN filter (Direction: 1, Function: 1 on Agent_Quality).
    // Stated coaching exception to descending sort: Ascending puts lowest-scoring agent in need of coaching first.
    // 75 axis floor matches barQueueBreakdown so real QA differences are legible. Retitled to omit digit (D-20).
    { key: 'barAgentBreakdown', id: '708192a3b4c5d6e7f809', kind: 'bar', x: 968, y: 688, z: 13, width: 928, height: 376, column: 'Agent_ID', measure: 'Avg QA Score', visualType: 'clusteredBarChart', chartTitle: 'Coaching Focus: Lowest Avg QA Scores', sort: { field: 'Avg QA Score', direction: 'Ascending' }, axisFloor: 75, topN: { filterName: 'Filter7f0a1b2c3d4e5f60718293a4', orderByColumn: 'Agent_Quality', aggregationFunction: 1, direction: 1, top: 10 } }
];

// 20-lowercase-hex Desktop-style page id, matching the convention observed in the Desktop-authored
// baseline (powerbi/test.Report/definition/pages/35b9d4ffda62a8d1350f/). Desktop normally mints this
// randomly per page at authoring time, but the generator must produce byte-identical output on every
// run (QUAL-02, 18-02), so neither Math.random() nor a timestamp is usable here. A fixed constant is
// chosen over a hash of PBI_PROJECT_NAME: Desktop only requires this to be a syntactically opaque
// identifier (not any particular derivation), so a literal constant is equally valid and simpler to
// keep at exactly 20 hex characters forever.
// Constants for Call Detail drill-through page (Phase 33, D-01, D-02, D-03, D-06, D-08, D-10, D-13, D-14)
var PBI_CALL_DETAIL_PAGE_ID = 'd4e5f6a7b8c9d0e1f2a3';

// 20-lowercase-hex fixed literal for Compliance & Coaching page (Phase 34, D-13, D-17).
// Byte-identical output forbids random or time-derived ids; see PBI_CALL_DETAIL_PAGE_ID reasoning.
var PBI_COMPLIANCE_PAGE_ID = '34e0f1a2b3c4d5e60718';

var PBI_DRILL_FIELDS = [
    'Contact_ID',
    'Agent_ID',
    'Primary_Category'
];

var PBI_DRILL_SOURCE_VISUALS = [
    { pageKey: 'opsQa', slotKey: 'barAgentBreakdown' },
    { pageKey: 'execHub', slotKey: 'barPrimaryCategory' }
];

var PBI_CALL_DETAIL_COLUMNS = [
    'Contact_ID',
    'Agent_ID',
    'Timestamp',
    'Queue_Name',
    'Primary_Category',
    'Call_Duration (s)',
    'Silence_Duration (s)',
    'Agent_Quality',
    'Customer_Sentiment',
    'Compliance_Risk',
    'FCR_Flag',
    'Call_Summary_Transcript'
];

var PBI_LOCKED_CALL_DETAIL_COLUMNS = Object.freeze(PBI_CALL_DETAIL_COLUMNS.slice());

var PBI_CALL_DETAIL_LAYOUT = [
    {
        key: 'headerBand',
        id: '4e5f6a7b8c9d0e1f2a3b',
        kind: 'textbox',
        layer: 'background',
        x: 0,
        y: 0,
        z: 0,
        width: 1920,
        height: PBI_HEADER_BAND_HEIGHT,
        title: 'Call Detail',
        alignment: 'center'
    },
    {
        key: 'piiNotice',
        id: '5f6a7b8c9d0e1f2a3b4c',
        kind: 'textbox',
        x: 24,
        y: 88,
        z: 10,
        width: 1872,
        height: 72,
        title: PBI_PII_EXPOSURE_STATEMENT
    },
    {
        key: 'callDetailTable',
        id: '6a7b8c9d0e1f2a3b4c5d',
        kind: 'table',
        x: 24,
        y: 176,
        z: 11,
        width: 1872,
        height: 880
    }
];

// Layout manifest for Compliance & Coaching page (Phase 34, Wave 1 tracer slice, D-09, D-13)
var PBI_COMPLIANCE_LAYOUT = [
    { key: 'headerBand', id: '34a0b1c2d3e4f5061728', kind: 'textbox', layer: 'background', x: 0, y: 0, z: 0, width: 1920, height: PBI_HEADER_BAND_HEIGHT, title: 'Compliance & Coaching', alignment: 'center' },
    { key: 'brandIcon', id: '34a1b2c3d4e5f6071829', kind: 'image', x: 24, y: 16, z: 1, width: 40, height: 40, itemName: 'brand-icon.png' },
    { key: 'brandWordmark', id: '34a2b3c4d5e6f708192a', kind: 'image', x: 80, y: 17, z: 2, width: 280, height: 38, itemName: 'brand-text.png' },
    // D-12: The date slicer joins the cross-page DateSync group so this page opens on the same populated sub-range
    // the other pages do; agent deliberately does not, because no other page carries an agent slicer this one should follow.
    { key: 'relativeDateSlicer', id: '34a3b4c5d6e7f8091a2b', kind: 'slicer', x: 944, y: 88, z: 5, width: 240, height: 88, slicerOptions: { entity: 'DateTable', column: 'Date', mode: 'Relative' } },
    { key: 'dateSlicer', id: '34a4b5c6d7e8f90a1b2c', kind: 'slicer', x: 1200, y: 88, z: 3, width: 440, height: 88, slicerOptions: { entity: 'DateTable', column: 'Date', mode: 'Between', syncGroup: { groupName: 'DateSync', fieldChanges: true, filterChanges: true } } },
    { key: 'agentSlicer', id: '34a5b6c7d8e9f01a2b3c', kind: 'slicer', x: 1656, y: 88, z: 4, width: 240, height: 88, slicerOptions: { column: 'Agent_ID', mode: 'Dropdown' } },
    { key: 'cardAvgEmpathy', id: '34b0c1d2e3f405162738', kind: 'card', x: 24, y: 192, z: 10, width: 450, height: 134, measure: 'Avg Empathy Score', label: 'Avg Empathy (/100)' },
    { key: 'cardAvgAgitation', id: '34b1c2d3e4f506172839', kind: 'card', x: 498, y: 192, z: 11, width: 450, height: 134, measure: 'Avg Max Agitation', label: 'Avg Max Agitation (/100)' },
    { key: 'cardComplianceRisk', id: '34b2c3d4e5f60718293a', kind: 'card', x: 972, y: 192, z: 12, width: 450, height: 134, measure: 'Compliance Risk Rate', label: '% of Calls Flagged' },
    { key: 'cardAvgQaScore', id: '34b3c4d5e6f708192a3b', kind: 'card', x: 1446, y: 192, z: 13, width: 450, height: 134, measure: 'Avg QA Score', label: 'Avg QA Score (/100)' },
    // D-04, D-05: Space paid out of lineAgitationCurve width (narrowed from 1872 to 1400, leaving 24px gutter before gauge at x=1448).
    // Bottom column charts (columnComplianceMix, columnEmpathyCorrelation) remain untouched per D-05.
    { key: 'lineAgitationCurve', id: '34c0d1e2f30415263748', kind: 'line', x: 24, y: 342, z: 20, width: 1400, height: 332, entity: 'DateTable', column: 'Date', measure: 'Avg Max Agitation', chartTitle: 'Interaction Agitation Curve' },
    // TGT-03, D-04: Compliance Risk Rate gauge with native target role projection against whole-dataset rate
    { key: 'gaugeComplianceRisk', id: '2e8b5f31c7a04d69be82', kind: 'gauge', x: 1448, y: 342, z: 23, width: 448, height: 332, measure: 'Compliance Risk Rate', axisMin: 0, axisMax: 1, chartTitle: 'Flagged-Call Rate vs Whole Dataset' },
    // No axisFloor: this grouping exists to surface low QA scores, and a fixed floor hid the
    // 21-40 and 41-60 empathy buckets (G-36-14).
    { key: 'columnEmpathyCorrelation', id: '34c1d2e3f40516273849', kind: 'column', x: 24, y: 690, z: 21, width: 928, height: 374, entity: 'EmpathyBuckets', column: 'Bucket_Label', measure: 'Avg QA Score', visualType: 'columnChart', chartTitle: 'Linguistic Empathy Correlation', showItemsWithNoData: true },
    { key: 'columnComplianceMix', id: '34c2d3e4f50617283940', kind: 'column', x: 968, y: 690, z: 22, width: 928, height: 374, column: 'Compliance_Risk', measure: 'Total Calls', visualType: 'columnChart', chartTitle: 'Calls by Compliance Risk' }
];

// G-36-4: Small path-addressed JSON helpers used to fold registry values into the
// Desktop-authored target-line template without hand-writing the whole object shape twice.
function getJsonLeaf(root, pathArray) {
    let node = root;
    for (const key of pathArray) {
        if (node === undefined || node === null) {
            return undefined;
        }
        node = node[key];
    }
    return node;
}

function setJsonLeaf(root, pathArray, value) {
    let node = root;
    for (let i = 0; i < pathArray.length - 1; i++) {
        node = node[pathArray[i]];
    }
    node[pathArray[pathArray.length - 1]] = value;
}

// TGT-01, G-36-4: The QA target reference-line shape exactly as Power BI Desktop authored and
// saved it. Captured in uat-36-desktop-shapes-fixture.json#/referenceLine after the developer
// added a constant line at 85 to "Avg QA Score by Queue" through the Analytics pane, then saved,
// reopened, and confirmed Desktop drew it (uat-36-desktop-shapes.md
// G36_4_LINE_DRAWN_AFTER_REOPEN: yes). `objectKey` here (`y1AxisReferenceLine`) is Desktop's own
// object key, not the `referenceLine` key this generator previously guessed by analogy with the
// Report Theme schema -- Desktop silently ignored that guessed key and never drew a line at all
// (G-36-4). `template` is the fixture's `capturedObject` array, copied verbatim; `valueLeafPath`
// and `labelLeafPath` locate the two leaves this generator substitutes per PBI_TARGET_LINES entry.
var PBI_TARGET_LINE_DESKTOP_SHAPE = {
    source: 'uat-36-desktop-shapes-fixture.json#/referenceLine, Power BI Desktop 2.157.1354.0 64-bit (August 2026), captured 2026-09-16T22:58:46.794Z',
    objectKey: 'y1AxisReferenceLine',
    template: [
        {
            "properties": {
                "show": {
                    "expr": {
                        "Literal": {
                            "Value": "true"
                        }
                    }
                },
                "displayName": {
                    "expr": {
                        "Literal": {
                            "Value": "'QA target 85 of 100 (generator default, not a published organizational target)'"
                        }
                    }
                },
                "value": {
                    "expr": {
                        "Literal": {
                            "Value": "85D"
                        }
                    }
                },
                "dataLabelShow": {
                    "expr": {
                        "Literal": {
                            "Value": "true"
                        }
                    }
                },
                "dataLabelText": {
                    "expr": {
                        "Literal": {
                            "Value": "'ValueAndName'"
                        }
                    }
                }
            },
            "selector": {
                "id": "1"
            }
        }
    ],
    valueLeafPath: [0, 'properties', 'value', 'expr', 'Literal', 'Value'],
    valueSuffix: 'D',
    labelLeafPath: [0, 'properties', 'displayName', 'expr', 'Literal', 'Value'],
    labelQuote: "'"
};

// D-07, D-08, D-09(a), TGT-01, TGT-02, TGT-03: Single registry for visual reference lines and target values.
// The values are generator defaults chosen by the generator author; they have not been confirmed
// against a published organizational figure. A single edit here retargets the entire report.
var PBI_TARGET_LINES = [
    {
        slotKey: 'barQueueBreakdown',
        kind: 'target',
        unit: 'points',
        value: 85,
        label: 'QA target 85 of 100 (' + PBI_TARGET_DEFAULT_DISCLOSURE + ')'
    },
    {
        slotKey: 'gaugeFcrRate',
        kind: 'target',
        unit: 'fraction',
        value: 0.75,
        measure: 'FCR Target',
        label: 'FCR target 75% (' + PBI_TARGET_DEFAULT_DISCLOSURE + ')'
    },
    {
        slotKey: 'gaugeComplianceRisk',
        kind: 'data-derived',
        unit: 'fraction',
        measure: 'Compliance Risk Rate (All Data)',
        label: 'Whole-dataset flagged-call rate (' + PBI_TARGET_DATA_DERIVED_DISCLOSURE + ')'
    }
];

// Generates DAX measures for registry target entries that specify a constant value and measure name.
function deriveTargetLineMeasures() {
    const derived = [];
    for (const entry of PBI_TARGET_LINES) {
        if (typeof entry.value !== 'undefined' && entry.measure) {
            const m = {
                name: entry.measure,
                dax: String(entry.value)
            };
            if (entry.unit === 'fraction') {
                m.formatString = '0.0%';
            }
            derived.push(m);
        }
    }
    return derived;
}
CALLS_MEASURES.push(...deriveTargetLineMeasures());

function buildCallDetailPageBinding() {
    if (!Array.isArray(PBI_DRILL_FIELDS) || PBI_DRILL_FIELDS.length === 0) {
        throw new Error("buildCallDetailPageBinding: empty declared drill field set for page 'callDetail'");
    }
    const manifestColNames = new Set(COLUMN_MANIFEST.map(c => c.name));
    for (const field of PBI_DRILL_FIELDS) {
        if (field !== 'Agent_Id' && !manifestColNames.has(field)) {
            throw new Error(`buildCallDetailPageBinding: field '${field}' is not in COLUMN_MANIFEST`);
        }
    }

    const drillBindingId = '15292d2401971c2c5b47';
    const paramIds = [
        '6dacc743da6b270906c6',
        'd80fa4886bd3432b7c60',
        'e952853ba351a4a12d66',
        'f1a2b3c4d5e6f708192a'
    ];
    const filterIds = [
        '8c605b07ae66e0130438',
        'ebfe2e47c5e5b5100106',
        'c04a76150550893daec5',
        'a1b2c3d4e5f60718293a'
    ];

    const parameters = [];
    const filters = [];

    for (let i = 0; i < PBI_DRILL_FIELDS.length; i++) {
        const col = PBI_DRILL_FIELDS[i];
        const pId = paramIds[i] || ('6dacc743da6b270906c' + i);
        const fId = filterIds[i] || ('8c605b07ae66e013043' + i);

        parameters.push({
            name: pId,
            boundFilter: fId,
            asAggregation: false,
            qnaSingleSelectRequired: false,
            fieldExpr: {
                Column: {
                    Expression: {
                        SourceRef: {
                            Entity: 'Calls'
                        }
                    },
                    Property: col
                }
            }
        });

        filters.push({
            name: fId,
            field: {
                Column: {
                    Expression: {
                        SourceRef: {
                            Entity: 'Calls'
                        }
                    },
                    Property: col
                }
            },
            type: 'Categorical',
            howCreated: 'Drillthrough'
        });
    }

    return {
        pageBinding: {
            name: drillBindingId,
            type: 'Drillthrough',
            parameters: parameters
        },
        filterConfig: {
            filters: filters
        }
    };
}

function buildTableVisualJson(slot) {
    if (!slot || typeof slot !== 'object') {
        throw new Error('buildTableVisualJson: slot must be an object');
    }
    const manifestColNames = new Set(COLUMN_MANIFEST.map(c => c.name));
    for (const col of PBI_CALL_DETAIL_COLUMNS) {
        if (!manifestColNames.has(col)) {
            throw new Error(`buildTableVisualJson: column '${col}' is not in COLUMN_MANIFEST`);
        }
    }

    const projections = PBI_CALL_DETAIL_COLUMNS.map(col => ({
        field: {
            Column: {
                Expression: {
                    SourceRef: {
                        Entity: 'Calls'
                    }
                },
                Property: col
            }
        },
        queryRef: `Calls.${col}`,
        nativeQueryRef: col
    }));

    const visualContainer = {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json",
        "name": slot.id,
        "position": {
            "x": slot.x,
            "y": slot.y,
            "z": slot.z,
            "width": slot.width,
            "height": slot.height,
            "tabOrder": slot.z
        },
        "visual": {
            "visualType": "tableEx",
            "query": {
                "queryState": {
                    "Values": {
                        "projections": projections
                    }
                }
            },
            "drillFilterOtherVisuals": true
        }
    };

    return JSON.stringify(visualContainer, null, 2);
}

// Registry rules (REFAC-02, D-08, D-13):
// - Every entry carries a key (stable lowercase-camel non-GUID identifier, distinct per entry).
// - layout holds a bare identifier reference to the same array object (never cloned, so in-place mutations reflect).
// - PBI_PAGES array order drives pages.json pageOrder. Call Detail is inserted at index 1 with ordinal: 1.
var PBI_PAGES = [
    { key: 'execHub', id: 'a1b2c3d4e5f6a7b8c9d0', displayName: 'Executive Hub', ordinal: 0, layout: PBI_EXEC_LAYOUT },
    {
        key: 'callDetail',
        id: PBI_CALL_DETAIL_PAGE_ID,
        displayName: 'Call Detail',
        ordinal: 1,
        layout: PBI_CALL_DETAIL_LAYOUT,
        visibility: 'HiddenInViewMode',
        pageBinding: buildCallDetailPageBinding().pageBinding,
        filterConfig: buildCallDetailPageBinding().filterConfig
    },
    { key: 'opsQa', id: 'b2c3d4e5f6a7b8c9d0e1', displayName: 'Ops/QA Command', ordinal: 2, layout: PBI_OPS_LAYOUT },
    { key: 'compliance', id: PBI_COMPLIANCE_PAGE_ID, displayName: 'Compliance & Coaching', ordinal: 3, layout: PBI_COMPLIANCE_LAYOUT }
];

function buildCallDetailVisuals(rows) {
    return buildPageVisuals(getPageByKey('callDetail'), rows);
}

function buildComplianceVisuals(rows) {
    return buildPageVisuals(getPageByKey('compliance'), rows);
}

function getPageByKey(key) {
    const page = PBI_PAGES.find(p => p.key === key);
    if (!page) {
        throw new Error(`getPageByKey: Unknown page key '${key}'`);
    }
    return page;
}

const PBI_THEME_PATH = `${PBI_ROOT}/${PBI_PROJECT_NAME}.Report/StaticResources/RegisteredResources/${PBI_THEME.fileName}`;


// PBI_MODEL_TABLES registry (D-18, D-19).
// Bounded promote: buildModelFiles iterates this registry for tables/<name>.tmdl emission
// and model.tmdl ref table lines, while individual tables retain bespoke builders.
var PBI_MODEL_TABLES = [
    { name: 'Calls', build: buildCallsTmdl },
    { name: 'SilenceBuckets', build: buildSilenceBucketsTmdl },
    { name: 'DateTable', build: buildDateTableTmdl },
    { name: 'EmpathyBuckets', build: buildEmpathyBucketsTmdl }
];

function buildModelFiles() {
    const files = {};
    const basePath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.SemanticModel`;

    files[`${basePath}/.platform`] = buildPlatformFile('SemanticModel', PBI_PROJECT_NAME);

    files[`${basePath}/definition.pbism`] = JSON.stringify({
        "version": PBI_PBISM_VERSION,
        "settings": {}
    }, null, 2);

    // Unnamed `database` object matches real Desktop-authored output (powerbi/test.SemanticModel/definition/database.tmdl).
    // A named `database DexcomAnalytics` object caused Power BI Desktop to silently refuse to open the .pbip (18-03 D-10 spike, MODEL-07).
    files[`${basePath}/definition/database.tmdl`] = `database\n\tcompatibilityLevel: ${PBI_COMPATIBILITY_LEVEL}\n`;

    // model.tmdl: annotation PBI_ProTooling, ref cultureInfo en-US, and ref table lines for all model tables.
    // TMDL deterministic collection ordering: ref table/ref cultureInfo/ref role only.
    // relationships.tmdl does NOT take a ref line per the official TMDL grammar.
    const refTableLines = PBI_MODEL_TABLES.map(t => `ref table ${t.name}`).join('\n');
    files[`${basePath}/definition/model.tmdl`] = `model Model\n\tculture: en-US\n\tdefaultPowerBIDataSourceVersion: powerBI_V3\n\nannotation PBI_ProTooling = ["DevMode"]\n\nref cultureInfo en-US\n\n${refTableLines}\n`;
    files[`${basePath}/definition/cultures/en-US.tmdl`] = `cultureInfo en-US\n`;

    // Emit each table from PBI_MODEL_TABLES registry
    for (const table of PBI_MODEL_TABLES) {
        files[`${basePath}/definition/tables/${table.name}.tmdl`] = table.build();
    }

    // relationships.tmdl: root-level definition file auto-discovered by Desktop without a ref line in model.tmdl
    files[`${basePath}/definition/relationships.tmdl`] = buildRelationshipsTmdl();

    // expressions.tmdl only ships on the 18-03 D-10 relative-fail branch (D-02/D-03). Unlike
    // `table`/`cultureInfo`, `expression` is NOT one of the ordered collections the official TMDL
    // grammar lists a `ref` line for in model.tmdl (learn.microsoft.com/en-us/analysis-services/tmdl/tmdl-overview,
    // "Deterministic Collection Ordering with References" — ref table/ref culture/ref role only).
    // `expressions.tmdl`, like `relationships.tmdl`/`functions.tmdl`/`dataSources.tmdl`, is a root-level
    // definition/ file Desktop auto-discovers without an explicit ref. No ref line is added here;
    // if the next Desktop round trips this file and needs one, adopt it then (A2/A3 policy).
    files[`${basePath}/definition/expressions.tmdl`] = CSV_FOLDER_PATH_EXPRESSION_TMDL;

    return files;
}

function buildPageBackgroundObjects() {
    const bg = `'${PBI_THEME.theme.background}'`;
    return {
        "background": [
            {
                "properties": {
                    "color": {
                        "solid": {
                            "color": {
                                "expr": {
                                    "Literal": {
                                        "Value": bg
                                    }
                                }
                            }
                        }
                    },
                    "transparency": {
                        "expr": {
                            "Literal": {
                                "Value": "0D"
                            }
                        }
                    }
                }
            }
        ],
        "outspace": [
            {
                "properties": {
                    "color": {
                        "solid": {
                            "color": {
                                "expr": {
                                    "Literal": {
                                        "Value": bg
                                    }
                                }
                            }
                        }
                    },
                    "transparency": {
                        "expr": {
                            "Literal": {
                                "Value": "0D"
                            }
                        }
                    }
                }
            }
        ]
    };
}

function buildReportFiles() {
    const files = {};
    const basePath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.Report`;

    files[`${basePath}/.platform`] = buildPlatformFile('Report', PBI_PROJECT_NAME);

    files[`${basePath}/definition.pbir`] = JSON.stringify({
        "version": PBI_PBIR_VERSION,
        "datasetReference": {
            "byPath": {
                "path": `../${PBI_PROJECT_NAME}.SemanticModel`
            }
        }
    }, null, 2);

    files[`${basePath}/definition/version.json`] = JSON.stringify({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json",
        "version": "2.0.0"
    }, null, 2);

    // themeCollection / resourcePackages RESTORED here (18-03 continuation, reversing cad6ec8 on empirical
    // evidence — see REPORT_THEME_MINIMAL_JSON comment above for the full H3 finding). Real Power BI Desktop
    // requires this reference to resolve to a real theme resource; the fix for the original dangling reference
    // was to ship StaticResources/SharedResources/BaseThemes/Fluent2-CY26SU08.json (buildThemeFile below), not
    // to delete the reference. Byte-identical in shape and field order to the Desktop-authored baseline
    // (powerbi/test.Report/definition/report.json), which this generator matched before cad6ec8.
    // Custom theme is layered over this base (D-01/D-04/D-05), resolving to RegisteredResources.
    files[`${basePath}/definition/report.json`] = JSON.stringify({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.3.0/schema.json",
        "themeCollection": {
            "baseTheme": {
                "name": "Fluent2-CY26SU08",
                "reportVersionAtImport": {
                    "visual": "2.12.0",
                    "report": "3.4.0",
                    "page": "2.3.1"
                },
                "type": "SharedResources"
            },
            "customTheme": {
                "name": PBI_THEME.theme.name,
                "reportVersionAtImport": {
                    "visual": "2.12.0",
                    "report": "3.4.0",
                    "page": "2.3.1"
                },
                "type": "RegisteredResources"
            }
        },
        "objects": {
            "section": [
                {
                    "properties": {
                        "verticalAlignment": {
                            "expr": {
                                "Literal": {
                                    "Value": "'Top'"
                                }
                            }
                        }
                    }
                }
            ]
        },
        "resourcePackages": [
            {
                "name": "SharedResources",
                "type": "SharedResources",
                "items": [
                    {
                        "name": "Fluent2-CY26SU08",
                        "path": "BaseThemes/Fluent2-CY26SU08.json",
                        "type": "BaseTheme"
                    }
                ]
            },
            {
                "name": "RegisteredResources",
                "type": "RegisteredResources",
                "items": [
                    {
                        "name": PBI_THEME.theme.name,
                        "path": PBI_THEME.fileName,
                        "type": "CustomTheme"
                    },
                    ...PBI_REGISTERED_IMAGES.map(img => ({
                        "name": img.itemName,
                        "path": img.itemName,
                        "type": "Image"
                    }))
                ]
            }
        ],
        "settings": {
            "useStylableVisualContainerHeader": true,
            "exportDataMode": "AllowSummarized",
            "defaultDrillFilterOtherVisuals": true,
            "allowChangeFilterTypes": true,
            "useEnhancedTooltips": true,
            "useDefaultAggregateDisplayName": true
        }
    }, null, 2);

    files[`${basePath}/definition/pages/pages.json`] = JSON.stringify({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.1.0/schema.json",
        "pageOrder": PBI_PAGES.map(p => p.id),
        "activePageName": getPageByKey('execHub').id
    }, null, 2);

    for (const page of PBI_PAGES) {
        const pageObj = {
            "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json",
            "name": page.id,
            "displayName": page.displayName,
            "displayOption": "FitToPage",
            "height": 1080,
            "width": 1920
        };
        if (page.pageType !== undefined) {
            pageObj.type = page.pageType;
        }
        if (page.visibility !== undefined) {
            pageObj.visibility = page.visibility;
        }
        if (page.filterConfig !== undefined) {
            pageObj.filterConfig = page.filterConfig;
        }
        if (page.pageBinding !== undefined) {
            pageObj.pageBinding = page.pageBinding;
        }
        pageObj.objects = buildPageBackgroundObjects();
        files[`${basePath}/definition/pages/${page.id}/page.json`] = JSON.stringify(pageObj, null, 2);
    }

    return files;
}

// G-36-8: The Executive Hub card caption shape exactly as Power BI Desktop authored and saved it.
// Captured in uat-36-desktop-shapes-fixture.json#/cardCaption after the developer bound the Call
// Volume card's "Reference labels" > Title sub-card to the Delta Baseline Label measure (Select
// label scoped to "Total Calls Delta % Label", Title source = Custom > fx > Field value), saved,
// reopened, and confirmed the caption read Desktop's own generated text (not the measure's name)
// across three date-slicer states (uat-36-desktop-shapes.md G36_8_CAPTION_SHOWS_MEASURE_TEXT: yes).
// `changes` is copied verbatim from that capture's `changedPaths`, with the card-specific strings
// ("Total Calls", the card's visual id) replaced by placeholders `{{measure}}` / `{{slotId}}` /
// `{{deltaLabelMeasure}}` so `applyCardCaptionShape` can specialise it per card. The bound
// baseline-text measure name ("Delta Baseline Label") is the same for every card, so it is left
// as a literal, not a placeholder. Option chosen in design review (bind-caption):
// Fallback option `fold-into-value` (uat-36-desktop-shapes-fixture.json#/captionOff) was not
// implemented, since Desktop confirmed the bound caption renders.
var PBI_CARD_CAPTION_DESKTOP_SHAPE = {
    source: "uat-36-desktop-shapes-fixture.json#/cardCaption, Power BI Desktop 2.157.1354.0 64-bit (August 2026), captured 2026-09-16T22:47:16.264Z; option chosen in design review",
    mode: 'bind-caption',
    changes: [
        {
            path: ['objects', 'referenceLabelDetail'],
            value: [
                {
                    properties: {
                        show: {
                            expr: {
                                Literal: {
                                    Value: 'false'
                                }
                            }
                        }
                    },
                    selector: {
                        metadata: 'Calls.{{measure}}'
                    }
                }
            ]
        },
        {
            path: ['objects', 'referenceLabelTitle'],
            value: [
                {
                    properties: {
                        titleContentType: {
                            expr: {
                                Literal: {
                                    Value: "'custom'"
                                }
                            }
                        }
                    },
                    selector: {
                        metadata: 'Calls.{{measure}}',
                        id: 'field-{{slotId}}'
                    }
                },
                {
                    properties: {
                        titleText: {
                            expr: {
                                Measure: {
                                    Expression: {
                                        SourceRef: {
                                            Entity: 'Calls'
                                        }
                                    },
                                    Property: 'Delta Baseline Label'
                                }
                            }
                        }
                    },
                    selector: {
                        data: [
                            {
                                dataViewWildcard: {
                                    matchingOption: 0
                                }
                            }
                        ],
                        metadata: 'Calls.{{measure}}',
                        id: 'field-{{slotId}}'
                    }
                }
            ]
        }
    ]
};

// G-36-8: substitutes the three card-specialised placeholders ({{measure}}, {{slotId}},
// {{deltaLabelMeasure}}) into a deep-cloned copy of a PBI_CARD_CAPTION_DESKTOP_SHAPE change value.
// String substitution only -- placeholders never appear as non-string values.
function substituteCardCaptionPlaceholders(value, slot) {
    const deltaLabelMeasure = `${slot.deltaMeasure} Label`;
    function walk(node) {
        if (typeof node === 'string') {
            return node
                .split('{{measure}}').join(slot.measure)
                .split('{{slotId}}').join(slot.id)
                .split('{{deltaLabelMeasure}}').join(deltaLabelMeasure);
        }
        if (Array.isArray(node)) {
            return node.map(walk);
        }
        if (node && typeof node === 'object') {
            const out = {};
            for (const key of Object.keys(node)) out[key] = walk(node[key]);
            return out;
        }
        return node;
    }
    return walk(value);
}

// G-36-8: Applies PBI_CARD_CAPTION_DESKTOP_SHAPE.changes onto a card's visual node (the object
// carrying .objects / .visualContainerObjects, before it is wrapped under "visual" and
// stringified), creating intermediate containers as needed and deleting on `removed`. Called for
// every Executive Hub card slot that carries a deltaMeasure, so the caption shape emitted is
// Desktop's own captured JSON (uat-36-desktop-shapes-fixture.json#/cardCaption), not a
// hand-written guess.
function applyCardCaptionShape(visualNode, slot) {
    for (const change of PBI_CARD_CAPTION_DESKTOP_SHAPE.changes) {
        let target = visualNode;
        for (let i = 0; i < change.path.length - 1; i++) {
            const key = change.path[i];
            if (target[key] === undefined || target[key] === null) {
                target[key] = {};
            }
            target = target[key];
        }
        const lastKey = change.path[change.path.length - 1];
        if (change.removed) {
            delete target[lastKey];
        } else {
            target[lastKey] = substituteCardCaptionPlaceholders(change.value, slot);
        }
    }
}

function buildThemeFile() {
    const files = {};
    const basePath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.Report`;
    // Path must match report.json's resourcePackages[0].items[0].path ("BaseThemes/Fluent2-CY26SU08.json")
    // resolved against the SharedResources StaticResources root Desktop expects for a "SharedResources" package.
    files[`${basePath}/StaticResources/SharedResources/BaseThemes/Fluent2-CY26SU08.json`] = REPORT_THEME_MINIMAL_JSON;
    
    // Custom theme (D-01). Path is relative to this package's own StaticResources root (D-02).
    files[`${basePath}/StaticResources/RegisteredResources/${PBI_THEME.fileName}`] = JSON.stringify(PBI_THEME.theme, null, 2);

    for (const img of PBI_REGISTERED_IMAGES) {
        files[`${PBI_REGISTERED_RESOURCES_DIR}/${img.itemName}`] = img.base64;
    }
    
    return files;
}

function buildCardVisualJson(slot) {
    if (!CALLS_MEASURES.some(m => m.name === slot.measure)) {
        throw new Error(`Measure not found in CALLS_MEASURES: ${slot.measure}`);
    }

    const objects = {
        "label": [
            {
                "properties": {
                    "show": {
                        "expr": {
                            "Literal": {
                                "Value": "true"
                            }
                        }
                    },
                    "text": {
                        "expr": {
                            "Literal": {
                                "Value": `'${slot.label}'`
                            }
                        }
                    }
                },
                "selector": {
                    "id": "default"
                }
            }
        ]
    };

    // D-06: Native referenceLabel fold.
    // If slot carries a deltaMeasure, emit the Desktop-confirmed referenceLabel schema. Only
    // properties.value was ever Desktop-confirmed (Phase 24, 24-DESKTOP-FINDINGS.md item 2:
    // "Desktop successfully bound reference label to Total Calls Delta % under
    // objects.referenceLabel with selector id field-... and metadata Calls.Total Calls"). The
    // old properties.title binding on this same object was an unverified analogy this generator
    // guessed by extension -- Desktop's own resave silently deleted it from all seven cards
    // (G-36-8), leaving the cards to fall back to the value measure's own name. The card's
    // baseline-text caption instead comes from the 36-06 Desktop capture
    // (uat-36-desktop-shapes-fixture.json#/cardCaption), applied below via applyCardCaptionShape.
    if (slot.deltaMeasure) {
        const labelMeasureName = `${slot.deltaMeasure} Label`;
        objects.referenceLabel = [
            {
                "properties": {
                    "value": {
                        "expr": {
                            "Measure": {
                                "Expression": {
                                    "SourceRef": {
                                        "Entity": "Calls"
                                    }
                                },
                                "Property": labelMeasureName
                            }
                        }
                    }
                },
                "selector": {
                    "data": [
                        {
                            "dataViewWildcard": {
                                "matchingOption": 0
                            }
                        }
                    ],
                    "metadata": `Calls.${slot.measure}`,
                    "id": `field-${slot.id}`,
                    "order": 0
                }
            }
        ];
    }

    const visualNode = {
        "visualType": "cardVisual",
        "query": {
            "queryState": {
                "Data": {
                    "projections": [
                        {
                            "field": {
                                "Measure": {
                                    "Expression": {
                                        "SourceRef": {
                                            "Entity": "Calls"
                                        }
                                    },
                                    "Property": slot.measure
                                }
                            },
                            "queryRef": `Calls.${slot.measure}`,
                            "nativeQueryRef": slot.measure
                        }
                    ]
                }
            }
        },
        "objects": objects
    };

    // G-36-8: fold Desktop's own captured caption shape onto this card's visual node.
    if (slot.deltaMeasure) {
        applyCardCaptionShape(visualNode, slot);
    }

    return JSON.stringify({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json",
        "name": slot.id,
        "position": {
            "x": slot.x,
            "y": slot.y,
            "z": slot.z,
            "width": slot.width,
            "height": slot.height,
            "tabOrder": slot.z
        },
        "visual": visualNode
    }, null, 2);
}

// TGT-02, TGT-03: Visual builder for native gauge visuals (FCR Rate, Compliance Risk).
// Emits queryState.Y (bound to slot.measure), queryState.TargetValue (bound to registry target measure),
// objects.axis with min and max bounds, and visualContainerObjects.title and subTitle disclosures.
// Emits NO literal axis target alongside TargetValue to avoid dual target signals.
function buildGaugeVisualJson(slot) {
    if (!CALLS_MEASURES.some(m => m.name === slot.measure)) {
        throw new Error(`Measure not found in CALLS_MEASURES: ${slot.measure}`);
    }
    const targetEntry = PBI_TARGET_LINES.find(t => t.slotKey === slot.key);
    if (!targetEntry) {
        throw new Error(`Target line entry not found in PBI_TARGET_LINES for slot: ${slot.key}`);
    }
    if (!targetEntry.measure) {
        throw new Error(`Target line entry for slot '${slot.key}' missing required 'measure' field`);
    }
    if (!CALLS_MEASURES.some(m => m.name === targetEntry.measure)) {
        throw new Error(`Target measure not found in CALLS_MEASURES: ${targetEntry.measure}`);
    }
    if (typeof slot.axisFloor !== 'undefined') {
        throw new Error(`buildGaugeVisualJson: slot '${slot.key}' declares forbidden 'axisFloor'`);
    }

    const visualNode = {
        "visualType": "gauge",
        "query": {
            "queryState": {
                "Y": {
                    "projections": [
                        {
                            "field": {
                                "Measure": {
                                    "Expression": {
                                        "SourceRef": {
                                            "Entity": "Calls"
                                        }
                                    },
                                    "Property": slot.measure
                                }
                            },
                            "queryRef": `Calls.${slot.measure}`,
                            "nativeQueryRef": slot.measure
                        }
                    ]
                },
                "TargetValue": {
                    "projections": [
                        {
                            "field": {
                                "Measure": {
                                    "Expression": {
                                        "SourceRef": {
                                            "Entity": "Calls"
                                        }
                                    },
                                    "Property": targetEntry.measure
                                }
                            },
                            "queryRef": `Calls.${targetEntry.measure}`,
                            "nativeQueryRef": targetEntry.measure
                        }
                    ]
                }
            }
        },
        "objects": {
            "axis": [
                {
                    "properties": {
                        "min": {
                            "expr": {
                                "Literal": {
                                    "Value": String(slot.axisMin) + 'D'
                                }
                            }
                        },
                        "max": {
                            "expr": {
                                "Literal": {
                                    "Value": String(slot.axisMax) + 'D'
                                }
                            }
                        }
                    }
                }
            ]
        },
        "visualContainerObjects": {
            "title": [
                {
                    "properties": {
                        "show": {
                            "expr": {
                                "Literal": {
                                    "Value": "true"
                                }
                            }
                        },
                        "text": {
                            "expr": {
                                "Literal": {
                                    "Value": `'${slot.chartTitle}'`
                                }
                            }
                        }
                    }
                }
            ],
            "subTitle": [
                {
                    "properties": {
                        "show": {
                            "expr": {
                                "Literal": {
                                    "Value": "true"
                                }
                            }
                        },
                        "text": {
                            "expr": {
                                "Literal": {
                                    "Value": `'${targetEntry.label}'`
                                }
                            }
                        }
                    }
                }
            ]
        }
    };

    return JSON.stringify({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json",
        "name": slot.id,
        "position": {
            "x": slot.x,
            "y": slot.y,
            "z": slot.z,
            "width": slot.width,
            "height": slot.height,
            "tabOrder": slot.z
        },
        "visual": visualNode
    }, null, 2);
}

// D-20, SC7: Build honest subtitle disclosure for floored value axes.
// Uses a single template derived directly from the axisFloor number.
function buildAxisFloorDisclosure(axisFloor) {
    return `Axis starts at ${axisFloor}`;
}

function buildLineChartJson(slot) {
    const entity = slot.entity || 'Calls';
    // Bind the derived day-grain column (Call_Date) by default. Raw Timestamp carried 1200 distinct values for 1200 rows across 7 days, causing Total Calls to evaluate to 1 everywhere (G-20-4).
    const column = slot.column || 'Call_Date';
    const measure = slot.measure || 'Total Calls';

    if (entity === 'DateTable') {
        const validDateColumns = ['Date', 'Year', 'Month_Number', 'Month_Name'];
        if (!validDateColumns.includes(column)) {
            throw new Error(`Column not found in DateTable: ${column}`);
        }
    } else if (entity === 'Calls') {
        const validColumns = COLUMN_MANIFEST
            .concat(typeof CALLS_DERIVED_COLUMNS !== 'undefined' ? CALLS_DERIVED_COLUMNS : [])
            .concat(typeof CALLS_CALCULATED_COLUMNS !== 'undefined' ? CALLS_CALCULATED_COLUMNS : []);
        if (!validColumns.some(c => c.name === column)) {
            throw new Error(`Column not found in Calls: ${column}`);
        }
    } else {
        throw new Error(`Unsupported entity for lineChart: ${entity}`);
    }

    if (!CALLS_MEASURES.some(m => m.name === measure)) {
        throw new Error(`Measure not found in CALLS_MEASURES: ${measure}`);
    }

    const visualNode = {
        "visualType": "lineChart",
        "query": {
            "queryState": {
                "Category": {
                    "projections": [
                        {
                            "field": {
                                "Column": {
                                    "Expression": {
                                        "SourceRef": {
                                            "Entity": entity
                                        }
                                    },
                                    "Property": column
                                }
                            },
                            "queryRef": `${entity}.${column}`,
                            "nativeQueryRef": column
                        }
                    ]
                },
                "Y": {
                    "projections": [
                        {
                            "field": {
                                "Measure": {
                                    "Expression": {
                                        "SourceRef": {
                                            "Entity": "Calls"
                                        }
                                    },
                                    "Property": measure
                                }
                            },
                            "queryRef": `Calls.${measure}`,
                            "nativeQueryRef": measure
                        }
                    ]
                }
            }
        },
        "objects": {
            "labels": [
                {
                    "properties": {
                        "show": {
                            "expr": {
                                "Literal": {
                                    "Value": "false"
                                }
                            }
                        }
                    }
                }
            ]
        },
        "visualContainerObjects": {
            "title": [
                {
                    "properties": {
                        "show": {
                            "expr": {
                                "Literal": {
                                    "Value": "true"
                                }
                            }
                        },
                        "text": {
                            "expr": slot.titleMeasure ? {
                                "Measure": {
                                    "Expression": {
                                        "SourceRef": {
                                            "Entity": "Calls"
                                        }
                                    },
                                    "Property": slot.titleMeasure
                                }
                            } : {
                                "Literal": {
                                    "Value": `'${slot.chartTitle || 'Call Volume Over Time'}'`
                                }
                            }
                        }
                    }
                }
            ]
        }
    };

    if (typeof slot.axisFloor === 'number') {
        visualNode.objects.valueAxis = [
            {
                "properties": {
                    "start": {
                        "expr": {
                            "Literal": {
                                "Value": String(slot.axisFloor) + 'D'
                            }
                        }
                    }
                }
            }
        ];
        visualNode.visualContainerObjects.subTitle = [
            {
                "properties": {
                    "show": {
                        "expr": {
                            "Literal": {
                                "Value": "true"
                            }
                        }
                    },
                    "text": {
                        "expr": {
                            "Literal": {
                                "Value": `'${buildAxisFloorDisclosure(slot.axisFloor)}'`
                            }
                        }
                    }
                }
            }
        ];
    }

    return JSON.stringify({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json",
        "name": slot.id,
        "position": {
            "x": slot.x,
            "y": slot.y,
            "z": slot.z,
            "width": slot.width,
            "height": slot.height,
            "tabOrder": slot.z
        },
        "visual": visualNode
    }, null, 2);
}

function buildBarChartJson(slot) {
    const entity = slot.entity || 'Calls';
    if (entity === 'SilenceBuckets' || entity === 'EmpathyBuckets') {
        const validDimColumns = ['Bucket_Label', 'Bucket_Order'];
        if (!validDimColumns.includes(slot.column)) {
            throw new Error(`Column not found in ${entity}: ${slot.column}`);
        }
    } else {
        const validColumns = COLUMN_MANIFEST
            .concat(typeof CALLS_DERIVED_COLUMNS !== 'undefined' ? CALLS_DERIVED_COLUMNS : [])
            .concat(typeof CALLS_CALCULATED_COLUMNS !== 'undefined' ? CALLS_CALCULATED_COLUMNS : []);
        if (!validColumns.some(c => c.name === slot.column)) {
            throw new Error(`Column not found in COLUMN_MANIFEST: ${slot.column}`);
        }
        if (slot.topN && !validColumns.some(c => c.name === slot.topN.orderByColumn)) {
            throw new Error(`Column not found in COLUMN_MANIFEST: ${slot.topN.orderByColumn}`);
        }
    }
    if (!CALLS_MEASURES.some(m => m.name === slot.measure)) {
        throw new Error(`Measure not found in CALLS_MEASURES: ${slot.measure}`);
    }

    const visualNode = {
        "visualType": slot.visualType,
        "query": {
            "queryState": {
                "Category": {
                    "projections": [
                        {
                            "field": {
                                "Column": {
                                    "Expression": {
                                        "SourceRef": {
                                            "Entity": entity
                                        }
                                    },
                                    "Property": slot.column
                                }
                            },
                            "queryRef": `${entity}.${slot.column}`,
                            "nativeQueryRef": slot.column
                        }
                    ]
                },
                "Y": {
                    "projections": [
                        {
                            "field": {
                                "Measure": {
                                    "Expression": {
                                        "SourceRef": {
                                            "Entity": "Calls"
                                        }
                                    },
                                    "Property": slot.measure
                                }
                            },
                            "queryRef": `Calls.${slot.measure}`,
                            "nativeQueryRef": slot.measure
                        }
                    ]
                }
            }
        },
        "objects": {
            "labels": [
                {
                    "properties": {
                        "show": {
                            "expr": {
                                "Literal": {
                                    "Value": "true"
                                }
                            }
                        },
                        "position": {
                            "expr": {
                                "Literal": {
                                    "Value": "'OutsideEnd'"
                                }
                            }
                        }
                    }
                }
            ]
        }
    };

    if (slot.showItemsWithNoData) {
        visualNode.query.queryState.Category.showAll = true;
    }

    if (slot.chartTitle || slot.titleMeasure) {
        visualNode.visualContainerObjects = visualNode.visualContainerObjects || {};
        visualNode.visualContainerObjects.title = [
            {
                "properties": {
                    "show": {
                        "expr": {
                            "Literal": {
                                "Value": "true"
                            }
                        }
                    },
                    "text": {
                        "expr": slot.titleMeasure ? {
                            "Measure": {
                                "Expression": {
                                    "SourceRef": {
                                        "Entity": "Calls"
                                    }
                                },
                                "Property": slot.titleMeasure
                            }
                        } : {
                            "Literal": {
                                "Value": `'${slot.chartTitle}'`
                            }
                        }
                    }
                }
            }
        ];
    }

    if (slot.sort) {
        visualNode.query.sortDefinition = {
            "sort": [
                {
                    "field": {
                        "Measure": {
                            "Expression": {
                                "SourceRef": {
                                    "Entity": "Calls"
                                }
                            },
                            "Property": slot.sort.field
                        }
                    },
                    "direction": slot.sort.direction
                }
            ],
            "isDefaultSort": true
        };
    }

    if (typeof slot.axisFloor === 'number') {
        visualNode.objects.valueAxis = [
            {
                "properties": {
                    "start": {
                        "expr": {
                            "Literal": {
                                "Value": String(slot.axisFloor) + 'D'
                            }
                        }
                    }
                }
            }
        ];
        if (!visualNode.visualContainerObjects) {
            visualNode.visualContainerObjects = {};
        }
        visualNode.visualContainerObjects.subTitle = [
            {
                "properties": {
                    "show": {
                        "expr": {
                            "Literal": {
                                "Value": "true"
                            }
                        }
                    },
                    "text": {
                        "expr": {
                            "Literal": {
                                "Value": `'${buildAxisFloorDisclosure(slot.axisFloor)}'`
                            }
                        }
                    }
                }
            }
        ];
    }

    // TGT-01, D-01, D-06, D-07, D-10, G-36-4: Reference line fold for cartesian bar charts.
    // The shape assigned below is Power BI Desktop's own saved shape (PBI_TARGET_LINE_DESKTOP_SHAPE;
    // see its `source` field for provenance). The generator previously wrote a hand-built
    // `objects.referenceLine` object here -- a key chosen by analogy with the Report Theme schema
    // that Desktop silently ignored, never drawing a line at all (G-36-4). Only the value and label
    // leaves are substituted; every other key, selector and property in the template is Desktop's
    // own default, copied verbatim so this generator cannot reintroduce a guessed shape.
    if (typeof PBI_TARGET_LINES !== 'undefined' && Array.isArray(PBI_TARGET_LINES)) {
        const targetEntry = PBI_TARGET_LINES.find(t => t.slotKey === slot.key);
        if (targetEntry && targetEntry.kind === 'target') {
            if (targetEntry.unit === 'points' && (targetEntry.value < 0 || targetEntry.value > 100)) {
                throw new Error(`buildBarChartJson: Slot '${slot.key}' target value ${targetEntry.value} out of bounds for unit 'points' (0-100)`);
            }
            if (targetEntry.unit === 'fraction' && (targetEntry.value < 0 || targetEntry.value > 1)) {
                throw new Error(`buildBarChartJson: Slot '${slot.key}' target value ${targetEntry.value} out of bounds for unit 'fraction' (0-1)`);
            }
            if (!visualNode.objects) {
                visualNode.objects = {};
            }
            const shape = PBI_TARGET_LINE_DESKTOP_SHAPE;
            const refLine = JSON.parse(JSON.stringify(shape.template));
            setJsonLeaf(refLine, shape.valueLeafPath, String(targetEntry.value) + shape.valueSuffix);
            setJsonLeaf(refLine, shape.labelLeafPath, shape.labelQuote + targetEntry.label + shape.labelQuote);
            visualNode.objects[PBI_TARGET_LINE_DESKTOP_SHAPE.objectKey] = refLine;
        }
    }

    const container = {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json",
        "name": slot.id,
        "position": {
            "x": slot.x,
            "y": slot.y,
            "z": slot.z,
            "width": slot.width,
            "height": slot.height,
            "tabOrder": slot.z
        },
        "visual": visualNode
    };

    if (slot.topN) {
        container.filterConfig = {
            "filters": [
                {
                    "name": slot.topN.filterName,
                    "field": {
                        "Column": {
                            "Expression": {
                                "SourceRef": {
                                    "Entity": "Calls"
                                }
                            },
                            "Property": slot.column
                        }
                    },
                    // The type is always 'TopN' regardless of ranking direction; Bottom-N is expressed by Direction (1 = Bottom, 2 = Top)
                    "type": "TopN",
                    "filter": {
                        "Version": 2,
                        "From": [
                            {
                                "Name": "subquery",
                                "Expression": {
                                    "Subquery": {
                                        "Query": {
                                            "Version": 2,
                                            "From": [
                                                {
                                                    "Name": "s",
                                                    "Entity": "Calls",
                                                    "Type": 0
                                                }
                                            ],
                                            "Select": [
                                                {
                                                    "Column": {
                                                        "Expression": {
                                                            "SourceRef": {
                                                                "Source": "s"
                                                            }
                                                        },
                                                        "Property": slot.column
                                                    },
                                                    "Name": "field"
                                                }
                                            ],
                                            "Top": slot.topN.top,
                                            // Pitfall 3: OrderBy expression MUST be an Aggregation wrapping a raw column, NOT a Measure.
                                            // A Measure reference here causes Desktop crash in SemanticQueryRewriter.rewriteOrderBy.
                                            // Avg QA Score is AVERAGE('Calls'[Agent_Quality]), so Function: 1 (Average) on Agent_Quality is exact.
                                            // Confirmed empirically in Power BI Desktop 2.157.879.0 (26.08, August 2026) on 2026-09-03: Function 1 on Agent_Quality renders cleanly.
                                            "OrderBy": [
                                                {
                                                    "Direction": slot.topN.direction,
                                                    "Expression": {
                                                        "Aggregation": {
                                                            "Expression": {
                                                                "Column": {
                                                                    "Expression": {
                                                                        "SourceRef": {
                                                                            "Source": "s"
                                                                        }
                                                                    },
                                                                    "Property": slot.topN.orderByColumn
                                                                }
                                                            },
                                                            "Function": slot.topN.aggregationFunction
                                                        }
                                                    }
                                                }
                                            ]
                                        }
                                    }
                                },
                                "Type": 2
                            },
                            {
                                "Name": "c",
                                "Entity": "Calls",
                                "Type": 0
                            }
                        ],
                        "Where": [
                            {
                                "Condition": {
                                    "In": {
                                        "Expressions": [
                                            {
                                                "Column": {
                                                    "Expression": {
                                                        "SourceRef": {
                                                            "Source": "c"
                                                        }
                                                    },
                                                    "Property": slot.column
                                                }
                                            }
                                        ],
                                        "Table": {
                                            "SourceRef": {
                                                "Source": "subquery"
                                            }
                                        }
                                    }
                                }
                            }
                        ]
                    },
                    "howCreated": "User"
                }
            ]
        };
    }

    return JSON.stringify(container, null, 2);
}

function buildScatterChartJson(slot) {
    if (!COLUMN_MANIFEST.some(c => c.name === 'Agent_ID')) {
        throw new Error('Column not found in COLUMN_MANIFEST: Agent_ID');
    }
    if (!CALLS_MEASURES.some(m => m.name === 'Avg Silence %')) {
        throw new Error('Measure not found in CALLS_MEASURES: Avg Silence %');
    }
    if (!CALLS_MEASURES.some(m => m.name === 'Avg QA Score')) {
        throw new Error('Measure not found in CALLS_MEASURES: Avg QA Score');
    }

    const visualNode = {
        "visualType": "scatterChart",
        "query": {
            "queryState": {
                "Category": {
                    "projections": [
                        {
                            "field": {
                                "Column": {
                                   "Expression": {
                                       "SourceRef": {
                                           "Entity": "Calls"
                                       }
                                   },
                                   "Property": "Agent_ID"
                                }
                            },
                            "queryRef": "Calls.Agent_ID",
                            "nativeQueryRef": "Agent_ID"
                        }
                    ]
                },
                "X": {
                    "projections": [
                        {
                            "field": {
                                "Measure": {
                                   "Expression": {
                                       "SourceRef": {
                                           "Entity": "Calls"
                                       }
                                   },
                                   "Property": "Avg Silence %"
                                }
                            },
                            "queryRef": "Calls.Avg Silence %",
                            "nativeQueryRef": "Avg Silence %"
                        }
                    ]
                },
                "Y": {
                    "projections": [
                        {
                            "field": {
                                "Measure": {
                                   "Expression": {
                                       "SourceRef": {
                                           "Entity": "Calls"
                                       }
                                   },
                                   "Property": "Avg QA Score"
                                }
                            },
                            "queryRef": "Calls.Avg QA Score",
                            "nativeQueryRef": "Avg QA Score"
                        }
                    ]
                }
            }
        },
        "objects": {
            // D-03 Fallback: Community-sourced trend property shape ({ show: 'true', lineColor: ..., transparency: '20D', style: '\'dashed\'' })
            // was empirically tested in Power BI Desktop (verified via UAT checkpoint: no-trend-line+uniform-dots) and ignored.
            // No official Microsoft documentation supports a 'trend' formatting object on scatterChart. Per D-03, shipping scatter without a line
            // is the documented fallback; no linear-regression DAX measure is substituted.
            // D-02 Fallback: Size role on Total Calls was ignored by Desktop (+uniform-dots). Dropped per D-02 escape hatch.
            "legend": [
                {
                    "properties": {
                        "show": {
                            "expr": {
                                "Literal": {
                                    "Value": "false"
                                }
                            }
                        }
                    }
                }
            ],
            // D-21, SC9: Agent category labels confirmed in Desktop (Microsoft Store 2.157.879.0)
            "categoryLabels": [
                {
                    "properties": {
                        "show": {
                            "expr": {
                                "Literal": {
                                    "Value": "true"
                                }
                            }
                        }
                    }
                }
            ]
        }
    };

    if (slot.chartTitle || slot.titleMeasure) {
        if (!visualNode.visualContainerObjects) {
            visualNode.visualContainerObjects = {};
        }
        visualNode.visualContainerObjects.title = [
            {
                "properties": {
                    "show": {
                        "expr": {
                            "Literal": {
                                "Value": "true"
                            }
                        }
                    },
                    "text": {
                        "expr": slot.titleMeasure ? {
                            "Measure": {
                                "Expression": {
                                    "SourceRef": {
                                        "Entity": "Calls"
                                    }
                                },
                                "Property": slot.titleMeasure
                            }
                        } : {
                            "Literal": {
                                "Value": `'${slot.chartTitle}'`
                            }
                        }
                    }
                }
            }
        ];
    }

    if (typeof slot.axisFloor === 'number') {
        visualNode.objects.valueAxis = [
            {
                "properties": {
                    "start": {
                        "expr": {
                            "Literal": {
                                "Value": String(slot.axisFloor) + 'D'
                            }
                        }
                    }
                }
            }
        ];
        if (!visualNode.visualContainerObjects) {
            visualNode.visualContainerObjects = {};
        }
        visualNode.visualContainerObjects.subTitle = [
            {
                "properties": {
                    "show": {
                        "expr": {
                            "Literal": {
                                "Value": "true"
                            }
                        }
                    },
                    "text": {
                        "expr": {
                            "Literal": {
                                "Value": `'${buildAxisFloorDisclosure(slot.axisFloor)}'`
                            }
                        }
                    }
                }
            }
        ];
    }

    return JSON.stringify({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json",
        "name": slot.id,
        "position": {
            "x": slot.x,
            "y": slot.y,
            "z": slot.z,
            "width": slot.width,
            "height": slot.height,
            "tabOrder": slot.z
        },
        "visual": visualNode
    }, null, 2);
}

function buildImageVisualJson(slot) {
    if (!PBI_REGISTERED_IMAGES.some(img => img.itemName === slot.itemName)) {
        throw new Error(`Registered image not found: ${slot.itemName}`);
    }
    return JSON.stringify({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json",
        "name": slot.id,
        "position": {
            "x": slot.x,
            "y": slot.y,
            "z": slot.z,
            "width": slot.width,
            "height": slot.height,
            "tabOrder": slot.z
        },
        "visual": {
            "visualType": "image",
            "drillFilterOtherVisuals": true,
            "visualContainerObjects": {
                "background": [
                    {
                        "properties": {
                            "show": {
                                "expr": {
                                    "Literal": {
                                        "Value": "false"
                                    }
                                }
                            }
                        }
                    }
                ],
                "border": [
                    {
                        "properties": {
                            "show": {
                                "expr": {
                                    "Literal": {
                                        "Value": "false"
                                    }
                                }
                            }
                        }
                    }
                ]
            },
            "objects": {
                "general": [
                    {
                        "properties": {
                            "imageUrl": {
                                "expr": {
                                    "ResourcePackageItem": {
                                        "PackageName": "RegisteredResources",
                                        "PackageType": 1,
                                        "ItemName": slot.itemName
                                    }
                                }
                            }
                        }
                    }
                ]
            }
        }
    }, null, 2);
}

function buildTextboxJson(slot) {
    if (!slot || !slot.title || typeof slot.title !== 'string' || slot.title.trim() === '') {
        throw new Error(`buildTextboxJson: Slot '${slot ? slot.key : 'unknown'}' is missing required string property 'title'`);
    }

    const alignment = slot.alignment || (slot.layer === 'background' ? 'center' : 'left');
    const textColor = slot.textColor || (slot.layer === 'background' ? ACME_TOKENS.textPrimary : '#F8FAFC');

    const fontSize = slot.layer === 'background' ? '28px' : '20px';
    const fontFamily = slot.layer === 'background' ? 'Segoe UI Semibold' : 'Segoe UI';

    const visualContainer = {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json",
        "name": slot.id,
        "position": {
            "x": slot.x,
            "y": slot.y,
            "z": slot.z,
            "width": slot.width,
            "height": slot.height,
            "tabOrder": slot.z
        },
        "visual": {
            "visualType": "textbox",
            "objects": {
                "general": [
                    {
                        "properties": {
                            "paragraphs": [
                                {
                                    "horizontalTextAlignment": alignment,
                                    "textRuns": [
                                        {
                                            "value": slot.title,
                                            "textStyle": {
                                                "fontFamily": fontFamily,
                                                "fontSize": fontSize,
                                                "color": textColor
                                            }
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                ]
            }
        }
    };

    if (slot.layer === 'background') {
        visualContainer.visual.visualContainerObjects = {
            "background": [
                {
                    "properties": {
                        "show": {
                            "expr": {
                                "Literal": {
                                    "Value": "true"
                                }
                            }
                        },
                        "color": {
                            "solid": {
                                "color": {
                                    "expr": {
                                        "Literal": {
                                            "Value": `'${ACME_TOKENS.header}'`
                                        }
                                    }
                                }
                            }
                        },
                        "transparency": {
                            "expr": {
                                "Literal": {
                                    "Value": "0D"
                                }
                            }
                        }
                    }
                }
            ],
            "border": [
                {
                    "properties": {
                        "show": {
                            "expr": {
                                "Literal": {
                                    "Value": "false"
                                }
                            }
                        }
                    }
                }
            ],
            "padding": [
                {
                    "properties": {
                        "top": {
                            "expr": {
                                "Literal": {
                                    "Value": "14D"
                                }
                            }
                        },
                        "bottom": {
                            "expr": {
                                "Literal": {
                                    "Value": "0D"
                                }
                            }
                        },
                        "left": {
                            "expr": {
                                "Literal": {
                                    "Value": "0D"
                                }
                            }
                        },
                        "right": {
                            "expr": {
                                "Literal": {
                                    "Value": "0D"
                                }
                            }
                        }
                    }
                }
            ]
        };
    }

    return JSON.stringify(visualContainer, null, 2);
}


// D-01 / P0-1 Remediation: Date-window honesty.
// Prior behavior: Derived the trailing third of the date span from the loaded rows and baked
// absolute datetime literals into the slicer visual definition.
// Why that failed: A partial default window that nothing on the canvas discloses caused
// 'Call Volume 692' to read as the total for a 1,200-row dataset, and caused deltas to compare
// that sub-window against an ALL('Calls') baseline of the whole dataset. Furthermore, derived
// bounds baked as absolute literals go stale whenever the CSV is refreshed without regenerating.
// What was rejected:
// 1. Keeping the trailing third with a canvas label — still leaves the delta baseline comparing
//    a sub-window against the whole dataset.
// 2. Relative-date slicer mode — while fixing staleness, it is an unconfirmed PBIR property that
//    risks Desktop failure, identical to prior title and filter discrepancies.
// Consequence under D-02: With no authored window, selection equals baseline on open; all seven
// deltas read zero until a slicer narrows, reflecting an honest un-filtered baseline comparison.
function buildDefaultDateRangeFilter(rows) {
    return null;
}

function buildSlicerJson(slot, options, rows) {
    var entity = options.entity || 'Calls';
    if (entity === 'Calls') {
        if (!COLUMN_MANIFEST.some(c => c.name === options.column)) {
            throw new Error(`Column not found in COLUMN_MANIFEST for entity 'Calls': ${options.column}`);
        }
    } else if (entity === 'DateTable') {
        if (!PBI_DATE_TABLE_COLUMNS.includes(options.column)) {
            throw new Error(`Column not found in PBI_DATE_TABLE_COLUMNS for entity 'DateTable': ${options.column}`);
        }
    } else {
        throw new Error(`buildSlicerJson: Unknown entity '${entity}'`);
    }
    if (options.mode !== 'Between' && options.mode !== 'Dropdown' && options.mode !== 'Relative') {
        throw new Error(`Slicer mode not supported: ${options.mode}`);
    }

    if (options.syncGroup) {
        if (!options.syncGroup.groupName || typeof options.syncGroup.groupName !== 'string' || options.syncGroup.groupName.trim() === '' ||
            typeof options.syncGroup.fieldChanges !== 'boolean' || typeof options.syncGroup.filterChanges !== 'boolean') {
            throw new Error(`buildSlicerJson: Invalid syncGroup configuration for column '${options.column}'`);
        }
    }
    
    const SLICER_HEADER_MAP = {
        'DateTable.Date|Between': "'Date Range'",
        'DateTable.Date|Relative': "'Relative to Today'",
        'Calls.Primary_Category': "'Category'",
        'Calls.Queue_Name': "'Queue'",
        'Calls.Agent_ID': "'Agent'"
    };
    const headerKeyWithMode = `${entity}.${options.column}|${options.mode}`;
    const headerKey = `${entity}.${options.column}`;
    let headerText;
    if (Object.prototype.hasOwnProperty.call(SLICER_HEADER_MAP, headerKeyWithMode)) {
        headerText = SLICER_HEADER_MAP[headerKeyWithMode];
    } else if (Object.prototype.hasOwnProperty.call(SLICER_HEADER_MAP, headerKey)) {
        headerText = SLICER_HEADER_MAP[headerKey];
    } else {
        throw new Error(`buildSlicerJson: Unsupported slicer column '${options.column}' for entity '${entity}' with mode '${options.mode}'`);
    }
    
    let filterConfigFilters = null;
    if (entity === 'DateTable' && options.column === 'Date' && options.mode === 'Between') {
        filterConfigFilters = buildDefaultDateRangeFilter(rows);
    }
    
    const visualNode = {
        "visualType": "slicer"
    };

    if (options.syncGroup) {
        // Pattern 3 confirmation: Confirmed empirically in Power BI Desktop 2.157.879.0 (26.08, August 2026) on 2026-09-03.
        // Hand-authored syncGroup is honoured in both directions across Executive Hub and Ops/QA Command tabs without error or repair prompt.
        // Closes RESEARCH Open Question 1.
        visualNode.syncGroup = {
            "groupName": options.syncGroup.groupName,
            "fieldChanges": options.syncGroup.fieldChanges,
            "filterChanges": options.syncGroup.filterChanges
        };
    }

    visualNode.query = {
        "queryState": {
            "Values": {
                "projections": [
                    {
                        "field": {
                            "Column": {
                                "Expression": {
                                    "SourceRef": {
                                        "Entity": entity
                                    }
                                },
                                "Property": options.column
                            }
                        },
                        "queryRef": entity + "." + options.column,
                        "nativeQueryRef": options.column
                    }
                ]
            }
        }
    };

    visualNode.objects = {
        "data": [
            {
                "properties": {
                    "mode": {
                        "expr": {
                            "Literal": {
                                "Value": "'" + options.mode + "'"
                            }
                        }
                    }
                }
            }
        ],
        "header": [
            {
                "properties": {
                    "show": {
                        "expr": {
                            "Literal": {
                                "Value": "true"
                            }
                        }
                    },
                    "text": {
                        "expr": {
                            "Literal": {
                                "Value": headerText
                            }
                        }
                    }
                }
            }
        ]
    };
    
    if (filterConfigFilters) {
        // [20-06 resolves it -> confirmed] The container-level attachment site is not what Desktop honours for a hand-authored report.
        // Moving to the formatting-object property under the general object.
        visualNode.objects.general = visualNode.objects.general || [];
        if (visualNode.objects.general.length === 0) {
            visualNode.objects.general.push({ "properties": {} });
        }
        visualNode.objects.general[0].properties.filter = {
            "filter": filterConfigFilters[0]
        };
    }
    
    return JSON.stringify({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json",
        "name": slot.id,
        "position": {
            "x": slot.x,
            "y": slot.y,
            "z": slot.z,
            "width": slot.width,
            "height": slot.height,
            "tabOrder": slot.z
        },
        "visual": visualNode
    }, null, 2);
}

// Global visual builder registry (REFAC-02, D-10).
// Maps non-slicer slot kinds to builder functions taking (slot).
// `var` so this attaches to the vm sandbox's global object.
var PBI_VISUAL_BUILDERS = {
    card: buildCardVisualJson,
    gauge: buildGaugeVisualJson,
    line: buildLineChartJson,
    bar: buildBarChartJson,
    // column kind explicitly aliases buildBarChartJson (Power BI column charts share the bar chart builder)
    column: buildBarChartJson,
    scatter: buildScatterChartJson,
    textbox: buildTextboxJson,
    image: buildImageVisualJson,
    table: buildTableVisualJson
};

function buildPageVisuals(pageEntry, rows) {
    const files = {};
    const basePath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.Report/definition/pages/${pageEntry.id}/visuals`;

    for (const slot of pageEntry.layout) {
        if (slot.kind === 'slicer') {
            if (!slot.slicerOptions) {
                throw new Error(`buildPageVisuals: slicer slot '${slot.key}' missing required slicerOptions`);
            }
            files[`${basePath}/${slot.id}/visual.json`] = buildSlicerJson(slot, slot.slicerOptions, rows);
        } else {
            const builder = PBI_VISUAL_BUILDERS[slot.kind];
            if (!builder) {
                throw new Error(`buildPageVisuals: unknown visual kind '${slot.kind}' for slot '${slot.key}'`);
            }
            files[`${basePath}/${slot.id}/visual.json`] = builder(slot);
        }
    }

    return files;
}

// Retained named wrappers (D-13): existing callers, tests, and regen-powerbi.js call these by exact name.
// Renaming or removing them breaks regen and external test harnesses silently.
function buildExecHubVisuals(rows) {
    return buildPageVisuals(getPageByKey('execHub'), rows);
}

function buildOpsQaVisuals(rows) {
    return buildPageVisuals(getPageByKey('opsQa'), rows);
}

// PBI_FIXED_FILE_COUNTS registry (REFAC-03, D-12).
// Named integer constants enumerating fixed files across builders that do not scale with registries:
// - semanticModel: 7 files in buildModelFiles that do not scale with PBI_MODEL_TABLES:
//     1. .platform
//     2. definition.pbism
//     3. definition/database.tmdl
//     4. definition/model.tmdl
//     5. definition/cultures/en-US.tmdl
//     6. definition/relationships.tmdl
//     7. definition/expressions.tmdl
//   Note: PBI_RELATIONSHIPS contributes a constant 1 file (definition/relationships.tmdl)
//   regardless of how many entries it holds (even 0). COLUMN_MANIFEST contributes 0 files
//   because column definitions are lines within tables/Calls.tmdl rather than separate files.
// - report: 5 files in buildReportFiles that do not scale with PBI_PAGES:
//     1. .platform
//     2. definition.pbir
//     3. definition/version.json
//     4. definition/report.json
//     5. definition/pages/pages.json
// - theme: 4 static resource files in buildThemeFile:
//     1. StaticResources/SharedResources/BaseThemes/Fluent2-CY26SU08.json
//     2. StaticResources/RegisteredResources/DexcomModernDark.json (PBI_THEME.fileName)
//     3. StaticResources/RegisteredResources/icon_auto.png (Brand logo)
//     4. StaticResources/RegisteredResources/avatar.png (Brand avatar)
// - extras: 3 top-level files added directly to fileMap in buildPowerBIFileMap:
//     1. <PBI_ROOT>/<PBI_PROJECT_NAME>.pbip
//     2. <PBI_ROOT>/<PBI_PROJECT_NAME>.SemanticModel/data/dashboard-ready.csv
//     3. README.md
var PBI_FIXED_FILE_COUNTS = {
    semanticModel: 7,
    report: 5,
    theme: 4,
    extras: 3
};

function computeExpectedFileCount() {
    // Exact count derived independently from registries and fixed counts:
    // semanticModel fixed (7) + PBI_MODEL_TABLES.length (4)
    // + report fixed (5) + PBI_PAGES.length (4)
    // + theme resources (4)
    // + total visual slots across all pages (PBI_PAGES.reduce layout.length) (42)
    // + top-level extras (3)
    // = 69 total files.
    const visualsCount = PBI_PAGES.reduce((sum, page) => sum + (page.layout ? page.layout.length : 0), 0);
    return PBI_FIXED_FILE_COUNTS.semanticModel +
        PBI_MODEL_TABLES.length +
        PBI_FIXED_FILE_COUNTS.report +
        PBI_PAGES.length +
        PBI_FIXED_FILE_COUNTS.theme +
        visualsCount +
        PBI_FIXED_FILE_COUNTS.extras;
}

function buildPowerBIFileMap(rows, exportMode) {
    if (!exportMode) exportMode = PBI_EXPORT_MODE_FULL;
    if (exportMode !== PBI_EXPORT_MODE_FULL && exportMode !== PBI_EXPORT_MODE_FILTERED) {
        throw new Error(`buildPowerBIFileMap: Unknown exportMode '${exportMode}'. Expected '${PBI_EXPORT_MODE_FULL}' or '${PBI_EXPORT_MODE_FILTERED}'.`);
    }

    const modelFiles = buildModelFiles();
    const reportFiles = buildReportFiles();
    const themeFiles = buildThemeFile();

    const fileMap = Object.assign(
        {},
        modelFiles,
        reportFiles,
        themeFiles
    );

    for (let i = 0; i < PBI_PAGES.length; i++) {
        Object.assign(fileMap, buildPageVisuals(PBI_PAGES[i], rows));
    }

    const expectedCount = computeExpectedFileCount();

    fileMap[`${PBI_ROOT}/${PBI_PROJECT_NAME}.pbip`] = JSON.stringify({
        "version": "1.0",
        "artifacts": [
            {
                "report": {
                    "path": `${PBI_PROJECT_NAME}.Report`
                }
            }
        ],
        "settings": {
            "enableAutoRecovery": true
        }
    }, null, 2);

    fileMap[`${PBI_ROOT}/${PBI_PROJECT_NAME}.SemanticModel/data/dashboard-ready.csv`] = buildDashboardReadyCsv(rows);

    const modePhrase = exportMode === PBI_EXPORT_MODE_FULL ? 'full dataset' : 'filtered rows only';
    const modeDescription = exportMode === PBI_EXPORT_MODE_FILTERED
        ? 'Rows were narrowed by the filters active in the dashboard at export time; the package therefore does not contain every row of the source file.'
        : 'Every row of the loaded source file is included.';

    fileMap['README.md'] = [
        '# Speech Analytics Power BI Export',
        '',
        `This project uses the Power BI Project (.pbip) format. Before opening it, three preview features must be enabled in Power BI Desktop (verified against build ${PBI_VERIFIED_DESKTOP_VERSION} Microsoft Store).`,
        '',
        '## Before you open this project',
        '',
        '1. Open Power BI Desktop.',
        '2. Navigate to: `File > Options and settings > Options > Preview features`.',
        '3. Ensure the following three toggles are checked:',
        '   - `Power BI Project (.pbip) save option`',
        '   - `Store semantic model using TMDL format`',
        '   - `Store reports using enhanced metadata format (PBIR)`',
        '4. Select OK.',
        '',
        'Power BI Desktop must be restarted after enabling the preview toggles for the changes to take effect.',
        '',
        '## Opening the report and loading data',
        '',
        '1. Extract this ZIP to a folder on your computer.',
        `2. In Power BI Desktop, use File > Open and select \`${PBI_ROOT}/${PBI_PROJECT_NAME}.pbip\`.`,
        '3. Click "Refresh now" when prompted. Power BI will report that CsvFolderPath has not been set yet. This is expected — continue to step 4.',
        `4. On the Home ribbon, open Transform data > Edit parameters and set \`CsvFolderPath\` to the extracted \`${PBI_PROJECT_NAME}.SemanticModel\` folder (the folder that contains \`data/\`) — not the ZIP root and not the CSV file itself. Select OK.`,
        '5. Click "Apply changes" in the yellow banner. Power BI holds parameter edits until you apply them, so refreshing before this step reuses the old value and shows the same error again.',
        '6. Click Refresh. The Calls table now loads.',
        '',
        'You only do this once per extracted copy. If you move the folder later, repeat steps 4-6 with the new location.',
        '',
        "Relative-date windows are measured against your computer's current system date; a dataset whose calls all predate the last 7 or 30 days will legitimately show an empty selection when a relative window is picked, reflecting that the data is historical rather than that the report is broken.",
        '',
        '## Call Detail & Data Exposure',
        '',
        PBI_PII_EXPOSURE_STATEMENT,
        '',
        'The Call Detail page is a drill-through target reached by right-clicking data points in Coaching Focus or Calls by Category. It is set to hidden in view mode so it is reached by drilling rather than by tab navigation. This hiding is a navigation choice that removes nothing from reach: all underlying data remains directly accessible through dashboard-ready.csv, DAX expressions, and Power Query.',
        '',
        '## Report targets and reference values',
        '',
        `Visual targets and reference lines in this report use a ${PBI_TARGET_DEFAULT_DISCLOSURE}, or a ${PBI_TARGET_DATA_DERIVED_DISCLOSURE}. They do not represent confirmed organizational performance standards.`,
        '',
        ...(typeof PBI_TARGET_LINES !== 'undefined' ? PBI_TARGET_LINES.map(entry => {
            const valStr = entry.measure ? `measure \`${entry.measure}\`` : `${entry.value} (${entry.unit || 'points'})`;
            return `- **${entry.slotKey}**: ${valStr} — ${entry.label}`;
        }) : []),
        '',
        '## Export scope',
        '',
        `${PBI_EXPORT_SCOPE_README_PREFIX}${modePhrase} (${String(rows.length)} rows).`,
        modeDescription,
        '',
        '## If something goes wrong',
        '',
        '| Symptom | What to do |',
        '|---|---|',
        '| Repair prompt on open | Preview toggles not enabled or Desktop not restarted. Ensure all three preview features are enabled and restart Power BI Desktop before opening the .pbip file. |',
        '| Folder moved after extraction | If the project directory was moved or renamed, repeat steps 4-6 with the new folder location. |',
        '| CsvFolderPath pointed at the extracted ZIP root | CsvFolderPath must point to the extracted SemanticModel subfolder containing `data/`, not the root directory. |',
        '| CsvFolderPath pointed directly at the CSV file | CsvFolderPath must point to the `.SemanticModel` folder itself, not directly to `dashboard-ready.csv`. |',
        '| Preview toggles not enabled or Desktop not restarted | Open `File > Options and settings > Options > Preview features`, enable all three toggles, and restart Power BI Desktop. |',
        '| A bar or line point is missing on a chart whose subtitle reads Axis starts at N | That chart\'s value axis starts at N instead of zero. The generator checked every such floor against the data it was built from, but after a refresh with different data a value at or below N is not drawn. Read that value from its data label or tooltip. |',
        ''
    ].join('\n');

    const actualCount = Object.keys(fileMap).length;
    if (actualCount !== expectedCount) {
        throw new Error(`buildPowerBIFileMap: File count mismatch (expected ${expectedCount} from registries, got ${actualCount}). A builder may have emitted fewer files or a duplicate key was encountered.`);
    }

    // Normalize every generated file to CRLF, at one place rather than in each builder.
    // Two reasons, one of them a real defect rather than cosmetics:
    //   1. The archive was internally INCONSISTENT. Papa.unparse defaults to \r\n, so the shipped
    //      dashboard-ready.csv was CRLF while every TMDL/JSON/README file around it was bare LF.
    //      (This hid in the test suite because the Papa stub there emits \n.)
    //   2. Every Desktop-authored file in the reference project is CRLF. Power BI rewrites these
    //      files on save, so an LF export that a user git-tracks — the whole point of PBIP and of
    //      the .platform logicalId — shows every file as wholly modified after the first save.
    // CRLF is empirically safe here: the Desktop baseline parses as CRLF, and the CSV was already
    // CRLF when Desktop loaded all 15 columns over 1200 rows during the D-10 spike.
    for (const key of Object.keys(fileMap)) {
        fileMap[key] = fileMap[key].replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    }

    return fileMap;
}

function assertGeneratedTextIsClean(fileMap) {
    // Case-only path collisions (18-REVIEW IN-02). buildPowerBIFileMap's expectedCount check catches
    // exact duplicate keys, but two keys differing only in case are distinct in the map and in the ZIP
    // while silently overwriting each other on extraction to a case-insensitive filesystem — Windows,
    // the stated primary target for this export. Nothing collides today; this keeps it that way.
    const seenLowercase = new Map();
    for (const key of Object.keys(fileMap)) {
        const lower = key.toLowerCase();
        if (seenLowercase.has(lower)) {
            throw new Error(`Generated paths collide when case is ignored: ${seenLowercase.get(lower)} vs ${key}`);
        }
        seenLowercase.set(lower, key);
    }

    for (const [key, content] of Object.entries(fileMap)) {
        if (typeof content !== 'string') {
            throw new Error(`Invalid file content type for ${key}: expected string`);
        }
        if (content.length === 0) {
            throw new Error(`Zero-length generated file: ${key}`);
        }
        if (!isRegisteredImagePath(key) && content.charCodeAt(0) === 0xFEFF) {
            throw new Error(`Byte-order mark (U+FEFF) at the start of: ${key}`);
        }
        if (key.includes('\\')) {
            throw new Error(`Backslash in generated path: ${key}`);
        }
        if (key.length > 200) {
            throw new Error(`Path exceeds the 200-character ceiling: ${key}`);
        }
        if (key !== 'README.md' && !key.startsWith('powerbi/')) {
            throw new Error(`Path escapes the single powerbi/ root: ${key}`);
        }
        // Line endings must be uniformly CRLF — matching the Desktop-authored reference, and
        // keeping the archive internally consistent (Papa.unparse emits CRLF for the CSV, so a
        // bare-LF TMDL file next to it was a real inconsistency, not a stylistic one).
        if (!isRegisteredImagePath(key) && /(^|[^\r])\n/.test(content)) {
            throw new Error(`Bare LF (expected CRLF) in generated file: ${key}`);
        }
    }
}

// D-13: The README is generated from a string array and shipped inside the distribution ZIP.
// Nothing else in the repository reads it, so an inline string array rots silently unless
// guarded by a gate asserting all required instructions and troubleshooting entries remain present.
function assertReadmeCoversRequiredContent(fileMap) {
    const readme = fileMap['README.md'];
    if (typeof readme !== 'string' || readme.length === 0) {
        throw new Error('README.md is missing or empty in fileMap');
    }
    for (const entry of README_REQUIRED_CONTENT) {
        if (!readme.includes(entry.needle)) {
            throw new Error(`README required content missing [${entry.label}]: expected substring "${entry.needle}"`);
        }
    }
}

// Phase 33 Plan 33-03 (DRILL-04, D-03): Build-time assertion that PII exposure disclosure is single-sourced.
// Asserts that PBI_PII_EXPOSURE_STATEMENT is non-empty and has no newlines, that README_REQUIRED_CONTENT
// binds the constant by reference, that README.md carries it verbatim, and that Call Detail's piiNotice slot
// carries it on canvas. Throws if fileMap contains no Call Detail visuals (anti-vacuity guard).
function assertPiiExposureStatementIsSingleSourced(fileMap) {
    if (!fileMap || typeof fileMap !== 'object') {
        throw new Error('assertPiiExposureStatementIsSingleSourced: fileMap must be an object');
    }

    const callDetailVisualsPrefix = `powerbi/${PBI_PROJECT_NAME}.Report/definition/pages/${PBI_CALL_DETAIL_PAGE_ID}/visuals/`;
    const visualFiles = Object.keys(fileMap).filter(k => k.startsWith(callDetailVisualsPrefix));
    if (visualFiles.length === 0) {
        throw new Error(`assertPiiExposureStatementIsSingleSourced: fileMap contains no files under '${callDetailVisualsPrefix}' (assertion inspected nothing)`);
    }

    const failures = [];

    // 1. The constant is real: non-empty string containing no newline
    if (typeof PBI_PII_EXPOSURE_STATEMENT !== 'string' || PBI_PII_EXPOSURE_STATEMENT.trim().length === 0) {
        failures.push('PBI_PII_EXPOSURE_STATEMENT is missing or empty');
    } else if (/[\r\n]/.test(PBI_PII_EXPOSURE_STATEMENT)) {
        failures.push('PBI_PII_EXPOSURE_STATEMENT must not contain newline characters');
    }

    // 2. The registry entry is the constant, not a copy
    const entry = (README_REQUIRED_CONTENT || []).find(x => x.label === 'drill-pii-exposure');
    if (!entry) {
        failures.push("README_REQUIRED_CONTENT is missing entry with label 'drill-pii-exposure'");
    } else if (entry.needle !== PBI_PII_EXPOSURE_STATEMENT) {
        failures.push("README_REQUIRED_CONTENT entry 'drill-pii-exposure' needle is not strictly identical to PBI_PII_EXPOSURE_STATEMENT constant (must be constant by reference)");
    }

    // 3. The README body carries it
    const readme = fileMap['README.md'];
    if (typeof readme !== 'string' || !readme.includes(PBI_PII_EXPOSURE_STATEMENT)) {
        failures.push('README.md does not carry PBI_PII_EXPOSURE_STATEMENT verbatim');
    }

    // 4. The canvas carries it
    const slot = (PBI_CALL_DETAIL_LAYOUT || []).find(s => s.key === 'piiNotice');
    if (!slot) {
        failures.push("PBI_CALL_DETAIL_LAYOUT is missing 'piiNotice' slot");
    } else {
        if (slot.title !== PBI_PII_EXPOSURE_STATEMENT) {
            failures.push("PBI_CALL_DETAIL_LAYOUT slot 'piiNotice' title does not match PBI_PII_EXPOSURE_STATEMENT");
        }
        const visualPath = `${callDetailVisualsPrefix}${slot.id}/visual.json`;
        const visualContent = fileMap[visualPath];
        if (!visualContent) {
            failures.push(`Visual file missing at '${visualPath}' for slot 'piiNotice'`);
        } else {
            let visualJson;
            try {
                visualJson = JSON.parse(visualContent);
            } catch (e) {
                failures.push(`Visual file at '${visualPath}' is not valid JSON: ${e.message}`);
            }
            if (visualJson) {
                const textRunValue = (
                    visualJson.visual &&
                    visualJson.visual.objects &&
                    visualJson.visual.objects.general &&
                    visualJson.visual.objects.general[0] &&
                    visualJson.visual.objects.general[0].properties &&
                    visualJson.visual.objects.general[0].properties.paragraphs &&
                    visualJson.visual.objects.general[0].properties.paragraphs.exprs &&
                    visualJson.visual.objects.general[0].properties.paragraphs.exprs[0] &&
                    visualJson.visual.objects.general[0].properties.paragraphs.exprs[0].textRun &&
                    visualJson.visual.objects.general[0].properties.paragraphs.exprs[0].textRun.value
                );
                if (textRunValue !== PBI_PII_EXPOSURE_STATEMENT && !visualContent.includes(JSON.stringify(PBI_PII_EXPOSURE_STATEMENT).slice(1, -1))) {
                    failures.push(`Visual at '${visualPath}' for slot 'piiNotice' canvas text does not carry PBI_PII_EXPOSURE_STATEMENT`);
                }
            }
        }
    }

    if (failures.length > 0) {
        throw new Error(`assertPiiExposureStatementIsSingleSourced failed (${failures.length}): ${failures.join('; ')}`);
    }
}

// 18-03 spent a spike proving Desktop refuses to open a report whose theme reference does not resolve.
// cad6ec8 "fixed" that by deleting the reference instead of shipping the file. This drift probe
// asserts the reference is both present and resolves to a real shipped file (D-05).
function assertThemeReferenceResolves(fileMap) {
    const reportStr = fileMap[`powerbi/${PBI_PROJECT_NAME}.Report/definition/report.json`];
    const reportJson = JSON.parse(reportStr);

    if (!reportJson.themeCollection || !reportJson.themeCollection.customTheme) {
        throw new Error('report.json is missing themeCollection.customTheme');
    }

    const regResources = (reportJson.resourcePackages || []).filter(p => p.type === 'RegisteredResources')[0];
    if (!regResources) {
        throw new Error('report.json resourcePackages is missing an element with type RegisteredResources');
    }

    const customThemeItem = (regResources.items || []).filter(i => i.type === 'CustomTheme')[0];
    if (!customThemeItem) {
        throw new Error('RegisteredResources package is missing an item with type CustomTheme');
    }

    const expectedPath = `powerbi/${PBI_PROJECT_NAME}.Report/StaticResources/RegisteredResources/${customThemeItem.path}`;
    if (!Object.prototype.hasOwnProperty.call(fileMap, expectedPath)) {
        throw new Error(`Theme reference does not resolve to a file-map key: ${expectedPath}`);
    }

    if (reportJson.themeCollection.customTheme.name !== PBI_THEME.theme.name || customThemeItem.name !== PBI_THEME.theme.name) {
        throw new Error(`customTheme name has drifted from PBI_THEME. Expected ${PBI_THEME.theme.name}, found ${reportJson.themeCollection.customTheme.name} and ${customThemeItem.name}`);
    }
}

// P2-8: Closes critique P2-8 finding by asserting that every emitted page.json
// drives its background and outspace canvas colors directly from PBI_THEME.theme.background.
function assertPageCanvasMatchesTheme(fileMap) {
    const expectedLiteral = `'${PBI_THEME.theme.background}'`;
    for (const page of PBI_PAGES) {
        const pagePath = `powerbi/${PBI_PROJECT_NAME}.Report/definition/pages/${page.id}/page.json`;
        const content = fileMap[pagePath];
        if (!content) {
            throw new Error(`assertPageCanvasMatchesTheme: Missing page file for page ${page.id} (${page.displayName}) at ${pagePath}`);
        }
        const pageJson = JSON.parse(content);
        const bg = pageJson.objects && pageJson.objects.background && pageJson.objects.background[0];
        const out = pageJson.objects && pageJson.objects.outspace && pageJson.objects.outspace[0];
        const bgVal = bg && bg.properties && bg.properties.color && bg.properties.color.solid && bg.properties.color.solid.color && bg.properties.color.solid.color.expr && bg.properties.color.solid.color.expr.Literal && bg.properties.color.solid.color.expr.Literal.Value;
        const outVal = out && out.properties && out.properties.color && out.properties.color.solid && out.properties.color.solid.color && out.properties.color.solid.color.expr && out.properties.color.solid.color.expr.Literal && out.properties.color.solid.color.expr.Literal.Value;
        if (bgVal !== expectedLiteral) {
            throw new Error(`assertPageCanvasMatchesTheme: Page ${page.id} (${page.displayName}) background color is ${bgVal}, expected theme background ${expectedLiteral}`);
        }
        if (outVal !== expectedLiteral) {
            throw new Error(`assertPageCanvasMatchesTheme: Page ${page.id} (${page.displayName}) outspace color is ${outVal}, expected theme background ${expectedLiteral}`);
        }
    }
}

// Drift probe: Layout geometry and card sizing pre-check (20-08 / G-20-2 / UAT Test 2).
// Guards against clipping by asserting cardVisual heights meet PBI_CARD_MIN_HEIGHT,
// all slots stay inside 1920x1080 canvas, no slots overlap, and emitted visual positions match.
function assertPageLayoutIsRenderable(pageEntry, fileMap) {
    if (!pageEntry || !Array.isArray(pageEntry.layout)) {
        throw new Error(`assertPageLayoutIsRenderable: page '${pageEntry ? pageEntry.key : 'unknown'}' layout is not an array.`);
    }

    const pageId = pageEntry.id;
    const basePath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.Report/definition/pages/${pageId}/visuals`;

    const bgSlots = pageEntry.layout.filter(s => s.layer === 'background');
    if (bgSlots.length > 1) {
        throw new Error(`assertPageLayoutIsRenderable: At most one background slot may exist per page, found ${bgSlots.length}`);
    }

    for (let i = 0; i < pageEntry.layout.length; i++) {
        const slot = pageEntry.layout[i];

        if (((slot.kind === 'card' || slot.kind === 'deltaCard') && slot.height < PBI_CARD_MIN_HEIGHT) || slot.height <= 1) {
            const minH = (slot.kind === 'card' || slot.kind === 'deltaCard') ? PBI_CARD_MIN_HEIGHT : 2;
            throw new Error(`assertPageLayoutIsRenderable: Slot '${slot.key}' height ${slot.height} is below minimum ${minH}`);
        }

        // D-16: Every ranking bar chart must declare a sort object with field and direction.
        // Kind 'column' is deliberately excluded (histogram order comes from model-level sortByColumn per Pitfall 4).
        if (slot.kind === 'bar' && (!slot.sort || !slot.sort.field || !slot.sort.direction)) {
            throw new Error(`assertPageLayoutIsRenderable: Slot '${slot.key}' of kind 'bar' must declare a sort object with field and direction`);
        }

        if (slot.x + slot.width > 1920 || slot.y + slot.height > 1080) {
            throw new Error(`assertPageLayoutIsRenderable: Slot '${slot.key}' extends beyond 1920x1080 canvas (x=${slot.x}, y=${slot.y}, w=${slot.width}, h=${slot.height})`);
        }

        // INVARIANT PROMOTION (Phase 24 D-12/D-13):
        // Previously, every layout slot was implicitly a content slot and pairwise no-overlap was global.
        // Now, slots carry an optional layer property (absence means content, 'background' designates background).
        // The no-overlap invariant is scoped to content slots (content vs content).
        // Background slots are governed by two rules:
        // 1) At most one background slot may exist per page, and background slots must not overlap each other.
        // 2) Any background slot intersecting a content slot must have a strictly lower z than that content slot.
        for (let j = i + 1; j < pageEntry.layout.length; j++) {
            const other = pageEntry.layout[j];
            const intersects = !(
                slot.x + slot.width <= other.x ||
                other.x + other.width <= slot.x ||
                slot.y + slot.height <= other.y ||
                other.y + other.height <= slot.y
            );

            if (intersects) {
                const slotIsBg = slot.layer === 'background';
                const otherIsBg = other.layer === 'background';

                if (slotIsBg && otherIsBg) {
                    throw new Error(`assertPageLayoutIsRenderable: Background slot '${slot.key}' overlaps with background slot '${other.key}'`);
                } else if (!slotIsBg && !otherIsBg) {
                    throw new Error(`assertPageLayoutIsRenderable: Slot '${slot.key}' overlaps with slot '${other.key}'`);
                } else {
                    const bg = slotIsBg ? slot : other;
                    const content = slotIsBg ? other : slot;
                    const bgZ = typeof bg.z === 'number' ? bg.z : 0;
                    const contentZ = typeof content.z === 'number' ? content.z : 0;
                    if (bgZ >= contentZ) {
                        throw new Error(`assertPageLayoutIsRenderable: Background slot '${bg.key}' (z=${bgZ}) must have strictly lower z than intersecting content slot '${content.key}' (z=${contentZ})`);
                    }
                }
            }
        }

        if (fileMap) {
            const visualKey = `${basePath}/${slot.id}/visual.json`;
            if (fileMap[visualKey]) {
                const visualObj = JSON.parse(fileMap[visualKey]);
                const pos = visualObj.position || {};
                if (pos.x !== slot.x || pos.y !== slot.y || pos.width !== slot.width || pos.height !== slot.height) {
                    throw new Error(`assertPageLayoutIsRenderable: Emitted visual for slot '${slot.key}' position does not match layout manifest`);
                }
            }
        }
    }
}

// Retained named wrapper (D-13): regen-powerbi.js and existing callers invoke this by exact name.
// Renaming it breaks regen silently.
function assertExecLayoutIsRenderable(fileMap) {
    return assertPageLayoutIsRenderable(getPageByKey('execHub'), fileMap);
}

// Retained named wrapper (D-13): regen-powerbi.js and existing callers invoke this by exact name.
// Renaming it breaks regen silently.
function assertOpsLayoutIsRenderable(fileMap) {
    return assertPageLayoutIsRenderable(getPageByKey('opsQa'), fileMap);
}

// Validates all pages in PBI_PAGES (REFAC-02, D-11).
// Redundantly runs execHub and opsQa in addition to the legacy wrappers above,
// ensuring any newly added page in future phases receives layout assertions automatically.
function assertAllPageLayoutsAreRenderable(fileMap) {
    for (const page of PBI_PAGES) {
        assertPageLayoutIsRenderable(page, fileMap);
    }
}

// Phase 34 Task 3 (T-34-01): Prevents line-chart slots from silently falling back to defaults.
function assertLineChartSlotsBindDeclaredFields(fileMap) {
    let inspectedCount = 0;
    for (const page of PBI_PAGES) {
        if (!page.layout) continue;
        for (const slot of page.layout) {
            if (slot.kind !== 'line') continue;
            inspectedCount++;

            const expectedEntity = slot.entity || 'Calls';
            const expectedColumn = slot.column || 'Call_Date';
            const expectedMeasure = slot.measure || 'Total Calls';

            const visualPath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.Report/definition/pages/${page.id}/visuals/${slot.id}/visual.json`;
            const content = fileMap[visualPath];
            if (!content) {
                throw new Error(`assertLineChartSlotsBindDeclaredFields: visual.json not found for slot '${slot.key}' (${slot.id}) on page '${page.key}' at ${visualPath}`);
            }

            const visualObj = JSON.parse(content);
            const queryState = visualObj.visual && visualObj.visual.query && visualObj.visual.query.queryState;
            if (!queryState) {
                throw new Error(`assertLineChartSlotsBindDeclaredFields: queryState missing for slot '${slot.key}' on page '${page.key}'`);
            }

            const catProj = queryState.Category && queryState.Category.projections && queryState.Category.projections[0];
            if (!catProj) {
                throw new Error(`assertLineChartSlotsBindDeclaredFields: Category projection missing for slot '${slot.key}' on page '${page.key}'`);
            }
            const actualCatEntity = catProj.field && catProj.field.Column && catProj.field.Column.Expression && catProj.field.Column.Expression.SourceRef && catProj.field.Column.Expression.SourceRef.Entity;
            const actualCatProperty = catProj.field && catProj.field.Column && catProj.field.Column.Property;

            if (actualCatEntity !== expectedEntity) {
                throw new Error(`assertLineChartSlotsBindDeclaredFields: Disagreeing Category entity for slot '${slot.key}' on page '${page.key}': expected '${expectedEntity}', got '${actualCatEntity}'`);
            }
            if (actualCatProperty !== expectedColumn) {
                throw new Error(`assertLineChartSlotsBindDeclaredFields: Disagreeing Category property for slot '${slot.key}' on page '${page.key}': expected '${expectedColumn}', got '${actualCatProperty}'`);
            }

            const yProj = queryState.Y && queryState.Y.projections && queryState.Y.projections[0];
            if (!yProj) {
                throw new Error(`assertLineChartSlotsBindDeclaredFields: Y projection missing for slot '${slot.key}' on page '${page.key}'`);
            }
            const actualYProperty = yProj.field && yProj.field.Measure && yProj.field.Measure.Property;

            if (actualYProperty !== expectedMeasure) {
                throw new Error(`assertLineChartSlotsBindDeclaredFields: Disagreeing Y property for slot '${slot.key}' on page '${page.key}': expected '${expectedMeasure}', got '${actualYProperty}'`);
            }
        }
    }

    if (inspectedCount === 0) {
        throw new Error('assertLineChartSlotsBindDeclaredFields: Found zero line-chart slots across report layouts');
    }
    return inspectedCount;
}


// Gate: QUAL-01, D-16, D-17, D-18, D-19, D-20.
// PBIR's public JSON Schema validates shape but never cross-reference correctness — every Entity,
// Property and Source is an untyped string — so schema-valid JSON with a typo'd column name is
// indistinguishable from correct JSON and Desktop's response to it ranges from a visible error to a fully
// silent blank visual. The in-memory manifests are the source of truth.
function assertFieldReferencesResolve(fileMap) {
    // CALLS_CALCULATED_COLUMNS added so visuals binding calculated columns resolve without failing QUAL-01
    const allCols = COLUMN_MANIFEST
        .concat(typeof CALLS_DERIVED_COLUMNS !== 'undefined' ? CALLS_DERIVED_COLUMNS : [])
        .concat(typeof CALLS_CALCULATED_COLUMNS !== 'undefined' ? CALLS_CALCULATED_COLUMNS : []);
    const validColumns = new Set(allCols.map(c => c.name));
    const validMeasures = new Set(CALLS_MEASURES.map(m => m.name));
    let totalReferences = 0;
    const failures = [];

    const visualKeys = Object.keys(fileMap).filter(k => k.match(/^powerbi\/.*\.Report\/definition\/pages\/[0-9a-f]{20}\/visuals\/[0-9a-f]{20}\/visual\.json$/));

    for (const key of visualKeys) {
        const visualMatch = key.match(/pages\/([0-9a-f]{20})\/visuals\/([0-9a-f]{20})\/visual\.json$/);
        const pageId = visualMatch[1];
        const visualId = visualMatch[2];
        const visualJson = JSON.parse(fileMap[key]);

        const sink = [];
        collectFieldReferences(visualJson, sink, {});

        for (const ref of sink) {
            totalReferences++;
            
            const entity = ref.entity || 'Calls';
            const knownTables = typeof PBI_MODEL_TABLES !== 'undefined' ? PBI_MODEL_TABLES.map(t => t.name) : ['Calls'];
            if (!knownTables.includes(entity)) {
                failures.push(`[${pageId} / ${visualId}] Unknown entity: ${ref.entity} on ${ref.property}`);
                continue;
            }

            if (entity === 'SilenceBuckets' || entity === 'EmpathyBuckets') {
                const validDimColumns = new Set(['Bucket_Label', 'Bucket_Order']);
                if (ref.kind === 'Column') {
                    if (!validDimColumns.has(ref.property)) {
                        failures.push(`[${pageId} / ${visualId}] Unknown Column: ${ref.property}`);
                    }
                } else if (ref.kind === 'Measure') {
                    failures.push(`[${pageId} / ${visualId}] Unknown Measure: ${ref.property}`);
                }
            } else if (entity === 'DateTable') {
                const validDimColumns = new Set(typeof PBI_DATE_TABLE_COLUMNS !== 'undefined' ? PBI_DATE_TABLE_COLUMNS : ['Date', 'Year', 'Month_Number', 'Month_Name']);
                if (ref.kind === 'Column') {
                    if (!validDimColumns.has(ref.property)) {
                        failures.push(`[${pageId} / ${visualId}] Unknown Column: ${ref.property}`);
                    }
                } else if (ref.kind === 'Measure') {
                    failures.push(`[${pageId} / ${visualId}] Unknown Measure: ${ref.property}`);
                }
            } else if (entity === 'Calls') {
                if (ref.kind === 'Column') {
                    if (validMeasures.has(ref.property) && !validColumns.has(ref.property)) {
                        failures.push(`[${pageId} / ${visualId}] Kind mismatch: ${ref.property} is a Measure, but referenced as Column`);
                    } else if (!validColumns.has(ref.property)) {
                        failures.push(`[${pageId} / ${visualId}] Unknown Column: ${ref.property}`);
                    }
                } else if (ref.kind === 'Measure') {
                    if (validColumns.has(ref.property) && !validMeasures.has(ref.property)) {
                        failures.push(`[${pageId} / ${visualId}] Kind mismatch: ${ref.property} is a Column, but referenced as Measure`);
                    } else if (!validMeasures.has(ref.property)) {
                        failures.push(`[${pageId} / ${visualId}] Unknown Measure: ${ref.property}`);
                    }
                }
            }
            if (ref.kind === 'UnresolvedAlias') {
                failures.push(`[${pageId} / ${visualId}] Unresolved alias (Source): ${ref.source}`);
            }
        }
    }

    if (totalReferences === 0) {
        throw new Error('Field reference gate found zero references across the report. Walker failed to find query blocks.');
    }

    if (failures.length > 0) {
        throw new Error(`Field reference validation failed:\n${failures.join('\n')}`);
    }
    
    return totalReferences;
}

// Gate: QUAL-03, D-17, D-18, D-19, D-20.
// PBIR cannot distinguish a binding to a column from a binding to a hardcoded value list by shape alone,
// so a visual that names specific categories, queues, or agents renders identically to one that binds
// Primary_Category, Queue_Name, or Agent_ID — until a different CSV is uploaded, at which point the baked
// visual is silently wrong and nobody is watching.
// Allowlist: Numeric bucket-edge thresholds (D-08), numeric axis floor starts (D-17), Top-N counts (D-09), data-derived date defaults (Phase 20 D-05),
// and display strings such as chart titles and axis labels are explicitly permitted. The rule is exact equality
// against an actual dataset cell value of the three forbidden columns after quote-stripping — not substring containment,
// and not a general ban on literals. The synthetic silence-bucket labels live in Calls.tmdl, not in visual.json.
function assertNoHardcodedCategoryLiterals(fileMap, rows) {
    const forbiddenColumns = ['Primary_Category', 'Queue_Name', 'Agent_ID'];
    const forbiddenValues = new Set();
    const safeRows = Array.isArray(rows) ? rows : [];

    for (let r = 0; r < safeRows.length; r++) {
        const row = safeRows[r];
        if (!row) continue;
        for (let c = 0; c < forbiddenColumns.length; c++) {
            const colName = forbiddenColumns[c];
            const val = row[colName];
            if (val !== null && val !== undefined) {
                forbiddenValues.add(String(val));
            }
        }
    }

    const visualKeys = Object.keys(fileMap).filter(k => k.match(/^powerbi\/.*\.Report\/definition\/pages\/[0-9a-f]{20}\/visuals\/[0-9a-f]{20}\/visual\.json$/)).sort();

    if (visualKeys.length === 0) {
        throw new Error('QUAL-03 gate found zero visuals across the report. Walker failed to find visual.json files.');
    }

    let totalLiterals = 0;
    const failures = [];

    for (const key of visualKeys) {
        const visualMatch = key.match(/pages\/([0-9a-f]{20})\/visuals\/([0-9a-f]{20})\/visual\.json$/);
        const pageId = visualMatch[1];
        const visualId = visualMatch[2];
        const visualJson = JSON.parse(fileMap[key]);

        const literals = [];
        collectLiteralValues(visualJson, literals);

        for (const lit of literals) {
            totalLiterals++;
            let stripped = lit;
            if (stripped.length >= 2 && stripped.startsWith("'") && stripped.endsWith("'")) {
                stripped = stripped.slice(1, -1);
            }

            if (forbiddenValues.has(lit) || forbiddenValues.has(stripped)) {
                const offending = forbiddenValues.has(lit) ? lit : stripped;
                failures.push(`[${pageId} / ${visualId}] Forbidden category literal: ${offending}`);
            }
        }
    }

    if (failures.length > 0) {
        throw new Error(`QUAL-03 hardcoded category literal validation failed:\n${failures.join('\n')}`);
    }

    return totalLiterals;
}

const THEME_OWNED_PROPERTY_RULES = [
    { card: 'categoryAxis', property: 'show', reason: 'Owned by theme visualStyles categoryAxis' },
    { card: 'categoryAxis', property: 'showAxisTitle', reason: 'Owned by theme visualStyles categoryAxis' },
    { card: 'categoryAxis', property: 'labelColor', reason: 'Owned by theme visualStyles categoryAxis' },
    { card: 'categoryAxis', property: 'gridlineStyle', reason: 'Owned by theme visualStyles categoryAxis' },
    { card: 'valueAxis', property: 'show', reason: 'Owned by theme visualStyles valueAxis' },
    { card: 'valueAxis', property: 'showAxisTitle', reason: 'Owned by theme visualStyles valueAxis' },
    { card: 'valueAxis', property: 'labelColor', reason: 'Owned by theme visualStyles valueAxis' },
    { card: 'valueAxis', property: 'start', reason: 'Owned by theme visualStyles valueAxis' },
    { card: 'outline', property: 'show', reason: 'Owned by theme visualStyles cardVisual outline' },
    { card: 'background', property: 'show', reason: 'Owned by theme visualStyles background' },
    { card: 'background', property: 'color', reason: 'Owned by theme visualStyles background' },
    { card: 'labels', property: 'labelDisplayUnits', reason: 'Owned by theme visualStyles labels' },
    { card: 'labels', property: 'fontSize', reason: 'Owned by theme visualStyles labels' },
    { card: 'labels', property: 'color', reason: 'Owned by theme visualStyles labels' },
    { card: 'title', property: 'fontColor', reason: 'Owned by theme visualStyles title' },
    { card: 'title', property: 'fontSize', reason: 'Owned by theme visualStyles title' },
    { card: 'title', property: 'alignment', reason: 'Owned by theme visualStyles title' },
    { card: 'title', property: 'titleWrap', reason: 'Owned by theme visualStyles title' }
];

var THEME_OWNED_PROPERTY_ALLOWLIST = [
    { path: 'visualContainerObjects.title.show', reason: 'D-11: a visual declares its own title on/off; a theme-forced title lets a missing string fall back to the auto-generated heading' },
    { path: 'visualContainerObjects.title.text', reason: 'D-11: the title string is per-visual content, not formatting' },
    { path: 'visualContainerObjects.background.show', reason: 'the header band background must be explicitly enabled' },
    { path: 'visualContainerObjects.background.color', reason: 'the header band is a brand surface rather than a themed visual container' },
    { path: 'visualContainerObjects.background.transparency', reason: 'the header band background is fully opaque 0% transparency' },
    { path: 'visualContainerObjects.border.show', reason: 'border explicitly disabled on image logos and header band' },
    { path: 'visualContainerObjects.padding.top', reason: 'header band vertical centering padding' },
    { path: 'visualContainerObjects.padding.bottom', reason: 'header band padding' },
    { path: 'visualContainerObjects.padding.left', reason: 'header band padding' },
    { path: 'visualContainerObjects.padding.right', reason: 'header band padding' },
    { path: 'objects.valueAxis.start', reason: 'D-17: the QA axis floor of 75 is a visual-specific exception to the theme\'s zero-basing' },
    { path: 'objects.labels.show', reason: 'bar charts show data labels and the line chart does not; not a shared default' },
    { path: 'objects.label.show', reason: 'cardVisual\'s own label text is per-visual content' },
    { path: 'objects.label.text', reason: 'cardVisual\'s own label text is per-visual content' },
    { path: 'objects.label.color', reason: 'the delta baseline label is secondary text styled per light theme contrast specification' },
    { path: 'objects.value.fontSize', reason: 'the delta strip is deliberately demoted below the KPI callout per D-03\'s fallback; a single shared default cannot express two weights' },
    { path: 'visualContainerObjects.subTitle.show', reason: 'D-20: axis truncation disclosure subtitle on/off' },
    { path: 'visualContainerObjects.subTitle.text', reason: 'D-20: axis truncation disclosure subtitle text derived from floor' },
    { path: 'objects.categoryLabels.show', reason: 'D-21: scatter category labels display agent identity per SC9' }
];

function collectVisualObjectProperties(node, sink) {
    if (node === null || typeof node !== 'object') return;

    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
            collectVisualObjectProperties(node[i], sink);
        }
        return;
    }

    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
        const containerName = keys[i];
        if (containerName === 'objects' || containerName === 'visualContainerObjects') {
            const container = node[containerName];
            if (container && typeof container === 'object' && !Array.isArray(container)) {
                const cardNames = Object.keys(container);
                for (let c = 0; c < cardNames.length; c++) {
                    const cardName = cardNames[c];
                    const card = container[cardName];
                    if (Array.isArray(card)) {
                        for (let e = 0; e < card.length; e++) {
                            const entry = card[e];
                            if (entry && entry.properties && typeof entry.properties === 'object') {
                                const propNames = Object.keys(entry.properties);
                                for (let p = 0; p < propNames.length; p++) {
                                    sink.push(`${containerName}.${cardName}.${propNames[p]}`);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    for (let i = 0; i < keys.length; i++) {
        if (keys[i] !== 'objects' && keys[i] !== 'visualContainerObjects') {
            collectVisualObjectProperties(node[keys[i]], sink);
        }
    }
}

function assertThemeOwnedPropertiesAreAllowlisted(fileMap) {
    const visualKeys = Object.keys(fileMap).filter(k => k.match(/^powerbi\/.*\.Report\/definition\/pages\/[0-9a-f]{20}\/visuals\/[0-9a-f]{20}\/visual\.json$/)).sort();

    if (visualKeys.length === 0) {
        throw new Error('Theme override gate found zero visuals across the report. Walker failed to find visual.json files.');
    }

    const allowlistPaths = new Set(THEME_OWNED_PROPERTY_ALLOWLIST.map(a => a.path));
    const themeOwnedCardsAndProps = new Map();
    for (const rule of THEME_OWNED_PROPERTY_RULES) {
        themeOwnedCardsAndProps.set(`${rule.card}.${rule.property}`, rule.reason);
    }

    let totalInspected = 0;
    const failures = [];

    for (const key of visualKeys) {
        const visualMatch = key.match(/pages\/([0-9a-f]{20})\/visuals\/([0-9a-f]{20})\/visual\.json$/);
        const pageId = visualMatch[1];
        const visualId = visualMatch[2];
        const visualJson = JSON.parse(fileMap[key]);

        const paths = [];
        collectVisualObjectProperties(visualJson, paths);

        for (const propPath of paths) {
            totalInspected++;
            const parts = propPath.split('.');
            const cardAndProp = parts.slice(1).join('.');

            if (themeOwnedCardsAndProps.has(cardAndProp) || themeOwnedCardsAndProps.has(propPath)) {
                if (!allowlistPaths.has(propPath)) {
                    const reason = themeOwnedCardsAndProps.get(cardAndProp) || themeOwnedCardsAndProps.get(propPath);
                    failures.push(`[${pageId} / ${visualId}] Theme-owned property override not in allowlist: ${propPath} (${reason})`);
                }
            }
        }
    }

    if (failures.length > 0) {
        throw new Error(`Theme-owned property validation failed:\n${failures.join('\n')}`);
    }

    return totalInspected;
}

// D-01 / D-05 / D-02: Asserts that date slicers (slicer visual bound to DateTable[Date] resolved from registry)
// carry NO authored filter and NO absolute datetime literals, guaranteeing the report opens on the full data span (P0-1).
// Anti-vacuity guard ensures the check fails if no matching date slicers are inspected (Pitfall 3).
function assertDateSlicerHasNoAuthoredFilter(fileMap) {
    const visualPattern = /^powerbi\/[^/]+\.Report\/definition\/pages\/([0-9a-f]{20})\/visuals\/([0-9a-f]{20})\/visual\.json$/;
    
    // Resolve target date entity and property from PBI_RELATIONSHIPS entry
    let targetEntity = 'DateTable';
    let targetProperty = 'Date';
    if (typeof PBI_RELATIONSHIPS !== 'undefined') {
        const dateRel = PBI_RELATIONSHIPS.find(r => r.id === PBI_DATE_RELATIONSHIP_ID);
        if (dateRel && dateRel.toColumn) {
            const parts = dateRel.toColumn.split('.');
            if (parts.length === 2) {
                targetEntity = parts[0];
                targetProperty = parts[1];
            }
        }
    }

    let inspectedVisualsCount = 0;

    for (const [relPath, content] of Object.entries(fileMap)) {
        const match = relPath.match(visualPattern);
        if (!match) continue;
        const pageId = match[1];
        const visualId = match[2];

        let visualJson;
        try {
            visualJson = JSON.parse(content);
        } catch {
            continue;
        }

        const visual = visualJson.visual;
        if (!visual || visual.visualType !== 'slicer') continue;

        // Check if query binds resolved target date entity and property
        let bindsTargetDate = false;
        const projections = visual.query && visual.query.queryState && visual.query.queryState.Values && visual.query.queryState.Values.projections;
        if (Array.isArray(projections)) {
            for (const proj of projections) {
                const col = proj && proj.field && proj.field.Column;
                const entity = col && col.Expression && col.Expression.SourceRef && col.Expression.SourceRef.Entity;
                const property = col && col.Property;
                if (entity === targetEntity && property === targetProperty) {
                    bindsTargetDate = true;
                    break;
                }
            }
        }

        if (!bindsTargetDate) continue;

        inspectedVisualsCount++;

        // Check 1: No filter property under visual.objects.general
        const general = visual.objects && visual.objects.general;
        if (Array.isArray(general)) {
            for (const genObj of general) {
                if (genObj && genObj.properties && genObj.properties.filter) {
                    throw new Error(`assertDateSlicerHasNoAuthoredFilter: Date slicer [${pageId} / ${visualId}] contains an authored filter under objects.general`);
                }
            }
        }

        // Check 2: No absolute datetime literal in serialized JSON
        if (/datetime'/.test(content)) {
            throw new Error(`assertDateSlicerHasNoAuthoredFilter: Date slicer [${pageId} / ${visualId}] contains an absolute datetime literal`);
        }
    }

    if (inspectedVisualsCount === 0) {
        throw new Error(`assertDateSlicerHasNoAuthoredFilter: No date slicers inspecting ${targetEntity}.${targetProperty} were found across the report`);
    }
}

// D-04: Asserts that every Relative-mode date slicer visual's header text discloses
// its system-date basis, and that the README contains the required disclosure needle.
function assertRelativeDateSlicerIsDisclosed(fileMap) {
    let inspectedCount = 0;
    for (const page of PBI_PAGES) {
        for (const slot of page.layout) {
            if (!slot.slicerOptions || slot.slicerOptions.mode !== 'Relative') continue;
            inspectedCount++;

            const visualPath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.Report/definition/pages/${page.id}/visuals/${slot.id}/visual.json`;
            const content = fileMap[visualPath];
            if (!content) {
                throw new Error(`assertRelativeDateSlicerIsDisclosed: Missing visual.json for Relative slicer slot '${slot.key}' at ${visualPath}`);
            }

            const visualObj = JSON.parse(content);
            const visual = visualObj.visual || {};
            const objects = visual.objects || {};
            const header = objects.header || [];
            const headerProps = header[0] && header[0].properties;
            const headerTextExpr = headerProps && headerProps.text && headerProps.text.expr;
            const headerText = headerTextExpr && headerTextExpr.Literal && headerTextExpr.Literal.Value;

            if (!headerText || (!headerText.includes('Today') && !headerText.includes('relative') && !headerText.includes('Relative'))) {
                throw new Error(`assertRelativeDateSlicerIsDisclosed: Slot '${slot.key}' header text does not disclose system-date basis. Found: ${headerText}`);
            }
        }
    }

    if (inspectedCount === 0) {
        throw new Error('assertRelativeDateSlicerIsDisclosed: Found zero Relative-mode slicer slots across report layouts');
    }

    const readmeContent = fileMap['README.md'];
    if (!readmeContent || !readmeContent.includes("Relative-date windows are measured against your computer's current system date")) {
        throw new Error("assertRelativeDateSlicerIsDisclosed: README.md is missing the relative-date system-date disclosure needle");
    }

    return inspectedCount;
}

// D-20, SC7: Asserts that every visual declaring an axisFloor carries both the valueAxis start
// property equal to String(slot.axisFloor) + 'D' and a subtitle in visualContainerObjects disclosing the floor.
function assertTruncatedAxesAreDisclosed(fileMap) {
    let inspectedCount = 0;
    for (const page of PBI_PAGES) {
        for (const slot of page.layout) {
            if (typeof slot.axisFloor !== 'number') continue;
            inspectedCount++;

            const visualPath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.Report/definition/pages/${page.id}/visuals/${slot.id}/visual.json`;
            const content = fileMap[visualPath];
            if (!content) {
                throw new Error(`assertTruncatedAxesAreDisclosed: Missing visual.json for floored slot '${slot.key}' at ${visualPath}`);
            }

            const visualObj = JSON.parse(content);
            const visual = visualObj.visual || {};
            const objects = visual.objects || {};
            const valueAxis = objects.valueAxis || [];

            // Check 1: Must carry valueAxis start property equal to String(slot.axisFloor) + 'D'
            const startExpr = valueAxis[0] && valueAxis[0].properties && valueAxis[0].properties.start && valueAxis[0].properties.start.expr;
            const startVal = startExpr && startExpr.Literal && startExpr.Literal.Value;
            const expectedStartVal = String(slot.axisFloor) + 'D';
            if (startVal !== expectedStartVal) {
                throw new Error(`assertTruncatedAxesAreDisclosed: Slot '${slot.key}' missing expected valueAxis.start '${expectedStartVal}', found '${startVal}'`);
            }

            // Check 2: visualContainerObjects.subTitle must exist and contain slot.axisFloor
            const vco = visual.visualContainerObjects || visualObj.visualContainerObjects || {};
            const subTitle = vco.subTitle || [];
            const subTitleProps = subTitle[0] && subTitle[0].properties;
            const subTitleExpr = subTitleProps && subTitleProps.text && subTitleProps.text.expr;
            const subTitleText = subTitleExpr && subTitleExpr.Literal && subTitleExpr.Literal.Value;

            if (!subTitleText || !subTitleText.includes(String(slot.axisFloor))) {
                throw new Error(`assertTruncatedAxesAreDisclosed: Slot '${slot.key}' subtitle does not disclose axisFloor ${slot.axisFloor}. Found: ${subTitleText}`);
            }
        }
    }

    if (inspectedCount === 0) {
        throw new Error('assertTruncatedAxesAreDisclosed: Found zero floored slots across report layouts');
    }

    return inspectedCount;
}

// G-36-14: Single source of which measures a floored visual can plot, and how each is
// aggregated from a raw CSV row. A measure missing here is a fail-closed violation, not a
// silent pass (assertAxisFloorsSitBelowPlottedData below).
var PBI_AXIS_FLOOR_MEASURE_AGGREGATES = {
    'Total Calls': { kind: 'count' },
    'Avg QA Score': { kind: 'mean', column: 'Agent_Quality' }
};

// G-36-14: Parses the `<= N, "label"` pairs and the final fall-through label directly from the
// Empathy_Bucket calculated column's DAX in CALLS_CALCULATED_COLUMNS, so the numeric thresholds
// (20, 40, 60, 80) are never duplicated as a second literal source of truth.
function parseEmpathyBucketThresholds() {
    const bucketCol = CALLS_CALCULATED_COLUMNS.find(c => c.name === 'Empathy_Bucket');
    if (!bucketCol) {
        throw new Error('parseEmpathyBucketThresholds: Empathy_Bucket missing from CALLS_CALCULATED_COLUMNS');
    }
    const dax = bucketCol.dax;
    const pairs = [];
    const pairRe = /<=\s*(\d+(?:\.\d+)?)\s*,\s*"([^"]+)"/g;
    let m;
    while ((m = pairRe.exec(dax)) !== null) {
        pairs.push({ threshold: Number(m[1]), label: m[2] });
    }
    const finalMatch = dax.match(/,\s*"([^"]+)"\)\s*$/);
    if (pairs.length === 0 || !finalMatch) {
        throw new Error('parseEmpathyBucketThresholds: Failed to parse thresholds/fall-through label from Empathy_Bucket DAX');
    }
    return { pairs, fallbackLabel: finalMatch[1] };
}

function empathyBucketLabelForValue(value, parsed) {
    for (const p of parsed.pairs) {
        if (value <= p.threshold) return p.label;
    }
    return parsed.fallbackLabel;
}

// G-36-14: Computes, from raw CSV rows, the same per-group aggregate Desktop plots for a given
// floored slot. Returns { measure, groups: [{ label, value, rowCount }] }. Throws (fail-closed)
// when the slot's measure has no row-level aggregation rule, or its kind/entity/column
// combination has no grouping rule -- a floored slot this function cannot check is itself an
// error, never a silent pass.
function computeAxisFloorGroupAggregates(slot, rows) {
    if (!Array.isArray(rows)) {
        throw new Error('computeAxisFloorGroupAggregates: rows must be an array');
    }

    // WR-02: groupMap below only ever gains an entry when at least one row maps to that label --
    // a showItemsWithNoData dimension table category with zero matching rows never enters
    // groupMap and is therefore never checked against slot.axisFloor. Rather than silently pass
    // on a category this function cannot see, fail closed the same way the missing-aggregation-
    // rule checks below do.
    if (slot.showItemsWithNoData) {
        throw new Error(`computeAxisFloorGroupAggregates: slot '${slot.key}' declares both axisFloor and showItemsWithNoData; a zero-row category rendered by showItemsWithNoData cannot be checked against the axis floor from CSV rows alone`);
    }

    let measureName;
    if (slot.kind === 'scatter') {
        // The floor sits on the scatter's Y value axis, which always plots Avg QA Score
        // (buildScatterChartJson), regardless of any slot.measure.
        measureName = 'Avg QA Score';
    } else if (slot.kind === 'line') {
        measureName = slot.measure || 'Total Calls';
    } else {
        measureName = slot.measure;
    }

    const aggRule = PBI_AXIS_FLOOR_MEASURE_AGGREGATES[measureName];
    if (!aggRule) {
        throw new Error(`computeAxisFloorGroupAggregates: slot '${slot.key}' plots measure '${measureName}' which has no row-level aggregation rule`);
    }

    let parsedEmpathy = null;
    function labelForRow(row) {
        if (slot.kind === 'scatter') {
            return row.Agent_ID;
        }
        if (slot.kind === 'line') {
            const entity = slot.entity;
            const column = slot.column || 'Call_Date';
            const isDefaultCalls = (!entity || entity === 'Calls') && column === 'Call_Date';
            const isDateTable = entity === 'DateTable' && column === 'Date';
            if (!isDefaultCalls && !isDateTable) {
                throw new Error(`computeAxisFloorGroupAggregates: slot '${slot.key}' (kind line) has no grouping rule for entity '${entity}' column '${column}'`);
            }
            const ts = row.Timestamp;
            if (typeof ts !== 'string') return undefined;
            const day = ts.slice(0, 10);
            return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
        }
        if (slot.kind === 'bar' || slot.kind === 'column') {
            const entity = slot.entity;
            if (entity === 'EmpathyBuckets') {
                if (!parsedEmpathy) parsedEmpathy = parseEmpathyBucketThresholds();
                const val = Number(row.Empathy_Score);
                if (!isFinite(val)) return undefined;
                return empathyBucketLabelForValue(val, parsedEmpathy);
            }
            if (!entity || entity === 'Calls') {
                return row[slot.column];
            }
            throw new Error(`computeAxisFloorGroupAggregates: slot '${slot.key}' (kind ${slot.kind}) has no grouping rule for entity '${entity}'`);
        }
        throw new Error(`computeAxisFloorGroupAggregates: slot '${slot.key}' (kind ${slot.kind}) has no grouping rule`);
    }

    const groupMap = new Map();
    for (const row of rows) {
        const label = labelForRow(row);
        if (label === undefined || label === null || label === '') continue;

        if (aggRule.kind === 'count') {
            const g = groupMap.get(label) || { sum: 0, count: 0, rowCount: 0 };
            g.rowCount += 1;
            groupMap.set(label, g);
        } else if (aggRule.kind === 'mean') {
            const raw = row[aggRule.column];
            const num = Number(raw);
            if (raw === undefined || raw === '' || !isFinite(num)) continue;
            const g = groupMap.get(label) || { sum: 0, count: 0, rowCount: 0 };
            g.sum += num;
            g.count += 1;
            g.rowCount += 1;
            groupMap.set(label, g);
        }
    }

    let groups = [];
    for (const [label, g] of groupMap.entries()) {
        if (g.rowCount === 0) continue;
        const value = aggRule.kind === 'count' ? g.rowCount : (g.sum / g.count);
        groups.push({ label: label, value: value, rowCount: g.rowCount });
    }

    // WR-01 / G-36-14: A slot with a native TopN filter (see buildVisualContainerJson's
    // filterConfig wiring) only ever renders the TopN-selected subset of groups, not every group
    // in `rows`. Checking every group here would false-positive on a group the TopN filter itself
    // excludes -- that group is absent from the render, not hidden by the axis floor. Narrow to
    // the same order/direction/top Desktop's OrderBy/Top would select.
    if (slot.topN) {
        // This narrowing is only valid because it ranks by the exact aggregate already computed
        // above (aggRule's column). Fail closed -- do not silently rank by the wrong column --
        // if a future TopN slot orders by a column this function isn't already aggregating.
        if (slot.topN.orderByColumn !== aggRule.column) {
            throw new Error(`computeAxisFloorGroupAggregates: slot '${slot.key}' TopN orders by '${slot.topN.orderByColumn}' but the plotted aggregate is keyed on '${aggRule.column}'; no rule to rank by a different column`);
        }
        // Direction 1 = Bottom-N (ascending, smallest first), 2 = Top-N (largest first) -- see
        // the "Direction (1 = Bottom, 2 = Top)" comment on filterConfig's OrderBy wiring above.
        const sorted = groups.slice().sort((a, b) => a.value - b.value);
        if (slot.topN.direction === 2) {
            sorted.reverse();
        } else if (slot.topN.direction !== 1) {
            throw new Error(`computeAxisFloorGroupAggregates: slot '${slot.key}' TopN direction '${slot.topN.direction}' is not a recognized ranking direction (1=Bottom, 2=Top)`);
        }
        groups = sorted.slice(0, slot.topN.top);
    }

    return { measure: measureName, groups: groups };
}

// G-36-14: Rejects any axisFloor that sits at or above an aggregate its own slot plots,
// computed from the rows passed to buildPowerBIFileMap. This closes the blind spot that let
// columnEmpathyCorrelation's axisFloor:75 hide its 21-40 and 41-60 buckets (both ~61) even
// though assertTruncatedAxesAreDisclosed only ever checked that a floor was disclosed, never
// that it sat below the data.
//
// Scope limit (stated here, in the error text below, and in the generated README): this check
// only covers the rows the generator was given. Power BI Desktop re-reads the CSV through
// CsvFolderPath on refresh, so a refreshed report can load data this check never saw -- a value
// at or below a disclosed floor is then not drawn and must be read from its data label/tooltip.
// For every floored slot in this report today, the comparison covers every group the slot
// actually renders: unfiltered slots check every populated group, and TopN-filtered slots (WR-01)
// are narrowed by computeAxisFloorGroupAggregates to the same order/direction/top Desktop's own
// OrderBy/Top would select, so a group the TopN filter excludes is never flagged as if the axis
// floor were hiding it.
//
// Plan 36-08 Task 2 decision (deliverable-only, recorded verbatim in 36-08-SUMMARY.md): this
// assertion is wired into regen-powerbi.js and check-target-lines.js only, never into
// generatePowerBIExport. The browser export can build from filtered rows (EXT-03), and on the
// shipped data a filtered export narrowed to a single category or queue has at most 82-84 calls
// per day -- below the Executive Hub trend floor of 100 -- so wiring this assertion into the
// browser export would fail every such filtered export today. That pre-existing filtered-export
// trend-floor gap is reported, not fixed, here.
function assertAxisFloorsSitBelowPlottedData(fileMap, rows) {
    if (!fileMap || typeof fileMap !== 'object') {
        throw new Error('assertAxisFloorsSitBelowPlottedData: fileMap must be an object');
    }
    if (!Array.isArray(rows)) {
        throw new Error('assertAxisFloorsSitBelowPlottedData: rows must be an array');
    }

    const results = [];
    const violations = [];
    let flooredCount = 0;

    for (const page of PBI_PAGES) {
        for (const slot of page.layout) {
            if (typeof slot.axisFloor !== 'number') continue;
            flooredCount++;

            let aggData;
            try {
                aggData = computeAxisFloorGroupAggregates(slot, rows);
            } catch (e) {
                violations.push(`${slot.key}: ${e.message}`);
                continue;
            }

            const visualPath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.Report/definition/pages/${page.id}/visuals/${slot.id}/visual.json`;
            const content = fileMap[visualPath];
            let startVal;
            if (content) {
                try {
                    const visualObj = JSON.parse(content);
                    const visual = visualObj.visual || {};
                    const objects = visual.objects || {};
                    const valueAxis = objects.valueAxis || [];
                    const startExpr = valueAxis[0] && valueAxis[0].properties && valueAxis[0].properties.start && valueAxis[0].properties.start.expr;
                    startVal = startExpr && startExpr.Literal && startExpr.Literal.Value;
                } catch (e) {
                    startVal = undefined;
                }
            }
            const expectedStartVal = String(slot.axisFloor) + 'D';
            if (startVal !== expectedStartVal) {
                violations.push(`${slot.key}: emitted valueAxis start '${startVal}' does not match declared axisFloor ${slot.axisFloor} (expected '${expectedStartVal}')`);
            }

            let lowestLabel = null;
            let lowestValue = Infinity;
            for (const g of aggData.groups) {
                if (g.value <= slot.axisFloor) {
                    violations.push(`${slot.key}: axis floor ${slot.axisFloor} hides group '${g.label}' (value ${g.value.toFixed(1)}, ${g.rowCount} rows)`);
                }
                if (g.value < lowestValue) {
                    lowestValue = g.value;
                    lowestLabel = g.label;
                }
            }

            results.push({ slotKey: slot.key, floor: slot.axisFloor, lowestLabel: lowestLabel, lowestValue: lowestValue, groupCount: aggData.groups.length });
        }
    }

    if (flooredCount === 0) {
        throw new Error('assertAxisFloorsSitBelowPlottedData: Found zero floored slots across report layouts');
    }

    if (violations.length > 0) {
        throw new Error(`assertAxisFloorsSitBelowPlottedData: ${violations.join('; ')} Checked against the ${rows.length} rows passed to buildPowerBIFileMap; a report refreshed in Power BI Desktop from different data is not covered by this check.`);
    }

    return results;
}

// TGT-01, TGT-02, TGT-03, D-01, D-06, D-07, D-08: Asserts that visual reference lines and targets
// match the single source of truth in PBI_TARGET_LINES.
function assertTargetLinesMatchRegistry(fileMap) {
    if (!Array.isArray(PBI_TARGET_LINES) || PBI_TARGET_LINES.length === 0) {
        throw new Error('assertTargetLinesMatchRegistry: Found zero entries in PBI_TARGET_LINES');
    }

    let inspectedCount = 0;
    const cartesianTargetSlotKeys = new Set();

    for (const entry of PBI_TARGET_LINES) {
        inspectedCount++;

        // 1. Resolve slot across PBI_PAGES
        let foundSlot = null;
        let foundPage = null;
        for (const page of PBI_PAGES) {
            const s = (page.layout || []).find(x => x.key === entry.slotKey);
            if (s) {
                foundSlot = s;
                foundPage = page;
                break;
            }
        }
        if (!foundSlot) {
            throw new Error(`assertTargetLinesMatchRegistry: slotKey '${entry.slotKey}' not found in any page layout`);
        }

        // 2. Unit versus value bounds and entry kinds
        if (typeof entry.value !== 'undefined') {
            if (entry.unit === 'points' && (entry.value < 0 || entry.value > 100)) {
                throw new Error(`assertTargetLinesMatchRegistry: Slot '${entry.slotKey}' value ${entry.value} out of range for unit 'points' (0-100)`);
            }
            if (entry.unit === 'fraction' && (entry.value < 0 || entry.value > 1)) {
                throw new Error(`assertTargetLinesMatchRegistry: Slot '${entry.slotKey}' value ${entry.value} out of range for unit 'fraction' (0-1)`);
            }
        }
        if (entry.kind === 'target' && foundSlot.kind === 'gauge') {
            if (typeof entry.value === 'undefined' || !entry.measure) {
                throw new Error(`assertTargetLinesMatchRegistry: Target entry '${entry.slotKey}' on gauge requires both value and measure`);
            }
        }
        if (entry.kind === 'data-derived') {
            if (!entry.measure || typeof entry.value !== 'undefined') {
                throw new Error(`assertTargetLinesMatchRegistry: Data-derived entry '${entry.slotKey}' requires measure and must have no value`);
            }
        }

        // 3. Measure existence
        if (entry.measure) {
            const exists = CALLS_MEASURES.some(m => m.name === entry.measure);
            if (!exists) {
                throw new Error(`assertTargetLinesMatchRegistry: measure '${entry.measure}' in PBI_TARGET_LINES not found in CALLS_MEASURES`);
            }
        }

        // 4. Label free of apostrophes and double quotes
        if (entry.label.includes("'") || entry.label.includes('"')) {
            throw new Error(`assertTargetLinesMatchRegistry: label for slot '${entry.slotKey}' contains quotes: ${entry.label}`);
        }

        // 5. Cartesian host validation
        const isCartesian = foundSlot.kind === 'bar' || foundSlot.kind === 'column' || foundSlot.kind === 'line' || foundSlot.kind === 'scatter';
        if (isCartesian && entry.kind === 'target') {
            cartesianTargetSlotKeys.add(entry.slotKey);

            const visualPath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.Report/definition/pages/${foundPage.id}/visuals/${foundSlot.id}/visual.json`;
            const content = fileMap[visualPath];
            if (!content) {
                throw new Error(`assertTargetLinesMatchRegistry: Missing visual.json for slot '${entry.slotKey}' at ${visualPath}`);
            }

            const visualObj = JSON.parse(content);
            const visual = visualObj.visual || {};
            const objects = visual.objects || {};
            const shape = PBI_TARGET_LINE_DESKTOP_SHAPE;
            const refLines = objects[shape.objectKey];

            if (!Array.isArray(refLines) || refLines.length !== shape.template.length) {
                throw new Error(`assertTargetLinesMatchRegistry: Slot '${entry.slotKey}' missing '${shape.objectKey}' array of length ${shape.template.length} in visual.objects`);
            }

            const expectedVal = String(entry.value) + shape.valueSuffix;
            const valLeaf = getJsonLeaf(refLines, shape.valueLeafPath);
            if (valLeaf !== expectedVal) {
                throw new Error(`assertTargetLinesMatchRegistry: Slot '${entry.slotKey}' '${shape.objectKey}' value leaf '${valLeaf}' does not match expected '${expectedVal}'`);
            }

            const expectedLabel = shape.labelQuote + entry.label + shape.labelQuote;
            const labelLeaf = getJsonLeaf(refLines, shape.labelLeafPath);
            if (labelLeaf !== expectedLabel) {
                throw new Error(`assertTargetLinesMatchRegistry: Slot '${entry.slotKey}' '${shape.objectKey}' label leaf '${labelLeaf}' does not match expected '${expectedLabel}'`);
            }

            // Blanking both variable leaves and comparing the remainder proves the selector and
            // every other property (name and Desktop default value) matches the captured template --
            // this replaces the old per-property checks (show/dataLabelShow/displayName) with a
            // single comparison against Desktop's own evidence.
            const blankedEmitted = JSON.parse(JSON.stringify(refLines));
            setJsonLeaf(blankedEmitted, shape.valueLeafPath, null);
            setJsonLeaf(blankedEmitted, shape.labelLeafPath, null);
            const blankedTemplate = JSON.parse(JSON.stringify(shape.template));
            setJsonLeaf(blankedTemplate, shape.valueLeafPath, null);
            setJsonLeaf(blankedTemplate, shape.labelLeafPath, null);
            if (JSON.stringify(blankedEmitted) !== JSON.stringify(blankedTemplate)) {
                throw new Error(`assertTargetLinesMatchRegistry: Slot '${entry.slotKey}' '${shape.objectKey}' shape (selector/property set) does not match the Desktop-authored template`);
            }
        }

        // 5b. Gauge host validation (TGT-02, TGT-03)
        if (foundSlot.kind === 'gauge') {
            const visualPath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.Report/definition/pages/${foundPage.id}/visuals/${foundSlot.id}/visual.json`;
            const content = fileMap[visualPath];
            if (!content) {
                throw new Error(`assertTargetLinesMatchRegistry: Missing visual.json for slot '${entry.slotKey}' at ${visualPath}`);
            }

            const visualObj = JSON.parse(content);
            const visual = visualObj.visual || {};
            if (visual.visualType !== 'gauge') {
                throw new Error(`assertTargetLinesMatchRegistry: Slot '${entry.slotKey}' visualType '${visual.visualType}' is not 'gauge'`);
            }

            const qs = (visual.query && visual.query.queryState) || {};
            const yProp = qs.Y && qs.Y.projections && qs.Y.projections[0] && qs.Y.projections[0].field && qs.Y.projections[0].field.Measure && qs.Y.projections[0].field.Measure.Property;
            if (yProp !== foundSlot.measure) {
                throw new Error(`assertTargetLinesMatchRegistry: Slot '${entry.slotKey}' Y projection '${yProp}' does not match slot measure '${foundSlot.measure}'`);
            }

            const tgtProp = qs.TargetValue && qs.TargetValue.projections && qs.TargetValue.projections[0] && qs.TargetValue.projections[0].field && qs.TargetValue.projections[0].field.Measure && qs.TargetValue.projections[0].field.Measure.Property;
            if (tgtProp !== entry.measure) {
                throw new Error(`assertTargetLinesMatchRegistry: Slot '${entry.slotKey}' TargetValue projection '${tgtProp}' does not match entry measure '${entry.measure}'`);
            }

            const axisProps = (visual.objects && visual.objects.axis && visual.objects.axis[0] && visual.objects.axis[0].properties) || {};
            const minVal = axisProps.min && axisProps.min.expr && axisProps.min.expr.Literal && axisProps.min.expr.Literal.Value;
            const expectedMin = String(foundSlot.axisMin) + 'D';
            if (minVal !== expectedMin) {
                throw new Error(`assertTargetLinesMatchRegistry: Slot '${entry.slotKey}' axis min '${minVal}' does not match expected '${expectedMin}'`);
            }

            const maxVal = axisProps.max && axisProps.max.expr && axisProps.max.expr.Literal && axisProps.max.expr.Literal.Value;
            const expectedMax = String(foundSlot.axisMax) + 'D';
            if (maxVal !== expectedMax) {
                throw new Error(`assertTargetLinesMatchRegistry: Slot '${entry.slotKey}' axis max '${maxVal}' does not match expected '${expectedMax}'`);
            }

            if (typeof axisProps.target !== 'undefined') {
                throw new Error(`assertTargetLinesMatchRegistry: Slot '${entry.slotKey}' emits forbidden literal axis target alongside bound TargetValue`);
            }
        }
    }

    // 6. Scan every slot on every page to verify that slots emitting the Desktop-shaped target
    // line match cartesianTargetSlotKeys exactly, and (G-36-4) that no visual still carries the
    // legacy guessed `referenceLine` key when that differs from Desktop's own object key.
    const shape6 = PBI_TARGET_LINE_DESKTOP_SHAPE;
    const slotsWithRefLine = new Set();
    for (const page of PBI_PAGES) {
        for (const slot of page.layout || []) {
            const vPath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.Report/definition/pages/${page.id}/visuals/${slot.id}/visual.json`;
            const c = fileMap[vPath];
            if (c) {
                const v = JSON.parse(c).visual || {};
                const objects = v.objects || {};
                if (Array.isArray(objects[shape6.objectKey]) && objects[shape6.objectKey].length > 0) {
                    slotsWithRefLine.add(slot.key);
                }
                if (shape6.objectKey !== 'referenceLine' && Array.isArray(objects.referenceLine) && objects.referenceLine.length > 0) {
                    throw new Error(`assertTargetLinesMatchRegistry: Slot '${slot.key}' carries the legacy guessed 'referenceLine' key (G-36-4); expected only '${shape6.objectKey}'`);
                }
            }
        }
    }

    for (const k of cartesianTargetSlotKeys) {
        if (!slotsWithRefLine.has(k)) {
            throw new Error(`assertTargetLinesMatchRegistry: Expected cartesian slot '${k}' to emit '${shape6.objectKey}', but it did not`);
        }
    }
    for (const k of slotsWithRefLine) {
        if (!cartesianTargetSlotKeys.has(k)) {
            throw new Error(`assertTargetLinesMatchRegistry: Slot '${k}' emitted '${shape6.objectKey}' but is not in PBI_TARGET_LINES cartesian entries`);
        }
    }

    return inspectedCount;
}

// G-36-8: true if any Measure { Property: propName } appears anywhere inside node (arrays and
// nested objects included). Used to confirm a shape change actually binds the baseline-label
// measure, wherever in the change's shape that binding lives.
function containsMeasurePropertyDeep(node, propName) {
    if (!node || typeof node !== 'object') return false;
    if (node.Measure && node.Measure.Property === propName) return true;
    if (Array.isArray(node)) {
        return node.some(item => containsMeasurePropertyDeep(item, propName));
    }
    return Object.keys(node).some(key => containsMeasurePropertyDeep(node[key], propName));
}

// G-36-8: Asserts every Executive Hub card with a deltaMeasure carries Desktop's own captured
// caption shape (PBI_CARD_CAPTION_DESKTOP_SHAPE) rather than the guessed, Desktop-deleted
// properties.title compound object. referenceLabel[0].properties.value must still bind the
// card's <deltaMeasure> Label measure (24-DESKTOP-FINDINGS.md item 2, the only Desktop-confirmed
// binding); every shape change must be present at its path with the card-specialised value, and
// every `removed` path must be absent; no card may carry an untargeted
// referenceLabel[*].properties.title. Throws if zero cards are inspected.
function assertCardCaptionsMatchDesktopShape(fileMap) {
    const shape = PBI_CARD_CAPTION_DESKTOP_SHAPE;
    if (!shape || !Array.isArray(shape.changes) || shape.changes.length === 0) {
        throw new Error('assertCardCaptionsMatchDesktopShape: PBI_CARD_CAPTION_DESKTOP_SHAPE.changes missing or empty');
    }

    let inspected = 0;
    const titleTargetedByShape = shape.changes.some(c => c.path[0] === 'objects' && c.path[1] === 'referenceLabel');

    for (const slot of PBI_EXEC_LAYOUT) {
        if (slot.kind !== 'card' || !slot.deltaMeasure) continue;
        inspected++;

        const page = PBI_PAGES.find(p => (p.layout || []).some(s => s.key === slot.key));
        if (!page) {
            throw new Error(`assertCardCaptionsMatchDesktopShape: page containing '${slot.key}' (${slot.id}) not found in PBI_PAGES`);
        }
        const visualPath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.Report/definition/pages/${page.id}/visuals/${slot.id}/visual.json`;
        const content = fileMap[visualPath];
        if (!content) {
            throw new Error(`assertCardCaptionsMatchDesktopShape: visual.json not found for slot '${slot.key}' (${slot.id})`);
        }
        const visualJson = JSON.parse(content);
        const visualNode = visualJson.visual || {};
        const objects = visualNode.objects || {};

        const labelMeasureName = `${slot.deltaMeasure} Label`;
        const refLabelEntry = Array.isArray(objects.referenceLabel) ? objects.referenceLabel[0] : undefined;
        const valueMeasure = refLabelEntry && refLabelEntry.properties && refLabelEntry.properties.value &&
            refLabelEntry.properties.value.expr && refLabelEntry.properties.value.expr.Measure;
        if (!valueMeasure || valueMeasure.Property !== labelMeasureName) {
            throw new Error(`assertCardCaptionsMatchDesktopShape: slot '${slot.key}' (${slot.id}) referenceLabel[0].properties.value does not bind '${labelMeasureName}'`);
        }

        let foundBoundBaselineMeasure = false;
        for (const change of shape.changes) {
            let target = visualNode;
            let missing = false;
            for (let i = 0; i < change.path.length - 1; i++) {
                if (!target || typeof target !== 'object') { missing = true; break; }
                target = target[change.path[i]];
            }
            const lastKey = change.path[change.path.length - 1];
            const actual = (!missing && target && typeof target === 'object') ? target[lastKey] : undefined;

            if (change.removed) {
                if (actual !== undefined) {
                    throw new Error(`assertCardCaptionsMatchDesktopShape: slot '${slot.key}' (${slot.id}) still carries removed path '${change.path.join('.')}'`);
                }
                continue;
            }

            const expected = substituteCardCaptionPlaceholders(change.value, slot);
            if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                throw new Error(`assertCardCaptionsMatchDesktopShape: slot '${slot.key}' (${slot.id}) path '${change.path.join('.')}' does not match the Desktop-captured shape`);
            }
            if (containsMeasurePropertyDeep(expected, 'Delta Baseline Label')) {
                foundBoundBaselineMeasure = true;
            }
        }

        if (!titleTargetedByShape && Array.isArray(objects.referenceLabel)) {
            for (const entry of objects.referenceLabel) {
                if (entry && entry.properties && Object.prototype.hasOwnProperty.call(entry.properties, 'title')) {
                    throw new Error(`assertCardCaptionsMatchDesktopShape: slot '${slot.key}' (${slot.id}) emits an untargeted referenceLabel.properties.title`);
                }
            }
        }

        if (shape.mode === 'bind-caption') {
            if (!foundBoundBaselineMeasure) {
                throw new Error(`assertCardCaptionsMatchDesktopShape: slot '${slot.key}' (${slot.id}) has no shape change binding Measure 'Delta Baseline Label'`);
            }
        } else if (shape.mode === 'fold-into-value') {
            const labelMeasure = (CALLS_MEASURES || []).find(m => m.name === labelMeasureName);
            if (!labelMeasure || (labelMeasure.dax || '').indexOf('[Delta Baseline Label]') === -1) {
                throw new Error(`assertCardCaptionsMatchDesktopShape: measure '${labelMeasureName}' DAX does not contain [Delta Baseline Label]`);
            }
        } else {
            throw new Error(`assertCardCaptionsMatchDesktopShape: unknown PBI_CARD_CAPTION_DESKTOP_SHAPE.mode '${shape.mode}'`);
        }
    }

    if (inspected === 0) {
        throw new Error('assertCardCaptionsMatchDesktopShape: zero cards inspected');
    }
    return inspected;
}

// D-08, D-09, TGT-01: Asserts that target disclosures are present in README,
// in README_REQUIRED_CONTENT, and in entry labels.
function assertTargetDisclosuresArePresent(fileMap) {
    const readme = fileMap['README.md'];
    if (!readme) {
        throw new Error('assertTargetDisclosuresArePresent: README.md missing from fileMap');
    }

    // 1. README heading and disclosure verbatim
    if (!readme.includes('## Report targets and reference values')) {
        throw new Error('assertTargetDisclosuresArePresent: README missing "## Report targets and reference values" heading');
    }
    if (!readme.includes(PBI_TARGET_DEFAULT_DISCLOSURE)) {
        throw new Error(`assertTargetDisclosuresArePresent: README missing PBI_TARGET_DEFAULT_DISCLOSURE: "${PBI_TARGET_DEFAULT_DISCLOSURE}"`);
    }
    if (!readme.includes(PBI_TARGET_DATA_DERIVED_DISCLOSURE)) {
        throw new Error(`assertTargetDisclosuresArePresent: README missing PBI_TARGET_DATA_DERIVED_DISCLOSURE: "${PBI_TARGET_DATA_DERIVED_DISCLOSURE}"`);
    }

    // 2. One line naming each registry entry's slot key
    if (!Array.isArray(PBI_TARGET_LINES) || PBI_TARGET_LINES.length === 0) {
        throw new Error('assertTargetDisclosuresArePresent: Found zero entries in PBI_TARGET_LINES');
    }
    for (const entry of PBI_TARGET_LINES) {
        if (!readme.includes(entry.slotKey)) {
            throw new Error(`assertTargetDisclosuresArePresent: README targets section does not mention slotKey '${entry.slotKey}'`);
        }
    }

    // 3. README_REQUIRED_CONTENT entries strictly identical to disclosure constants
    const needleEntry1 = README_REQUIRED_CONTENT.find(r => r.label === 'target-line-generator-defaults');
    if (!needleEntry1) {
        throw new Error("assertTargetDisclosuresArePresent: README_REQUIRED_CONTENT missing 'target-line-generator-defaults' entry");
    }
    if (needleEntry1.needle !== PBI_TARGET_DEFAULT_DISCLOSURE) {
        throw new Error("assertTargetDisclosuresArePresent: needle in README_REQUIRED_CONTENT is not strictly identical to PBI_TARGET_DEFAULT_DISCLOSURE");
    }

    const needleEntry2 = README_REQUIRED_CONTENT.find(r => r.label === 'target-line-data-derived');
    if (!needleEntry2) {
        throw new Error("assertTargetDisclosuresArePresent: README_REQUIRED_CONTENT missing 'target-line-data-derived' entry");
    }
    if (needleEntry2.needle !== PBI_TARGET_DATA_DERIVED_DISCLOSURE) {
        throw new Error("assertTargetDisclosuresArePresent: needle in README_REQUIRED_CONTENT is not strictly identical to PBI_TARGET_DATA_DERIVED_DISCLOSURE");
    }

    // 4. Disclosure constants unequal and neither includes the other
    if (PBI_TARGET_DEFAULT_DISCLOSURE === PBI_TARGET_DATA_DERIVED_DISCLOSURE) {
        throw new Error('assertTargetDisclosuresArePresent: PBI_TARGET_DEFAULT_DISCLOSURE and PBI_TARGET_DATA_DERIVED_DISCLOSURE must not be equal');
    }
    if (PBI_TARGET_DEFAULT_DISCLOSURE.includes(PBI_TARGET_DATA_DERIVED_DISCLOSURE) ||
        PBI_TARGET_DATA_DERIVED_DISCLOSURE.includes(PBI_TARGET_DEFAULT_DISCLOSURE)) {
        throw new Error('assertTargetDisclosuresArePresent: disclosure constants must not contain each other');
    }

    // 5. Entry labels check
    for (const entry of PBI_TARGET_LINES) {
        if (entry.kind === 'target') {
            if (!entry.label.includes(PBI_TARGET_DEFAULT_DISCLOSURE)) {
                throw new Error(`assertTargetDisclosuresArePresent: Target entry '${entry.slotKey}' label does not include default disclosure: "${entry.label}"`);
            }
        } else if (entry.kind === 'data-derived') {
            if (!entry.label.includes(PBI_TARGET_DATA_DERIVED_DISCLOSURE)) {
                throw new Error(`assertTargetDisclosuresArePresent: Data-derived entry '${entry.slotKey}' label does not include data-derived disclosure: "${entry.label}"`);
            }
            if (entry.label.includes(PBI_TARGET_DEFAULT_DISCLOSURE)) {
                throw new Error(`assertTargetDisclosuresArePresent: Data-derived entry '${entry.slotKey}' label must not include default disclosure: "${entry.label}"`);
            }
        }
    }

    // 6. Gauge hosts subtitle literal check
    for (const entry of PBI_TARGET_LINES) {
        let foundSlot = null;
        let foundPage = null;
        for (const page of PBI_PAGES) {
            const s = (page.layout || []).find(x => x.key === entry.slotKey);
            if (s) {
                foundSlot = s;
                foundPage = page;
                break;
            }
        }
        if (foundSlot && foundSlot.kind === 'gauge') {
            const visualPath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.Report/definition/pages/${foundPage.id}/visuals/${foundSlot.id}/visual.json`;
            const content = fileMap[visualPath];
            if (!content) {
                throw new Error(`assertTargetDisclosuresArePresent: Missing visual.json for slot '${entry.slotKey}' at ${visualPath}`);
            }
            const visualObj = JSON.parse(content);
            const subTitleObj = visualObj.visual && visualObj.visual.visualContainerObjects && visualObj.visual.visualContainerObjects.subTitle;
            const subTitleProps = subTitleObj && subTitleObj[0] && subTitleObj[0].properties;
            const subTitleText = subTitleProps && subTitleProps.text && subTitleProps.text.expr && subTitleProps.text.expr.Literal && subTitleProps.text.expr.Literal.Value;
            const expectedSubTitle = `'${entry.label}'`;
            if (subTitleText !== expectedSubTitle) {
                throw new Error(`assertTargetDisclosuresArePresent: Slot '${entry.slotKey}' subtitle '${subTitleText}' does not match expected '${expectedSubTitle}'`);
            }
        }
    }

    return PBI_TARGET_LINES.length;
}

// NARR-03, D-14: Validates that all title measures carry the required zero-row guard
// and fallback strings, with no blank returns and no format strings.
function assertTitleMeasuresHaveZeroRowGuard() {
    const titleMeasures = (CALLS_MEASURES || []).filter(m => m.name.endsWith('Headline Title'));
    if (titleMeasures.length < 2) {
        throw new Error(`assertTitleMeasuresHaveZeroRowGuard: Expected at least 2 title measures ending in 'Headline Title', found ${titleMeasures.length}`);
    }

    for (const m of titleMeasures) {
        if (m.formatString) {
            throw new Error(`assertTitleMeasuresHaveZeroRowGuard: Measure '${m.name}' must not carry formatString`);
        }
        if (!m.dax.includes('ISBLANK([Total Calls])') || !m.dax.includes('[Total Calls] = 0')) {
            throw new Error(`assertTitleMeasuresHaveZeroRowGuard: Measure '${m.name}' missing zero-row guard (requires ISBLANK([Total Calls]) and [Total Calls] = 0)`);
        }
        if (!m.dax.includes(PBI_TITLE_EMPTY_STATE_LABEL)) {
            throw new Error(`assertTitleMeasuresHaveZeroRowGuard: Measure '${m.name}' missing PBI_TITLE_EMPTY_STATE_LABEL fallback`);
        }
        if (!m.dax.includes(PBI_TITLE_NO_PRIOR_PERIOD_LABEL)) {
            throw new Error(`assertTitleMeasuresHaveZeroRowGuard: Measure '${m.name}' missing PBI_TITLE_NO_PRIOR_PERIOD_LABEL fallback`);
        }
        if (/\bBLANK\s*\(\s*\)/i.test(m.dax)) {
            throw new Error(`assertTitleMeasuresHaveZeroRowGuard: Measure '${m.name}' contains forbidden BLANK() call`);
        }
        const quoteCount = (m.dax.match(/"/g) || []).length;
        if (quoteCount % 2 !== 0) {
            throw new Error(`assertTitleMeasuresHaveZeroRowGuard: Measure '${m.name}' has unbalanced double quotes`);
        }
        if (m.name.includes("'") || m.name.includes('"') || m.dax.includes("'")) {
            throw new Error(`assertTitleMeasuresHaveZeroRowGuard: Measure '${m.name}' contains forbidden quote character`);
        }
        if (!m.dax.includes('▲') || !m.dax.includes('▼')) {
            throw new Error(`assertTitleMeasuresHaveZeroRowGuard: Measure '${m.name}' missing direction glyphs`);
        }
        const arrowRegex = /[→←↑↓↔↕↖↗↘↙]/;
        if (arrowRegex.test(m.dax)) {
            throw new Error(`assertTitleMeasuresHaveZeroRowGuard: Measure '${m.name}' contains unauthorized direction glyph`);
        }
        const refs = [...m.dax.matchAll(/(?:^|[^a-zA-Z0-9_\'])\[([^\]]+)\]/g)].map(match => match[1]);
        for (const ref of refs) {
            if (!CALLS_MEASURES.some(x => x.name === ref)) {
                throw new Error(`assertTitleMeasuresHaveZeroRowGuard: Measure '${m.name}' references unknown measure '${ref}'`);
            }
        }
    }

    return titleMeasures.length;
}

// D-11, D-12, D-13, NARR-01, NARR-02: Validates that headline visuals bind dynamic title measures
// while other titled visuals retain their literal titles.
function assertNarrativeTitlesBindMeasures(fileMap) {
    let inspectedBoundTitles = 0;
    const expectedBindings = {
        lineVolumeTrend: { pageKey: 'execHub', measure: 'Exec Headline Title' },
        scatterSilenceQa: { pageKey: 'opsQa', measure: 'Ops Headline Title' }
    };

    // 1. Verify exactly the two headline slots carry titleMeasure
    for (const page of PBI_PAGES) {
        for (const slot of page.layout || []) {
            if (slot.titleMeasure) {
                if (!expectedBindings[slot.key]) {
                    throw new Error(`assertNarrativeTitlesBindMeasures: Unexpected slot '${slot.key}' on page '${page.key}' carries titleMeasure '${slot.titleMeasure}'`);
                }
                const exp = expectedBindings[slot.key];
                if (page.key !== exp.pageKey || slot.titleMeasure !== exp.measure) {
                    throw new Error(`assertNarrativeTitlesBindMeasures: Slot '${slot.key}' expected page '${exp.pageKey}' and measure '${exp.measure}', got page '${page.key}' and '${slot.titleMeasure}'`);
                }
            }
        }
    }

    // Check specific missing slot messages required by negative harness Cases 1 and 2
    for (const [slotKey, exp] of Object.entries(expectedBindings)) {
        const page = PBI_PAGES.find(p => p.key === exp.pageKey);
        const slot = page && (page.layout || []).find(s => s.key === slotKey);
        if (!slot || slot.titleMeasure !== exp.measure) {
            throw new Error(`assertNarrativeTitlesBindMeasures: Slot '${slotKey}' missing required titleMeasure '${exp.measure}'`);
        }
    }

    // 2. Validate visual.json emitted for each page and slot
    for (const page of PBI_PAGES) {
        for (const slot of page.layout || []) {
            const visualPath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.Report/definition/pages/${page.id}/visuals/${slot.id}/visual.json`;
            const content = fileMap[visualPath];
            if (!content) continue;

            const visualObj = JSON.parse(content);
            const visualNode = visualObj.visual || {};
            const vcObjects = visualNode.visualContainerObjects || {};
            const titleObj = vcObjects.title && vcObjects.title[0];
            const titleProps = titleObj && titleObj.properties;

            if (slot.titleMeasure) {
                inspectedBoundTitles++;
                if (!titleProps || !titleProps.text || !titleProps.text.expr) {
                    throw new Error(`assertNarrativeTitlesBindMeasures: Slot '${slot.key}' missing title text expr`);
                }
                const expr = titleProps.text.expr;
                if (!expr.Measure) {
                    throw new Error(`assertNarrativeTitlesBindMeasures: Slot '${slot.key}' title text expr is not a Measure expression`);
                }
                if (expr.Literal) {
                    throw new Error(`assertNarrativeTitlesBindMeasures: Slot '${slot.key}' title text expr must not carry Literal key`);
                }
                if (expr.Measure.Property !== slot.titleMeasure) {
                    throw new Error(`assertNarrativeTitlesBindMeasures: Slot '${slot.key}' title Measure property '${expr.Measure.Property}' does not match '${slot.titleMeasure}'`);
                }

                // Check measure exists in CALLS_MEASURES and ends with 'Headline Title'
                const m = CALLS_MEASURES.find(x => x.name === slot.titleMeasure);
                if (!m) {
                    throw new Error(`assertNarrativeTitlesBindMeasures: Measure '${slot.titleMeasure}' not found in CALLS_MEASURES`);
                }
                if (!m.name.endsWith('Headline Title')) {
                    throw new Error(`assertNarrativeTitlesBindMeasures: Measure '${slot.titleMeasure}' does not end with 'Headline Title'`);
                }

                // Check title measure is NOT projected in visual query.queryState
                const queryState = (visualNode.query && visualNode.query.queryState) || {};
                const qsJson = JSON.stringify(queryState);
                if (qsJson.includes(slot.titleMeasure)) {
                    throw new Error(`assertNarrativeTitlesBindMeasures: Slot '${slot.key}' must not project title measure in queryState`);
                }
            } else if (slot.chartTitle) {
                if (!titleProps || !titleProps.text || !titleProps.text.expr) {
                    throw new Error(`assertNarrativeTitlesBindMeasures: Titled slot '${slot.key}' missing title text expr`);
                }
                const expr = titleProps.text.expr;
                if (!expr.Literal) {
                    throw new Error(`assertNarrativeTitlesBindMeasures: Titled slot '${slot.key}' expected Literal title, got non-Literal expr`);
                }
                const expectedLiteral = `'${slot.chartTitle}'`;
                if (expr.Literal.Value !== expectedLiteral) {
                    throw new Error(`assertNarrativeTitlesBindMeasures: Slot '${slot.key}' literal title '${expr.Literal.Value}' does not match expected '${expectedLiteral}'`);
                }
            }

            // Subtitle literal check (if present)
            const subTitleObj = vcObjects.subTitle && vcObjects.subTitle[0];
            const subTitleProps = subTitleObj && subTitleObj.properties;
            if (subTitleProps && subTitleProps.text && subTitleProps.text.expr && subTitleProps.text.expr.Literal) {
                const subVal = subTitleProps.text.expr.Literal.Value;
                if (!subVal.startsWith("'") || !subVal.endsWith("'")) {
                    throw new Error(`assertNarrativeTitlesBindMeasures: Slot '${slot.key}' subtitle literal '${subVal}' not single-quote wrapped`);
                }
                const inner = subVal.slice(1, -1);
                if (inner.includes("'")) {
                    throw new Error(`assertNarrativeTitlesBindMeasures: Slot '${slot.key}' subtitle inner text contains forbidden apostrophe: ${inner}`);
                }
            }
        }
    }

    if (inspectedBoundTitles !== 2) {
        throw new Error(`assertNarrativeTitlesBindMeasures: Expected exactly 2 measure-bound titles, inspected ${inspectedBoundTitles}`);
    }

    return inspectedBoundTitles;
}

// D-18, D-19, T-24-22: Asserts that every table in PBI_MODEL_TABLES has an emitted .tmdl file
// and a matching 'ref table <name>' line in model.tmdl, and that relationships.tmdl points only
// to known tables and columns actually declared by those tables.
function assertModelTablesAreReferenced(fileMap) {
    const basePath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.SemanticModel/definition`;
    const modelTmdlPath = `${basePath}/model.tmdl`;
    const modelTmdlContent = fileMap[modelTmdlPath];
    if (!modelTmdlContent) {
        throw new Error(`assertModelTablesAreReferenced: Missing model.tmdl at ${modelTmdlPath}`);
    }

    const tables = typeof PBI_MODEL_TABLES !== 'undefined' ? PBI_MODEL_TABLES : [{ name: 'Calls' }];
    for (const table of tables) {
        const tableFilePath = `${basePath}/tables/${table.name}.tmdl`;
        if (!fileMap[tableFilePath]) {
            throw new Error(`assertModelTablesAreReferenced: Missing table file for '${table.name}' at ${tableFilePath}`);
        }
        const refRegex = new RegExp(`^\\s*ref\\s+table\\s+${table.name}\\s*$`, 'm');
        if (!refRegex.test(modelTmdlContent)) {
            throw new Error(`assertModelTablesAreReferenced: model.tmdl is missing 'ref table ${table.name}'`);
        }
    }

    // Validate relationships.tmdl if emitted
    const relTmdlPath = `${basePath}/relationships.tmdl`;
    if (fileMap[relTmdlPath]) {
        const relContent = fileMap[relTmdlPath];
        const relMatches = [...relContent.matchAll(/relationship\s+([0-9a-fA-F-]+)/g)];
        if (relMatches.length === 0) {
            throw new Error('assertModelTablesAreReferenced: relationships.tmdl is emitted but contains no relationship blocks');
        }

        // Validate fromColumn and toColumn targets
        const fromMatches = [...relContent.matchAll(/fromColumn:\s*([^.\r\n]+)\.([^\r\n]+)/g)];
        const toMatches = [...relContent.matchAll(/toColumn:\s*([^.\r\n]+)\.([^\r\n]+)/g)];
        const endpoints = fromMatches.concat(toMatches);

        const knownTableNames = new Set(tables.map(t => t.name));
        for (const m of endpoints) {
            const tableName = m[1].trim();
            const colName = m[2].trim().replace(/^['"]|['"]$/g, '');
            if (!knownTableNames.has(tableName)) {
                throw new Error(`assertModelTablesAreReferenced: Relationship references unknown table '${tableName}'`);
            }
            const tableFile = fileMap[`${basePath}/tables/${tableName}.tmdl`];
            if (!tableFile) {
                throw new Error(`assertModelTablesAreReferenced: Target table file for '${tableName}' not found`);
            }
            // Check if column is declared in the table TMDL: column <colName> or column '<colName>'
            const colRegex = new RegExp(`^\\s*column\\s+(?:'${colName}'|"${colName}"|${colName})(?:\\s*=|\\s*$)`, 'm');
            if (!colRegex.test(tableFile)) {
                throw new Error(`assertModelTablesAreReferenced: Relationship references column '${colName}' not declared in '${tableName}.tmdl'`);
            }
        }
    }
}

function assertRelationshipRegistryIsWellFormed(fileMap) {
    if (typeof PBI_RELATIONSHIPS === 'undefined' || !Array.isArray(PBI_RELATIONSHIPS)) {
        throw new Error('assertRelationshipRegistryIsWellFormed: PBI_RELATIONSHIPS must be an array');
    }
    const seenIds = new Set();
    const seenPairs = new Set();
    const tableColPattern = /^[^.\r\n]+\.[^.\r\n]+$/;

    for (let i = 0; i < PBI_RELATIONSHIPS.length; i++) {
        const entry = PBI_RELATIONSHIPS[i];
        if (!entry || typeof entry !== 'object') {
            throw new Error(`assertRelationshipRegistryIsWellFormed: Entry at index ${i} must be an object`);
        }
        const id = entry.id;
        if (!id || typeof id !== 'string' || id.trim() === '') {
            throw new Error(`assertRelationshipRegistryIsWellFormed: Entry at index ${i} must declare a non-empty string id`);
        }
        if (seenIds.has(id)) {
            throw new Error(`assertRelationshipRegistryIsWellFormed: duplicate relationship id '${id}'`);
        }
        seenIds.add(id);

        if (!entry.fromColumn || typeof entry.fromColumn !== 'string' || entry.fromColumn.trim() === '') {
            throw new Error(`assertRelationshipRegistryIsWellFormed: Entry '${id}' must declare fromColumn`);
        }
        if (!entry.toColumn || typeof entry.toColumn !== 'string' || entry.toColumn.trim() === '') {
            throw new Error(`assertRelationshipRegistryIsWellFormed: Entry '${id}' must declare toColumn`);
        }

        if (!tableColPattern.test(entry.fromColumn.trim())) {
            throw new Error(`assertRelationshipRegistryIsWellFormed: Entry '${id}' fromColumn '${entry.fromColumn}' must be Table.Column`);
        }
        if (!tableColPattern.test(entry.toColumn.trim())) {
            throw new Error(`assertRelationshipRegistryIsWellFormed: Entry '${id}' toColumn '${entry.toColumn}' must be Table.Column`);
        }

        const pair = `${entry.fromColumn.trim()}->${entry.toColumn.trim()}`;
        if (seenPairs.has(pair)) {
            throw new Error(`assertRelationshipRegistryIsWellFormed: duplicate relationship endpoint pair '${pair}'`);
        }
        seenPairs.add(pair);
    }
}

// Phase 34 Task 3 (Pitfall 3): Structural assertion that all page IDs and layout slot IDs
// across PBI_PAGES are unique 20-lowercase-hex strings. Prevents two PBIR objects silently
// sharing an identifier, which causes Desktop load errors.
function assertLogicalIdsAreUnique() {
    if (typeof PBI_PAGES === 'undefined' || !Array.isArray(PBI_PAGES) || PBI_PAGES.length === 0) {
        throw new Error('assertLogicalIdsAreUnique: PBI_PAGES must be a non-empty array');
    }

    const HEX_20_REGEX = /^[0-9a-f]{20}$/;
    const seen = new Map(); // id -> owner description string
    let totalChecked = 0;

    for (const page of PBI_PAGES) {
        const pageKey = page.key || page.displayName || 'unknown_page';
        const pageId = page.id;
        if (!pageId || !HEX_20_REGEX.test(pageId)) {
            throw new Error(`assertLogicalIdsAreUnique: Page '${pageKey}' has invalid 20-hex id '${pageId}'`);
        }
        if (seen.has(pageId)) {
            throw new Error(`assertLogicalIdsAreUnique: Duplicate id '${pageId}' found on page '${pageKey}', previously defined by ${seen.get(pageId)}`);
        }
        seen.set(pageId, `page '${pageKey}'`);
        totalChecked++;

        if (Array.isArray(page.layout)) {
            for (const slot of page.layout) {
                const slotKey = slot.key || 'unnamed_slot';
                const slotId = slot.id;
                if (!slotId || !HEX_20_REGEX.test(slotId)) {
                    throw new Error(`assertLogicalIdsAreUnique: Slot '${slotKey}' on page '${pageKey}' has invalid 20-hex id '${slotId}'`);
                }
                if (seen.has(slotId)) {
                    throw new Error(`assertLogicalIdsAreUnique: Duplicate id '${slotId}' found on slot '${slotKey}' of page '${pageKey}', previously defined by ${seen.get(slotId)}`);
                }
                seen.set(slotId, `slot '${slotKey}' of page '${pageKey}'`);
                totalChecked++;
            }
        }
    }

    if (totalChecked === 0) {
        throw new Error('assertLogicalIdsAreUnique: Anti-vacuity guard: zero ids were collected');
    }

    return totalChecked;
}

// ============================================================================
// VERIF-01: DATE-DIMENSION STRUCTURAL ASSERTIONS (D-15)
//
// These four assertions implement the VERIF-01 structural checks enumerated in
// CONTEXT.md D-15. They are reached both from the standalone gate script
// (check-date-dimension.js) and from the in-browser/regen assertion chains.
// Every function is a bare function declaration (vm-visible per D-14).
// ============================================================================

function assertDateTableIsMarked(fileMap) {
    const basePath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.SemanticModel/definition`;
    const dateTablePath = `${basePath}/tables/DateTable.tmdl`;
    const content = fileMap[dateTablePath];
    if (!content) {
        throw new Error(`assertDateTableIsMarked: Missing DateTable.tmdl at ${dateTablePath}`);
    }

    const hasTableCategory = /^\tdataCategory:\s*Time\s*$/m.test(content);

    // Extract column Date block: from 'column Date' line to next 'column ' or 'partition ' or EOF
    const dateIdx = content.search(/^[ \t]*column[ \t]+Date\b/m);
    if (dateIdx === -1) {
        throw new Error('assertDateTableIsMarked: DateTable is missing column Date');
    }
    const dateLineEnd = content.indexOf('\n', dateIdx);
    const afterDateLine = dateLineEnd !== -1 ? content.slice(dateLineEnd + 1) : '';
    const nextBoundary = afterDateLine.search(/^[ \t]*(?:column|partition)\b/m);
    const dateColBlock = nextBoundary !== -1 ? afterDateLine.slice(0, nextBoundary) : afterDateLine;
    
    // isKey line before dataType line inside column Date block
    const isKeyMatch = dateColBlock.match(/^[ \t]*isKey\b/m);
    const dataTypeMatch = dateColBlock.match(/^[ \t]*dataType:\s*dateTime\b/m);
    const hasIsKey = !!isKeyMatch;
    const isKeyBeforeDataType = hasIsKey && dataTypeMatch && isKeyMatch.index < dataTypeMatch.index;

    if (hasTableCategory && !hasIsKey) {
        throw new Error('assertDateTableIsMarked: Half-marked DateTable — table has dataCategory: Time but column Date is missing isKey');
    }
    if (!hasTableCategory && hasIsKey) {
        throw new Error('assertDateTableIsMarked: Half-marked DateTable — column Date has isKey but table is missing dataCategory: Time');
    }
    if (!hasTableCategory && !hasIsKey) {
        throw new Error('assertDateTableIsMarked: DateTable is completely unmarked — missing dataCategory: Time and column Date isKey');
    }
    if (!isKeyBeforeDataType) {
        throw new Error('assertDateTableIsMarked: column Date isKey must appear before dataType: dateTime');
    }

    return 1;
}

function assertCalendarSpanIsFullYear(fileMap) {
    const basePath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.SemanticModel/definition`;
    const dateTablePath = `${basePath}/tables/DateTable.tmdl`;
    const content = fileMap[dateTablePath];
    if (!content) {
        throw new Error(`assertCalendarSpanIsFullYear: Missing DateTable.tmdl at ${dateTablePath}`);
    }

    const partIdx = content.search(/^[ \t]*partition[ \t]+DateTable[ \t]*=[ \t]*calculated\b/m);
    if (partIdx === -1) {
        throw new Error('assertCalendarSpanIsFullYear: Missing partition DateTable = calculated block');
    }
    const partLineEnd = content.indexOf('\n', partIdx);
    const afterPartLine = partLineEnd !== -1 ? content.slice(partLineEnd + 1) : '';
    const nextBoundary = afterPartLine.search(/^[ \t]*annotation[ \t]+PBI_Id\b/m);
    const partitionSlice = nextBoundary !== -1 ? afterPartLine.slice(0, nextBoundary) : afterPartLine;

    if (!partitionSlice.includes('CALENDAR(')) {
        throw new Error('assertCalendarSpanIsFullYear: DateTable partition source must contain a CALENDAR( expression');
    }
    if (partitionSlice.includes('DATATABLE(')) {
        throw new Error('assertCalendarSpanIsFullYear: DateTable partition source must not contain a DATATABLE( expression');
    }

    if (/\b(19|20)\d{2}\b/.test(partitionSlice)) {
        throw new Error('assertCalendarSpanIsFullYear: DateTable partition contains a four-digit year literal — bounds must be computed at load per D-08, not baked by the generator');
    }

    const stripped = partitionSlice.replace(/\s+/g, '');
    if (!stripped.includes("DATE(YEAR(MIN('Calls'[Call_Date])),1,1)")) {
        throw new Error("assertCalendarSpanIsFullYear: DateTable partition lower bound must be DATE(YEAR(MIN('Calls'[Call_Date])), 1, 1)");
    }
    if (!stripped.includes("DATE(YEAR(MAX('Calls'[Call_Date])),12,31)")) {
        throw new Error("assertCalendarSpanIsFullYear: DateTable partition upper bound must be DATE(YEAR(MAX('Calls'[Call_Date])), 12, 31)");
    }

    return 1;
}

function assertDateRelationshipKeyAndCardinality(fileMap) {
    if (typeof PBI_RELATIONSHIPS === 'undefined' || !Array.isArray(PBI_RELATIONSHIPS)) {
        throw new Error('assertDateRelationshipKeyAndCardinality: PBI_RELATIONSHIPS is undefined or not an array');
    }

    // Dedicated by-name rejection for Calls.Timestamp
    for (const rel of PBI_RELATIONSHIPS) {
        const from = (rel.fromColumn || '').trim();
        const to = (rel.toColumn || '').trim();
        if ((from === 'Calls.Timestamp' && to.startsWith('DateTable.')) ||
            (to === 'Calls.Timestamp' && from.startsWith('DateTable.'))) {
            throw new Error(`assertDateRelationshipKeyAndCardinality: Rejected endpoint 'Calls.Timestamp' in relationship '${rel.id}' — relationship to DateTable must key on Calls.Call_Date, not raw Calls.Timestamp which contains midnight-only instant-level timestamps resulting in blank joins`);
        }
    }

    const dateRels = PBI_RELATIONSHIPS.filter(r => (r.toColumn || '').trim() === 'DateTable.Date');
    if (dateRels.length === 0) {
        throw new Error('assertDateRelationshipKeyAndCardinality: No relationship in PBI_RELATIONSHIPS targets toColumn DateTable.Date');
    }
    if (dateRels.length > 1) {
        throw new Error(`assertDateRelationshipKeyAndCardinality: Expected exactly 1 relationship targeting DateTable.Date, found ${dateRels.length}`);
    }

    const rel = dateRels[0];
    if (rel.fromColumn !== 'Calls.Call_Date') {
        throw new Error(`assertDateRelationshipKeyAndCardinality: Date relationship fromColumn must be 'Calls.Call_Date', found '${rel.fromColumn}'`);
    }
    if (rel.cardinality !== undefined && rel.cardinality !== 'many') {
        throw new Error(`assertDateRelationshipKeyAndCardinality: Date relationship cardinality must be omitted (Option B auto-detection) or 'many', found '${rel.cardinality}'`);
    }
    if (rel.crossFilteringBehavior !== 'oneDirection') {
        throw new Error(`assertDateRelationshipKeyAndCardinality: Date relationship crossFilteringBehavior must be 'oneDirection', found '${rel.crossFilteringBehavior}'`);
    }

    // Cross-check emitted relationships.tmdl
    const basePath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.SemanticModel/definition`;
    const relTmdlPath = `${basePath}/relationships.tmdl`;
    const relContent = fileMap[relTmdlPath];
    if (!relContent) {
        throw new Error(`assertDateRelationshipKeyAndCardinality: Missing relationships.tmdl at ${relTmdlPath}`);
    }

    const relId = typeof PBI_DATE_RELATIONSHIP_ID !== 'undefined' ? PBI_DATE_RELATIONSHIP_ID : rel.id;
    if (!relContent.includes(`relationship ${relId}`)) {
        throw new Error(`assertDateRelationshipKeyAndCardinality: relationships.tmdl does not contain relationship ${relId}`);
    }
    const blockMatch = relContent.match(new RegExp(`relationship\\s+${relId}[\\s\\S]*?(?=relationship|$)`));
    if (!blockMatch || !blockMatch[0].includes('fromColumn: Calls.Call_Date') || !blockMatch[0].includes('toColumn: DateTable.Date')) {
        throw new Error(`assertDateRelationshipKeyAndCardinality: relationships.tmdl block for ${relId} missing fromColumn Calls.Call_Date or toColumn DateTable.Date`);
    }

    return 1;
}

function assertNoOrphanedModelOrReportReferences(fileMap) {
    let totalInspected = 0;

    // 1. Model side: assertModelTablesAreReferenced
    try {
        assertModelTablesAreReferenced(fileMap);
    } catch (e) {
        throw new Error(`assertNoOrphanedModelOrReportReferences: ${e.message}`);
    }

    // 2. Report side: assertFieldReferencesResolve
    try {
        assertFieldReferencesResolve(fileMap);
    } catch (e) {
        throw new Error(`assertNoOrphanedModelOrReportReferences: ${e.message}`);
    }

    // 3. Orphan check: every table in PBI_MODEL_TABLES must be referenced by at least one report visual or relationship endpoint
    const tables = typeof PBI_MODEL_TABLES !== 'undefined' ? PBI_MODEL_TABLES : [];
    const referencedEntities = new Set();

    // Walk relationships.tmdl endpoints
    const basePath = `${PBI_ROOT}/${PBI_PROJECT_NAME}.SemanticModel/definition`;
    const relTmdlPath = `${basePath}/relationships.tmdl`;
    if (fileMap[relTmdlPath]) {
        const relContent = fileMap[relTmdlPath];
        const endpoints = [...relContent.matchAll(/(?:fromColumn|toColumn):\s*([^.\r\n]+)\./g)];
        for (const m of endpoints) {
            referencedEntities.add(m[1].trim());
            totalInspected++;
        }
    }

    // Walk report visuals
    const visualKeys = Object.keys(fileMap).filter(k => k.match(/^powerbi\/.*\.Report\/definition\/pages\/[0-9a-f]{20}\/visuals\/[0-9a-f]{20}\/visual\.json$/));
    for (const key of visualKeys) {
        let visJson;
        try {
            visJson = JSON.parse(fileMap[key]);
        } catch {
            continue;
        }
        const sink = [];
        collectFieldReferences(visJson, sink, {});
        for (const ref of sink) {
            const entity = ref.entity || 'Calls';
            referencedEntities.add(entity);
            totalInspected++;
        }
    }

    if (totalInspected === 0) {
        throw new Error('assertNoOrphanedModelOrReportReferences: Zero model or report references inspected');
    }

    for (const table of tables) {
        if (!referencedEntities.has(table.name)) {
            throw new Error(`assertNoOrphanedModelOrReportReferences: Orphaned model table '${table.name}' — registered in PBI_MODEL_TABLES but referenced by no relationship endpoint and no report visual`);
        }
    }

    return totalInspected;
}

// Phase 33 Plan 33-04 (DRILL-01, D-15a): Asserts that Call Detail page.json carries a drill-through
// binding with exactly one parameter and one filter per declared field in PBI_DRILL_FIELDS,
// and that all parameter boundFilters point to valid filters.
function assertDrillthroughPageBindsDeclaredFields(fileMap) {
    if (!fileMap || typeof fileMap !== 'object') {
        throw new Error('assertDrillthroughPageBindsDeclaredFields: fileMap must be an object');
    }

    const pageKeys = Object.keys(fileMap).filter(k => /^powerbi\/.*\.Report\/definition\/pages\/[0-9a-f]{20}\/page\.json$/.test(k));
    if (pageKeys.length === 0) {
        throw new Error('assertDrillthroughPageBindsDeclaredFields: fileMap contains no page.json files (assertion inspected nothing)');
    }

    const targetKey = `powerbi/${PBI_PROJECT_NAME}.Report/definition/pages/${PBI_CALL_DETAIL_PAGE_ID}/page.json`;
    const targetContent = fileMap[targetKey];
    if (!targetContent) {
        throw new Error(`assertDrillthroughPageBindsDeclaredFields: page 'callDetail' page.json missing at '${targetKey}'`);
    }

    let pageJson;
    try {
        pageJson = JSON.parse(targetContent);
    } catch (e) {
        throw new Error(`assertDrillthroughPageBindsDeclaredFields: page 'callDetail' page.json is invalid JSON: ${e.message}`);
    }

    if (!pageJson.pageBinding) {
        throw new Error("assertDrillthroughPageBindsDeclaredFields: page 'callDetail' has no drill binding (missing pageBinding)");
    }
    if (!pageJson.filterConfig) {
        throw new Error("assertDrillthroughPageBindsDeclaredFields: page 'callDetail' missing filterConfig");
    }

    const failures = [];
    const params = (pageJson.pageBinding && pageJson.pageBinding.parameters) || [];
    const filters = (pageJson.filterConfig && pageJson.filterConfig.filters) || [];

    const filterByName = new Map();
    for (const f of filters) {
        if (f && typeof f.name === 'string') {
            filterByName.set(f.name, f);
        }
    }

    const boundFilterNames = new Set();

    for (const field of PBI_DRILL_FIELDS) {
        const matchingParams = params.filter(p => (
            p &&
            p.fieldExpr &&
            p.fieldExpr.Column &&
            p.fieldExpr.Column.Property === field &&
            p.fieldExpr.Column.Expression &&
            p.fieldExpr.Column.Expression.SourceRef &&
            p.fieldExpr.Column.Expression.SourceRef.Entity === 'Calls'
        ));

        if (matchingParams.length === 0) {
            failures.push(`declared drill field '${field}' has no parameter in pageBinding.parameters`);
        } else if (matchingParams.length > 1) {
            failures.push(`declared drill field '${field}' has ${matchingParams.length} duplicate parameters in pageBinding.parameters`);
        }

        const matchingFilters = filters.filter(f => (
            f &&
            f.field &&
            f.field.Column &&
            f.field.Column.Property === field &&
            f.field.Column.Expression &&
            f.field.Column.Expression.SourceRef &&
            f.field.Column.Expression.SourceRef.Entity === 'Calls'
        ));

        if (matchingFilters.length === 0) {
            failures.push(`declared drill field '${field}' has no filter in filterConfig.filters`);
        } else if (matchingFilters.length > 1) {
            failures.push(`declared drill field '${field}' has ${matchingFilters.length} duplicate filters in filterConfig.filters`);
        }
    }

    for (const p of params) {
        if (p && typeof p.boundFilter === 'string') {
            boundFilterNames.add(p.boundFilter);
            if (!filterByName.has(p.boundFilter)) {
                failures.push(`parameter '${p.name}' boundFilter '${p.boundFilter}' names a filter not present in filterConfig.filters`);
            }
        } else if (p) {
            failures.push(`parameter '${p.name}' is missing boundFilter property`);
        }
    }

    for (const f of filters) {
        if (f && typeof f.name === 'string' && !boundFilterNames.has(f.name)) {
            failures.push(`filter '${f.name}' in filterConfig.filters is not bound by any parameter`);
        }
    }

    if (failures.length > 0) {
        throw new Error(`assertDrillthroughPageBindsDeclaredFields failed (${failures.length}): ${failures.join('; ')}`);
    }
}

// Phase 33 Plan 33-04 (DRILL-02, D-15b): Asserts that Call Detail table visual binds all columns
// in PBI_CALL_DETAIL_COLUMNS in positional order, with zero Measure references (per D-11).
function assertTableVisualBindsAllDrillColumnsInOrder(fileMap) {
    if (!fileMap || typeof fileMap !== 'object') {
        throw new Error('assertTableVisualBindsAllDrillColumnsInOrder: fileMap must be an object');
    }

    const pageKeys = Object.keys(fileMap).filter(k => /^powerbi\/.*\.Report\/definition\/pages\/[0-9a-f]{20}\/page\.json$/.test(k));
    if (pageKeys.length === 0) {
        throw new Error('assertTableVisualBindsAllDrillColumnsInOrder: fileMap contains no page.json files (assertion inspected nothing)');
    }

    const tableSlot = (PBI_CALL_DETAIL_LAYOUT || []).find(s => s.kind === 'table');
    if (!tableSlot) {
        throw new Error("assertTableVisualBindsAllDrillColumnsInOrder: PBI_CALL_DETAIL_LAYOUT has no slot with kind 'table'");
    }

    const visualKey = `powerbi/${PBI_PROJECT_NAME}.Report/definition/pages/${PBI_CALL_DETAIL_PAGE_ID}/visuals/${tableSlot.id}/visual.json`;
    const visualContent = fileMap[visualKey];
    if (!visualContent) {
        throw new Error(`assertTableVisualBindsAllDrillColumnsInOrder: Table visual missing at '${visualKey}'`);
    }

    let visualJson;
    try {
        visualJson = JSON.parse(visualContent);
    } catch (e) {
        throw new Error(`assertTableVisualBindsAllDrillColumnsInOrder: Table visual at '${visualKey}' is invalid JSON: ${e.message}`);
    }

    const visual = visualJson.visual || {};
    if (visual.visualType !== 'tableEx') {
        throw new Error(`assertTableVisualBindsAllDrillColumnsInOrder: Expected visualType 'tableEx', found '${visual.visualType}'`);
    }

    const failures = [];
    const query = visual.query || {};

    // Check for Measure references anywhere in the visual query
    const refs = [];
    collectFieldReferences(query, refs);
    for (const ref of refs) {
        if (ref.kind === 'Measure') {
            failures.push(`table visual contains Measure reference '${ref.property}' on entity '${ref.entity}' (per D-11, must contain only Column projections)`);
        }
    }

    const projections = (visual.query && visual.query.queryState && visual.query.queryState.Values && visual.query.queryState.Values.projections) || [];
    const projectedCols = projections.map(p => p && p.field && p.field.Column && p.field.Column.Property).filter(Boolean);

    const targetCols = (typeof PBI_LOCKED_CALL_DETAIL_COLUMNS !== 'undefined') ? PBI_LOCKED_CALL_DETAIL_COLUMNS : PBI_CALL_DETAIL_COLUMNS;

    if (projectedCols.length !== targetCols.length) {
        failures.push(`table visual projected column count (${projectedCols.length}) does not match expected count (${targetCols.length})`);
    }

    const maxLen = Math.max(projectedCols.length, targetCols.length);
    for (let i = 0; i < maxLen; i++) {
        const expectedCol = targetCols[i];
        const observedCol = projectedCols[i];
        if (observedCol !== expectedCol) {
            failures.push(`column at position ${i} mismatch: expected '${expectedCol}', observed '${observedCol}'`);
        }
    }

    for (const expected of targetCols) {
        if (!projectedCols.includes(expected)) {
            failures.push(`missing required column '${expected}' in table visual projections`);
        }
    }

    if (failures.length > 0) {
        throw new Error(`assertTableVisualBindsAllDrillColumnsInOrder failed (${failures.length}): ${failures.join('; ')}`);
    }
}

// Phase 33 Plan 33-04 (D-15c restated): Asserts that every visual in PBI_DRILL_SOURCE_VISUALS
// projects at least one field appearing in PBI_DRILL_FIELDS.
function assertSourceVisualsProjectDeclaredDrillFields(fileMap) {
    if (!fileMap || typeof fileMap !== 'object') {
        throw new Error('assertSourceVisualsProjectDeclaredDrillFields: fileMap must be an object');
    }

    const pageKeys = Object.keys(fileMap).filter(k => /^powerbi\/.*\.Report\/definition\/pages\/[0-9a-f]{20}\/page\.json$/.test(k));
    if (pageKeys.length === 0) {
        throw new Error('assertSourceVisualsProjectDeclaredDrillFields: fileMap contains no page.json files (assertion inspected nothing)');
    }

    if (!Array.isArray(PBI_DRILL_SOURCE_VISUALS) || PBI_DRILL_SOURCE_VISUALS.length === 0) {
        throw new Error('assertSourceVisualsProjectDeclaredDrillFields: PBI_DRILL_SOURCE_VISUALS is empty');
    }

    const failures = [];

    for (const src of PBI_DRILL_SOURCE_VISUALS) {
        const page = typeof getPageByKey === 'function' ? getPageByKey(src.pageKey) : (PBI_PAGES || []).find(p => p.key === src.pageKey);
        if (!page) {
            failures.push(`source visual registration names unknown pageKey '${src.pageKey}'`);
            continue;
        }

        const slot = (page.layout || []).find(s => s.key === src.slotKey);
        if (!slot) {
            failures.push(`source visual registration names unknown slotKey '${src.slotKey}' on page '${src.pageKey}'`);
            continue;
        }

        const visualKey = `powerbi/${PBI_PROJECT_NAME}.Report/definition/pages/${page.id}/visuals/${slot.id}/visual.json`;
        const visualContent = fileMap[visualKey];
        if (!visualContent) {
            failures.push(`visual file missing at '${visualKey}' for slot '${src.slotKey}' on page '${src.pageKey}'`);
            continue;
        }

        let visualJson;
        try {
            visualJson = JSON.parse(visualContent);
        } catch (e) {
            failures.push(`visual file at '${visualKey}' is invalid JSON: ${e.message}`);
            continue;
        }

        const refs = [];
        collectFieldReferences(visualJson.visual, refs);

        const projectedCallsCols = refs
            .filter(r => r.kind === 'Column' && r.entity === 'Calls')
            .map(r => r.property);

        const hasDeclaredDrillField = projectedCallsCols.some(col => PBI_DRILL_FIELDS.includes(col));
        if (!hasDeclaredDrillField) {
            failures.push(`source visual slot '${src.slotKey}' on page '${src.pageKey}' projects [${projectedCallsCols.join(', ')}], none of which appears in declared PBI_DRILL_FIELDS [${PBI_DRILL_FIELDS.join(', ')}]`);
        }
    }

    if (failures.length > 0) {
        throw new Error(`assertSourceVisualsProjectDeclaredDrillFields failed (${failures.length}): ${failures.join('; ')}`);
    }
}

// Phase 33 Plan 33-04 (33-RESEARCH.md Pitfall 2): Asserts that all page-level field references in
// page.json (pageBinding and filterConfig) resolve against COLUMN_MANIFEST and model tables.
function assertPageLevelFieldReferencesResolve(fileMap) {
    if (!fileMap || typeof fileMap !== 'object') {
        throw new Error('assertPageLevelFieldReferencesResolve: fileMap must be an object');
    }

    const pageRegex = /^powerbi\/.*\.Report\/definition\/pages\/[0-9a-f]{20}\/page\.json$/;
    const pageKeys = Object.keys(fileMap).filter(k => pageRegex.test(k));
    if (pageKeys.length === 0) {
        throw new Error('assertPageLevelFieldReferencesResolve: fileMap contains no page.json files (assertion inspected nothing)');
    }

    const knownTableNames = new Set((PBI_MODEL_TABLES || []).map(t => t.name));
    const knownCallsColumns = new Set();
    for (const col of (COLUMN_MANIFEST || [])) knownCallsColumns.add(col.name);
    for (const col of (CALLS_DERIVED_COLUMNS || [])) knownCallsColumns.add(col.name);
    for (const col of (CALLS_CALCULATED_COLUMNS || [])) knownCallsColumns.add(col.name);

    const failures = [];

    for (const pageKey of pageKeys) {
        let pageJson;
        try {
            pageJson = JSON.parse(fileMap[pageKey]);
        } catch (e) {
            failures.push(`page.json at '${pageKey}' is invalid JSON: ${e.message}`);
            continue;
        }

        if (!pageJson.pageBinding && !pageJson.filterConfig) {
            continue;
        }

        const refs = [];
        if (pageJson.pageBinding) {
            collectFieldReferences(pageJson.pageBinding, refs);
        }
        if (pageJson.filterConfig) {
            collectFieldReferences(pageJson.filterConfig, refs);
        }

        for (const ref of refs) {
            if (ref.kind === 'Column') {
                if (!knownTableNames.has(ref.entity)) {
                    failures.push(`page '${pageJson.name || pageKey}' references unknown entity '${ref.entity}'`);
                } else if (ref.entity === 'Calls' && !knownCallsColumns.has(ref.property)) {
                    failures.push(`page '${pageJson.name || pageKey}' references unknown column '${ref.property}' on entity 'Calls'`);
                }
            }
        }
    }

    if (failures.length > 0) {
        throw new Error(`assertPageLevelFieldReferencesResolve failed (${failures.length}): ${failures.join('; ')}`);
    }
}

// Phase 34 Plan 34-05 (EXT-01, D-15):
// Asserts that no visual on the Compliance & Coaching page pairs the column 'Agent_ID' with the measure 'Avg QA Score'.
// This page's audience is the same coaching audience that 'barAgentBreakdown' on Ops/QA serves, so re-plotting it here
// is the standing temptation. A prose sentence in the README was explicitly rejected as the acknowledgment-instead-of-mechanism
// posture Phase 31 D-13 and Phase 32 D-11 both ruled against.
// Scoped per visual (not per page), so the page can legitimately carry an Agent_ID slicer and an Avg QA Score card simultaneously.
function assertNoAgentQaDuplicateSignature(fileMap) {
    if (!fileMap || typeof fileMap !== 'object') {
        throw new Error('assertNoAgentQaDuplicateSignature: fileMap must be an object');
    }

    const page = typeof getPageByKey === 'function' ? getPageByKey('compliance') : (PBI_PAGES || []).find(p => p.key === 'compliance');
    if (!page) {
        throw new Error("assertNoAgentQaDuplicateSignature: page 'compliance' not found in page registry");
    }

    // Registry-level pre-check: quick fail if a slot explicitly declares column: 'Agent_ID' and measure: 'Avg QA Score'
    for (const slot of (page.layout || [])) {
        if (slot && slot.column === 'Agent_ID' && slot.measure === 'Avg QA Score') {
            throw new Error(`assertNoAgentQaDuplicateSignature: slot '${slot.key}' on page 'compliance' declares forbidden pairing of column 'Agent_ID' with measure 'Avg QA Score'`);
        }
    }

    let inspectedCount = 0;
    const failures = [];

    for (const slot of (page.layout || [])) {
        const visualKey = `powerbi/${PBI_PROJECT_NAME}.Report/definition/pages/${page.id}/visuals/${slot.id}/visual.json`;
        const visualContent = fileMap[visualKey];
        if (!visualContent) {
            continue;
        }

        let visualJson;
        try {
            visualJson = JSON.parse(visualContent);
        } catch (e) {
            failures.push(`visual '${slot.key}' at '${visualKey}' is invalid JSON: ${e.message}`);
            continue;
        }

        inspectedCount++;

        const refs = [];
        collectFieldReferences(visualJson, refs, {});

        const hasAgentCol = refs.some(r => r.kind === 'Column' && r.property === 'Agent_ID');
        const hasAvgQaMeasure = refs.some(r => r.kind === 'Measure' && r.property === 'Avg QA Score');

        if (hasAgentCol && hasAvgQaMeasure) {
            failures.push(`slot '${slot.key}' on page 'compliance' carries forbidden visual signature: pairs column 'Agent_ID' with measure 'Avg QA Score'`);
        }
    }

    if (inspectedCount === 0) {
        throw new Error("assertNoAgentQaDuplicateSignature: zero visuals inspected for page 'compliance' (assertion inspected nothing)");
    }

    if (failures.length > 0) {
        throw new Error(`assertNoAgentQaDuplicateSignature failed (${failures.length}): ${failures.join('; ')}`);
    }

    return inspectedCount;
}

// Phase 32 Task 1 (D-11, D-12, MODEL-08):
// Pattern matching forward reference descriptions of the fixed form:
// "reserved for <REQ-ID>, Phase <N>" (e.g. "reserved for DRILL-02, Phase 33").
// Captures the requirement ID and phase token as text for specific diagnostic reporting.
var PBI_COLUMN_FORWARD_REFERENCE_PATTERN = /^reserved for ([A-Z0-9]+-[0-9]+),\s*Phase\s*(.*)$/;

function collectCallsColumnConsumers(fileMap) {
    if (!fileMap || typeof fileMap !== 'object') {
        throw new Error('collectCallsColumnConsumers: fileMap is required and must be an object');
    }

    var consumedColumns = new Set();
    var source1Count = 0;

    // Source 1 — Generated report visuals: walk visual.json files in fileMap
    var visualKeys = Object.keys(fileMap).filter(function(k) {
        return k.match(/^powerbi\/.*\.Report\/definition\/pages\/[0-9a-f]{20}\/visuals\/[0-9a-f]{20}\/visual\.json$/);
    });

    for (var i = 0; i < visualKeys.length; i++) {
        var key = visualKeys[i];
        var visJson;
        try {
            visJson = JSON.parse(fileMap[key]);
        } catch (e) {
            continue;
        }
        var sink = [];
        collectFieldReferences(visJson, sink, {});
        for (var j = 0; j < sink.length; j++) {
            var ref = sink[j];
            if (ref.kind === 'Column' && (ref.entity === 'Calls' || (!ref.entity && ref.property))) {
                consumedColumns.add(ref.property);
                source1Count++;
            }
        }
    }

    if (source1Count === 0) {
        throw new Error('collectCallsColumnConsumers: Zero visual field references inspected from fileMap — index can inspect nothing');
    }

    // Source 2 — Measure DAX: scan CALLS_MEASURES for 'Calls'[ColumnName] or Calls[ColumnName]
    var callsColDaxRegex = /(?:'Calls'|Calls)\[([^\]]+)\]/g;
    (typeof CALLS_MEASURES !== 'undefined' ? CALLS_MEASURES : []).forEach(function(m) {
        var dax = m.dax || '';
        var match;
        while ((match = callsColDaxRegex.exec(dax)) !== null) {
            consumedColumns.add(match[1]);
        }
    });

    // Source 3 — Calculated column DAX: scan CALLS_CALCULATED_COLUMNS for 'Calls'[ColumnName] or Calls[ColumnName]
    (typeof CALLS_CALCULATED_COLUMNS !== 'undefined' ? CALLS_CALCULATED_COLUMNS : []).forEach(function(col) {
        var dax = col.dax || '';
        var match;
        while ((match = callsColDaxRegex.exec(dax)) !== null) {
            consumedColumns.add(match[1]);
        }
    });

    // Source 4 — Relationship endpoints: scan PBI_RELATIONSHIPS
    (typeof PBI_RELATIONSHIPS !== 'undefined' ? PBI_RELATIONSHIPS : []).forEach(function(rel) {
        var from = (rel.fromColumn || '').trim();
        var to = (rel.toColumn || '').trim();
        if (from.startsWith('Calls.')) {
            consumedColumns.add(from.slice('Calls.'.length));
        }
        if (to.startsWith('Calls.')) {
            consumedColumns.add(to.slice('Calls.'.length));
        }
    });

    // Source 5 — Power Query M expressions: scan CALLS_DERIVED_COLUMNS for [ColumnName]
    var bareColRegex = /\[([^\]]+)\]/g;
    (typeof CALLS_DERIVED_COLUMNS !== 'undefined' ? CALLS_DERIVED_COLUMNS : []).forEach(function(col) {
        var mExpr = col.mExpression || '';
        var match;
        while ((match = bareColRegex.exec(mExpr)) !== null) {
            consumedColumns.add(match[1]);
        }
    });

    // Source 6 — Sort-by references: scan COLUMN_MANIFEST and CALLS_CALCULATED_COLUMNS
    (typeof COLUMN_MANIFEST !== 'undefined' ? COLUMN_MANIFEST : []).forEach(function(col) {
        if (col.sortByColumn) {
            consumedColumns.add(col.sortByColumn);
        }
    });
    (typeof CALLS_CALCULATED_COLUMNS !== 'undefined' ? CALLS_CALCULATED_COLUMNS : []).forEach(function(col) {
        if (col.sortByColumn) {
            consumedColumns.add(col.sortByColumn);
        }
    });

    return consumedColumns;
}

function assertEveryVisibleCallsColumnHasAConsumer(fileMap, roadmapText) {
    var consumedColumns = collectCallsColumnConsumers(fileMap);
    var offenders = [];

    var allEntries = (typeof COLUMN_MANIFEST !== 'undefined' ? COLUMN_MANIFEST : []).concat(
        typeof CALLS_CALCULATED_COLUMNS !== 'undefined' ? CALLS_CALCULATED_COLUMNS : [],
        typeof CALLS_DERIVED_COLUMNS !== 'undefined' ? CALLS_DERIVED_COLUMNS : []
    );

    var visibleEntries = allEntries.filter(function(col) {
        return col.isHidden === false;
    });

    visibleEntries.forEach(function(col) {
        var colName = col.name;
        if (consumedColumns.has(colName)) {
            return; // Consumed by one of the 6 sources
        }

        var desc = (col.description || '').trim();

        // Check for forward reference escape hatch
        if (desc.startsWith('reserved for')) {
            var match = PBI_COLUMN_FORWARD_REFERENCE_PATTERN.exec(desc);
            if (!match) {
                offenders.push("Column '" + colName + "' has malformed forward reference description: " + JSON.stringify(col.description));
                return;
            }

            var reqId = match[1];
            var phaseToken = match[2].trim();

            if (!/^[0-9]+$/.test(phaseToken)) {
                offenders.push("Column '" + colName + "' has malformed forward reference (non-numeric or empty phase token): " + JSON.stringify(col.description));
                return;
            }

            if (!roadmapText || typeof roadmapText !== 'string' || roadmapText.trim().length === 0) {
                offenders.push("Column '" + colName + "' forward reference cannot be validated because ROADMAP text is missing or empty");
                return;
            }

            // Cross-check that phase heading exists in ROADMAP.md
            var phaseHeaderRegex = new RegExp('#+\\s+Phase\\s+' + phaseToken + ':', 'i');
            if (!phaseHeaderRegex.test(roadmapText)) {
                offenders.push("Column '" + colName + "' forward reference names Phase " + phaseToken + " (" + reqId + "), but no 'Phase " + phaseToken + ":' heading was found in .planning/ROADMAP.md");
                return;
            }

            return; // Valid forward reference to an existing roadmap phase
        }

        // Unconsumed and carries no valid forward reference
        offenders.push("Visible column '" + colName + "' has no consumer in measures, calculated columns, relationships, M expressions, sort-by references, or visual bindings, and carries no declared forward reference (D-11, D-12)");
    });

    if (offenders.length > 0) {
        throw new Error("assertEveryVisibleCallsColumnHasAConsumer: " + offenders.join("; "));
    }
    return 1;
}

function assertEveryHiddenCallsColumnHasARecordedReason() {
    var offenders = [];

    var allEntries = (typeof COLUMN_MANIFEST !== 'undefined' ? COLUMN_MANIFEST : []).concat(
        typeof CALLS_CALCULATED_COLUMNS !== 'undefined' ? CALLS_CALCULATED_COLUMNS : [],
        typeof CALLS_DERIVED_COLUMNS !== 'undefined' ? CALLS_DERIVED_COLUMNS : []
    );

    var hiddenEntries = allEntries.filter(function(col) {
        return col.isHidden === true;
    });

    hiddenEntries.forEach(function(col) {
        var colName = col.name;
        if (col.description === undefined || typeof col.description !== 'string' || col.description.trim().length === 0) {
            offenders.push("Hidden column '" + colName + "' has no recorded reason in model (description missing or empty)");
        }
    });

    if (offenders.length > 0) {
        throw new Error("assertEveryHiddenCallsColumnHasARecordedReason: " + offenders.join("; "));
    }
    return 1;
}

// ============================================================================
// PERIOD-OVER-PERIOD STRUCTURAL ASSERTIONS (Phase 31 D-13, D-14)
//
// Standalone gate assertions answering whether delta measures use the date
// dimension correctly (check:pop). Bare function declarations (vm-visible).
// ============================================================================

function assertNoAllCallsBaselineInDeltaMeasures() {
    var popMeasures = (CALLS_MEASURES || []).filter(function(m) {
        return isPopDeltaMeasureName(m.name);
    });
    if (popMeasures.length === 0) {
        throw new Error("assertNoAllCallsBaselineInDeltaMeasures: Found zero delta measures matching naming convention");
    }
    var offenders = [];
    for (var i = 0; i < popMeasures.length; i++) {
        var m = popMeasures[i];
        var dax = m.dax || '';
        var stripped = dax.split(PBI_POP_SANCTIONED_DATE_ANCHOR).join('');
        if (stripped.includes("ALL('Calls')")) {
            offenders.push("Measure '" + m.name + "' contains 'ALL('Calls')' whole-dataset baseline removed in DATE-02");
        }
    }
    if (offenders.length > 0) {
        throw new Error("assertNoAllCallsBaselineInDeltaMeasures: " + offenders.join("; "));
    }
    return 1;
}

function assertEveryDeltaMeasureReferencesDateTable() {
    var popMeasures = (CALLS_MEASURES || []).filter(function(m) {
        return isPopDeltaMeasureName(m.name);
    });
    if (popMeasures.length === 0) {
        throw new Error("assertEveryDeltaMeasureReferencesDateTable: Found zero delta measures matching naming convention");
    }
    var offenders = [];
    for (var i = 0; i < popMeasures.length; i++) {
        var m = popMeasures[i];
        var dax = m.dax || '';
        if (!dax.includes("'DateTable'[Date]")) {
            offenders.push("Measure '" + m.name + "' missing 'DateTable'[Date] reference; period-over-period comparison must resolve through DateTable");
        }
    }
    if (offenders.length > 0) {
        throw new Error("assertEveryDeltaMeasureReferencesDateTable: " + offenders.join("; "));
    }
    return 1;
}

function assertNoFactTableDateDerivationInDeltaMeasures() {
    var popMeasures = (CALLS_MEASURES || []).filter(function(m) {
        return isPopDeltaMeasureName(m.name);
    });
    if (popMeasures.length === 0) {
        throw new Error("assertNoFactTableDateDerivationInDeltaMeasures: Found zero delta measures matching naming convention");
    }
    var forbiddenFragments = [
        "INT('Calls'[Timestamp])",
        "DISTINCT(SELECTCOLUMNS('Calls'",
        "'Calls'[Call_Date]",
        "'Calls'[Timestamp]",
        "TODAY()"
    ];
    var offenders = [];
    for (var i = 0; i < popMeasures.length; i++) {
        var m = popMeasures[i];
        var dax = m.dax || '';
        var stripped = dax.split(PBI_POP_SANCTIONED_DATE_ANCHOR).join('');
        for (var j = 0; j < forbiddenFragments.length; j++) {
            var frag = forbiddenFragments[j];
            if (stripped.includes(frag)) {
                offenders.push("Measure '" + m.name + "' contains forbidden fact-table date derivation fragment: " + frag);
            }
        }
    }
    if (offenders.length > 0) {
        throw new Error("assertNoFactTableDateDerivationInDeltaMeasures: " + offenders.join("; "));
    }
    return 1;
}

function assertPartialPeriodClampInEveryDeltaMeasure() {
    var popMeasures = (CALLS_MEASURES || []).filter(function(m) {
        return isPopDeltaMeasureName(m.name);
    });
    if (popMeasures.length === 0) {
        throw new Error("assertPartialPeriodClampInEveryDeltaMeasure: Found zero delta measures matching naming convention");
    }
    var offenders = [];
    for (var i = 0; i < popMeasures.length; i++) {
        var m = popMeasures[i];
        var dax = m.dax || '';
        var hasClamp = dax.includes("MIN(MAX('DateTable'[Date]), _lastDataDate)");
        var hasAnchor = dax.includes(PBI_POP_SANCTIONED_DATE_ANCHOR);
        if (!hasClamp || !hasAnchor) {
            offenders.push("Measure '" + m.name + "' missing DATE-05 partial-period clamp or sanctioned anchor");
        }
    }
    if (offenders.length > 0) {
        throw new Error("assertPartialPeriodClampInEveryDeltaMeasure: " + offenders.join("; "));
    }
    return 1;
}

// ============================================================================
// Phase 32: Weighted Measures Structural Assertions (EXT-02, D-04)
// Validates that weighted measures carry duration-weighted ratio DAX expressions
// produced by buildWeightedRatioDax, and that no row-averaged silence survives.
// Bare function declarations (vm-visible).
// ============================================================================

function assertWeightedRatioShapeOnWeightedMeasures() {
    if (!Array.isArray(PBI_WEIGHTED_MEASURE_SPECS) || PBI_WEIGHTED_MEASURE_SPECS.length === 0) {
        throw new Error("assertWeightedRatioShapeOnWeightedMeasures: Found zero weighted measures in PBI_WEIGHTED_MEASURE_SPECS");
    }
    var measuresByName = {};
    (CALLS_MEASURES || []).forEach(function(m) {
        measuresByName[m.name] = m;
    });

    var offenders = [];
    for (var i = 0; i < PBI_WEIGHTED_MEASURE_SPECS.length; i++) {
        var spec = PBI_WEIGHTED_MEASURE_SPECS[i];
        var m = measuresByName[spec.name];
        if (!m) {
            offenders.push("Measure '" + spec.name + "' is missing from CALLS_MEASURES");
            continue;
        }
        var expectedDax = buildWeightedRatioDax(spec.numerator, spec.denominator);
        if (m.dax !== expectedDax) {
            offenders.push("Measure '" + spec.name + "' DAX does not match expected weighted ratio shape.\n  Expected: " + expectedDax + "\n  Found:    " + m.dax);
        }
    }
    if (offenders.length > 0) {
        throw new Error("assertWeightedRatioShapeOnWeightedMeasures: " + offenders.join("; "));
    }
    return 1;
}

function assertNoRowAveragedSilencePctSurvives() {
    if (!Array.isArray(PBI_WEIGHTED_MEASURE_SPECS) || PBI_WEIGHTED_MEASURE_SPECS.length === 0) {
        throw new Error("assertNoRowAveragedSilencePctSurvives: Found zero weighted measures in PBI_WEIGHTED_MEASURE_SPECS");
    }
    var retiredPattern = /AVERAGE\s*\(\s*'Calls'\[Silence_Pct\]\s*\)/i;
    var offenders = [];

    (CALLS_MEASURES || []).forEach(function(m) {
        var dax = m.dax || '';
        if (retiredPattern.test(dax) || dax.includes("AVERAGE('Calls'[Silence_Pct])")) {
            offenders.push("Measure '" + m.name + "' carries retired row-average of pre-computed percentage AVERAGE('Calls'[Silence_Pct]) removed in EXT-02");
        }
    });

    (CALLS_CALCULATED_COLUMNS || []).forEach(function(col) {
        var dax = col.dax || '';
        if (retiredPattern.test(dax) || dax.includes("AVERAGE('Calls'[Silence_Pct])")) {
            offenders.push("Calculated column '" + col.name + "' carries retired row-average of pre-computed percentage AVERAGE('Calls'[Silence_Pct]) removed in EXT-02");
        }
    });

    if (offenders.length > 0) {
        throw new Error("assertNoRowAveragedSilencePctSurvives: " + offenders.join("; "));
    }
    return 1;
}

// Phase 32 Task 1: Guard against TMDL comment injection and parser-breaking description strings.
// Rejects blank, multi-line, non-ASCII, over-length (>120 chars), whitespace-padded, or triple-slash-bearing strings.
// Also throws if a description is present on a DateTable or SilenceBuckets column (which have no emitter).
// Note: The newline rejection is deliberately stricter than buildTmdlDescriptionLines (which supports multi-line).
// Microsoft documents no content-escaping rule for description text (RESEARCH A2), so this assertion
// holds the model to short single-line plain-ASCII reasons until D-14 Desktop testing says otherwise.
function assertDescriptionStringsAreTmdlSafe() {
    var printableAsciiRegex = /^[\x20-\x7E]+$/;
    var offenders = [];

    function validateEntry(col, tableName) {
        if (!col || col.description === undefined) return;
        var desc = col.description;
        var colName = col.name || 'unnamed';

        if (tableName !== 'Calls') {
            offenders.push("Column '" + colName + "' in table '" + tableName + "' carries a description, but table has no TMDL description emitter (D-16)");
            return;
        }

        if (typeof desc !== 'string') {
            offenders.push("Column '" + colName + "' description must be a string; received " + typeof desc);
            return;
        }

        if (desc.trim().length === 0) {
            offenders.push("Column '" + colName + "' description is empty or whitespace-only");
            return;
        }

        if (desc !== desc.trim()) {
            offenders.push("Column '" + colName + "' description carries leading or trailing whitespace");
            return;
        }

        if (desc.length > 120) {
            offenders.push("Column '" + colName + "' description exceeds 120 characters (" + desc.length + ")");
            return;
        }

        if (desc.indexOf('///') !== -1) {
            offenders.push("Column '" + colName + "' description contains forbidden triple-slash '///' sequence");
            return;
        }

        if (desc.indexOf('\n') !== -1 || desc.indexOf('\r') !== -1) {
            offenders.push("Column '" + colName + "' description contains forbidden newline");
            return;
        }

        if (!printableAsciiRegex.test(desc)) {
            offenders.push("Column '" + colName + "' description contains non-ASCII or control characters");
            return;
        }
    }

    (typeof COLUMN_MANIFEST !== 'undefined' ? COLUMN_MANIFEST : []).forEach(function(col) {
        validateEntry(col, 'Calls');
    });

    (typeof CALLS_CALCULATED_COLUMNS !== 'undefined' ? CALLS_CALCULATED_COLUMNS : []).forEach(function(col) {
        validateEntry(col, 'Calls');
    });

    (typeof CALLS_DERIVED_COLUMNS !== 'undefined' ? CALLS_DERIVED_COLUMNS : []).forEach(function(col) {
        validateEntry(col, 'Calls');
    });

    // DateTable and SilenceBuckets checks
    if (typeof PBI_DATE_TABLE_COLUMNS !== 'undefined') {
        PBI_DATE_TABLE_COLUMNS.forEach(function(col) {
            if (col && typeof col === 'object' && col.description !== undefined) {
                validateEntry(col, 'DateTable');
            }
        });
    }

    if (typeof SILENCE_BUCKET_DIMENSION !== 'undefined') {
        SILENCE_BUCKET_DIMENSION.forEach(function(col) {
            if (col && typeof col === 'object' && col.description !== undefined) {
                validateEntry(col, 'SilenceBuckets');
            }
        });
    }

    if (offenders.length > 0) {
        throw new Error("assertDescriptionStringsAreTmdlSafe: " + offenders.join("; "));
    }
    return 1;
}

function collectFieldReferences(node, sink, context) {
    if (node === null || typeof node !== 'object') return;

    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
            collectFieldReferences(node[i], sink, context);
        }
        return;
    }

    let nextContext = context || {};
    if (Array.isArray(node.From)) {
        nextContext = Object.assign({}, nextContext);
        for (let i = 0; i < node.From.length; i++) {
            const fromItem = node.From[i];
            if (fromItem && typeof fromItem.Name === 'string' && typeof fromItem.Entity === 'string') {
                nextContext[fromItem.Name] = fromItem.Entity;
            }
        }
    }

    // Check for Measure / Column patterns
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (k === 'Measure' || k === 'Column') {
            const field = node[k];
            if (field && typeof field === 'object' && field.Expression && typeof field.Property === 'string') {
                const srcRef = field.Expression.SourceRef;
                if (srcRef) {
                    if (typeof srcRef.Entity === 'string') {
                        sink.push({ kind: k, entity: srcRef.Entity, property: field.Property });
                    } else if (typeof srcRef.Source === 'string') {
                        if (typeof nextContext[srcRef.Source] === 'string') {
                            sink.push({ kind: k, entity: nextContext[srcRef.Source], property: field.Property });
                        } else {
                            sink.push({ kind: 'UnresolvedAlias', source: srcRef.Source });
                        }
                    }
                }
            }
        }
    }

    for (let i = 0; i < keys.length; i++) {
        collectFieldReferences(node[keys[i]], sink, nextContext);
    }
}

function collectLiteralValues(node, sink) {
    if (node === null || typeof node !== 'object') return;

    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
            collectLiteralValues(node[i], sink);
        }
        return;
    }

    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (k === 'Literal') {
            const lit = node[k];
            if (lit && typeof lit === 'object' && typeof lit.Value === 'string') {
                sink.push(lit.Value);
            }
        }
    }

    for (let i = 0; i < keys.length; i++) {
        collectLiteralValues(node[keys[i]], sink);
    }
}

function zipFromFileMap(fileMap) {
    const zip = new JSZip();
    for (const [path, content] of Object.entries(fileMap)) {
        // JSZip documentation note: A plain string passed to zip.file is UTF-8 encoded.
        // Base64 content written without { base64: true } lands in the archive as literal ASCII rather than decoded bytes.
        if (isRegisteredImagePath(path)) {
            zip.file(path, content, { base64: true });
        } else {
            zip.file(path, content);
        }
    }
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

function buildExportFilename(exportMode) {
    const dateStr = new Date().toISOString().slice(0, 10);
    const suffix = exportMode === PBI_EXPORT_MODE_FILTERED ? '-filtered' : '';
    return `powerbi-export-${dateStr}${suffix}.zip`;
}

function assertExportModeIsDisclosed(fileMap, exportMode, rowCount) {
    if (!fileMap || typeof fileMap !== 'object') {
        throw new Error('assertExportModeIsDisclosed: fileMap is required');
    }
    if (exportMode !== PBI_EXPORT_MODE_FULL && exportMode !== PBI_EXPORT_MODE_FILTERED) {
        throw new Error(`assertExportModeIsDisclosed: Unknown exportMode '${exportMode}'. Expected '${PBI_EXPORT_MODE_FULL}' or '${PBI_EXPORT_MODE_FILTERED}'.`);
    }

    const readme = fileMap['README.md'];
    if (typeof readme !== 'string') {
        throw new Error("assertExportModeIsDisclosed: README.md not found in fileMap");
    }

    // 1. README contains PBI_EXPORT_SCOPE_README_PREFIX exactly once
    const prefixCount = (readme.split(PBI_EXPORT_SCOPE_README_PREFIX).length - 1);
    if (prefixCount !== 1) {
        throw new Error(`assertExportModeIsDisclosed: Expected PBI_EXPORT_SCOPE_README_PREFIX ('${PBI_EXPORT_SCOPE_README_PREFIX}') exactly once, found ${prefixCount}`);
    }

    // 2. The scope line names the phrase matching exportMode and does not name the other mode's phrase
    const expectedPhrase = exportMode === PBI_EXPORT_MODE_FULL ? 'full dataset' : 'filtered rows only';
    const forbiddenPhrase = exportMode === PBI_EXPORT_MODE_FULL ? 'filtered rows only' : 'full dataset';

    // Extract scope line
    const lines = readme.split(/\r?\n/);
    const scopeLine = lines.find(line => line.startsWith(PBI_EXPORT_SCOPE_README_PREFIX));
    if (!scopeLine) {
        throw new Error("assertExportModeIsDisclosed: Scope line starting with prefix not found");
    }

    if (!scopeLine.includes(expectedPhrase)) {
        throw new Error(`assertExportModeIsDisclosed: Scope line '${scopeLine}' does not contain expected phrase '${expectedPhrase}'`);
    }
    if (scopeLine.includes(forbiddenPhrase)) {
        throw new Error(`assertExportModeIsDisclosed: Scope line '${scopeLine}' contains forbidden phrase '${forbiddenPhrase}'`);
    }

    // 3. The scope line contains String(rowCount) as the exported count
    const countStr = String(rowCount);
    if (!scopeLine.includes(`(${countStr} rows)`)) {
        throw new Error(`assertExportModeIsDisclosed: Scope line '${scopeLine}' does not contain expected count '(${countStr} rows)'`);
    }

    // 4. The filtered-mode README carries the narrowed-rows sentence and the full-mode README carries the every-row sentence
    const narrowedSentence = 'Rows were narrowed by the filters active in the dashboard at export time; the package therefore does not contain every row of the source file.';
    const everyRowSentence = 'Every row of the loaded source file is included.';

    if (exportMode === PBI_EXPORT_MODE_FILTERED) {
        if (!readme.includes(narrowedSentence)) {
            throw new Error(`assertExportModeIsDisclosed: Filtered-mode README missing narrowed sentence: '${narrowedSentence}'`);
        }
        if (readme.includes(everyRowSentence)) {
            throw new Error(`assertExportModeIsDisclosed: Filtered-mode README contains full-mode sentence: '${everyRowSentence}'`);
        }
    } else {
        if (!readme.includes(everyRowSentence)) {
            throw new Error(`assertExportModeIsDisclosed: Full-mode README missing every-row sentence: '${everyRowSentence}'`);
        }
        if (readme.includes(narrowedSentence)) {
            throw new Error(`assertExportModeIsDisclosed: Full-mode README contains filtered-mode sentence: '${narrowedSentence}'`);
        }
    }

    // 5. README_REQUIRED_CONTENT contains an entry whose needle is strictly identical to PBI_EXPORT_SCOPE_README_PREFIX
    const hasNeedle = (typeof README_REQUIRED_CONTENT !== 'undefined' ? README_REQUIRED_CONTENT : []).some(
        item => item.needle === PBI_EXPORT_SCOPE_README_PREFIX
    );
    if (!hasNeedle) {
        throw new Error(`assertExportModeIsDisclosed: README_REQUIRED_CONTENT does not contain needle strictly identical to PBI_EXPORT_SCOPE_README_PREFIX ('${PBI_EXPORT_SCOPE_README_PREFIX}')`);
    }

    // 6. buildExportFilename(exportMode) ends with -filtered.zip for filtered mode and .zip for full mode
    const filename = buildExportFilename(exportMode);
    if (exportMode === PBI_EXPORT_MODE_FILTERED) {
        if (!filename.endsWith('-filtered.zip')) {
            throw new Error(`assertExportModeIsDisclosed: buildExportFilename('filtered') ('${filename}') does not end with '-filtered.zip'`);
        }
    } else {
        if (!filename.endsWith('.zip') || filename.endsWith('-filtered.zip')) {
            throw new Error(`assertExportModeIsDisclosed: buildExportFilename('full') ('${filename}') is invalid for full mode`);
        }
    }

    return true;
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
}

async function generatePowerBIExport(rows, exportMode) {
    if (!exportMode) exportMode = PBI_EXPORT_MODE_FULL;
    // Reject rather than resolving to undefined (18-REVIEW WR-03). The current UI caller disables its
    // trigger during the loading state so this is unreachable through normal clicks, but that is the
    // caller's discipline, not this function's contract — a second caller, a keyboard shortcut or a
    // retry loop would otherwise receive `undefined` and hand it straight to triggerDownload/JSZip.
    if (isExportingPbi) throw new Error('Power BI export already in progress.');
    isExportingPbi = true;
    try {
        const fileMap = buildPowerBIFileMap(rows, exportMode);
        assertGeneratedTextIsClean(fileMap);
        assertModelTablesAreReferenced(fileMap);
        assertRelationshipRegistryIsWellFormed(fileMap);
        assertLogicalIdsAreUnique();
        assertThemeReferenceResolves(fileMap);
        assertPageCanvasMatchesTheme(fileMap);
        assertExecLayoutIsRenderable(fileMap);
        assertOpsLayoutIsRenderable(fileMap);
        assertAllPageLayoutsAreRenderable(fileMap);
        assertLineChartSlotsBindDeclaredFields(fileMap);
        assertTruncatedAxesAreDisclosed(fileMap);
        assertFieldReferencesResolve(fileMap);
        assertNoHardcodedCategoryLiterals(fileMap, rows);
        assertThemeOwnedPropertiesAreAllowlisted(fileMap);
        assertDateSlicerHasNoAuthoredFilter(fileMap);
        assertRelativeDateSlicerIsDisclosed(fileMap);
        assertDateTableIsMarked(fileMap);
        assertCalendarSpanIsFullYear(fileMap);
        assertDateRelationshipKeyAndCardinality(fileMap);
        assertNoOrphanedModelOrReportReferences(fileMap);
        assertNoAllCallsBaselineInDeltaMeasures();
        assertEveryDeltaMeasureReferencesDateTable();
        assertNoFactTableDateDerivationInDeltaMeasures();
        assertPartialPeriodClampInEveryDeltaMeasure();
        assertWeightedRatioShapeOnWeightedMeasures();
        assertNoRowAveragedSilencePctSurvives();
        assertDescriptionStringsAreTmdlSafe();
        assertTargetLinesMatchRegistry(fileMap);
        assertTargetDisclosuresArePresent(fileMap);
        assertTitleMeasuresHaveZeroRowGuard();
        assertNarrativeTitlesBindMeasures(fileMap);
        assertCardCaptionsMatchDesktopShape(fileMap);
        assertExportModeIsDisclosed(fileMap, exportMode, rows.length);
        assertReadmeCoversRequiredContent(fileMap);
        const blob = await zipFromFileMap(fileMap);
        return blob;
    } finally {
        isExportingPbi = false;
    }
}

async function exportPowerBIProject(rows, exportMode) {
    exportMode = exportMode || PBI_EXPORT_MODE_FULL;
    const blob = await generatePowerBIExport(rows, exportMode);
    if (typeof window !== 'undefined' && window.document) {
        const filename = buildExportFilename(exportMode);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    return blob;
}

// ============================================================================
// REGISTERED IMAGE PAYLOADS (D-16, D-17, Pitfall 3/4)
//
// ~17KB of opaque base64 in the readable region of a ~2,650-line generator costs
// every future reader; a bottom-of-file const is safe here because the whole script
// executes before any builder is called, so no builder can observe the temporal dead zone.
//
// Pitfall 4 Note: file-map values for registered images are base64 TEXT, and both
// writers decode them to PNG bytes before they reach disk -- zipFromFileMap via
// { base64: true } (for the ZIP-export path), regen-powerbi.js via
// Buffer.from(content, 'base64') (for the committed powerbi/ tree). check-powerbi-freshness.js
// compares registered images as decoded bytes and checks the PNG signature on disk, not
// as UTF-8 text. The earlier arrangement -- base64 text written straight to disk with a
// .png extension, and a freshness check that only ever compared UTF-8 text -- caused
// G-36-13: the committed tree's images were never valid PNGs and Power BI Desktop showed
// broken-image placeholders, with no gate catching it.
// ============================================================================

const BRAND_ICON_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAC4klEQVR4nO3dMW4TQRSH8bVFu0qZMyQSBdyAQ9DQpqbJQdJQ09JwCG4ABVI4Q8rIBzAdQpbH897szHjef76vzK690f7ydi1711kWIiIiuka71hu4ub0/tt5G9F5fnps5VH9iQMcCr/ZEwI4JvfkJgB0ber9lw+D2act+LvrLADbONLsnGNzr5t3/LmBwx8jjYAYGd6ysHiZgcMfM4rLpVTSNXxaY6R27nM9FYHBjdMmJQ7R4SWCmN1YpLyZYvLPATG/MzrkxweIBLB7AswFz/o3dqR8TLB7A4gEs3psleIfPX5PL1i8Py+ztVXEty2coLLAV7zA5ckhgL9phYuRwwKVYh0mRwwGTL4DFA1g8gMUDWDyAxQNYvPDvRdfu7tvP5LI/n94v0WKCjbiW5SMGsBMvGjLAix8tEvL0wHeFWFGQpwdWD2DxABYPYPEAFq/7O1nHpx/JZbvHD11/lxnaj4JrWU4DA1vxQA4I7EUDORBwKRbIdeJVtHgAiweweACLB7B4XJPVuO+/fieXfXz3tvXmmeBr4VqW14hDdKOseK2RAW6QF60lMsCVK8VqhQyweACLB7B4AIsHsHgAiweweACLB7B4AIsHsHgAiweweACLB7B4AIsHsHgAiweweACLB7B4AIsHsHgAi9ccuPSrkVKPK/2Hk2vicaVf8p16XOkNZa1uROsywV7k3Ppe5DWzvhc5t74Xq+Vdht0O0VZk63pW5NW4nhXZup4VrfUtpF3PwTk876Tn8FbnpOfwvJOew+txf/Du9Ac3t/fH5lulpr2+PP9z5VW0eACLB/BswP8fvylep35MsHgAiwfwjMCch2N2zo0JFi8JzBTHKuXFBIt3EZgpjtElp+wEgzx2OR8O0eKZgJniMbO4mCcY5LGyergO0SCPkcfBfQ4G+bp59/+mjwa5vKdfpYO16VU009ynLfu52of7THP9agxQ9as3gN5ezSNj88tzAM/HqY6IaJmxv04a5OEmyU7VAAAAAElFTkSuQmCC';



const BRAND_TEXT_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAZwAAAA4CAYAAADJu051AAAXUUlEQVR42u2debwcRbXHv7lMJh1JWCIhEhRkFyESNtMGgUiLtOBOSMLSJs8AsnR4whN9KstDRIOgGGlBBRUcdjQsAg5oA2GzExCIRghglEQgLEGWEFKZDMn7o+q+1wzT20zPcu/U7/OZz2dmeqs+deqcOqdOnQMaGhoaGhoaGhoaGhqDBUMavVBUqr8H7ITTLjeKhRmtfglRqW4FHARMAHYGtgY2AYYDFUAALwP/Ap4CHgTmGcXCkxH3+wDweMrHrwe2MoqFZ5po/yJgl5Sn72AUC3/Pod1psK9RLNzXLmY0fZGKpwLLmNHEM9LQ6NDAMuY2cO9NgFdiThkdWMaKAU6fWYFleA3c9x5g35hTlgA7BpaxLuX9NlPj2Yg4ZTlwNHBrm9j31MAyzm81HWto0JDcCyzjyYzP+ZDiuw8pOTUG2Eg9Z416zkvAM8CTwMPAXYFlvENOFRoUkJsDH09x6udFpXqcUSyIFiiZocAUwAXMmFMN9dkE2A6YBByj7rHAKBYm5KC0pwA/bPA9dsmgbAYtTF+k5inTF8cFliFa2BzP9MWdgWW8qumTG84ByjHHtwM+mUFBHBujbADOVUJ3sI2TpuWe6YsFgWVMSHjOMODLwEnq+igMV59NgR2BA0L3uDawjGnhk/safO/DUyqrjYBPtUDZfBJYBFyRQPQk7JRTk6Z26NrBhI7yVA22AM7X9MkPgWXcrmbYcTgppdAtAMfHnLIc+NkgVDZtkXumL/ZRlsqcBGWThPfU/tGowjkqw7lH5KhoholK9afAbUqbdgs+LCrVbbTCaQod4akYzDR9cYCmT+5WThwONH2RZhL4BeC9cdZNF1p4zSiaYaYv2iL3TF9MA+4EtmrF/fsaEPo7AXtluORgUalunIOy2QT4gzLzuhFTG3in3btMcXZqQGXmKdMXG7ehaT83fTFc0yc33Az8hXj3tJviPif1inWj1gXbIvdMX+wOXAYUW/WMvhbPtACGAYc2qWw2RPp/9+1i3piKtm7aMXvPhadSYjvg25o+5OVWWw98N+G06aYvNkoQivv0gnVj+qJtcs/0RR9wpeKdtFgLrMvynEaCBqLM9VuI9h0fAfyyCXpcgYzESItFwN+AFcCbwChlgk9ALqI1g8eRESG1GC8q1Z2MYuGJDPeaUue/p4AdWsRX3wWuznD+P9o0tjrBU2lxslr8fKiDsqeb6ZMV1wNnEb2OMBKYAfw44vh/ZrBu/gSMS9GmS2LWRP4FHJziHstbQKt2yr1DIuRaGM8BHnC7okt/xOXGSmbtCljqXps0rXBEpboPsG3E4buB/ZCLlrX4mKhUtzCKheUNWDcnAJ9LcerLyIXey6OeIyrVPuDDwHHAtAaZ4MGYjpmadkYsKtUJQL11nz+3UOEsN4qFRV02i2uYp0xfbBFYxvIWN3ED4FLTF3sFllHV9Gnaylln+uJ7ynUTBdf0xYXKIqqN1JuW1roJLGOVEsJJNF4Vc7gSWMaiDvR7ZrkX1dfKekmSe0lKdQHwicAyXqtz7FUlFx8EfqWCOqbVU+J9OZr284CAaNddI2sco1OY4AC/BbYxioXZcUrNKBbWGcVCoPYG7QLc0QAvPK1MyWZdZFNjLCi0O601PNUgdgO+rumTG64E/hlzfAfq7zf6cozLZ9Cs3Zi+yCT3AsuYHTexCCxjXWAZgdqfFSX3dk141tcjlE2951UDy7gisAy3YYUjKtVihAsI4EXkZp87co6c+Zoy1+LwA6NYmGwUCyuz3NgoFpYYxcKUBto0FHg04tgHRaU6LgUthwCHRRz+K70TLNAJnopD3L6N01NGUA1m+uRl5VTVPpk4zKqz/+S4HolMSyX3AsuYHFjGyoy0XxJYRj2e2jSFJUU7gwYORvoE6+EWo1hYB/wu5vq9RaW6fQYF9y7URqUY3KI6p514F3Bvk4EAH6V+WOdfgNd7yLqJ5Sm16zyWp0xfbJ9je54Bfk/0Qvylpi+G9DB98sSvgGdjjtumL8Ku5cnA2B6wbjol996kDaH2fTmZ9jcrq+FJ5IahPBp9SIKWF8CxStG1W+Hc1KTCiTrnN7QwJJGB5U67Wc3I8uSpJGwMfAWZriNqonB8D9MnTyunApxH+hDpk3rEukkl99KmAMqAZUlWl1pXar3CUftoDokhwB9qB0IOzJ+0W/qSRoIQcsAwZeFE5U7bXlSqe8bQcgM1W6uHa5EuO3rAndYJnkqcTCgBHuc/n2364n09Sp+88XOkazAKM0xfjDB9sVdMFNlgyyqQKPdaFAhyTwpd8RPTF2XTF+NosYVzWEzeIt8oFsLmWJyJv5OoVPdI+cyJCcev6xBDFI1iYT1wTYNWziRk8rtaPKIsxJ5QOEk8FVhGap4yfbFHTm3qp/1soqObRgIX9yh98rZyVgMXEJ+m50Bgeq9kFeig3LsaWJ3ivIOAhaYvbjJ9MalVCifRtA/hfuIXmI5IYVEZxOfwWQXM7xBD9IU6KApTVGBAFmV0bbMZvFPgQlGprk/5Oa7T7qI8eYr0IdD97p6ZRG9qO8T0xeE9SJ9W4CfEZ9j+hBJyvZBVoGNyL7CMl4h3cVLj7vwMcJfpi0WmL2aqZJ/NKxxRqb4PGetPRGr+39VEf71F9MIrwDS1HyYOWycI3qeNYmFtJxWOUSw8DCyOab9Zh5YFZB6obrLYOjGwMvFUYBmJPKX2GpBXuY7AMhYgkxdGYY5Kkd9L9GmFoFtJ9CZP1HjZoUesm0S5F1hGK+Xe2cAfM16zC3ApsMT0xdGmLzZo1sI5MoYID0Wso8T5lLeMGUz9GEUbQvRyqCF0dUa32oHAu+v8v8AoFv5J7yCWpyJ81M3yVCM4jehsC6OBH/U4ffLCHCAqvHfzHsoI3VG5p8LVP4uMgsuKLZEZGwLTF7s2o3CymPb9uJ34PQ1JJr6RcHxNlzDIVTHHDqtjySW509DRaS3jqUYG4JvEh6geqVLG9yR9cqTzK8BFGS8bbNZNV8g9xfOfAU5FuvCyYi9gvumLT2VWOCqb8S5Zmd8oFl5H7oKOwmS1kTQKSSlE3t0V3CErb0bl2BpLKOmeqFSHUT9VxXp6y53WEE8FlpHIU2qjZN4D8E7gFzGn/NT0xYhepU+O+AHJe0EGdb2bbpF7gWWsV9VLP6CsljUNbB25oV5QQV8TM62lRrEQl2o8LnJmU+JL5a5MYb4xAKycsEVjUz++/v5mylMPMutmaWAZreKpZvDVmOSMWwHfC00eepE+eS1aX9LD1k3Xyb3AMp4JLONY4P3I9Z0XyJYY+rrazN99MdZNH/GJ8m4mufYFDZr4SQJ4jKrL0w24huhops+HotUO7QJ32lnIBdg0n6talAK9UzzVzMB7FYjb9HaC6YuJKWaog5I+OeK8FLPpwWrdpJJ77U6vpPj/+cAyzlCTq6OAhSkvHQ2cnDZbtEV0KgmAWaJSndXEe3xaVKojjGLhDd7pqlohKtVXEvL7fAp4gs671ZaLSnUe8DHql1jdQ1Sqj1I/G+s6ZHaBdmGFcgN2Cok8ZfqiKZ4yfTEisIw3WjDobjR9cT31c+D1IffmmL1Kn5xo/Kzpi8uILzb2/UFq3RBYxgrTF10r99R2gStNX1ylJkYXROwprPXynJXGpXYUrU8RE5d+Oyne/OSEdSC6xK1mK0FUz/86zygWngftTmsTTzWLWcC/I459CJlcck0P0ycPJIXlPjTIx8j8FPWZip0upBdYxtXA7iSXf9jZ9MWoWIUjKtXhwOfpXGEpkFE3JPgzT+8SJvkN0RFCEyKsH4jPVsAgCxboBp5qdqC9AJxCvMuy2qv00cgFA0buqfD8L6Tg+TFJFs7nkCk8Wo0DRaW6WYwQfyvh+m+JSnUynXervYosBVsPeyLT2VAnImVuDw2ktvFUqzZkqkF2eYxQGAls2Mv00chl8poo90xfTKY7lM5TJJdUeVeSwjmqTe0tEFHvQ0Vu3UDyJsxrRaV6akwqGSKsuPGiUr2R1rvVxiJ989TJQbcC7U5rG0/liC8Db2j6aLQiMiyt3DN9cWrWchmmL8abvrixzv/fMX3R6BpkUvnqVyODBlSVzU8QXzfhqQyNGQ7smGDiR236OlO5GTZIyJbwfeBIUameA9xak0w0/G4bIvMyzUSurazMkVduVkIo7Z6Ma3vIndZNPJWHUFhq+uKbxKdk6Vn6aDSNTHLP9MU5wK01CV3D/JVG7o0Hvmn6ogRcGFjGQyl592Rgm4RyCk/HRakdnhC9dplRLJyYwZLYEHhJDYJ6mCgq1a2NYmFpHSvnMVGpngf8N+nKAF8HVESlugD4F7ACWV9mFDLUd1xCJ9KEW221spiOSllZ8oYOMPJmWYrghTa3NotEngos48QMAjqRp0xfbB1YxlJam3RyKrBPj9Fns4xF3SqBZSxDI8uE5jHTF5nlnumLZuXeEOCLwBdNXzyMdB3fhywMuaI/OtD0xVgVCDWT+tG3Ydylcv1FKpwkgXl9RoG1SlSqtxG9D2WIGnCzI46fgSx89dGUjyxmOJcWpPhOo3DuUOs+nZg5nUnjueNa5S66PuOAXGX6ohmeykMorDN9cTSy3PiwHqJPVh5aAnRr1dFuRqfl3h7qE57ICPWcLIlgL4rc+Ckq1R2BvWMufpH48sqNDpgjYhTWWmRun0cHAJPcoWYXpNgsSo+407qOp3JUOouRO7A1fTTy5q1ulHtGRmVzZWAZt8RlGkiaac1V5Qey4hbii/uME5XqrjFK5xVg/xQhg52OVqumGOiC5B3h9FCwwNywyZ0nT8Vlrc0R55J+53Uv0kejuaSmXS/3IrAAuS+NOIVzJMkhe40I4lXE1+tInHGphKCfRNacf62LCX11wvHbjGJhJb1ViiB3ngoso2meyjGl+0ySQ1l7kj4aTfPXQJF7YVwO7F8vo0VfyJ02Edg25iYrgLubaMT1KRZOkxTXeqNYmIP0CX8beK7BtqwH7lKCIm/cByzT0Wmg8ot1NU/lJBT+jMx2rOmj0aqd/a2We+cCN9J4PsC3gNuACYFlzIhKP1TIYNrf0KA7rdbEj4qceb+oVCcaxcIDKRTPCuBMUamepaIlDkBusNweue9lhHq31ciQ0hXIQlpPAX8C7jaKhRdpjVttvahUrwG+Rv0Ssbeg3Wn/x1MNuotS85Tpi4mBZTxA+0JZd9D00WhVrjXgTNMXDcu9wDJejLj3vcC9Krtzf7DCTsiQ5y2QG5qHI/M/voHcW7MEeBJ4ACgHlvFv3UsaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoagxx1EzN6pfJQ4ATkLujtkAV0XgDucB37WHVOGZnymlBBsReQJWLPdB17acR5/ZjnOvaktOeE2nYQcDwyDn0UMib8ceBE17EfDd1roevY42uuPR/4L+At17Ejs/N6pfIWwHeBA9UzlgBzXMe+NCuBU7R3MTLe/SbXsT8Xuu69yMyvALNcx/bS9I1XKt+NTIcRh51dx17slcoF4EvIDLHjkEkolwI3Aee6jv1yqD21fbSz69iLa971dt6eZn+k69hvNMgDb6n3mgec7jr2kgj6vqO/a+41xXXs60PnF4C16qfjOvYVaWkG/CjDe7yD/5o97pXK+ylemgi8B1nO+jngj65juw2Ot0T6NDj+EseyRu8hKhHbdWpw7a2YygC2RpYTJaaw05bAdOA+r1TOtXqhVyoP8UrlnyMra34WWbZ0KLCpGoDvz/Fxc4EZ6n2GA7sCl3il8he6oL2N9E299g1XbfsZMsX+Rkrh7AicCjzilcrbp03J4pXKm1O/0Fyj2AC5me1w4B6vVG60kuZPvFJ5QFe4VLw0RynfacBWyKy9I9VkZUYTt09FnzaPP41BikIdxtoNWe4WZFbjU4B/KwF3bJ17LHQde7xXKo8BzgMc4L3Ap3l7Fcy6M7p694o4dhpwjPp+P7JWxEJgc+SObZHT4B4KTOif4anZ/q3AvsBewFyvVL5cWQWnuY59Trvam6ZvwrNIr1T2gBOBVa5jj6i518UhBXGx6ruVSpGcB7wPuM4rlfd0HXs9b083v51SBOHa6lOVkug/nrV/a/lpM2Rq88OU4tkfmTojK0aHatfURQaaZXmPPPEN4CT1fT7wdeARpXDGA26DtE5Fnwb5ud000hiICqcmDcZ64CXXsasqR9h9MYP2BTUDctRfY3Kc4Y0MFSN6DDjAdeyK+r0SOCuvZ7mOvdYrle8F9gM+plwGOyk3Q3/RtNUx9GtlexvqmzrtGw0crX76rmOfEDo8xyuVt1UCbndgEjL/Uj8eUQplO69UnuA69nzengjygRiFk6UfVnil8g1K4fS/b1Y8qqzTKV6pfJ3r2L8dgNbNSOCb6udiYH/Xsdeo368Dz6oJEa2iTzvHn0bvKZxHkX78rdUsdk+vVP4R8CvXsUXMwBiDrPXej7/VnLKbVyqHhcY3XMeenfKc/ZBrFQBeiNnjUHuvLPgPJVi/pD4rAMt17AfV8f58Wf+MuL6R9qYVEJn7pg4+Gur7EvUTjPbPqD9So3CWAQ8jizMdAcz3SuVtkD79/mNOyj6pxwP9/LSVsjRQVlwj+b6eUsL4W8BFaq0mj4y7qd8jB+yHzGMFcGFI2eTRxrT0yWP8tZJGGgzQNRwluA4KFf7ZUbk2lnil8qQYxno+lIzw98Afcmzn2BqXTitnlB9Xwm0jZMK7l4HNgB97pfIHvVJ5rHKvvRWT/r0l7W2gb+LcKP14ts7xcDbaTXjn2kq/kprqlcobhKyba3IU5kuRa0svAoe6jv1ag/z9bWCRcv14A3CMhnnp74pHba9UXl/zOa2F9Gnb+NPoPQsH17Gf8ErlPZDrMF9VAnYscJNXKn/AdezldS57VQ2IXwKX1vj9obk1nHAhqS1TvltclFpcdNpcpG/8bNexz/BK5Y2BOchgiHuVsB8K/MJ17JcibpWlvWtDJWLDGBr6vqbJvqlFuB7PFnWOvyf0/aWImj/nI92mk0L+/6uQbkiaWMOhJvLxFNex725CSVe8UnkGECAX3H+Tw7hp5/rEqgjBn0sbU9Inl/GnodEXw4jrXce+2XXs/YDvq783UuZ1LWMNcR17U9ex93Yd+2LXsdfm3M6HQt+P8UrlIS2ix/5K2QD8WtHhNdexZ6jZ3yhkSvBlaiE3j/Y+H7JWwghHiD3TYN9E4U/EF+E6LPR9Xr31OmT4O8gIqXHA465jL8yhDxYiI+8uUROiX3ul8sFNWoZ/DtHpx00US6NDlRP7MV29T9l17CEhXqXF9GnX+NPowSg1E1ka9KfIBcIhNeetaXcj1Z4RHxlV9RHgRq9U/h/gCWQ01XTgHtexy00+Klyh7hTlplirZu1hYf5XYKhXKo8CCq5jv9hEe+8EPo5chP+WUmyjgbNDM9z78+wb17Gf9krl3wKHArZXKl8A/BAZaXQkMEudeqfr2AsiblNCuveODFk3efX3Gq9UPhH4MLAb8EuvVN4lvC+oAZyFrBE/oMoqu479d69U/p2yaCd5pfLVwDnI9ZcxOT4qkj5tHH8aPehSKygGmk79Rdjbc1poRc3S0p4zHVn9cHs1MD4TMxNsFHco4b4PcnPb8TXHFyMX7A/h/9c+Dqf+2kXa9l6EjBjbFviO+oRxuuvYr7egb45BFlfaA1m+9is1xx9LKH98g1LQI1KW1k7LA+FowZnIMOAxyNDtKTm51grkGzSQhpdrw6yTjofxJcWbuyu317Q8aZ2SPlnHX6bna/SuS+0fwBXKbbRazbCfAGYD+7iOvbpDM71nkdXtzlRulzfVjHyZEvh/zeEZFaVMzla7p99ERu3cr2b9/WHCDyhr4pmIRffU7VWL4R9RVssy5LrFSuAeYLLr2Be0om9cx34FGa32NeS61Gr1+Qtyz8UE17Gfj7n+zVCY+PyoTAA5uHr63/8wr1SelqPraCBZOSsUj5ykePE1ZXk/pxTyGcBlObvW2j7+NDQ0NDQ0NDQ0NDQ0NDQGDv4XrTDr1f+jEDEAAAAASUVORK5CYII=';

var PBI_REGISTERED_RESOURCES_DIR = `${PBI_ROOT}/${PBI_PROJECT_NAME}.Report/StaticResources/RegisteredResources`;

var PBI_REGISTERED_IMAGES = [
    { itemName: 'brand-icon.png', base64: BRAND_ICON_PNG_BASE64 },
    { itemName: 'brand-text.png', base64: BRAND_TEXT_PNG_BASE64 }
];

function isRegisteredImagePath(path) {
    return typeof path === 'string' &&
        path.startsWith(`${PBI_REGISTERED_RESOURCES_DIR}/`) &&
        /\.png$/i.test(path);
}

