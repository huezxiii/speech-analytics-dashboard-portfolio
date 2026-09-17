// check-narrative-titles.js
//
// Structural gate: validates dynamic narrative titles, zero-row guards,
// and title regression invariants (NARR-01, NARR-02, NARR-03, D-11, D-12, D-13, D-14, D-15).
//
// Covered groups:
//   1. binding: validates headline visuals bind title measures while other visuals retain literal titles (assertNarrativeTitlesBindMeasures)
//   2. guard: validates title measures contain required zero-row and blank guards (assertTitleMeasuresHaveZeroRowGuard)
//   3. regression: validates axis-floor subtitle disclosures survive and title measures resolve (assertTruncatedAxesAreDisclosed, assertFieldReferencesResolve)
//
// Usage: node check-narrative-titles.js (or npm run check:narrative)
//   Exit 0 - check:narrative PASS
//   Exit 1 - check:narrative FAIL
//
// Not wired into any git hook or CI step.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;

function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(line => line.length > 0);
    if (lines.length === 0) return [];
    const header = lines[0].split(',');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const row = {};
        for (let j = 0; j < header.length; j++) {
            row[header[j]] = values[j] !== undefined ? values[j] : '';
        }
        rows.push(row);
    }
    return rows;
}

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
    const csvPath = path.join(ROOT, 'dashboard-ready.csv');
    if (!fs.existsSync(csvPath)) {
        console.error('check:narrative FAIL: dashboard-ready.csv not found');
        process.exit(1);
    }
    const csv = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCsv(csv);

    const sandbox = { console, crypto, Papa: { unparse: unparse } };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'powerbi.js'), 'utf8'), sandbox);

    let fileMap = null;
    try {
        fileMap = sandbox.buildPowerBIFileMap(rows);
    } catch (err) {
        console.error(`check:narrative FAIL: buildPowerBIFileMap(rows) threw: ${err && err.message ? err.message : err}`);
        process.exit(1);
    }

    let hasFailure = false;

    // ------------------------------------------------------------------------
    // Group 1: binding
    // ------------------------------------------------------------------------
    if (typeof sandbox.assertNarrativeTitlesBindMeasures !== 'function') {
        console.log("check:narrative[binding] FAIL: assertion 'assertNarrativeTitlesBindMeasures' not found on sandbox global — check it is declared as a function/var, not const");
        hasFailure = true;
    } else {
        try {
            sandbox.assertNarrativeTitlesBindMeasures(fileMap);
            console.log('check:narrative[binding] PASS');
        } catch (err) {
            console.log(`check:narrative[binding] FAIL: ${err && err.message ? err.message : err}`);
            hasFailure = true;
        }
    }

    // ------------------------------------------------------------------------
    // Group 2: guard
    // ------------------------------------------------------------------------
    if (typeof sandbox.assertTitleMeasuresHaveZeroRowGuard !== 'function') {
        console.log("check:narrative[guard] FAIL: assertion 'assertTitleMeasuresHaveZeroRowGuard' not found on sandbox global — check it is declared as a function/var, not const");
        hasFailure = true;
    } else {
        try {
            sandbox.assertTitleMeasuresHaveZeroRowGuard();
            console.log('check:narrative[guard] PASS');
        } catch (err) {
            console.log(`check:narrative[guard] FAIL: ${err && err.message ? err.message : err}`);
            hasFailure = true;
        }
    }

    // ------------------------------------------------------------------------
    // Group 3: regression
    // ------------------------------------------------------------------------
    const regressionAssertions = [
        'assertTruncatedAxesAreDisclosed',
        'assertFieldReferencesResolve'
    ];
    let regressionMissing = null;
    for (const name of regressionAssertions) {
        if (typeof sandbox[name] !== 'function') {
            regressionMissing = name;
            break;
        }
    }

    if (regressionMissing) {
        console.log(`check:narrative[regression] FAIL: assertion '${regressionMissing}' not found on sandbox global — check it is declared as a function/var, not const`);
        hasFailure = true;
    } else {
        try {
            sandbox.assertTruncatedAxesAreDisclosed(fileMap);
            sandbox.assertFieldReferencesResolve(fileMap);
            console.log('check:narrative[regression] PASS');
        } catch (err) {
            console.log(`check:narrative[regression] FAIL: ${err && err.message ? err.message : err}`);
            hasFailure = true;
        }
    }

    if (hasFailure) {
        process.exit(1);
    }

    console.log('check:narrative PASS');
    process.exit(0);
}

main();
