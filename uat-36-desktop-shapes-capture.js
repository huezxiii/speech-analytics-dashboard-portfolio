// uat-36-desktop-shapes-capture.js
// Capture tool for the Desktop-authored shapes needed by the G-36-4 / G-36-8 gap-closure spikes
// (Plan 36-05). CLI modes: resave, prepare <dir>, after <dir>, validate.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PENDING_TOKEN = '__PENDING_DESKTOP_CAPTURE__';
const FIXTURE_FILE = 'uat-36-desktop-shapes-fixture.json';
const WORKSHEET_FILE = 'uat-36-desktop-shapes.md';
const SPIKE_DIR_DOC = 'C:/Users/Reviewer/AppData/Local/Temp/speech-analytics-pbi-spike-36';

const BAR_CHART_REL = 'powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/6f708192a3b4c5d6e7f8/visual.json';

const EXEC_CARD_IDS = [
    '1b7e4a2c8f60d3591c4b',
    '2d9f6b0a4e13c78520fa',
    '3a4c8e15b7d02f96e831',
    '4f0b23d78a1c5e69b0d4',
    '5e6d19af03b74c28d5a0',
    '6b2708c4e9a15d3f70bc',
    '7c8a35f1602bd94e8a17'
];
const CARD_TOTAL_CALLS_ID = '1b7e4a2c8f60d3591c4b';
const CARD_AVG_HANDLE_TIME_ID = '2d9f6b0a4e13c78520fa';

function cardRelPath(id) {
    return `powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/${id}/visual.json`;
}

const REGISTERED_IMAGE_RELS = [
    'powerbi/SpeechAnalytics.Report/StaticResources/RegisteredResources/brand-icon.png',
    'powerbi/SpeechAnalytics.Report/StaticResources/RegisteredResources/brand-text.png'
];

class FixtureError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FixtureError';
    }
}

function toPosix(p) {
    return p.split(path.sep).join('/');
}

function linesOf(buf) {
    return buf.toString('utf8').split(/\r?\n/).filter((l) => l.length > 0);
}

function git(repoRoot, args) {
    return execFileSync('git', args, { cwd: repoRoot });
}

function readWorkingBuffer(repoRoot, relPath) {
    return fs.readFileSync(path.join(repoRoot, relPath));
}

function readHeadBuffer(repoRoot, relPath) {
    return git(repoRoot, ['show', `HEAD:${relPath}`]);
}

function readWorkingJson(repoRoot, relPath) {
    return JSON.parse(readWorkingBuffer(repoRoot, relPath).toString('utf8'));
}

function readHeadJson(repoRoot, relPath) {
    return JSON.parse(readHeadBuffer(repoRoot, relPath).toString('utf8'));
}

function extractSchemaVersion(schemaUrl) {
    const m = /visualContainer\/([^/]+)\//.exec(schemaUrl || '');
    return m ? m[1] : null;
}

function loadValidatedFixture(repoRoot) {
    const fixturePath = path.join(repoRoot, FIXTURE_FILE);
    if (!fs.existsSync(fixturePath)) {
        throw new FixtureError(`fixture not found: ${fixturePath}`);
    }
    const raw = fs.readFileSync(fixturePath, 'utf8');
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new FixtureError(`fixture does not parse as JSON: ${e.message}`);
    }
    if (raw.includes(PENDING_TOKEN)) {
        throw new FixtureError(`fixture still contains the pending token (${PENDING_TOKEN})`);
    }
    if (!parsed.referenceLine || typeof parsed.referenceLine.objectKey !== 'string' || parsed.referenceLine.objectKey.length === 0) {
        throw new FixtureError('fixture.referenceLine.objectKey must be a non-empty string');
    }
    return parsed;
}

function emptyFixture() {
    return {
        metadata: {
            purpose: 'Desktop-authored JSON shapes for G-36-4 (QA reference line) and G-36-8 (card caption) gap closure',
            worksheet: WORKSHEET_FILE,
            captureScript: 'uat-36-desktop-shapes-capture.js',
            spikeDir: SPIKE_DIR_DOC
        },
        resaveEvidence: PENDING_TOKEN,
        spikeBefore: PENDING_TOKEN,
        referenceLine: PENDING_TOKEN,
        cardCaption: PENDING_TOKEN,
        captionOff: PENDING_TOKEN
    };
}

function writeFixture(repoRoot, fixture) {
    const fixturePath = path.join(repoRoot, FIXTURE_FILE);
    fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
}

function readFixtureRaw(repoRoot) {
    const fixturePath = path.join(repoRoot, FIXTURE_FILE);
    if (!fs.existsSync(fixturePath)) return null;
    return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Mode: resave
// ---------------------------------------------------------------------------

function cmdResave(repoRoot) {
    const existing = readFixtureRaw(repoRoot);
    if (existing && existing.resaveEvidence !== PENDING_TOKEN) {
        console.error('refuse: resaveEvidence is already filled in the fixture; nothing to capture');
        process.exit(1);
        return;
    }

    const barWorking = readWorkingBuffer(repoRoot, BAR_CHART_REL);
    const barHead = readHeadBuffer(repoRoot, BAR_CHART_REL);
    if (Buffer.compare(barWorking, barHead) === 0) {
        console.error('refuse: bar-chart visual.json is byte-identical to HEAD; nothing to capture');
        process.exit(1);
        return;
    }

    const capturedAt = new Date().toISOString();
    const headCommit = git(repoRoot, ['rev-parse', 'HEAD']).toString('utf8').trim();
    const gitStatusPorcelain = linesOf(git(repoRoot, ['status', '--porcelain', '--', 'powerbi/']));
    const gitStatusIgnored = linesOf(git(repoRoot, [
        'status', '--porcelain', '--ignored', '--',
        'powerbi/SpeechAnalytics.Report', 'powerbi/SpeechAnalytics.SemanticModel'
    ]));
    const diffStat = git(repoRoot, ['diff', '--stat', 'HEAD', '--', 'powerbi/']).toString('utf8');
    const cleanDryRun = linesOf(git(repoRoot, ['clean', '-nd', '--', 'powerbi/']));
    const cleanIgnoredDryRun = linesOf(git(repoRoot, [
        'clean', '-ndX', '--',
        'powerbi/SpeechAnalytics.Report', 'powerbi/SpeechAnalytics.SemanticModel'
    ]));

    const barHeadJson = JSON.parse(barHead.toString('utf8'));
    const barResaveJson = JSON.parse(barWorking.toString('utf8'));
    const barQueueBreakdown = {
        path: BAR_CHART_REL,
        schemaHead: extractSchemaVersion(barHeadJson.$schema),
        schemaResave: extractSchemaVersion(barResaveJson.$schema),
        objectsHead: barHeadJson.visual.objects || null,
        objectsResave: barResaveJson.visual.objects || null,
        visualContainerObjectsHead: barHeadJson.visual.visualContainerObjects || null,
        visualContainerObjectsResave: barResaveJson.visual.visualContainerObjects || null
    };

    const execCards = EXEC_CARD_IDS.map((id) => {
        const rel = cardRelPath(id);
        const headJson = readHeadJson(repoRoot, rel);
        const resaveJson = readWorkingJson(repoRoot, rel);
        const headProps = (headJson.visual.objects.referenceLabel && headJson.visual.objects.referenceLabel[0] && headJson.visual.objects.referenceLabel[0].properties) || {};
        const resaveProps = (resaveJson.visual.objects.referenceLabel && resaveJson.visual.objects.referenceLabel[0] && resaveJson.visual.objects.referenceLabel[0].properties) || {};
        return {
            id,
            headHasTitle: Object.prototype.hasOwnProperty.call(headProps, 'title'),
            resaveHasTitle: Object.prototype.hasOwnProperty.call(resaveProps, 'title'),
            valueUnchanged: JSON.stringify(headProps.value) === JSON.stringify(resaveProps.value),
            referenceLabelHead: headJson.visual.objects.referenceLabel || null,
            referenceLabelResave: resaveJson.visual.objects.referenceLabel || null
        };
    });

    const registeredImages = REGISTERED_IMAGE_RELS.map((rel) => {
        const abs = path.join(repoRoot, rel);
        const buf = fs.readFileSync(abs);
        return {
            path: rel,
            sizeBytes: fs.statSync(abs).size,
            firstBytesHex: buf.subarray(0, 8).toString('hex')
        };
    });

    const resaveEvidence = {
        capturedAt,
        headCommit,
        gitStatusPorcelain,
        gitStatusIgnored,
        diffStat,
        cleanDryRun,
        cleanIgnoredDryRun,
        barQueueBreakdown,
        execCards,
        registeredImages
    };

    const fixture = existing || emptyFixture();
    fixture.resaveEvidence = resaveEvidence;
    writeFixture(repoRoot, fixture);
    console.log(`resave evidence captured: ${execCards.length} cards, bar chart schema ${barQueueBreakdown.schemaHead} -> ${barQueueBreakdown.schemaResave}`);
}

// ---------------------------------------------------------------------------
// Shared diff helpers (used by mode "after")
// ---------------------------------------------------------------------------

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function diffAtPath(before, after, pathSoFar, results) {
    const beforeHas = before !== undefined;
    const afterHas = after !== undefined;
    if (!beforeHas && !afterHas) return;
    if (!beforeHas) {
        results.push({ path: pathSoFar.slice(), after, added: true });
        return;
    }
    if (!afterHas) {
        results.push({ path: pathSoFar.slice(), before, removed: true });
        return;
    }
    if (isPlainObject(before) && isPlainObject(after)) {
        const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
        for (const k of keys) {
            diffAtPath(before[k], after[k], pathSoFar.concat(k), results);
        }
        return;
    }
    if (Array.isArray(before) && Array.isArray(after)) {
        const len = Math.max(before.length, after.length);
        for (let i = 0; i < len; i++) {
            diffAtPath(before[i], after[i], pathSoFar.concat(i), results);
        }
        return;
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) {
        results.push({ path: pathSoFar.slice(), before, after });
    }
}

function diffObjects(before, after) {
    const results = [];
    diffAtPath(before === undefined ? null : before, after === undefined ? null : after, [], results);
    return results;
}

function findChangedObjectKeys(before, after) {
    const b = before || {};
    const a = after || {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    const changed = [];
    for (const k of keys) {
        if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) changed.push(k);
    }
    return changed;
}

function containsLiteral85(value) {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.some(containsLiteral85);
    if (typeof value === 'object') {
        if (value.Literal && typeof value.Literal.Value === 'string' && value.Literal.Value.startsWith('85')) {
            return true;
        }
        return Object.values(value).some(containsLiteral85);
    }
    return false;
}

function findPathToObjectWithProperty(obj, propKey, propValue, pathSoFar) {
    pathSoFar = pathSoFar || [];
    if (obj && typeof obj === 'object') {
        if (!Array.isArray(obj) && obj[propKey] === propValue) {
            return pathSoFar.slice();
        }
        const entries = Array.isArray(obj) ? obj.map((v, i) => [i, v]) : Object.entries(obj);
        for (const [k, v] of entries) {
            const found = findPathToObjectWithProperty(v, propKey, propValue, pathSoFar.concat(k));
            if (found) return found;
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Mode: prepare <spikeDir>
// ---------------------------------------------------------------------------

function cmdPrepare(repoRoot, spikeDir) {
    if (!spikeDir) {
        console.error('prepare requires a <spikeDir> argument');
        process.exit(1);
        return;
    }
    const repoRootResolved = path.resolve(repoRoot);
    const spikeResolved = path.resolve(spikeDir);
    const rel = path.relative(repoRootResolved, spikeResolved);
    // path.relative() cannot express a cross-drive relationship on Windows and returns the
    // absolute `to` path in that case; treat that as "outside" too (isInside stays false).
    // path.relative(a, a) returns '' for identical paths -- that is the exact-same-directory
    // case, which must also be refused as "inside the repo" (CR-01).
    const isInside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    if (isInside) {
        console.error(`refuse: spikeDir must be outside the repo (relative path resolved to "${rel}")`);
        process.exit(1);
        return;
    }
    const pbipPath = path.join(spikeDir, 'powerbi', 'SpeechAnalytics.pbip');
    if (!fs.existsSync(pbipPath)) {
        console.error(`refuse: ${pbipPath} does not exist; copy the project into the spike dir first`);
        process.exit(1);
        return;
    }
    const existing = readFixtureRaw(repoRoot);
    if (!existing) {
        console.error('refuse: fixture does not exist yet; run "resave" first');
        process.exit(1);
        return;
    }
    if (existing.spikeBefore !== PENDING_TOKEN) {
        console.error('refuse: spikeBefore is already filled in the fixture');
        process.exit(1);
        return;
    }

    const barSpikeAbs = path.join(spikeDir, BAR_CHART_REL);
    const barJson = JSON.parse(fs.readFileSync(barSpikeAbs, 'utf8'));
    if (barJson.visual.objects && barJson.visual.objects.referenceLine) {
        delete barJson.visual.objects.referenceLine;
    }
    fs.writeFileSync(barSpikeAbs, JSON.stringify(barJson, null, 2), 'utf8');

    const expressionsRel = 'powerbi/SpeechAnalytics.SemanticModel/definition/expressions.tmdl';
    const expressionsAbs = path.join(spikeDir, expressionsRel);
    const semanticModelDirWindows = path.join(spikeDir, 'powerbi', 'SpeechAnalytics.SemanticModel');
    let expressionsText = fs.readFileSync(expressionsAbs, 'utf8');
    expressionsText = expressionsText.replace(
        /(expression CsvFolderPath = ")[^"]*(")/,
        (m, pre, post) => `${pre}${semanticModelDirWindows}${post}`
    );
    fs.writeFileSync(expressionsAbs, expressionsText, 'utf8');

    const preparedAt = new Date().toISOString();

    function captureFile(rel) {
        const abs = path.join(spikeDir, rel);
        const buf = fs.readFileSync(abs);
        const json = JSON.parse(buf.toString('utf8'));
        return {
            relPath: rel,
            sha256: crypto.createHash('sha256').update(buf).digest('hex'),
            schema: extractSchemaVersion(json.$schema),
            objects: json.visual.objects || null,
            visualContainerObjects: json.visual.visualContainerObjects || null
        };
    }

    const spikeBefore = {
        spikeDir: toPosix(spikeDir),
        preparedAt,
        files: {
            bar: captureFile(BAR_CHART_REL),
            cardTotalCalls: captureFile(cardRelPath(CARD_TOTAL_CALLS_ID)),
            cardAvgHandleTime: captureFile(cardRelPath(CARD_AVG_HANDLE_TIME_ID))
        }
    };

    existing.spikeBefore = spikeBefore;
    writeFixture(repoRoot, existing);
    console.log(`spike prepared at ${spikeDir}: bar referenceLine removed, CsvFolderPath rewritten to ${semanticModelDirWindows}`);
}

// ---------------------------------------------------------------------------
// Mode: after <spikeDir>
// ---------------------------------------------------------------------------

function cmdAfter(repoRoot, spikeDir) {
    if (!spikeDir) {
        console.error('after requires a <spikeDir> argument');
        process.exit(1);
        return;
    }
    const fixture = readFixtureRaw(repoRoot);
    if (!fixture || fixture.spikeBefore === PENDING_TOKEN || typeof fixture.spikeBefore !== 'object') {
        console.error('refuse: spikeBefore has not been captured yet; run "prepare" first');
        process.exit(1);
        return;
    }
    const before = fixture.spikeBefore;
    const preparedAtMs = Date.parse(before.preparedAt);

    function readSpikeFile(rel) {
        const abs = path.join(spikeDir, rel);
        const buf = fs.readFileSync(abs);
        const stat = fs.statSync(abs);
        return {
            stat,
            json: JSON.parse(buf.toString('utf8')),
            sha256: crypto.createHash('sha256').update(buf).digest('hex')
        };
    }

    const barRel = before.files.bar.relPath;
    const cardTotalCallsRel = before.files.cardTotalCalls.relPath;
    const cardAvgHandleTimeRel = before.files.cardAvgHandleTime.relPath;

    const barAfter = readSpikeFile(barRel);
    const cardTotalCallsAfter = readSpikeFile(cardTotalCallsRel);
    const cardAvgHandleTimeAfter = readSpikeFile(cardAvgHandleTimeRel);

    const barUnchanged = barAfter.sha256 === before.files.bar.sha256;
    const cardUnchanged = cardTotalCallsAfter.sha256 === before.files.cardTotalCalls.sha256;
    const barMtimeOk = barAfter.stat.mtimeMs > preparedAtMs;
    const cardMtimeOk = cardTotalCallsAfter.stat.mtimeMs > preparedAtMs;

    if (barUnchanged || !barMtimeOk) {
        console.error(`Desktop did not save a change to ${barRel}`);
        process.exit(1);
        return;
    }
    if (cardUnchanged || !cardMtimeOk) {
        console.error(`Desktop did not save a change to ${cardTotalCallsRel}`);
        process.exit(1);
        return;
    }

    // Bar chart reference-line detection.
    const changedKeys = findChangedObjectKeys(before.files.bar.objects, barAfter.json.visual.objects);
    let objectKey = null;
    if (changedKeys.length === 1 && containsLiteral85(barAfter.json.visual.objects[changedKeys[0]])) {
        objectKey = changedKeys[0];
    }
    const capturedObject = objectKey ? barAfter.json.visual.objects[objectKey] : null;
    const capturedSelector = (capturedObject && capturedObject[0] && capturedObject[0].selector) || null;
    const capturedPropertyNames = (capturedObject && capturedObject[0] && capturedObject[0].properties)
        ? Object.keys(capturedObject[0].properties).sort()
        : [];
    const otherChangedPaths = diffObjects(before.files.bar.visualContainerObjects, barAfter.json.visual.visualContainerObjects)
        .map((e) => ({ ...e, path: ['visualContainerObjects', ...e.path] }));

    fixture.referenceLine = {
        spikeDir: toPosix(spikeDir),
        objectKey,
        candidates: changedKeys,
        capturedObject,
        capturedSelector,
        capturedPropertyNames,
        schema: extractSchemaVersion(barAfter.json.$schema),
        afterSha256: barAfter.sha256,
        afterMtime: new Date(barAfter.stat.mtimeMs).toISOString(),
        otherChangedPaths
    };

    // Call Volume card.
    const cardChangedPaths = [
        ...diffObjects(before.files.cardTotalCalls.objects, cardTotalCallsAfter.json.visual.objects)
            .map((e) => ({ ...e, path: ['objects', ...e.path] })),
        ...diffObjects(before.files.cardTotalCalls.visualContainerObjects, cardTotalCallsAfter.json.visual.visualContainerObjects)
            .map((e) => ({ ...e, path: ['visualContainerObjects', ...e.path] }))
    ];
    const boundPath = findPathToObjectWithProperty(cardTotalCallsAfter.json.visual, 'Property', 'Delta Baseline Label');

    fixture.cardCaption = {
        spikeDir: toPosix(spikeDir),
        changedPaths: cardChangedPaths,
        boundPath,
        capturedObjects: cardTotalCallsAfter.json.visual.objects,
        schema: extractSchemaVersion(cardTotalCallsAfter.json.$schema),
        afterSha256: cardTotalCallsAfter.sha256,
        afterMtime: new Date(cardTotalCallsAfter.stat.mtimeMs).toISOString()
    };

    // Avg Handle Time card (captionOff) - unchanged is a valid, recorded result, not an error.
    const captionOffChangedPaths = [
        ...diffObjects(before.files.cardAvgHandleTime.objects, cardAvgHandleTimeAfter.json.visual.objects)
            .map((e) => ({ ...e, path: ['objects', ...e.path] })),
        ...diffObjects(before.files.cardAvgHandleTime.visualContainerObjects, cardAvgHandleTimeAfter.json.visual.visualContainerObjects)
            .map((e) => ({ ...e, path: ['visualContainerObjects', ...e.path] }))
    ];
    fixture.captionOff = {
        spikeDir: toPosix(spikeDir),
        changed: cardAvgHandleTimeAfter.sha256 !== before.files.cardAvgHandleTime.sha256,
        changedPaths: captionOffChangedPaths,
        capturedObjects: cardAvgHandleTimeAfter.json.visual.objects,
        schema: extractSchemaVersion(cardAvgHandleTimeAfter.json.$schema),
        afterSha256: cardAvgHandleTimeAfter.sha256,
        afterMtime: new Date(cardAvgHandleTimeAfter.stat.mtimeMs).toISOString()
    };

    fixture.metadata.capturedAt = new Date().toISOString();
    writeFixture(repoRoot, fixture);

    if (objectKey === null) {
        console.error(`ambiguous: human review needed for bar-chart reference-line object key. candidates=${JSON.stringify(changedKeys)}`);
        process.exit(1);
        return;
    }

    console.log(`after: captured referenceLine.objectKey=${objectKey}, cardCaption.boundPath=${JSON.stringify(boundPath)}`);
}

// ---------------------------------------------------------------------------
// Mode: validate
// ---------------------------------------------------------------------------

function cmdValidate(repoRoot) {
    const pending = [];
    const fixturePath = path.join(repoRoot, FIXTURE_FILE);
    const worksheetPath = path.join(repoRoot, WORKSHEET_FILE);

    if (!fs.existsSync(fixturePath)) {
        pending.push(`fixture missing: ${FIXTURE_FILE}`);
    } else {
        const raw = fs.readFileSync(fixturePath, 'utf8');
        if (raw.includes(PENDING_TOKEN)) {
            let fixture;
            try {
                fixture = JSON.parse(raw);
            } catch (e) {
                pending.push(`fixture does not parse: ${e.message}`);
                fixture = null;
            }
            if (fixture) {
                for (const key of ['resaveEvidence', 'spikeBefore', 'referenceLine', 'cardCaption', 'captionOff']) {
                    if (fixture[key] === PENDING_TOKEN) {
                        pending.push(`fixture.${key}`);
                    }
                }
            } else {
                pending.push('fixture: pending token present but file failed to parse for section detection');
            }
        }
    }

    if (!fs.existsSync(worksheetPath)) {
        pending.push(`worksheet missing: ${WORKSHEET_FILE}`);
    } else {
        const text = fs.readFileSync(worksheetPath, 'utf8');
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
            if (line.includes(PENDING_TOKEN)) {
                pending.push(`worksheet field pending: ${line.trim()}`);
            }
        }
        const testerLine = lines.find((l) => l.startsWith('- TESTER:'));
        if (!testerLine) {
            pending.push('worksheet: missing "- TESTER:" field');
        } else if (testerLine.slice('- TESTER:'.length).trim().length === 0) {
            pending.push('worksheet: "- TESTER:" has no text after the colon');
        }
    }

    if (pending.length > 0) {
        console.error('validate: pending sections/fields remain:');
        for (const p of pending) console.error(`  - ${p}`);
        process.exit(1);
        return;
    }
    console.log('validate: OK, no pending sections or fields');
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

function main() {
    const mode = process.argv[2];
    const repoRoot = process.cwd();
    switch (mode) {
        case 'resave':
            return cmdResave(repoRoot);
        case 'validate':
            return cmdValidate(repoRoot);
        case 'prepare':
            return cmdPrepare(repoRoot, process.argv[3]);
        case 'after':
            return cmdAfter(repoRoot, process.argv[3]);
        default:
            console.error(`unknown mode: ${mode}. Expected one of: resave, prepare, after, validate`);
            process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { PENDING_TOKEN, loadValidatedFixture };
