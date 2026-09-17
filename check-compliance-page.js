// check-compliance-page.js
//
// Structural gate: validates non-duplication signature on Compliance & Coaching page,
// line chart field bindings, and logical id uniqueness (EXT-01, success criterion 3).
//
// Covered assertions:
//   1. Phase 34 Plan 34-05: No visual on the Compliance & Coaching page references both the
//      column Agent_ID and the measure Avg QA Score (assertNoAgentQaDuplicateSignature)
//   2. Phase 34 Plan 34-01: Every line-chart-kind slot binds its declared slot.column and
//      slot.measure (assertLineChartSlotsBindDeclaredFields)
//   3. Phase 34 Plan 34-03: Every page id and slot id across all layout registries is unique
//      (assertLogicalIdsAreUnique)
//
// Usage: node check-compliance-page.js (or npm run check:compliance)
//   Exit 0 - check:compliance PASS: ...
//   Exit 1 - check:compliance FAIL: ...
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
        console.error('check:compliance FAIL: dashboard-ready.csv not found');
        process.exit(1);
    }
    const csv = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCsv(csv);

    const sandbox = { console, crypto, Papa: { unparse: unparse } };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'powerbi.js'), 'utf8'), sandbox);

    const assertionNames = [
        'assertNoAgentQaDuplicateSignature',
        'assertLineChartSlotsBindDeclaredFields',
        'assertLogicalIdsAreUnique'
    ];

    for (const name of assertionNames) {
        if (typeof sandbox[name] !== 'function') {
            console.error(`check:compliance FAIL: assertion '${name}' not found on sandbox global — check it is declared as a function/var, not const`);
            process.exit(1);
        }
    }

    try {
        const fileMap = sandbox.buildPowerBIFileMap(rows);
        const inspectedComplianceVisuals = sandbox.assertNoAgentQaDuplicateSignature(fileMap);
        const lineSlotsChecked = sandbox.assertLineChartSlotsBindDeclaredFields(fileMap);
        const distinctIdsChecked = sandbox.assertLogicalIdsAreUnique();

        console.log(`check:compliance PASS: all 3 compliance structural assertions clean (${inspectedComplianceVisuals} compliance visuals inspected without Agent_ID+Avg QA Score duplicate, ${lineSlotsChecked} line chart slots verified, ${distinctIdsChecked} logical ids confirmed unique)`);
        process.exit(0);
    } catch (err) {
        console.error(`check:compliance FAIL: ${err && err.message ? err.message : err}`);
        if (err && err.stack && !err.message) {
            console.error(err.stack);
        }
        process.exit(1);
    }
}

main();
