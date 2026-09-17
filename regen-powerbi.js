const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// materializeFileMapEntries: decode every fileMap entry under `prefix` into an
// in-memory { relPath, data, encoding } record WITHOUT touching disk. Registered
// images (isRegisteredImagePath) are decoded from base64 to a Buffer and validated
// against PNG_SIGNATURE plus a base64 round-trip check; everything else is kept as
// the original UTF-8 string. Throws (naming the offending path) before any entry is
// written, so writeFileMapToDisk can validate every payload before deleting anything.
function materializeFileMapEntries(fileMap, prefix, isRegisteredImagePath) {
    const entries = [];
    for (const [relPath, content] of Object.entries(fileMap)) {
        if (!relPath.startsWith(prefix)) continue;
        if (isRegisteredImagePath(relPath)) {
            const buf = Buffer.from(content, 'base64');
            const sig = buf.subarray(0, PNG_SIGNATURE.length);
            if (buf.length < PNG_SIGNATURE.length || !sig.equals(PNG_SIGNATURE)) {
                throw new Error(`Decoded payload for ${relPath} does not start with the PNG signature`);
            }
            const reencoded = buf.toString('base64');
            const stripped = content.replace(/\s+/g, '');
            if (reencoded !== stripped) {
                throw new Error(`Decoded payload for ${relPath} does not re-encode to the same base64 text`);
            }
            entries.push({ relPath, data: buf, encoding: undefined });
        } else {
            entries.push({ relPath, data: content, encoding: 'utf8' });
        }
    }
    return entries;
}

// writeMaterializedEntries: writes each already-validated entry to disk under
// destRoot. Pure I/O, no validation -- call materializeFileMapEntries first.
function writeMaterializedEntries(entries, destRoot) {
    let count = 0;
    for (const entry of entries) {
        const fullPath = path.join(destRoot, entry.relPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        if (entry.encoding) {
            fs.writeFileSync(fullPath, entry.data, entry.encoding);
        } else {
            fs.writeFileSync(fullPath, entry.data);
        }
        count++;
    }
    return count;
}

// writeFileMapToDisk: materialize-then-write in one call. materializeFileMapEntries
// runs to completion (throwing on any bad payload) before writeMaterializedEntries
// writes a single byte, so a bad payload can never leave a half-written tree.
function writeFileMapToDisk(fileMap, destRoot, prefix, isRegisteredImagePath) {
    const entries = materializeFileMapEntries(fileMap, prefix, isRegisteredImagePath);
    return writeMaterializedEntries(entries, destRoot);
}

function main() {
try {
    const csv = fs.readFileSync(path.join(__dirname, 'dashboard-ready.csv'), 'utf8');

    const roadmapPath = path.join(__dirname, '.planning', 'ROADMAP.md');
    if (!fs.existsSync(roadmapPath)) {
        console.error('.planning/ROADMAP.md not found. Cannot regenerate.');
        process.exit(1);
    }
    const roadmapText = fs.readFileSync(roadmapPath, 'utf8');
    if (!roadmapText || roadmapText.trim().length === 0) {
        console.error('.planning/ROADMAP.md is empty. Cannot regenerate.');
        process.exit(1);
    }

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
                    token += ch;
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

    const rows = parseCsv(csv);

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

    const c = { console, crypto, Papa: { unparse: unparse } };
    vm.createContext(c);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'powerbi.js'), 'utf8'), c);

    const PBI_REGEN_TARGET_PREFIX = c.PBI_ROOT || 'powerbi';
    if (!PBI_REGEN_TARGET_PREFIX || PBI_REGEN_TARGET_PREFIX === '.' || PBI_REGEN_TARGET_PREFIX === '/' || PBI_REGEN_TARGET_PREFIX.includes('..')) {
        console.error('Refusing to run with unsafe target prefix:', PBI_REGEN_TARGET_PREFIX);
        process.exit(1);
    }

    const fileMap = c.buildPowerBIFileMap(rows);

    // Run validator chain in same order as generatePowerBIExport before deleting/writing
    if (typeof c.assertGeneratedTextIsClean === 'function') c.assertGeneratedTextIsClean(fileMap);
    if (typeof c.assertModelTablesAreReferenced === 'function') c.assertModelTablesAreReferenced(fileMap);
    if (typeof c.assertRelationshipRegistryIsWellFormed === 'function') c.assertRelationshipRegistryIsWellFormed(fileMap);
    if (typeof c.assertLogicalIdsAreUnique === 'function') c.assertLogicalIdsAreUnique();
    if (typeof c.assertThemeReferenceResolves === 'function') c.assertThemeReferenceResolves(fileMap);
    if (typeof c.assertPageCanvasMatchesTheme === 'function') c.assertPageCanvasMatchesTheme(fileMap);
    if (typeof c.assertExecLayoutIsRenderable === 'function') c.assertExecLayoutIsRenderable(fileMap);
    if (typeof c.assertOpsLayoutIsRenderable === 'function') c.assertOpsLayoutIsRenderable(fileMap);
    if (typeof c.assertAllPageLayoutsAreRenderable === 'function') c.assertAllPageLayoutsAreRenderable(fileMap);
    if (typeof c.assertLineChartSlotsBindDeclaredFields === 'function') c.assertLineChartSlotsBindDeclaredFields(fileMap);
    if (typeof c.assertNoAgentQaDuplicateSignature === 'function') c.assertNoAgentQaDuplicateSignature(fileMap);
    if (typeof c.assertTruncatedAxesAreDisclosed === 'function') c.assertTruncatedAxesAreDisclosed(fileMap);
    if (typeof c.assertAxisFloorsSitBelowPlottedData === 'function') c.assertAxisFloorsSitBelowPlottedData(fileMap, rows);
    if (typeof c.assertFieldReferencesResolve === 'function') c.assertFieldReferencesResolve(fileMap);
    if (typeof c.assertNoHardcodedCategoryLiterals === 'function') c.assertNoHardcodedCategoryLiterals(fileMap, rows);
    if (typeof c.assertThemeOwnedPropertiesAreAllowlisted === 'function') c.assertThemeOwnedPropertiesAreAllowlisted(fileMap);
    if (typeof c.assertDateSlicerHasNoAuthoredFilter === 'function') c.assertDateSlicerHasNoAuthoredFilter(fileMap);
    if (typeof c.assertRelativeDateSlicerIsDisclosed === 'function') c.assertRelativeDateSlicerIsDisclosed(fileMap);
    if (typeof c.assertDateTableIsMarked === 'function') c.assertDateTableIsMarked(fileMap);
    if (typeof c.assertCalendarSpanIsFullYear === 'function') c.assertCalendarSpanIsFullYear(fileMap);
    if (typeof c.assertDateRelationshipKeyAndCardinality === 'function') c.assertDateRelationshipKeyAndCardinality(fileMap);
    if (typeof c.assertNoOrphanedModelOrReportReferences === 'function') c.assertNoOrphanedModelOrReportReferences(fileMap);
    if (typeof c.assertNoAllCallsBaselineInDeltaMeasures === 'function') c.assertNoAllCallsBaselineInDeltaMeasures();
    if (typeof c.assertEveryDeltaMeasureReferencesDateTable === 'function') c.assertEveryDeltaMeasureReferencesDateTable();
    if (typeof c.assertNoFactTableDateDerivationInDeltaMeasures === 'function') c.assertNoFactTableDateDerivationInDeltaMeasures();
    if (typeof c.assertPartialPeriodClampInEveryDeltaMeasure === 'function') c.assertPartialPeriodClampInEveryDeltaMeasure();
    if (typeof c.assertWeightedRatioShapeOnWeightedMeasures === 'function') c.assertWeightedRatioShapeOnWeightedMeasures();
    if (typeof c.assertNoRowAveragedSilencePctSurvives === 'function') c.assertNoRowAveragedSilencePctSurvives();
    if (typeof c.assertDescriptionStringsAreTmdlSafe === 'function') c.assertDescriptionStringsAreTmdlSafe();
    if (typeof c.assertEveryVisibleCallsColumnHasAConsumer === 'function') c.assertEveryVisibleCallsColumnHasAConsumer(fileMap, roadmapText);
    if (typeof c.assertEveryHiddenCallsColumnHasARecordedReason === 'function') c.assertEveryHiddenCallsColumnHasARecordedReason();
    if (typeof c.assertDrillthroughPageBindsDeclaredFields === 'function') c.assertDrillthroughPageBindsDeclaredFields(fileMap);
    if (typeof c.assertTableVisualBindsAllDrillColumnsInOrder === 'function') c.assertTableVisualBindsAllDrillColumnsInOrder(fileMap);
    if (typeof c.assertSourceVisualsProjectDeclaredDrillFields === 'function') c.assertSourceVisualsProjectDeclaredDrillFields(fileMap);
    if (typeof c.assertPageLevelFieldReferencesResolve === 'function') c.assertPageLevelFieldReferencesResolve(fileMap);
    if (typeof c.assertPiiExposureStatementIsSingleSourced === 'function') c.assertPiiExposureStatementIsSingleSourced(fileMap);
    if (typeof c.assertTargetLinesMatchRegistry === 'function') c.assertTargetLinesMatchRegistry(fileMap);
    if (typeof c.assertTargetDisclosuresArePresent === 'function') c.assertTargetDisclosuresArePresent(fileMap);
    if (typeof c.assertTitleMeasuresHaveZeroRowGuard === 'function') c.assertTitleMeasuresHaveZeroRowGuard();
    if (typeof c.assertNarrativeTitlesBindMeasures === 'function') c.assertNarrativeTitlesBindMeasures(fileMap);
    if (typeof c.assertCardCaptionsMatchDesktopShape === 'function') c.assertCardCaptionsMatchDesktopShape(fileMap);
    if (typeof c.assertExportModeIsDisclosed === 'function') c.assertExportModeIsDisclosed(fileMap, c.PBI_EXPORT_MODE_FULL, rows.length);
    if (typeof c.assertReadmeCoversRequiredContent === 'function') c.assertReadmeCoversRequiredContent(fileMap);

    const prefix = PBI_REGEN_TARGET_PREFIX + '/';
    const producedTopLevel = new Set(
        Object.keys(fileMap)
            .filter(k => k.startsWith(prefix))
            .map(relPath => relPath.slice(prefix.length).split('/')[0])
    );

    // Decode and validate every entry before anything is deleted: a bad payload
    // (see materializeFileMapEntries) throws here, before the delete loop runs.
    const entries = materializeFileMapEntries(fileMap, prefix, c.isRegisteredImagePath);

    // Delete only the generator-produced top-level children under target prefix
    for (const topLevel of producedTopLevel) {
        const topLevelPath = path.join(__dirname, PBI_REGEN_TARGET_PREFIX, topLevel);
        if (fs.existsSync(topLevelPath)) {
            fs.rmSync(topLevelPath, { recursive: true, force: true });
        }
    }

    const fileCount = writeMaterializedEntries(entries, __dirname);

    // Also write README.md inside powerbi/ distribution folder
    if (fileMap['README.md']) {
        fs.writeFileSync(path.join(__dirname, PBI_REGEN_TARGET_PREFIX, 'README.md'), fileMap['README.md'], 'utf8');
    }

    console.log(`Wrote ${fileCount} files to ${path.join(__dirname, PBI_REGEN_TARGET_PREFIX)}`);
    console.log('REGEN OK');
} catch (err) {
    console.error(`FAIL: ${err.message || err}`);
    process.exit(1);
}
}

module.exports = { materializeFileMapEntries, writeMaterializedEntries, writeFileMapToDisk, PNG_SIGNATURE };

if (require.main === module) {
    main();
}
