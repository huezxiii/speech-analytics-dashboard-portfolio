// check-weighted-measures.js
//
// Structural gate: validates that weighted measures in CALLS_MEASURES
// correctly implement duration-weighted ratios and comply with EXT-02.
//
// Why this is separate from check-powerbi-freshness.js (D-04):
// check-powerbi-freshness.js answers whether the tracked tree matches the generator.
// check-weighted-measures.js answers whether the measures still have the shape
// EXT-02 asked for. A fresh tree full of wrong measures is a different failure
// from a right measure that was never regenerated, and mixing freshness byte-diffing
// with measure semantics destroys the one-gate-per-requirement-family precedent (D-04).
//
// Deliberate simplification vs check-date-dimension.js:
// This gate does NOT read the fact CSV and does NOT generate the file map.
// Both assertions inspect only registry DAX text; they never touch TMDL or visual
// JSON files, so loading the CSV would be pointless latency.
//
// The two checks it runs (D-04):
//   1. Every measure in PBI_WEIGHTED_MEASURE_SPECS carries exactly the expression
//      buildWeightedRatioDax produces for it (assertWeightedRatioShapeOnWeightedMeasures)
//   2. No row-average of the pre-computed silence percentage survives anywhere in
//      the measure registry or calculated columns (assertNoRowAveragedSilencePctSurvives)
//
// Caveat:
// A green check:weighted run proves the generator emits DAX that says the right thing.
// It is NOT evidence that the DAX computes the right number — Node emits DAX and
// cannot evaluate it. Numeric proof lives in uat-32-weighted-divergence.js (Node reference
// arithmetic showing the two methods differ) and uat-32-weighted-spotcheck.md (hand-filled
// against real Power BI Desktop output).
//
// Usage: node check-weighted-measures.js (or npm run check:weighted)
//   Exit 0 - check:weighted PASS: ...
//   Exit 1 - check:weighted FAIL: ...
//
// Not wired into any git hook or CI step.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;

function unparse(input) {
    const fields = input.fields;
    const dataRows = input.data.map(function (cells) {
        return cells.map(function (v) {
            const s = String(v);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(',');
    });
    return [fields.join(',')].concat(dataRows).join('\r\n');
}

function main() {
    const sandbox = { console, crypto, Papa: { unparse: unparse } };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'powerbi.js'), 'utf8'), sandbox);

    const assertionNames = [
        'assertWeightedRatioShapeOnWeightedMeasures',
        'assertNoRowAveragedSilencePctSurvives'
    ];

    for (const name of assertionNames) {
        if (typeof sandbox[name] !== 'function') {
            console.error(`check:weighted FAIL: assertion '${name}' not found on sandbox global — check it is declared as a function/var, not const`);
            process.exit(1);
        }
    }

    try {
        sandbox.assertWeightedRatioShapeOnWeightedMeasures();
        sandbox.assertNoRowAveragedSilencePctSurvives();
    } catch (err) {
        console.error(`check:weighted FAIL: ${err && err.message ? err.message : err}`);
        if (err && err.stack && !err.message) {
            console.error(err.stack);
        }
        process.exit(1);
    }

    console.log('check:weighted PASS: all 2 weighted measure structural assertions clean (duration-weighted ratio shape on allowlist, no surviving row-averaged silence)');
    process.exit(0);
}

main();
