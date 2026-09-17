// check-pop-measures.js
//
// Structural gate: validates that period-over-period delta measures in CALLS_MEASURES
// correctly consume the date dimension and comply with DATE-02 and DATE-05.
//
// Why this is separate from check-date-dimension.js:
// check-date-dimension.js answers whether DateTable is structurally sound
// (marked, whole calendar years, joined, unorphaned). check-pop-measures.js answers
// whether the delta measures use it correctly (prior window resolved through DateTable,
// whole-dataset ALL('Calls') baseline eliminated, no fact-table date derivations,
// and DATE-05 partial-period clamp present). Keeping the gates separate ensures
// structural model errors and measure logic errors never blur together (D-13).
//
// Deliberate simplification vs check-date-dimension.js:
// This gate does NOT read dashboard-ready.csv and does NOT call buildPowerBIFileMap.
// The four D-14 assertions inspect only CALLS_MEASURES DAX text; they never touch
// TMDL or visual JSON files, so loading the CSV would be pointless latency.
//
// The four checks it runs (D-14):
//   1. No surviving ALL('Calls') baseline in any delta measure (DATE-02)
//   2. Every delta measure references DateTable[Date]
//   3. No fact-table date derivation outside the sanctioned anchor CALCULATE(MAX('Calls'[Call_Date]), ALL('Calls'))
//   4. DATE-05 partial-period clamp MIN(MAX('DateTable'[Date]), _lastDataDate) present in all seven deltas
//
// Caveat (D-15):
// A green check:pop run proves the generator emits DAX that says the right thing.
// It is NOT evidence that the DAX computes the right number — Node emits DAX and
// cannot evaluate it. Numeric proof lives in uat-31-pop-spotcheck.md, hand-filled
// against real Power BI Desktop output.
//
// Usage: node check-pop-measures.js (or npm run check:pop)
//   Exit 0 - check:pop PASS: ...
//   Exit 1 - check:pop FAIL: ...
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
        'assertNoAllCallsBaselineInDeltaMeasures',
        'assertEveryDeltaMeasureReferencesDateTable',
        'assertNoFactTableDateDerivationInDeltaMeasures',
        'assertPartialPeriodClampInEveryDeltaMeasure'
    ];

    for (const name of assertionNames) {
        if (typeof sandbox[name] !== 'function') {
            console.error(`check:pop FAIL: assertion '${name}' not found on sandbox global — check it is declared as a function/var, not const (D-13)`);
            process.exit(1);
        }
    }

    try {
        sandbox.assertNoAllCallsBaselineInDeltaMeasures();
        sandbox.assertEveryDeltaMeasureReferencesDateTable();
        sandbox.assertNoFactTableDateDerivationInDeltaMeasures();
        sandbox.assertPartialPeriodClampInEveryDeltaMeasure();
    } catch (err) {
        console.error(`check:pop FAIL: ${err && err.message ? err.message : err}`);
        if (err && err.stack && !err.message) {
            console.error(err.stack);
        }
        process.exit(1);
    }

    console.log('check:pop PASS: all 4 period-over-period structural assertions clean (no ALL baseline, DateTable reference, no fact-table date derivation, partial-period clamp)');
    process.exit(0);
}

main();
