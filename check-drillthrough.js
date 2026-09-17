// check-drillthrough.js
//
// Structural gate: validates drill-through target page declaration, field bindings,
// table visual projection contract, source visual eligibility, page-level field resolution,
// and single-sourced PII exposure disclosure (DRILL-01, DRILL-02, DRILL-04).
//
// Covered assertions:
//   1. D-15(a) target page.json carries drill-through pageBinding and filterConfig with exactly
//      one parameter and filter per declared field in PBI_DRILL_FIELDS (assertDrillthroughPageBindsDeclaredFields)
//   2. D-15(b) Call Detail table visual binds all columns in PBI_CALL_DETAIL_COLUMNS in strict D-10 order
//      with zero Measure references (assertTableVisualBindsAllDrillColumnsInOrder)
//   3. D-15(c) RESTATED: PBIR has no drill-source registration key in visualContainer/2.9.0 schema.
//      Eligibility is determined at click-time by field projection. Assertion verifies every visual in
//      PBI_DRILL_SOURCE_VISUALS projects at least one field from PBI_DRILL_FIELDS
//      (assertSourceVisualsProjectDeclaredDrillFields)
//   4. 33-RESEARCH.md Pitfall 2: page-level field expressions in pageBinding and filterConfig resolve against
//      COLUMN_MANIFEST and model tables (assertPageLevelFieldReferencesResolve)
//   5. DRILL-04 / D-03: single-sourced PII exposure disclosure statement on canvas and in README
//      (assertPiiExposureStatementIsSingleSourced)
//
// Usage: node check-drillthrough.js (or npm run check:drill)
//   Exit 0 - check:drill PASS: ...
//   Exit 1 - check:drill FAIL: ...
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
        console.error('check:drill FAIL: dashboard-ready.csv not found');
        process.exit(1);
    }
    const csv = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCsv(csv);

    const sandbox = { console, crypto, Papa: { unparse: unparse } };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'powerbi.js'), 'utf8'), sandbox);

    const assertionNames = [
        'assertDrillthroughPageBindsDeclaredFields',
        'assertTableVisualBindsAllDrillColumnsInOrder',
        'assertSourceVisualsProjectDeclaredDrillFields',
        'assertPageLevelFieldReferencesResolve',
        'assertPiiExposureStatementIsSingleSourced'
    ];

    for (const name of assertionNames) {
        if (typeof sandbox[name] !== 'function') {
            console.error(`check:drill FAIL: assertion '${name}' not found on sandbox global — check it is declared as a function/var, not const`);
            process.exit(1);
        }
    }

    try {
        const fileMap = sandbox.buildPowerBIFileMap(rows);
        sandbox.assertDrillthroughPageBindsDeclaredFields(fileMap);
        sandbox.assertTableVisualBindsAllDrillColumnsInOrder(fileMap);
        sandbox.assertSourceVisualsProjectDeclaredDrillFields(fileMap);
        sandbox.assertPageLevelFieldReferencesResolve(fileMap);
        sandbox.assertPiiExposureStatementIsSingleSourced(fileMap);

        const drillFieldsCount = (sandbox.PBI_DRILL_FIELDS || []).length;
        const columnsCount = (sandbox.PBI_CALL_DETAIL_COLUMNS || []).length;
        const sourceVisualsCount = (sandbox.PBI_DRILL_SOURCE_VISUALS || []).length;

        const pageRegex = /^powerbi\/.*\.Report\/definition\/pages\/[0-9a-f]{20}\/page\.json$/;
        let pageRefsCount = 0;
        for (const k of Object.keys(fileMap)) {
            if (pageRegex.test(k)) {
                const pj = JSON.parse(fileMap[k]);
                const refs = [];
                if (pj.pageBinding) sandbox.collectFieldReferences(pj.pageBinding, refs);
                if (pj.filterConfig) sandbox.collectFieldReferences(pj.filterConfig, refs);
                pageRefsCount += refs.length;
            }
        }

        console.log(`check:drill PASS: all 5 drill-through structural assertions clean (${drillFieldsCount} declared drill fields bound, ${columnsCount} table columns verified in order, ${sourceVisualsCount} source visuals checked, ${pageRefsCount} page-level field references resolved, PII disclosure single-sourced)`);
        process.exit(0);
    } catch (err) {
        console.error(`check:drill FAIL: ${err && err.message ? err.message : err}`);
        if (err && err.stack && !err.message) {
            console.error(err.stack);
        }
        process.exit(1);
    }
}

main();
