// check-target-lines.js
//
// Structural gate: validates target reference lines, disclosures, and export mode
// across generated visuals and model artifacts (TGT-01, TGT-02, TGT-03, EXT-03).
//
// Covered groups:
//   1. targets: validates target line properties against PBI_TARGET_LINES registry (assertTargetLinesMatchRegistry)
//   2. desktop-shape: validates the QA target line's key/selector/property shape against the
//      Power BI Desktop-authored fixture (checkDesktopReferenceLineShape, G-36-4)
//   3. disclosures: validates target disclosures in visual titles and README (assertTargetDisclosuresArePresent)
//   4. regression: validates truncated axes disclosure, floor-vs-plotted-data safety, field references, renderability, and builder data-independence
//   5. export: validates export mode disclosure across full and filtered packages (assertExportModeIsDisclosed)
//
// Usage: node check-target-lines.js (or npm run check:target)
//   Exit 0 - check:target PASS
//   Exit 1 - check:target FAIL
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

// checkDesktopReferenceLineShape(sandbox, fileMap, fixture)
// Fixture-bound gate (G-36-4): re-compares the generator's Desktop-shaped QA target line
// against uat-36-desktop-shapes-fixture.json#/referenceLine on every run, so the generator's
// shape cannot drift back to a guess even if PBI_TARGET_LINE_DESKTOP_SHAPE is edited without
// re-checking it against the committed Desktop evidence.
function checkDesktopReferenceLineShape(sandbox, fileMap, fixture) {
    const shape = sandbox.PBI_TARGET_LINE_DESKTOP_SHAPE;
    if (!shape || typeof shape.objectKey !== 'string') {
        throw new Error('checkDesktopReferenceLineShape: sandbox.PBI_TARGET_LINE_DESKTOP_SHAPE.objectKey missing');
    }
    if (!fixture || !fixture.referenceLine || typeof fixture.referenceLine.objectKey !== 'string') {
        throw new Error('checkDesktopReferenceLineShape: fixture.referenceLine.objectKey missing');
    }

    // (a) the generator's objectKey must equal the fixture's captured objectKey
    if (shape.objectKey !== fixture.referenceLine.objectKey) {
        throw new Error(`checkDesktopReferenceLineShape: sandbox objectKey '${shape.objectKey}' does not match fixture objectKey '${fixture.referenceLine.objectKey}'`);
    }

    // (b) locate the barQueueBreakdown visual, same lookup the regression group uses
    const slot = (sandbox.PBI_OPS_LAYOUT || []).find(s => s.key === 'barQueueBreakdown');
    if (!slot) {
        throw new Error('checkDesktopReferenceLineShape: barQueueBreakdown slot not found in PBI_OPS_LAYOUT');
    }
    const page = (sandbox.PBI_PAGES || []).find(p => (p.layout || []).some(s => s.key === 'barQueueBreakdown'));
    if (!page) {
        throw new Error('checkDesktopReferenceLineShape: page containing barQueueBreakdown not found in PBI_PAGES');
    }
    const visualPath = `${sandbox.PBI_ROOT}/${sandbox.PBI_PROJECT_NAME}.Report/definition/pages/${page.id}/visuals/${slot.id}/visual.json`;
    const content = fileMap[visualPath];
    if (!content) {
        throw new Error(`checkDesktopReferenceLineShape: visual.json not found at ${visualPath}`);
    }
    const visualObj = JSON.parse(content);
    const objects = (visualObj.visual && visualObj.visual.objects) || {};
    const emitted = objects[shape.objectKey];
    if (!Array.isArray(emitted) || emitted.length === 0) {
        throw new Error(`checkDesktopReferenceLineShape: barQueueBreakdown visual.json missing objects.${shape.objectKey}`);
    }
    if (shape.objectKey !== 'referenceLine' && Array.isArray(objects.referenceLine) && objects.referenceLine.length > 0) {
        throw new Error('checkDesktopReferenceLineShape: barQueueBreakdown visual.json still carries the legacy guessed objects.referenceLine key (G-36-4)');
    }

    // (c) the fixture's own leaves must prove this is the line the developer actually drew
    const fixtureTemplate = fixture.referenceLine.capturedObject;
    const fixtureValueLeaf = sandbox.getJsonLeaf(fixtureTemplate, shape.valueLeafPath);
    if (typeof fixtureValueLeaf !== 'string' || !fixtureValueLeaf.startsWith('85')) {
        throw new Error(`checkDesktopReferenceLineShape: fixture value leaf '${fixtureValueLeaf}' does not start with '85'`);
    }
    const fixtureLabelLeaf = sandbox.getJsonLeaf(fixtureTemplate, shape.labelLeafPath);
    if (typeof fixtureLabelLeaf !== 'string' || !fixtureLabelLeaf.includes('QA target 85 of 100')) {
        throw new Error(`checkDesktopReferenceLineShape: fixture label leaf '${fixtureLabelLeaf}' does not contain 'QA target 85 of 100'`);
    }

    // (d) the emitted array, with both leaves blanked, must serialize identically to the fixture's
    // capturedObject with the same leaves blanked -- proves selector + property set + defaults match
    const blankedEmitted = JSON.parse(JSON.stringify(emitted));
    sandbox.setJsonLeaf(blankedEmitted, shape.valueLeafPath, null);
    sandbox.setJsonLeaf(blankedEmitted, shape.labelLeafPath, null);
    const blankedFixture = JSON.parse(JSON.stringify(fixtureTemplate));
    sandbox.setJsonLeaf(blankedFixture, shape.valueLeafPath, null);
    sandbox.setJsonLeaf(blankedFixture, shape.labelLeafPath, null);
    if (JSON.stringify(blankedEmitted) !== JSON.stringify(blankedFixture)) {
        throw new Error('checkDesktopReferenceLineShape: emitted shape (selector/property set) does not match the fixture capturedObject');
    }

    // (e) the emitted leaves must equal the registry's value and label encodings
    const registryEntry = (sandbox.PBI_TARGET_LINES || []).find(t => t.slotKey === 'barQueueBreakdown');
    if (!registryEntry) {
        throw new Error("checkDesktopReferenceLineShape: PBI_TARGET_LINES has no entry for slotKey 'barQueueBreakdown'");
    }
    const expectedValueLeaf = String(registryEntry.value) + shape.valueSuffix;
    const emittedValueLeaf = sandbox.getJsonLeaf(emitted, shape.valueLeafPath);
    if (emittedValueLeaf !== expectedValueLeaf) {
        throw new Error(`checkDesktopReferenceLineShape: emitted value leaf '${emittedValueLeaf}' does not match registry-encoded '${expectedValueLeaf}'`);
    }
    const expectedLabelLeaf = shape.labelQuote + registryEntry.label + shape.labelQuote;
    const emittedLabelLeaf = sandbox.getJsonLeaf(emitted, shape.labelLeafPath);
    if (emittedLabelLeaf !== expectedLabelLeaf) {
        throw new Error(`checkDesktopReferenceLineShape: emitted label leaf '${emittedLabelLeaf}' does not match registry-encoded '${expectedLabelLeaf}'`);
    }

    return true;
}

function main() {
    const csvPath = path.join(ROOT, 'dashboard-ready.csv');
    if (!fs.existsSync(csvPath)) {
        console.error('check:target FAIL: dashboard-ready.csv not found');
        process.exit(1);
    }
    const csv = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCsv(csv);

    const sandbox = { console, crypto, Papa: { unparse: unparse } };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'powerbi.js'), 'utf8'), sandbox);

    let fileMapFull = null;
    try {
        fileMapFull = sandbox.buildPowerBIFileMap(rows);
    } catch (err) {
        console.error(`check:target FAIL: buildPowerBIFileMap(rows) threw: ${err && err.message ? err.message : err}`);
        process.exit(1);
    }

    let fileMapFiltered = null;
    try {
        if (typeof sandbox.buildPowerBIFileMap === 'function') {
            fileMapFiltered = sandbox.buildPowerBIFileMap(rows, 'filtered');
        }
    } catch (err) {
        // Handled gracefully in export group
    }

    let hasFailure = false;

    // ------------------------------------------------------------------------
    // Group 1: targets
    // ------------------------------------------------------------------------
    if (typeof sandbox.assertTargetLinesMatchRegistry !== 'function') {
        console.log("check:target[targets] FAIL: assertion 'assertTargetLinesMatchRegistry' not found on sandbox global — check it is declared as a function/var, not const");
        hasFailure = true;
    } else {
        try {
            sandbox.assertTargetLinesMatchRegistry(fileMapFull);
            console.log('check:target[targets] PASS');
        } catch (err) {
            console.log(`check:target[targets] FAIL: ${err && err.message ? err.message : err}`);
            hasFailure = true;
        }
    }

    // ------------------------------------------------------------------------
    // Group 2: desktop-shape (G-36-4)
    // ------------------------------------------------------------------------
    try {
        const { loadValidatedFixture } = require('./uat-36-desktop-shapes-capture.js');
        const fixture = loadValidatedFixture(ROOT);
        checkDesktopReferenceLineShape(sandbox, fileMapFull, fixture);
        console.log('check:target[desktop-shape] PASS');
    } catch (err) {
        console.log(`check:target[desktop-shape] FAIL: ${err && err.message ? err.message : err}`);
        hasFailure = true;
    }

    // ------------------------------------------------------------------------
    // Group 3: disclosures
    // ------------------------------------------------------------------------
    if (typeof sandbox.assertTargetDisclosuresArePresent !== 'function') {
        console.log("check:target[disclosures] FAIL: assertion 'assertTargetDisclosuresArePresent' not found on sandbox global — check it is declared as a function/var, not const");
        hasFailure = true;
    } else {
        try {
            sandbox.assertTargetDisclosuresArePresent(fileMapFull);
            console.log('check:target[disclosures] PASS');
        } catch (err) {
            console.log(`check:target[disclosures] FAIL: ${err && err.message ? err.message : err}`);
            hasFailure = true;
        }
    }

    // ------------------------------------------------------------------------
    // Group 4: regression
    // ------------------------------------------------------------------------
    const regressionAssertions = [
        'assertTruncatedAxesAreDisclosed',
        'assertAxisFloorsSitBelowPlottedData',
        'assertFieldReferencesResolve',
        'assertAllPageLayoutsAreRenderable',
        'buildBarChartJson'
    ];
    let regressionMissing = null;
    for (const name of regressionAssertions) {
        if (typeof sandbox[name] !== 'function') {
            regressionMissing = name;
            break;
        }
    }

    if (regressionMissing) {
        console.log(`check:target[regression] FAIL: assertion '${regressionMissing}' not found on sandbox global — check it is declared as a function/var, not const`);
        hasFailure = true;
    } else {
        try {
            sandbox.assertTruncatedAxesAreDisclosed(fileMapFull);
            sandbox.assertAxisFloorsSitBelowPlottedData(fileMapFull, rows);
            if (fileMapFiltered) {
                sandbox.assertAxisFloorsSitBelowPlottedData(fileMapFiltered, rows);
            }
            sandbox.assertFieldReferencesResolve(fileMapFull);
            sandbox.assertAllPageLayoutsAreRenderable(fileMapFull);

            // Local data-independence check for barQueueBreakdown slot
            const slot = (sandbox.PBI_OPS_LAYOUT || []).find(s => s.key === 'barQueueBreakdown');
            if (!slot) {
                throw new Error("barQueueBreakdown slot not found in PBI_OPS_LAYOUT");
            }
            if (sandbox.buildBarChartJson.length !== 1) {
                throw new Error(`buildBarChartJson arity is ${sandbox.buildBarChartJson.length}, expected 1`);
            }
            const directRaw = sandbox.buildBarChartJson(slot);
            const directVisualJson = typeof directRaw === 'string' ? JSON.parse(directRaw) : directRaw;

            const page = (sandbox.PBI_PAGES || []).find(p => (p.layout || []).some(s => s.key === 'barQueueBreakdown'));
            if (!page) {
                throw new Error("page containing barQueueBreakdown not found in PBI_PAGES");
            }
            const visualPath = `${sandbox.PBI_ROOT}/${sandbox.PBI_PROJECT_NAME}.Report/definition/pages/${page.id}/visuals/${slot.id}/visual.json`;
            const emittedContent = fileMapFull[visualPath];
            if (!emittedContent) {
                throw new Error(`visual.json not found at ${visualPath}`);
            }
            const emittedVisualJson = JSON.parse(emittedContent);
            const refLineShape = sandbox.PBI_TARGET_LINE_DESKTOP_SHAPE;
            const directRefLine = directVisualJson.visual && directVisualJson.visual.objects && directVisualJson.visual.objects[refLineShape.objectKey];
            const emittedRefLine = emittedVisualJson.visual && emittedVisualJson.visual.objects && emittedVisualJson.visual.objects[refLineShape.objectKey];

            if (typeof directRefLine === 'undefined' || typeof emittedRefLine === 'undefined') {
                throw new Error(`Direct or emitted visual.json is missing objects.${refLineShape.objectKey} (regression comparison would otherwise pass vacuously)`);
            }
            if (JSON.stringify(directRefLine) !== JSON.stringify(emittedRefLine)) {
                throw new Error(`Direct buildBarChartJson ${refLineShape.objectKey} does not match emitted visual.json ${refLineShape.objectKey}`);
            }

            console.log('check:target[regression] PASS');
        } catch (err) {
            console.log(`check:target[regression] FAIL: ${err && err.message ? err.message : err}`);
            hasFailure = true;
        }
    }

    // ------------------------------------------------------------------------
    // Group 5: export
    // ------------------------------------------------------------------------
    if (typeof sandbox.assertExportModeIsDisclosed !== 'function') {
        console.log("check:target[export] FAIL: assertion 'assertExportModeIsDisclosed' not found on sandbox global — check it is declared as a function/var, not const");
        hasFailure = true;
    } else {
        try {
            sandbox.assertExportModeIsDisclosed(fileMapFull, 'full', rows.length);
            if (!fileMapFiltered) {
                throw new Error("fileMapFiltered could not be built with mode 'filtered'");
            }
            sandbox.assertExportModeIsDisclosed(fileMapFiltered, 'filtered', rows.length);
            console.log('check:target[export] PASS');
        } catch (err) {
            console.log(`check:target[export] FAIL: ${err && err.message ? err.message : err}`);
            hasFailure = true;
        }
    }

    if (hasFailure) {
        process.exit(1);
    }

    console.log('check:target PASS');
    process.exit(0);
}

if (require.main === module) {
    main();
}

module.exports = { checkDesktopReferenceLineShape };
