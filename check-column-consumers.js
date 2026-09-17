// check-column-consumers.js
//
// Structural gate: validates that every Calls table column is in exactly one deliberate state,
// satisfying MODEL-08 and Phase 32 decisions D-11 and D-12:
//   Claim 1: Every visible column (isHidden: false) is referenced by at least one measure,
//            calculated column, relationship endpoint, M expression, sort-by reference,
//            or visual binding — or carries a declared forward reference of the fixed form
//            "reserved for <REQ-ID>, Phase <N>" whose phase heading exists in .planning/ROADMAP.md.
//   Claim 2: Every hidden column (isHidden: true) carries a recorded reason in the model
//            (description string) explaining why it is hidden.
//
// Why this gate loads dashboard-ready.csv and calls buildPowerBIFileMap:
// Claim 1 builds a 6-source reference index across generated visual JSON, measure DAX,
// calculated-column DAX, relationship endpoints, Power Query M expressions, and sort-by
// references. At least one column reference (Agent_ID) is hardcoded inside buildScatterChartJson
// rather than declared in any layout registry; walking generated visual JSON ensures that
// hardcoded visual references are correctly indexed and never reported as false orphans.
//
// Why this is a separate script from check-weighted-measures.js:
// Follows the one-gate-per-requirement-family precedent (check:date for date dimension,
// check:pop for DATE-02/05, check:weighted for EXT-02, check:columns for MODEL-08).
// Keeps MODEL-08 and EXT-02 failure diagnostics distinct, and confines the .planning/ROADMAP.md
// filesystem read to this gate without adding unrelated dependencies to check-weighted-measures.js.
//
// Usage: node check-column-consumers.js (or npm run check:columns)
//   Exit 0 - check:columns PASS: ...
//   Exit 1 - check:columns FAIL: ...
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
    const roadmapPath = path.join(ROOT, '.planning', 'ROADMAP.md');
    if (!fs.existsSync(roadmapPath)) {
        console.error('check:columns FAIL: .planning/ROADMAP.md not found — forward-reference escape hatch cannot be validated without the project roadmap');
        process.exit(1);
    }
    const roadmapText = fs.readFileSync(roadmapPath, 'utf8');
    if (!roadmapText || roadmapText.trim().length === 0) {
        console.error('check:columns FAIL: .planning/ROADMAP.md is empty — forward-reference escape hatch cannot be validated without the project roadmap');
        process.exit(1);
    }

    const csvPath = path.join(ROOT, 'dashboard-ready.csv');
    if (!fs.existsSync(csvPath)) {
        console.error('check:columns FAIL: dashboard-ready.csv not found');
        process.exit(1);
    }
    const csv = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCsv(csv);

    const sandbox = { console, crypto, Papa: { unparse: unparse } };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'powerbi.js'), 'utf8'), sandbox);

    const assertionNames = [
        'assertEveryVisibleCallsColumnHasAConsumer',
        'assertEveryHiddenCallsColumnHasARecordedReason'
    ];

    for (const name of assertionNames) {
        if (typeof sandbox[name] !== 'function') {
            console.error(`check:columns FAIL: assertion '${name}' not found on sandbox global — check it is declared as a function/var, not const (D-11)`);
            process.exit(1);
        }
    }

    try {
        const fileMap = sandbox.buildPowerBIFileMap(rows);
        sandbox.assertEveryVisibleCallsColumnHasAConsumer(fileMap, roadmapText);
        sandbox.assertEveryHiddenCallsColumnHasARecordedReason();

        const allColumns = (sandbox.COLUMN_MANIFEST || []).concat(
            sandbox.CALLS_CALCULATED_COLUMNS || [],
            sandbox.CALLS_DERIVED_COLUMNS || []
        );

        console.log(`check:columns PASS: all ${allColumns.length} Calls columns in deliberate states (visible columns consumed or forward-referenced to roadmap; hidden columns have recorded reasons in model)`);
        process.exit(0);
    } catch (err) {
        console.error(`check:columns FAIL: ${err && err.message ? err.message : err}`);
        if (err && err.stack && !err.message) {
            console.error(err.stack);
        }
        process.exit(1);
    }
}

main();
