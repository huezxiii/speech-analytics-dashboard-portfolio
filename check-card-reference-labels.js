// check-card-reference-labels.js
//
// Structural gate: validates that the Executive Hub card caption shape matches Power BI
// Desktop's own captured JSON, closing G-36-8 (VERIF-03).
//
// Covered:
//   checkCardCaptionShape(sandbox, fileMap, fixture) -- re-derives PBI_CARD_CAPTION_DESKTOP_SHAPE
//   from uat-36-desktop-shapes-fixture.json#/cardCaption (bind-caption mode, chosen in
//   plan 36-10) on every run, so the generator's shape cannot drift back to a guess even if
//   PBI_CARD_CAPTION_DESKTOP_SHAPE is edited without re-checking it against the committed
//   Desktop evidence.
//
// Usage: node check-card-reference-labels.js (or npm run check:cards)
//   Exit 0 - check:cards PASS
//   Exit 1 - check:cards FAIL
//
// Not wired into any git hook or CI step.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;

// Quote-aware CSV parse (matches check-target-lines.js / regen-powerbi.js).
function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/).filter(line => line.length > 0);
    if (lines.length === 0) return [];
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
                token += ch;
            }
        }
        cells.push(token);
        const row = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = cells[j] !== undefined ? cells[j] : '';
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

// checkCardCaptionShape(sandbox, fileMap, fixture)
// Fixture-bound gate (G-36-8): re-compares the generator's Desktop-shaped card caption against
// uat-36-desktop-shapes-fixture.json#/cardCaption (or #/captionOff for the fold-into-value
// fallback, not implemented in this plan) on every run.
//   (a) sandbox.PBI_CARD_CAPTION_DESKTOP_SHAPE.source cites the fixture section matching .mode.
//   (b) specialising .changes for the card the capture came from (cardTotalCalls for bind-caption,
//       cardAvgHandleTime for fold-into-value) reproduces that section's changedPaths exactly
//       (paths, values, removed flags).
//   (c) for bind-caption, fixture.cardCaption.boundPath is not null.
//   (d) the emitted visual for that card holds exactly those after-values at those paths.
function checkCardCaptionShape(sandbox, fileMap, fixture) {
    const shape = sandbox.PBI_CARD_CAPTION_DESKTOP_SHAPE;
    if (!shape || typeof shape.mode !== 'string') {
        throw new Error('checkCardCaptionShape: sandbox.PBI_CARD_CAPTION_DESKTOP_SHAPE.mode missing');
    }

    const sectionByMode = { 'bind-caption': 'cardCaption', 'fold-into-value': 'captionOff' };
    const sourceCardByMode = { 'bind-caption': 'cardTotalCalls', 'fold-into-value': 'cardAvgHandleTime' };
    const sourceSectionKey = sectionByMode[shape.mode];
    const sourceCardKey = sourceCardByMode[shape.mode];
    if (!sourceSectionKey) {
        throw new Error(`checkCardCaptionShape: unknown PBI_CARD_CAPTION_DESKTOP_SHAPE.mode '${shape.mode}'`);
    }

    // (a) source cites the matching fixture section
    if (typeof shape.source !== 'string' || shape.source.indexOf(`#/${sourceSectionKey}`) === -1) {
        throw new Error(`checkCardCaptionShape: PBI_CARD_CAPTION_DESKTOP_SHAPE.source does not cite fixture section '#/${sourceSectionKey}'`);
    }

    const sourceSection = fixture[sourceSectionKey];
    if (!sourceSection) {
        throw new Error(`checkCardCaptionShape: fixture.${sourceSectionKey} missing`);
    }

    // (c) bind-caption requires a non-null boundPath
    if (shape.mode === 'bind-caption') {
        if (!Array.isArray(fixture.cardCaption && fixture.cardCaption.boundPath)) {
            throw new Error('checkCardCaptionShape: fixture.cardCaption.boundPath must be a non-null array for mode bind-caption');
        }
    }

    const sourceSlot = (sandbox.PBI_EXEC_LAYOUT || []).find(s => s.key === sourceCardKey);
    if (!sourceSlot) {
        throw new Error(`checkCardCaptionShape: slot '${sourceCardKey}' not found in PBI_EXEC_LAYOUT`);
    }

    // (b) specialising .changes for the source card reproduces the fixture's changedPaths exactly
    const fixtureChangedPaths = sourceSection.changedPaths;
    if (!Array.isArray(fixtureChangedPaths) || fixtureChangedPaths.length === 0) {
        throw new Error(`checkCardCaptionShape: fixture.${sourceSectionKey}.changedPaths missing or empty`);
    }
    if (!Array.isArray(shape.changes) || shape.changes.length !== fixtureChangedPaths.length) {
        throw new Error(`checkCardCaptionShape: PBI_CARD_CAPTION_DESKTOP_SHAPE.changes length (${(shape.changes || []).length}) does not match fixture.${sourceSectionKey}.changedPaths length (${fixtureChangedPaths.length})`);
    }

    for (let i = 0; i < fixtureChangedPaths.length; i++) {
        const fixtureEntry = fixtureChangedPaths[i];
        const codeEntry = shape.changes[i];
        if (JSON.stringify(codeEntry.path) !== JSON.stringify(fixtureEntry.path)) {
            throw new Error(`checkCardCaptionShape: changes[${i}].path '${JSON.stringify(codeEntry.path)}' does not match fixture path '${JSON.stringify(fixtureEntry.path)}'`);
        }
        if (fixtureEntry.removed) {
            if (!codeEntry.removed) {
                throw new Error(`checkCardCaptionShape: changes[${i}] should be marked removed to match the fixture`);
            }
            continue;
        }
        if (codeEntry.removed) {
            throw new Error(`checkCardCaptionShape: changes[${i}] is marked removed but the fixture does not mark it removed`);
        }
        if (typeof sandbox.substituteCardCaptionPlaceholders !== 'function') {
            throw new Error("checkCardCaptionShape: sandbox.substituteCardCaptionPlaceholders not found — check it is declared as a function, not const");
        }
        const specialised = sandbox.substituteCardCaptionPlaceholders(codeEntry.value, sourceSlot);
        if (JSON.stringify(specialised) !== JSON.stringify(fixtureEntry.after)) {
            throw new Error(`checkCardCaptionShape: changes[${i}] specialised for '${sourceCardKey}' does not reproduce fixture.${sourceSectionKey}.changedPaths[${i}].after exactly`);
        }
    }

    // (d) the emitted visual for the source card holds exactly those after-values at those paths
    const page = (sandbox.PBI_PAGES || []).find(p => (p.layout || []).some(s => s.key === sourceCardKey));
    if (!page) {
        throw new Error(`checkCardCaptionShape: page containing '${sourceCardKey}' not found in PBI_PAGES`);
    }
    const visualPath = `${sandbox.PBI_ROOT}/${sandbox.PBI_PROJECT_NAME}.Report/definition/pages/${page.id}/visuals/${sourceSlot.id}/visual.json`;
    const content = fileMap[visualPath];
    if (!content) {
        throw new Error(`checkCardCaptionShape: visual.json not found at ${visualPath}`);
    }
    const visualNode = JSON.parse(content).visual || {};
    for (const fixtureEntry of fixtureChangedPaths) {
        let target = visualNode;
        for (let i = 0; i < fixtureEntry.path.length - 1; i++) {
            target = target ? target[fixtureEntry.path[i]] : undefined;
        }
        const lastKey = fixtureEntry.path[fixtureEntry.path.length - 1];
        const actual = (target && typeof target === 'object') ? target[lastKey] : undefined;
        if (fixtureEntry.removed) {
            if (actual !== undefined) {
                throw new Error(`checkCardCaptionShape: emitted visual for '${sourceCardKey}' still carries removed path '${fixtureEntry.path.join('.')}'`);
            }
            continue;
        }
        if (JSON.stringify(actual) !== JSON.stringify(fixtureEntry.after)) {
            throw new Error(`checkCardCaptionShape: emitted visual for '${sourceCardKey}' path '${fixtureEntry.path.join('.')}' does not equal the fixture's captured after-value`);
        }
    }

    return true;
}

function main() {
    const csvPath = path.join(ROOT, 'dashboard-ready.csv');
    if (!fs.existsSync(csvPath)) {
        console.error('check:cards FAIL: dashboard-ready.csv not found');
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
        console.error(`check:cards FAIL: buildPowerBIFileMap(rows) threw: ${err && err.message ? err.message : err}`);
        process.exit(1);
    }

    let fixture = null;
    try {
        const { loadValidatedFixture } = require('./uat-36-desktop-shapes-capture.js');
        fixture = loadValidatedFixture(ROOT);
    } catch (err) {
        console.log(`check:cards FAIL: ${err && err.message ? err.message : err}`);
        process.exit(1);
    }

    try {
        if (typeof sandbox.assertCardCaptionsMatchDesktopShape !== 'function') {
            throw new Error("assertion 'assertCardCaptionsMatchDesktopShape' not found on sandbox global — check it is declared as a function/var, not const");
        }
        sandbox.assertCardCaptionsMatchDesktopShape(fileMap);
        checkCardCaptionShape(sandbox, fileMap, fixture);
    } catch (err) {
        console.log(`check:cards FAIL: ${err && err.message ? err.message : err}`);
        process.exit(1);
    }

    console.log('check:cards PASS');
    process.exit(0);
}

if (require.main === module) {
    main();
}

module.exports = { checkCardCaptionShape };
