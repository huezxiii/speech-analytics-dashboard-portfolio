// check-powerbi-freshness.js
//
// Regenerates the Power BI deliverable file map in memory from the current,
// unmodified `powerbi.js` generator + the current root `dashboard-ready.csv`,
// then diffs it byte-for-byte against the on-disk `powerbi/` tree that ships
// in this repo.
//
// Why this exists: see .planning/debug/resolved/pbip-datamodelloadfailed.md.
// The `powerbi/` tree silently went stale relative to the generator + data it
// was supposedly built from (a Call_Date fix landed in powerbi.js but the
// on-disk deliverable was never regenerated). Phase 20's own "no-repair-prompt"
// human-verification signal (20-10-SUMMARY.md) was captured against a
// git-ignored regen target (uat-20/powerbi/, written by uat-20-regen.js), not
// against this on-disk powerbi/ tree that a user actually opens directly --
// so a stale powerbi/ tree sat unflagged even though the generator itself was
// already correct and a separately-built, verified-clean tree existed side by
// side with it. This script closes that gap: it is the freshness check that
// would have caught the divergence between "the tree we verified" and "the
// tree we ship" before a user ever opened it in Power BI Desktop.
//
// Usage: node check-powerbi-freshness.js
//   Exit 0 - `powerbi/` on disk is byte-identical to what the current
//            generator + current data would produce right now.
//   Exit 1 - divergence found; prints the missing / differing / extra paths.
//
// Scope note: only compares paths under the `powerbi/` (PBI_ROOT) prefix of
// the generator's file map. `buildPowerBIFileMap` also emits a bare top-level
// `README.md` key intended for a standalone extracted-ZIP distribution, not
// for this repo's own README -- that key is intentionally excluded here.
//
// Registered images (G-36-13): the two registered images (`brand-icon.png`,
// `brand-text.png`) hold base64 TEXT in the generator's file map, decoded to
// PNG bytes only by the writers (`zipFromFileMap`'s `{ base64: true }` branch,
// `regen-powerbi.js`'s `materializeFileMapEntries`). Comparing them as UTF-8
// text (like every other generated file) let a base64-text-saved-as-.png tree
// pass as fresh even though Power BI Desktop could not decode it as an image.
// For paths where `isRegisteredImagePath` is true, this checker instead reads
// the on-disk file as a Buffer, checks its first 8 bytes against `PNG_SIGNATURE`
// (defined locally here, not imported from the writer, so a writer bug cannot
// hide itself from the checker), and compares it byte-for-byte against
// `Buffer.from(content, 'base64')`. It also requires exactly the expected
// number of registered images to have been checked, so a missing/renamed image
// cannot silently drop out of the comparison.
//
// Not wired into any git hook or CI step (this project has neither yet).
// Run manually before shipping/opening the .pbip, or wire it into whatever
// pre-commit/CI process this project adopts later -- that wiring decision is
// out of scope for this script.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

// checkFreshness({ repoRoot, treeRoot, expectedImageCount }) -> {
//   expectedCount, imageCount, missing, differing, extra, badSignature, imageCountMismatch
// }
//
// The generator and the source CSV are loaded from `repoRoot` (the current
// committed powerbi.js + dashboard-ready.csv). The on-disk tree being checked
// -- and the extra-file walk -- are read from `treeRoot`, which may be a
// different directory (e.g. a temp tree) than `repoRoot`. `expectedImageCount`
// defaults to `sandbox.PBI_REGISTERED_IMAGES.length`.
function checkFreshness({ repoRoot, treeRoot, expectedImageCount } = {}) {
    repoRoot = repoRoot || ROOT;
    treeRoot = treeRoot || ROOT;

    const csv = fs.readFileSync(path.join(repoRoot, 'dashboard-ready.csv'), 'utf8');
    const rows = parseCsv(csv);

    const sandbox = { console, crypto, Papa: { unparse: unparse } };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(repoRoot, 'powerbi.js'), 'utf8'), sandbox);

    const fileMap = sandbox.buildPowerBIFileMap(rows);
    const pbiRoot = sandbox.PBI_ROOT || 'powerbi';
    const prefix = pbiRoot + '/';
    const expectedCount = typeof expectedImageCount === 'number'
        ? expectedImageCount
        : (sandbox.PBI_REGISTERED_IMAGES || []).length;

    const expected = {};
    for (const [relPath, content] of Object.entries(fileMap)) {
        if (relPath.startsWith(prefix)) expected[relPath] = content;
    }

    const missing = [];
    const differing = [];
    const badSignature = [];
    let imageCount = 0;
    for (const [relPath, content] of Object.entries(expected)) {
        const onDiskPath = path.join(treeRoot, relPath);
        if (!fs.existsSync(onDiskPath)) {
            missing.push(relPath);
            continue;
        }
        if (sandbox.isRegisteredImagePath(relPath)) {
            imageCount++;
            const onDiskBytes = fs.readFileSync(onDiskPath);
            const sig = onDiskBytes.subarray(0, PNG_SIGNATURE.length);
            if (onDiskBytes.length < PNG_SIGNATURE.length || !sig.equals(PNG_SIGNATURE)) {
                badSignature.push(relPath);
            }
            const expectedBytes = Buffer.from(content, 'base64');
            if (!onDiskBytes.equals(expectedBytes)) differing.push(relPath);
            continue;
        }
        const onDisk = fs.readFileSync(onDiskPath, 'utf8');
        if (onDisk !== content) differing.push(relPath);
    }
    const imageCountMismatch = imageCount !== expectedCount;

    // Files present on disk but not produced by the current generator run at
    // all (renamed/orphaned/manual residue -- e.g. this exact incident's
    // stray `data/x-dashboard-ready.csv` file). Scoped strictly to the
    // immediate children of `powerbi/` that the generator itself produces
    // (e.g. `SpeechAnalytics.pbip`, `SpeechAnalytics.SemanticModel/`,
    // `SpeechAnalytics.Report/`) -- NOT the whole `powerbi/` directory, which
    // in this repo also holds unrelated sibling spike/scratch trees
    // (`*-extracted*/`, `test.*`, `powerbi/powerbi/`, critique docs, zips)
    // that are out of scope for a deliverable-freshness check.
    const extra = [];
    const producedTopLevel = new Set(
        Object.keys(expected).map((relPath) => relPath.slice(prefix.length).split('/')[0])
    );
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            const rel = path.relative(treeRoot, full).split(path.sep).join('/');
            if (!(rel in expected)) extra.push(rel);
        }
    }
    for (const topLevel of producedTopLevel) {
        const topLevelPath = path.join(treeRoot, pbiRoot, topLevel);
        if (!fs.existsSync(topLevelPath)) continue;
        if (fs.statSync(topLevelPath).isDirectory()) {
            walk(topLevelPath);
        } else {
            const rel = path.relative(treeRoot, topLevelPath).split(path.sep).join('/');
            if (!(rel in expected)) extra.push(rel);
        }
    }

    return { expectedCount, imageCount, missing, differing, extra, badSignature, imageCountMismatch, pbiRoot, totalChecked: Object.keys(expected).length };
}

function main() {
    const treeRoot = ROOT;
    const result = checkFreshness({ repoRoot: ROOT, treeRoot });
    const { pbiRoot, missing, differing, extra, badSignature, imageCount, expectedCount, imageCountMismatch, totalChecked } = result;

    if (missing.length === 0 && differing.length === 0 && extra.length === 0 && badSignature.length === 0 && !imageCountMismatch) {
        console.log(`FRESH: ${pbiRoot}/ on disk matches the current generator + data byte-for-byte (${totalChecked} files checked), ${imageCount} registered PNGs byte-verified.`);
        process.exit(0);
    }

    console.error(`STALE: ${pbiRoot}/ on disk diverges from what the current generator + data would produce.`);
    if (missing.length) {
        console.error(`  Missing on disk (${missing.length}):`);
        missing.forEach((p) => console.error(`    ${p}`));
    }
    if (differing.length) {
        console.error(`  Content differs from generator output (${differing.length}):`);
        differing.forEach((p) => console.error(`    ${p}`));
    }
    if (badSignature.length) {
        console.error(`  Not a valid PNG on disk (${badSignature.length}):`);
        badSignature.forEach((p) => console.error(`    ${p}`));
    }
    if (extra.length) {
        console.error(`  On disk but not produced by the generator (${extra.length}):`);
        extra.forEach((p) => console.error(`    ${p}`));
    }
    if (imageCountMismatch) {
        console.error(`  Registered PNGs checked: ${imageCount}, expected ${expectedCount}`);
    }
    console.error('Regenerate the deliverable from powerbi.js + dashboard-ready.csv before shipping/opening it.');
    process.exit(1);
}

module.exports = { checkFreshness, PNG_SIGNATURE };

if (require.main === module) {
    main();
}
