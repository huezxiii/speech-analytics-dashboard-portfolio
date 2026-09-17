// check-date-dimension.js
//
// VERIF-01 structural gate: validates the date dimension and its relationship
// in the Power BI deliverable in-memory model.
//
// Reads the generator's own in-memory model rather than the on-disk `powerbi/`
// tree, because the on-disk tree is covered separately by VERIF-02's byte diff
// and the two gates are designed to compose without overlapping (D-14).
//
// The four checks it runs:
//   1. Date-table marking (table dataCategory: Time and column Date isKey per D-09, D-10, D-11)
//   2. Full-calendar-year span (CALENDAR() bounds DATE(YEAR(MIN()),1,1) .. DATE(YEAR(MAX()),12,31) per D-08)
//   3. Relationship key and cardinality (Calls.Call_Date -> DateTable.Date, manyToOne, single filtering per D-01, D-02, D-03)
//   4. Orphaned model or report references (no visual references nonexistent columns per D-15)
//
// Why this exists:
// A half-marked date table or a relationship keyed on the fact table's raw
// datetime column makes Phase 31's time-intelligence measures return a plausible
// but wrong number instead of an error, which no amount of inspection catches.
//
// Usage: node check-date-dimension.js
//   Exit 0 - VERIF-01 PASS: ...
//   Exit 1 - VERIF-01 FAIL: ...
//
// Not wired into any git hook or CI step (this project has neither yet).
// Run manually before shipping/opening the .pbip, or via `npm run check:date`.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;

function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    const headers = lines[0].split(',');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        let inQuotes = false;
        let token = '';
        const cells = [];
        for (let j = 0; j < line.length; j++) {
            const ch = line[j];
            if (ch === '"') {
                inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) {
                cells.push(token);
                token = '';
            } else {
                cells.push(token);
            }
        }
        cells.push(token);
        const obj = {};
        for (let j = 0; j < headers.length; j++) {
            obj[headers[j]] = cells[j];
        }
        rows.push(obj);
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
        console.error('VERIF-01 FAIL: dashboard-ready.csv not found at repo root');
        process.exit(1);
    }
    const csv = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCsv(csv);

    const sandbox = { console, crypto, Papa: { unparse: unparse } };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'powerbi.js'), 'utf8'), sandbox);

    const assertionNames = [
        'assertDateTableIsMarked',
        'assertCalendarSpanIsFullYear',
        'assertDateRelationshipKeyAndCardinality',
        'assertNoOrphanedModelOrReportReferences'
    ];

    for (const name of assertionNames) {
        if (typeof sandbox[name] !== 'function') {
            console.error(`VERIF-01 FAIL: assertion '${name}' not found on sandbox global — check it is declared as a function/var, not const (D-14)`);
            process.exit(1);
        }
    }

    const fileMap = sandbox.buildPowerBIFileMap(rows);

    try {
        sandbox.assertDateTableIsMarked(fileMap);
        sandbox.assertCalendarSpanIsFullYear(fileMap);
        sandbox.assertDateRelationshipKeyAndCardinality(fileMap);
        sandbox.assertNoOrphanedModelOrReportReferences(fileMap);
    } catch (err) {
        console.error(`VERIF-01 FAIL: ${err && err.message ? err.message : err}`);
        if (err && err.stack && !err.message) {
            console.error(err.stack);
        }
        process.exit(1);
    }

    console.log('VERIF-01 PASS: date-table marking, full-calendar-year span, relationship key/cardinality, orphaned model/report references clean');
    process.exit(0);
}

main();
