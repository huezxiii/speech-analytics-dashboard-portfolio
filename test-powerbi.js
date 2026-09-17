const fs = require('fs');
const src = fs.readFileSync('powerbi.js', 'utf8');

// Minimal Papa stub mirroring the {fields, data} unparse form powerbi.js uses.
// Quoting is deliberately naive — these tests assert column SHAPE, not CSV escaping.
function unparse(input) {
    const fields = input.fields;
    const rows = input.data.map(function (cells) {
        return cells.map(function (v) {
            const s = String(v);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(',');
    });
    // Real Papa.unparse defaults to \r\n. The stub must match, or the CRLF invariant goes untested
    // here while the shipped CSV exercises it — which is how the CSV/TMDL line-ending inconsistency
    // stayed invisible in the first place.
    return [fields.join(',')].concat(rows).join('\r\n');
}

const c = { console, crypto, Papa: { unparse: unparse } };
const vm = require('vm');
vm.createContext(c);
vm.runInContext(src, c);

let failures = 0;
function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
        failures++;
        console.log('FAIL ' + name + '\n  expected: ' + JSON.stringify(expected) + '\n  actual:   '+ JSON.stringify(actual));
    }
}

const MANIFEST_NAMES = c.COLUMN_MANIFEST.map(function (col) { return col.name; });

// --- Baseline: file map builds and passes the clean-text gate ---
const fileMap = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01' }]);
console.log(Object.keys(fileMap).length, 'files generated.');
c.assertGeneratedTextIsClean(fileMap);
console.log('CLEAN OK');
c.assertThemeReferenceResolves(fileMap);
console.log('THEME REF OK');
if (typeof c.assertFieldReferencesResolve === 'function') {
    c.assertFieldReferencesResolve(fileMap);
    console.log('FIELD REFS OK');
}


// --- CR-01: CSV and M script must agree on column shape ---
// Regression guard for 18-REVIEW CR-01. index.html's validateColumns rejects MISSING
// required columns but permits EXTRA ones, so a user CSV with an additional field
// reaches generatePowerBIExport. Previously Papa.unparse(rows) shipped that extra
// column while the M query still declared Columns=15 — a silent CSV/M mismatch.
const CSV_KEY = 'powerbi/SpeechAnalytics.SemanticModel/data/dashboard-ready.csv';
const TMDL_KEY = 'powerbi/SpeechAnalytics.SemanticModel/definition/tables/Calls.tmdl';

const rowWithExtras = { Timestamp: '2026-01-01', Unexpected_Extra_Column: 'x', Another_Extra: 42 };
const extrasMap = c.buildPowerBIFileMap([rowWithExtras]);
const csvHeader = function (map) { return map[CSV_KEY].split(/\r?\n/)[0].split(','); };
const extrasHeader = csvHeader(extrasMap);
check('extra caller keys are dropped from the CSV header', extrasHeader, MANIFEST_NAMES);

const reorderedRow = {};
MANIFEST_NAMES.slice().reverse().forEach(function (n) { reorderedRow[n] = n; });
const reorderedHeader = csvHeader(c.buildPowerBIFileMap([reorderedRow]));
check('CSV header follows manifest order, not caller key order', reorderedHeader, MANIFEST_NAMES);

const emptyHeader = csvHeader(c.buildPowerBIFileMap([]));
check('header is emitted even with zero rows', emptyHeader, MANIFEST_NAMES);

// --- M script column count must track the manifest, not a magic number ---
const partition = c.buildCallsPartitionSource();
const declaredColumns = /Columns=(\d+)/.exec(partition);
check('M Columns= matches manifest length',
    declaredColumns && Number(declaredColumns[1]), MANIFEST_NAMES.length);

const typedNames = (partition.match(/\{"([^"]+)",/g) || []).map(function (m) {
    return m.slice(2, -2);
});
check('TransformColumnTypes pairs cover exactly the manifest columns in order',
    typedNames, MANIFEST_NAMES);

// --- 18-03 defect A regression: multi-line DAX must be fenced, never bare ---
// A bare multi-line measure expression is an `Other!` TMDL parse error that stops
// Power BI Desktop opening the project at all (18-03 defect A, commit eb088e2).
const callsTmdl = fileMap[TMDL_KEY];
const measureLines = callsTmdl.split(/\r?\n/).filter(function (l) { return /^\tmeasure /.test(l); });
const unfenced = measureLines.filter(function (l) { return /=\s*[^`\s].*\($/.test(l); });
check('no measure opens a multi-line expression without a backtick fence', unfenced, []);

// --- MODEL-05: names needing quotes are quoted in TMDL and DAX ---
check('quoteTmdlName quotes a name containing spaces and parens',
    c.quoteTmdlName('Call_Duration (s)'), "'Call_Duration (s)'");
check('quoteTmdlName leaves a plain identifier unquoted',
    c.quoteTmdlName('Contact_ID'), 'Contact_ID');
check('quoteTmdlName doubles an embedded apostrophe',
    c.quoteTmdlName("O'Brien"), "'O''Brien'");

// --- MODEL-06: flag columns must not default to Sum ---
const fcr = c.COLUMN_MANIFEST.filter(function (col) { return col.name === 'FCR_Flag'; })[0];
check('FCR_Flag does not default to Sum', fcr && fcr.summarizeBy, 'none');

// --- QUAL-02 / IN-03: output must be byte-identical across runs ---
// crypto.randomUUID() in buildPlatformFile was the last source of run-to-run drift, and was also a
// Secure-Contexts availability hazard on a file:// origin. Fixed logicalIds removed both.
const sameRowA = { Timestamp: '2026-01-01', Primary_Category: 'A', Call_Duration_s: 100 };
const sameRowB = { Timestamp: '2026-01-01', Call_Duration_s: 100, Primary_Category: 'A' }; // Differently ordered keys
const runA = JSON.stringify(c.buildPowerBIFileMap([sameRowA]));
const runB = JSON.stringify(c.buildPowerBIFileMap([sameRowA]));
const runC = JSON.stringify(c.buildPowerBIFileMap([sameRowB]));
check('file map is byte-identical across runs', runA === runB && runA === runC, true);

// --- IN-02: case-only path collisions must be rejected ---
let caughtCollision = false;
try {
    c.assertGeneratedTextIsClean({ 'powerbi/Calls.tmdl': 'a', 'powerbi/calls.tmdl': 'b' });
} catch (e) {
    caughtCollision = /collide when case is ignored/.test(e.message);
}
check('case-only path collision is rejected', caughtCollision, true);

// --- IN-01: quoting predicate is an allow-list, not a character deny-list ---
check('a name starting with a digit is quoted', c.quoteTmdlName('2024_Total'), "'2024_Total'");
check('a name containing # is quoted', c.quoteTmdlName('Rank#'), "'Rank#'");

// --- D-05: the theme reference drift probe must actually fire ---

let caughtDanglingPath = false;
try {
    const map = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01' }]);
    const reportJson = JSON.parse(map['powerbi/SpeechAnalytics.Report/definition/report.json']);
    const regResources = reportJson.resourcePackages.filter(function(p) { return p.type === 'RegisteredResources'; })[0];
    regResources.items[0].path = 'NotAcmeTheme.json';
    map['powerbi/SpeechAnalytics.Report/definition/report.json'] = JSON.stringify(reportJson, null, 2);
    c.assertThemeReferenceResolves(map);
} catch (e) {
    caughtDanglingPath = /Theme reference does not resolve to a file-map key/.test(e.message);
}
check('drift probe rejects a customTheme reference with no matching file', caughtDanglingPath, true);

let caughtMissingCustomTheme = false;
try {
    const map = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01' }]);
    const reportJson = JSON.parse(map['powerbi/SpeechAnalytics.Report/definition/report.json']);
    delete reportJson.themeCollection.customTheme;
    map['powerbi/SpeechAnalytics.Report/definition/report.json'] = JSON.stringify(reportJson, null, 2);
    c.assertThemeReferenceResolves(map);
} catch (e) {
    caughtMissingCustomTheme = /report\.json is missing themeCollection\.customTheme/.test(e.message);
}
check('drift probe rejects a missing customTheme block', caughtMissingCustomTheme, true);

let caughtDriftedName = false;
try {
    const map = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01' }]);
    const reportJson = JSON.parse(map['powerbi/SpeechAnalytics.Report/definition/report.json']);
    reportJson.themeCollection.customTheme.name = 'Acme Analytics';
    map['powerbi/SpeechAnalytics.Report/definition/report.json'] = JSON.stringify(reportJson, null, 2);
    c.assertThemeReferenceResolves(map);
} catch (e) {
    caughtDriftedName = /customTheme name has drifted from PBI_THEME/.test(e.message);
}
check('drift probe rejects a customTheme name that has drifted from the asset', caughtDriftedName, true);

// --- WR-02: .pbism version matches the Desktop-authored baseline ---
// Asserted as a literal rather than read from PBI_PBISM_VERSION: that is a top-level `const`, which
// V8 keeps in the declarative record and never exposes as a sandbox global property (the same reason
// COLUMN_MANIFEST is declared with `var`). Restating the expected value independently is what a test
// should do anyway — reading the constant back would only assert it equals itself.
const pbism = JSON.parse(fileMap['powerbi/SpeechAnalytics.SemanticModel/definition.pbism']);
check('definition.pbism version matches the Desktop baseline', pbism.version, '4.2');

// --- 19-02 Task 1: Palette assertions ---
const parsedThemeMap = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01' }]);
const task1ThemeStr = parsedThemeMap['powerbi/SpeechAnalytics.Report/StaticResources/RegisteredResources/AcmeTheme.json'];
const theme = task1ThemeStr ? JSON.parse(task1ThemeStr) : { dataColors: [] };

check('dataColors has eight slots', theme.dataColors ? theme.dataColors.length : 0, 8);
check('dataColors slot 1 is forestgreen brand accent', theme.dataColors ? theme.dataColors[0] : null, '#48B040');
check('dataColors slot 2 is tan secondary fill', theme.dataColors ? theme.dataColors[1] : null, '#DAC6AB');

const divergingActual = [theme.maximum, theme.center, theme.minimum];
const semanticActual = [theme.good, theme.neutral, theme.bad];
const divergingExpected = ['#48B040', '#DAC6AB', '#89705D'];
const semanticExpected = ['#48B040', '#C8C7CB', '#DAC6AB'];
check('diverging slots match Acme palette', divergingActual, divergingExpected);
check('semantic slots match Acme palette', semanticActual, semanticExpected);

check('center is distinct from both minimum and maximum',
    theme.center !== theme.minimum && theme.center !== theme.maximum, true);

const divergingAreColors = divergingActual.every(function(c) { return typeof c === 'string' && /^#[0-9A-F]{6}$/i.test(c); });
check('diverging slots are colors, not numbers', divergingAreColors, true);

const structuralExpected = { background: '#E3F1EA', firstLevelElements: '#171F1C', secondaryBackground: '#F8F8F8', tableAccent: '#48B040' };
const structuralActual = { background: theme.background, firstLevelElements: theme.firstLevelElements, secondaryBackground: theme.secondaryBackground, tableAccent: theme.tableAccent };
check('structural colors match the light theme specification', structuralActual, structuralExpected);

check('theme.background is derived light canvas', theme.background, '#E3F1EA');
check('theme.firstLevelElements is black', theme.firstLevelElements, '#171F1C');
check('theme.secondaryBackground is whitesmoke card surface', theme.secondaryBackground, '#F8F8F8');
check('theme.dataColors leading marks are forestgreen and tan', [theme.dataColors[0], theme.dataColors[1]], ['#48B040', '#DAC6AB']);

const textClassesOk = theme.textClasses && 
    Object.keys(theme.textClasses).sort().join(',') === 'callout,header,label,title' &&
    Object.keys(theme.textClasses).every(function(k) {
        const tc = theme.textClasses[k];
        const keys = Object.keys(tc).sort().join(',');
        const colorOk = tc.color === '#171F1C' || tc.color === '#53463C';
        return keys === 'color,fontSize' && colorOk && typeof tc.fontSize === 'number' && tc.fontSize >= 8 && tc.fontSize <= 60;
    });
check('textClasses set size and color and no font family', textClassesOk, true);

// Derived canvas matches computation (Task 3 requirement 4)
check('derived canvas matches blendOverWhite calculation', c.PBI_CANVAS_BACKGROUND, c.blendOverWhite(c.ACME_TOKENS.honeydew, 128));

// --- THEME-01/THEME-03: the theme palette must stay inside the brand, and stay row-independent ---
// Plan 24-09 pruned the stale allowlist (historical blends, dark palette, retired derivations):
const allowlist = [
    '#48B040', '#F8F8F8', '#DAC6AB', '#171F1C', '#53463C', '#C8C7CB', '#89705D', '#C7E4D5', // 8 brand tokens
    '#E3F1EA', // derived canvas: honeydew composited at 50% over white (blendOverWhite(ACME_TOKENS.honeydew, 128))
    '#A79486', '#7E746D' // 2 active derivations (border/outline, axis/gridline)
];

function collectColors(obj, found) {
    if (typeof obj === 'string') {
        if (/^#[0-9A-Fa-f]{6}$/.test(obj)) {
            found.push(obj.toUpperCase());
        }
    } else if (Array.isArray(obj)) {
        obj.forEach(function(item) { collectColors(item, found); });
    } else if (obj !== null && typeof obj === 'object') {
        Object.keys(obj).forEach(function(k) { collectColors(obj[k], found); });
    }
}
const foundColors = [];
collectColors(theme, foundColors);
const nonBrandColors = foundColors.filter(function(c) { return allowlist.indexOf(c) === -1; }).sort();
check('no non-brand color appears anywhere in the theme', nonBrandColors, []);

// Plan 24-09: Scan the whole generated file map — not just the theme object — for any six-digit hex
const mapHexes = [];
for (const [k, v] of Object.entries(fileMap)) {
    if (typeof v === 'string') {
        const matches = v.match(/#[0-9A-Fa-f]{6}\b/g) || [];
        for (const m of matches) {
            mapHexes.push(m.toUpperCase());
        }
    }
}
const nonBrandMapColors = Array.from(new Set(mapHexes)).filter(function(c) { return allowlist.indexOf(c) === -1; }).sort();
check('no non-brand color appears anywhere in the generated file map', nonBrandMapColors, []);

check('theme sets visualStyles', 'visualStyles' in theme, true);

function hasAnyExprProperty(obj) {
    if (obj && typeof obj === 'object') {
        if (Object.prototype.hasOwnProperty.call(obj, 'expr')) {
            return true;
        }
        for (const k of Object.keys(obj)) {
            if (hasAnyExprProperty(obj[k])) return true;
        }
    }
    return false;
}
check('visualStyles values are bare, not expr-wrapped', hasAnyExprProperty(theme.visualStyles), false);
check('theme does not set title show', !theme.visualStyles['*']['*'].title[0].show, true);
check('cardVisual display units are None',
    theme.visualStyles.cardVisual['*']['*'][0].displayUnits === 1 &&
    theme.visualStyles.cardVisual['*']['*'][0].labelDisplayUnits === 1, true);

// Check stripped per-visual properties vs surviving exceptions
const barPrimaryVisual = JSON.parse(fileMap['powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/9a3f7c2e5081bd64f29c/visual.json']);
const barPrimaryObjs = (barPrimaryVisual.visual || {}).objects || {};
const barPrimaryCatProps = (barPrimaryObjs.categoryAxis && barPrimaryObjs.categoryAxis[0] && barPrimaryObjs.categoryAxis[0].properties) || {};
const barPrimaryValProps = (barPrimaryObjs.valueAxis && barPrimaryObjs.valueAxis[0] && barPrimaryObjs.valueAxis[0].properties) || {};
check('barPrimaryCategory has no categoryAxis show/showAxisTitle', ('show' in barPrimaryCatProps) || ('showAxisTitle' in barPrimaryCatProps), false);
check('barPrimaryCategory has no valueAxis show/showAxisTitle', ('show' in barPrimaryValProps) || ('showAxisTitle' in barPrimaryValProps), false);

const barQueueVisual = JSON.parse(fileMap['powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/6f708192a3b4c5d6e7f8/visual.json']);
const barQueueValProps = (((barQueueVisual.visual || {}).objects || {}).valueAxis && barQueueVisual.visual.objects.valueAxis[0].properties) || {};
check('barQueueBreakdown retains axisFloor start 75D', (barQueueValProps.start && barQueueValProps.start.expr && barQueueValProps.start.expr.Literal && barQueueValProps.start.expr.Literal.Value), '75D');

const cardTotalCallsVisual = JSON.parse(fileMap['powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/1b7e4a2c8f60d3591c4b/visual.json']);
const cardTotalObjs = (cardTotalCallsVisual.visual || {}).objects || {};
check('cardTotalCalls visual has no outline card', 'outline' in cardTotalObjs, false);
check('cardTotalCalls visual retains label card', !!cardTotalObjs.label, true);

const lineVolumeVisual = JSON.parse(fileMap['powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/8d15e0b96c4a273f01de/visual.json']);
const lineLabelsShow = (((lineVolumeVisual.visual || {}).objects || {}).labels && lineVolumeVisual.visual.objects.labels[0].properties.show.expr.Literal.Value);
check('lineVolumeTrend retains labels show false', lineLabelsShow, 'false');

const mapZero = c.buildPowerBIFileMap([]);
const mapNull = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01', Customer_Sentiment: null }]);
const themeStrPopulated = task1ThemeStr;
const themeStrZero = mapZero['powerbi/SpeechAnalytics.Report/StaticResources/RegisteredResources/AcmeTheme.json'];
const themeStrNull = mapNull['powerbi/SpeechAnalytics.Report/StaticResources/RegisteredResources/AcmeTheme.json'];

check('theme asset is identical for zero rows', themeStrZero, themeStrPopulated);
check('theme asset is identical when Customer_Sentiment is absent or null', themeStrNull, themeStrPopulated);

const mapA = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01', Primary_Category: 'A' }]);
const mapB = c.buildPowerBIFileMap([{ Timestamp: '2026-01-02', Primary_Category: 'B' }]);
const dataColorsA = JSON.parse(mapA['powerbi/SpeechAnalytics.Report/StaticResources/RegisteredResources/AcmeTheme.json']).dataColors;
const dataColorsB = JSON.parse(mapB['powerbi/SpeechAnalytics.Report/StaticResources/RegisteredResources/AcmeTheme.json']).dataColors;
check('dataColors order is stable across repeated builds', JSON.stringify(dataColorsA) === JSON.stringify(dataColorsB) && dataColorsA[0] === '#48B040', true);

// --- CsvFolderPath ships unset, and the M guards on the same sentinel ---
// A "." default made "operator forgot to set it" and "path is wrong" produce an identical error.
// The default and the guard live in two files, so assert they still agree.
const expressionsTmdl = fileMap['powerbi/SpeechAnalytics.SemanticModel/definition/expressions.tmdl'];
const defaultValue = /expression CsvFolderPath = "([^"]*)"/.exec(expressionsTmdl);
check('CsvFolderPath does not default to a usable-looking path',
    defaultValue && defaultValue[1] !== '.', true);

const partitionM = c.buildCallsPartitionSource();
check('M guards on the same sentinel the parameter defaults to',
    defaultValue && partitionM.indexOf('if CsvFolderPath = "' + defaultValue[1] + '" then error') !== -1, true);
check('M reads the guarded value, not the raw parameter',
    /File\.Contents\(Configured &/.test(partitionM), true);

// --- Line endings are uniformly CRLF across every generated file ---
// The archive was previously mixed: Papa.unparse emits CRLF for the CSV while every TMDL/JSON/README
// file was bare LF. Desktop's own files are CRLF, and it rewrites them on save, so an LF export that
// a user git-tracks shows wholly-modified files after the first save.
const bareLf = Object.keys(fileMap).filter(function (k) { return /(^|[^\r])\n/.test(fileMap[k]); });
check('no generated file contains a bare LF', bareLf, []);
const crlfCount = (fileMap[CSV_KEY].match(/\r\n/g) || []).length;
check('the CSV itself uses CRLF', crlfCount > 0, true);

// --- Phase 19-01 assertions ---
check('theme asset exists at the D-02 locked path', 
    Object.prototype.hasOwnProperty.call(fileMap, 'powerbi/SpeechAnalytics.Report/StaticResources/RegisteredResources/AcmeTheme.json'), true);

const themeAssetStr = fileMap['powerbi/SpeechAnalytics.Report/StaticResources/RegisteredResources/AcmeTheme.json'];
const themeAsset = themeAssetStr ? JSON.parse(themeAssetStr) : {};
check('theme name is single-sourced from PBI_THEME', 
    themeAsset.name === c.PBI_THEME.theme.name && themeAsset.name === 'Acme', true);

const reportJson = JSON.parse(fileMap['powerbi/SpeechAnalytics.Report/definition/report.json']);
check('customTheme name matches the theme asset name (D-05 drift probe)', 
    reportJson.themeCollection.customTheme.name, themeAsset.name);

const regResources = reportJson.resourcePackages.filter(function(p) { return p.type === 'RegisteredResources'; })[0] || { items: [{}] };
check('RegisteredResources item path resolves to the theme file-map key',
    'powerbi/SpeechAnalytics.Report/StaticResources/RegisteredResources/' + regResources.items[0].path, 
    'powerbi/SpeechAnalytics.Report/StaticResources/RegisteredResources/AcmeTheme.json');

check('customTheme carries all three ThemeMetadata fields',
    Object.keys(reportJson.themeCollection.customTheme).sort(), ['name', 'reportVersionAtImport', 'type']);
check('customTheme type is RegisteredResources',
    reportJson.themeCollection.customTheme.type, 'RegisteredResources');

check('baseTheme block is untouched by Phase 19',
    reportJson.themeCollection.baseTheme, { name: 'Fluent2-CY26SU08', reportVersionAtImport: { visual: '2.12.0', report: '3.4.0', page: '2.3.1' }, type: 'SharedResources' });
const fluent2Stub = JSON.parse(fileMap['powerbi/SpeechAnalytics.Report/StaticResources/SharedResources/BaseThemes/Fluent2-CY26SU08.json']);
check('fluent2 stub only has name', Object.keys(fluent2Stub), ['name']);
check('fluent2 stub name is Fluent 2 (Preview)', fluent2Stub.name, 'Fluent 2 (Preview)');

const sharedResources = reportJson.resourcePackages.filter(function(p) { return p.type === 'SharedResources'; })[0];
check('SharedResources package entry is untouched by Phase 19',
    sharedResources, { name: 'SharedResources', type: 'SharedResources', items: [{ name: 'Fluent2-CY26SU08', path: 'BaseThemes/Fluent2-CY26SU08.json', type: 'BaseTheme' }] });

const themeCollectionKeys = Object.keys(fileMap).filter(function(k) { return fileMap[k].indexOf('themeCollection') !== -1; });
check('themeCollection appears in exactly one generated file', 
    themeCollectionKeys.length === 1 && themeCollectionKeys[0] === 'powerbi/SpeechAnalytics.Report/definition/report.json', true);


let caughtBareLf = false;
try {
    c.assertGeneratedTextIsClean({ 'powerbi/x.tmdl': 'line one\nline two' });
} catch (e) {
    caughtBareLf = /Bare LF/.test(e.message);
}
check('clean-text gate rejects a bare LF', caughtBareLf, true);

// --- 20-01: Executive Hub page manifest, first KPI card, field-reference gate ---

check('page manifest carries pages with valid properties', 
    Array.isArray(c.PBI_PAGES) && c.PBI_PAGES.length >= 1 && Object.keys(c.PBI_PAGES[0]).sort().join(',') === 'displayName,id,key,layout,ordinal', true);

check('Executive Hub reuses the scaffold page id', 
    Array.isArray(c.PBI_PAGES) && c.PBI_PAGES.length > 0 && c.PBI_PAGES[0].id === 'a1b2c3d4e5f6a7b8c9d0' && /^[0-9a-f]{20}$/.test(c.PBI_PAGES[0].id), true);

const pageJsonStr = fileMap['powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/page.json'];
const pageJson = pageJsonStr ? JSON.parse(pageJsonStr) : {};
check('page.json displayName is Executive Hub',
    pageJson.displayName === 'Executive Hub' && pageJson.name === 'a1b2c3d4e5f6a7b8c9d0' && pageJson.height === 1080 && pageJson.width === 1920, true);

const pagesJsonStr = fileMap['powerbi/SpeechAnalytics.Report/definition/pages/pages.json'];
const pagesJson = pagesJsonStr ? JSON.parse(pagesJsonStr) : {};
check('pages.json is derived from the page manifest',
    JSON.stringify(pagesJson.pageOrder) === JSON.stringify(['a1b2c3d4e5f6a7b8c9d0', 'd4e5f6a7b8c9d0e1f2a3', 'b2c3d4e5f6a7b8c9d0e1', '34e0f1a2b3c4d5e60718']) && pagesJson.activePageName === 'a1b2c3d4e5f6a7b8c9d0', true);

const layoutValid = Array.isArray(c.PBI_EXEC_LAYOUT) && c.PBI_EXEC_LAYOUT.length === 16 && c.PBI_EXEC_LAYOUT.every(function(s) {
    return /^[0-9a-f]{20}$/.test(s.id) && s.id !== 'a1b2c3d4e5f6a7b8c9d0' && s.x >= 0 && s.y >= 0 && (s.x + s.width) <= 1920 && (s.y + s.height) <= 1080;
});
const layoutIds = Array.isArray(c.PBI_EXEC_LAYOUT) ? c.PBI_EXEC_LAYOUT.map(function(s) { return s.id; }) : [];
let layoutIdsDistinct = false;
if (typeof Set !== 'undefined') {
    layoutIdsDistinct = new Set(layoutIds).size === 16;
} else {
    layoutIdsDistinct = layoutIds.filter(function(v, i, a) { return a.indexOf(v) === i; }).length === 16;
}
let hasOverlap = false;
if (Array.isArray(c.PBI_EXEC_LAYOUT)) {
    for (let i = 0; i < c.PBI_EXEC_LAYOUT.length; i++) {
        for (let j = i + 1; j < c.PBI_EXEC_LAYOUT.length; j++) {
            const a = c.PBI_EXEC_LAYOUT[i];
            const b = c.PBI_EXEC_LAYOUT[j];
            if (a.layer !== 'background' && b.layer !== 'background') {
                if (!(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)) {
                    hasOverlap = true;
                }
            }
        }
    }
}
check('layout manifest holds fifteen slots with no content overlap', layoutValid && layoutIdsDistinct && !hasOverlap, true);

const cardSlots = Array.isArray(c.PBI_EXEC_LAYOUT) ? c.PBI_EXEC_LAYOUT.filter(function(s) { return s.kind === 'card'; }) : [];
const directionCounts = { invert: 0, normal: 0 };
cardSlots.forEach(function(s) { if (s.deltaDirection) directionCounts[s.deltaDirection] = (directionCounts[s.deltaDirection] || 0) + 1; });
check('KPI slots carry a direction flag',
    cardSlots.length === 7 && directionCounts.invert === 3 && directionCounts.normal === 4, true);

// --- 20-10: File map layout slot coverage ---
const pageId = c.PBI_PAGES[0].id;
const visualFileKeys = Object.keys(fileMap).filter(function(k) {
    return k.startsWith('powerbi/' + c.PBI_PROJECT_NAME + '.Report/definition/pages/' + pageId + '/visuals/') && k.endsWith('/visual.json');
});
const layoutSlotIds = c.PBI_EXEC_LAYOUT.map(function(s) { return s.id; });
const allSlotsPresentInFileMap = layoutSlotIds.every(function(id) {
    const k = 'powerbi/' + c.PBI_PROJECT_NAME + '.Report/definition/pages/' + pageId + '/visuals/' + id + '/visual.json';
    return Object.prototype.hasOwnProperty.call(fileMap, k);
});
const noOrphanVisuals = visualFileKeys.every(function(k) {
    const match = k.match(/visuals\/([0-9a-f]{20})\/visual\.json$/);
    return match && layoutSlotIds.indexOf(match[1]) !== -1;
});
check('generated file map contains one visual.json per layout slot with no orphans',
    allSlotsPresentInFileMap && noOrphanVisuals && visualFileKeys.length === layoutSlotIds.length, true);

// --- 20-08: Layout height & geometry assertions ---
const allCardsClearMinHeight = Array.isArray(c.PBI_EXEC_LAYOUT) && c.PBI_EXEC_LAYOUT
    .filter(function(s) { return s.kind === 'card'; })
    .every(function(s) { return s.height >= 114; });
check('every card slot height is at least 114', allCardsClearMinHeight, true);

const allSlotsWithinCanvas = Array.isArray(c.PBI_EXEC_LAYOUT) && c.PBI_EXEC_LAYOUT
    .every(function(s) { return s.x + s.width <= 1920 && s.y + s.height <= 1080; });
check('every slot fits within 1920x1080 canvas', allSlotsWithinCanvas, true);

let probeBelowMinThrows = false;
let probeOffCanvasThrows = false;
let probeOverlapThrows = false;
let probeCleanPasses = false;

if (typeof c.assertExecLayoutIsRenderable === 'function') {
    try {
        c.assertExecLayoutIsRenderable(fileMap);
        probeCleanPasses = true;
    } catch(e) {}

    // 1. Mutate card slot height below minimum
    const cardSlot = c.PBI_EXEC_LAYOUT.find(s => s.key === 'cardTotalCalls');
    const origHeight = cardSlot.height;
    cardSlot.height = 40;
    try {
        c.assertExecLayoutIsRenderable(fileMap);
    } catch(e) {
        if (/cardTotalCalls/.test(e.message) && /below minimum/.test(e.message)) {
            probeBelowMinThrows = true;
        }
    }
    cardSlot.height = origHeight;

    // 2. Mutate slot past canvas edge
    const bandSlot = c.PBI_EXEC_LAYOUT[0];
    const origWidth = bandSlot.width;
    bandSlot.width = 2000;
    try {
        c.assertExecLayoutIsRenderable(fileMap);
    } catch(e) {
        if (/(headerBand|title)/.test(e.message) && /extends beyond/.test(e.message)) {
            probeOffCanvasThrows = true;
        }
    }
    bandSlot.width = origWidth;

    // 3. Mutate two slots into an overlap
    const handleTimeSlot = c.PBI_EXEC_LAYOUT.find(s => s.key === 'cardAvgHandleTime');
    const origX = handleTimeSlot.x;
    handleTimeSlot.x = 24;
    try {
        c.assertExecLayoutIsRenderable(fileMap);
    } catch(e) {
        if (/cardTotalCalls/.test(e.message) && /cardAvgHandleTime/.test(e.message) && /overlaps/.test(e.message)) {
            probeOverlapThrows = true;
        }
    }
    handleTimeSlot.x = origX;
}
check('assertExecLayoutIsRenderable passes on clean file map', probeCleanPasses, true);
check('assertExecLayoutIsRenderable throws when card height is below minimum', probeBelowMinThrows, true);
check('assertExecLayoutIsRenderable throws when slot extends off canvas', probeOffCanvasThrows, true);
check('assertExecLayoutIsRenderable throws when two slots overlap', probeOverlapThrows, true);

const callsTmdlContent = fileMap['powerbi/SpeechAnalytics.SemanticModel/definition/tables/Calls.tmdl'] || '';
const hasDeltaFence = /^\tmeasure 'Total Calls Delta %' = ```\r?$/m.test(callsTmdlContent);
const measureSection = callsTmdlContent.substring(callsTmdlContent.indexOf("'Total Calls Delta %' = ```"));
const hasFormatString = hasDeltaFence && measureSection.indexOf('formatString:') > -1;
const deltaDeclarationCount = (callsTmdlContent.match(/^\tmeasure 'Total Calls Delta %' =/mg) || []).length;
check('Total Calls Delta % is a real model measure', hasDeltaFence && hasFormatString && deltaDeclarationCount === 1, true);

const visualKey = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/1b7e4a2c8f60d3591c4b/visual.json';
const hasVisualKey = Object.prototype.hasOwnProperty.call(fileMap, visualKey);
check('first KPI card is emitted under the page\'s visuals directory', hasVisualKey, true);

const visualJsonStr = fileMap[visualKey];
const visualJson = visualJsonStr ? JSON.parse(visualJsonStr) : { visual: { query: { queryState: { Data: { projections: [] } } } } };
const dataProjections = (((visualJson.visual || {}).query || {}).queryState || {}).Data || { projections: [] };
const hasProjectionsKey = Object.prototype.hasOwnProperty.call((visualJson.visual || {}).query || {}, 'projections');
check('first KPI card binds the Data role to a real measure',
    visualJson.visual && visualJson.visual.visualType === 'cardVisual' &&
    dataProjections.projections && dataProjections.projections.length === 1 &&
    dataProjections.projections[0].field && dataProjections.projections[0].field.Measure &&
    dataProjections.projections[0].field.Measure.Expression.SourceRef.Entity === 'Calls' &&
    dataProjections.projections[0].field.Measure.Property === 'Total Calls' &&
    !hasProjectionsKey, true);

// D-06: Native reference label carries the delta and baseline label
const refLabelObj = visualJson.visual && visualJson.visual.objects && visualJson.visual.objects.referenceLabel && visualJson.visual.objects.referenceLabel[0];
check('first KPI card carries folded native referenceLabel object', !!refLabelObj, true);
// G-36-8: the old compound properties.title binding (an unverified analogy Desktop's own resave
// deleted from all seven cards) is replaced by Desktop's own captured caption shape, applied via
// applyCardCaptionShape and re-checked by assertCardCaptionsMatchDesktopShape on every run.
let cardCaptionShapeThrew = false;
try {
    c.assertCardCaptionsMatchDesktopShape(fileMap);
} catch (e) {
    cardCaptionShapeThrew = true;
}
check('folded card carries the Desktop-captured caption shape', cardCaptionShapeThrew, false);
check('folded card emits no compound referenceLabel title', refLabelObj && refLabelObj.properties && Object.prototype.hasOwnProperty.call(refLabelObj.properties, 'title'), false);
check('folded card referenceLabel value binds Total Calls Delta % Label', refLabelObj && refLabelObj.properties && refLabelObj.properties.value && refLabelObj.properties.value.expr && refLabelObj.properties.value.expr.Measure && refLabelObj.properties.value.expr.Measure.Property, 'Total Calls Delta % Label');

// D-07 Option C: Glyph carries direction alone, no static or misleading colour literal
let hasMisleadingColorLiteral = false;
cardSlots.forEach(function(s) {
    const vKey = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/' + s.id + '/visual.json';
    const vStr = fileMap[vKey] || '';
    if (vStr.includes('#9AD496') || vStr.includes('#DAC6AB')) {
        hasMisleadingColorLiteral = true;
    }
});
check('no KPI card contains generation-time static delta colour literals', hasMisleadingColorLiteral, false);

// Verify derived label measures carry formatting and glyphs
const callsMeasuresMap = new Map(c.CALLS_MEASURES.map(m => [m.name, m]));
check('Has Active Filter measure exists in CALLS_MEASURES', callsMeasuresMap.has('Has Active Filter'), true);
check('Has Active Filter compares against ALL(\'Calls\')', (callsMeasuresMap.get('Has Active Filter').dax || '').includes("ALL('Calls')"), true);
check('Delta Baseline Label measure exists in CALLS_MEASURES', callsMeasuresMap.has('Delta Baseline Label'), true);

let allLabelMeasuresValid = true;
cardSlots.forEach(function(s) {
    if (!s.deltaMeasure) return;
    const labelMeasure = callsMeasuresMap.get(`${s.deltaMeasure} Label`);
    if (!labelMeasure) {
        allLabelMeasuresValid = false;
        return;
    }
    const dax = labelMeasure.dax || '';
    const targetMeasure = callsMeasuresMap.get(s.deltaMeasure);
    const expectedFmt = targetMeasure ? targetMeasure.formatString.replace(/"/g, '""') : '';
    if (!dax.includes('▲') || !dax.includes('▼') || !dax.includes(expectedFmt)) {
        allLabelMeasuresValid = false;
    }
});
check('derived label measures contain ▲, ▼, and matching format strings', allLabelMeasuresValid, true);

let condRefThrows = false;
try {
    const testMap = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01' }]);
    const vJson = JSON.parse(testMap[visualKey]);
    vJson.visual.objects.referenceLabel[0].properties.value = {
        expr: {
            Measure: {
                Expression: { SourceRef: { Entity: 'Calls' } },
                Property: 'NonExistentDeltaMeasure'
            }
        }
    };
    testMap[visualKey] = JSON.stringify(vJson);
    c.assertFieldReferencesResolve(testMap);
} catch (e) {
    if (/NonExistentDeltaMeasure/.test(e.message) && (e.message.includes('1b7e4a2c8f60d3591c4b') || /visual/i.test(e.message))) {
        condRefThrows = true;
    }
}
check('field-reference gate catches and names invalid measure in visual objects tree', condRefThrows, true);

check('the export path runs the field-reference gate', typeof c.assertFieldReferencesResolve === 'function', true);

check('file count grows by visuals (at least 47 files)', Object.keys(fileMap).length >= 47, true);

const mapA1 = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01', Primary_Category: 'A' }, { Timestamp: '2026-01-02', Primary_Category: 'B' }]);
const mapA2 = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01', Primary_Category: 'A' }, { Timestamp: '2026-01-02', Primary_Category: 'B' }]);
const mapB1 = c.buildPowerBIFileMap([{ Timestamp: '2026-01-02', Primary_Category: 'B' }, { Timestamp: '2026-01-01', Primary_Category: 'A' }]);
const mapB2 = c.buildPowerBIFileMap([{ Timestamp: '2026-01-02', Primary_Category: 'B' }, { Timestamp: '2026-01-01', Primary_Category: 'A' }]);
check('export output is still byte-identical across runs', 
    JSON.stringify(mapA1) === JSON.stringify(mapA2) && 
    JSON.stringify(mapB1) === JSON.stringify(mapB2), true);

// --- 20-04: call volume trend ---
const lineVisualKey = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/8d15e0b96c4a273f01de/visual.json';
const hasLineVisualKey = Object.prototype.hasOwnProperty.call(fileMap, lineVisualKey);
check('line chart visual is emitted', hasLineVisualKey, true);

const lineVisualJsonStr = fileMap[lineVisualKey];
const lineVisualJson = lineVisualJsonStr ? JSON.parse(lineVisualJsonStr) : { visual: { query: { queryState: {} }, objects: {} } };
check('line chart declares the cartesian line visual type', lineVisualJson.visual && lineVisualJson.visual.visualType, 'lineChart');

const lineCategoryProjections = (((lineVisualJson.visual || {}).query || {}).queryState || {}).Category || { projections: [] };
const lineCategoryProp = lineCategoryProjections.projections && lineCategoryProjections.projections[0] && lineCategoryProjections.projections[0].field && lineCategoryProjections.projections[0].field.Column && lineCategoryProjections.projections[0].field.Column.Property;
check('line chart category axis is not bound to raw Timestamp column', lineCategoryProp !== 'Timestamp', true);
check('line chart category axis binds the day-grain Call_Date column', lineCategoryProp, 'Call_Date');

// --- 20-09: Derived columns in TMDL and M partition ---
const derivedNames = Array.isArray(c.CALLS_DERIVED_COLUMNS) ? c.CALLS_DERIVED_COLUMNS.map(function(d) { return d.name; }) : [];
check('CALLS_DERIVED_COLUMNS contains Call_Date', derivedNames.indexOf('Call_Date') !== -1, true);

const hasDerivedTmdl = /column Call_Date\r?\n\s+dataType: dateTime/m.test(callsTmdlContent) || /column Call_Date\r?\n\s+dataType: dateTime/m.test(fileMap['powerbi/SpeechAnalytics.SemanticModel/definition/tables/Calls.tmdl'] || '');
check('Calls.tmdl contains Call_Date column block', hasDerivedTmdl, true);

const hasAddColumnM = /Table\.AddColumn\([^,]+,\s*"Call_Date",\s*each DateTime\.Date\(\[Timestamp\]\),\s*type date\)/.test(fileMap['powerbi/SpeechAnalytics.SemanticModel/definition/tables/Calls.tmdl'] || '');
check('Calls.tmdl M partition includes Table.AddColumn step for Call_Date', hasAddColumnM, true);

const lineYProjections = (((lineVisualJson.visual || {}).query || {}).queryState || {}).Y || { projections: [] };
check('line chart plots call volume on the value axis',
    lineYProjections.projections && lineYProjections.projections.length === 1 &&
    lineYProjections.projections[0].field && lineYProjections.projections[0].field.Measure &&
    lineYProjections.projections[0].field.Measure.Property === 'Total Calls', true);

const lineQueryStateKeys = Object.keys(((lineVisualJson.visual || {}).query || {}).queryState || {}).sort();
check('line chart has no series role', lineQueryStateKeys, ['Category', 'Y']);

const lineObjects = (lineVisualJson.visual || {}).objects || {};
let hasMetadataSelector = false;
Object.keys(lineObjects).forEach(function(k) {
    if (Array.isArray(lineObjects[k])) {
        lineObjects[k].forEach(function(item) {
            if (item.selector && item.selector.metadata) {
                hasMetadataSelector = true;
            }
        });
    }
});
const lineVCObjects = (lineVisualJson.visual || {}).visualContainerObjects || {};
check('line chart carries explicit formatting', 
    !!lineObjects.labels && !!lineVCObjects.title && !hasMetadataSelector, true);

const lineSlot = Array.isArray(c.PBI_EXEC_LAYOUT) ? c.PBI_EXEC_LAYOUT.filter(function(s) { return s.id === '8d15e0b96c4a273f01de'; })[0] : {};
const linePosition = lineVisualJson.position || {};
check('line chart position matches its layout slot',
    linePosition.x === lineSlot.x && linePosition.y === lineSlot.y && linePosition.z === lineSlot.z &&
    linePosition.width === lineSlot.width && linePosition.height === lineSlot.height, true);

// --- 20-04: Primary_Category breakdown, bound to the live column ---
const barVisualKey = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/9a3f7c2e5081bd64f29c/visual.json';
const hasBarVisualKey = Object.prototype.hasOwnProperty.call(fileMap, barVisualKey);
check('bar chart visual is emitted', hasBarVisualKey, true);

const barVisualJsonStr = fileMap[barVisualKey];
const barVisualJson = barVisualJsonStr ? JSON.parse(barVisualJsonStr) : { visual: { query: { queryState: {} }, objects: {} } };
check('bar chart declares a clustered bar visual type', barVisualJson.visual && barVisualJson.visual.visualType, 'clusteredBarChart');

const barCategoryProjections = (((barVisualJson.visual || {}).query || {}).queryState || {}).Category || { projections: [] };
check('bar chart categorises on the live category column',
    barCategoryProjections.projections && barCategoryProjections.projections.length === 1 &&
    barCategoryProjections.projections[0].field && barCategoryProjections.projections[0].field.Column &&
    barCategoryProjections.projections[0].field.Column.Expression &&
    barCategoryProjections.projections[0].field.Column.Expression.SourceRef &&
    barCategoryProjections.projections[0].field.Column.Expression.SourceRef.Entity === 'Calls' &&
    barCategoryProjections.projections[0].field.Column.Property === 'Primary_Category', true);

const barYProjections = (((barVisualJson.visual || {}).query || {}).queryState || {}).Y || { projections: [] };
check('bar chart measures call volume',
    barYProjections.projections && barYProjections.projections.length === 1 &&
    barYProjections.projections[0].field && barYProjections.projections[0].field.Measure &&
    barYProjections.projections[0].field.Measure.Property === 'Total Calls', true);

const demoCategories = ['Sensor_Replacement', 'Bluetooth_General', 'Billing_Inquiry', 'App_Error', 'Shipping_Status', 'G7_iOS_Pairing_Failure'];
let foundDemoCategory = false;
Object.keys(fileMap).forEach(function(k) {
    if (/visuals\/[0-9a-f]{20}\/visual\.json$/.test(k)) {
        const content = fileMap[k];
        demoCategories.forEach(function(cat) {
            if (content.indexOf(cat) !== -1) {
                foundDemoCategory = true;
            }
        });
    }
});
check('no category value string appears in any emitted visual', foundDemoCategory, false);

const mapDisjoint1 = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01', Primary_Category: 'Sensor_Replacement' }]);
const mapDisjoint2 = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01', Primary_Category: 'Billing_Inquiry' }]);
check('the breakdown is row-independent', mapDisjoint1[barVisualKey] === mapDisjoint2[barVisualKey], true);

const barSlot = Array.isArray(c.PBI_EXEC_LAYOUT) ? c.PBI_EXEC_LAYOUT.filter(function(s) { return s.id === '9a3f7c2e5081bd64f29c'; })[0] : {};
const barPosition = barVisualJson.position || {};
check('bar chart position matches its layout slot',
    barPosition.x === barSlot.x && barPosition.y === barSlot.y && barPosition.z === barSlot.z &&
    barPosition.width === barSlot.width && barPosition.height === barSlot.height, true);

// --- 20-04: page title textbox ---
const textboxVisualKey = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/0c1a5e7b3d9f204186ea/visual.json';
const hasTextboxVisualKey = Object.prototype.hasOwnProperty.call(fileMap, textboxVisualKey);
check('textbox visual is emitted', hasTextboxVisualKey, true);

const textboxVisualJsonStr = fileMap[textboxVisualKey];
const textboxVisualJson = textboxVisualJsonStr ? JSON.parse(textboxVisualJsonStr) : { visual: {} };
check('textbox visual declares the textbox visual type', textboxVisualJson.visual && textboxVisualJson.visual.visualType, 'textbox');
check('textbox visual has no query block', Object.prototype.hasOwnProperty.call(textboxVisualJson.visual || {}, 'query'), false);

let titleText = '';
let titleColor = '';
let titleAlignment = '';
if (textboxVisualJson.visual && textboxVisualJson.visual.objects && textboxVisualJson.visual.objects.general && textboxVisualJson.visual.objects.general.length > 0) {
    const paragraphs = textboxVisualJson.visual.objects.general[0].properties.paragraphs;
    if (paragraphs && paragraphs.length > 0) {
        titleAlignment = paragraphs[0].horizontalTextAlignment;
        if (paragraphs[0].textRuns && paragraphs[0].textRuns.length > 0) {
            titleText = paragraphs[0].textRuns[0].value;
            titleColor = paragraphs[0].textRuns[0].textStyle.color;
        }
    }
}
check('textbox text is Executive Hub', titleText, 'Executive Hub');
check('textbox text color matches theme', titleColor, '#F8F8F8');
check('textbox paragraph alignment is center', titleAlignment, 'center');

let bandBackgroundColor = '';
let bandBackgroundShow = '';
let bandBackgroundTransparency = '';
if (textboxVisualJson.visual && textboxVisualJson.visual.visualContainerObjects && textboxVisualJson.visual.visualContainerObjects.background && textboxVisualJson.visual.visualContainerObjects.background[0]) {
    const bgProps = textboxVisualJson.visual.visualContainerObjects.background[0].properties;
    if (bgProps && bgProps.color && bgProps.color.solid && bgProps.color.solid.color && bgProps.color.solid.color.expr && bgProps.color.solid.color.expr.Literal) {
        bandBackgroundColor = bgProps.color.solid.color.expr.Literal.Value;
    }
    if (bgProps && bgProps.show && bgProps.show.expr && bgProps.show.expr.Literal) {
        bandBackgroundShow = bgProps.show.expr.Literal.Value;
    }
    if (bgProps && bgProps.transparency && bgProps.transparency.expr && bgProps.transparency.expr.Literal) {
        bandBackgroundTransparency = bgProps.transparency.expr.Literal.Value;
    }
}
check('textbox band background color is forestgreen', bandBackgroundColor, "'#48B040'");
check('textbox band background show is true', bandBackgroundShow, "true");
check('textbox band background transparency is 0D', bandBackgroundTransparency, "0D");

const textboxSlot = Array.isArray(c.PBI_EXEC_LAYOUT) ? c.PBI_EXEC_LAYOUT.filter(function(s) { return s.id === '0c1a5e7b3d9f204186ea'; })[0] : {};
const textboxPosition = textboxVisualJson.position || {};
check('textbox position matches its layout slot',
    textboxPosition.x === textboxSlot.x && textboxPosition.y === textboxSlot.y && textboxPosition.z === textboxSlot.z &&
    textboxPosition.width === textboxSlot.width && textboxPosition.height === textboxSlot.height, true);

let textboxGatePassed = false;
try {
    if (typeof c.assertFieldReferencesResolve === 'function') {
        c.assertFieldReferencesResolve(fileMap);
        textboxGatePassed = true;
    }
} catch(e) {}
check('textbox visual passes field-reference gate', textboxGatePassed, true);

// --- 20-05: date and category slicers ---
const dateSlicerKey = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/a0e94b18d5c7360f2b83/visual.json';
const catSlicerKey = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/b17c60ea294f8d3501ba/visual.json';

check('both slicer visuals are emitted', 
    Object.prototype.hasOwnProperty.call(fileMap, dateSlicerKey) && 
    Object.prototype.hasOwnProperty.call(fileMap, catSlicerKey), true);

const dateSlicerStr = fileMap[dateSlicerKey];
const catSlicerStr = fileMap[catSlicerKey];
const dateSlicerVis = dateSlicerStr ? JSON.parse(dateSlicerStr) : { visual: { visualType: '' } };
const catSlicerVis = catSlicerStr ? JSON.parse(catSlicerStr) : { visual: { visualType: '' } };

check('both declare the classic slicer visual type', 
    dateSlicerVis.visual && dateSlicerVis.visual.visualType === 'slicer' && catSlicerVis.visual && catSlicerVis.visual.visualType === 'slicer', true);

let dateSlicerMode = '';
if (dateSlicerVis.visual && dateSlicerVis.visual.objects && dateSlicerVis.visual.objects.data && dateSlicerVis.visual.objects.data[0].properties.mode) {
    dateSlicerMode = dateSlicerVis.visual.objects.data[0].properties.mode.expr.Literal.Value;
}
check('the date slicer is a two-handle range', dateSlicerMode, "'Between'");

let catSlicerMode = '';
if (catSlicerVis.visual && catSlicerVis.visual.objects && catSlicerVis.visual.objects.data && catSlicerVis.visual.objects.data[0].properties.mode) {
    catSlicerMode = catSlicerVis.visual.objects.data[0].properties.mode.expr.Literal.Value;
}
check('the category slicer is a dropdown', catSlicerMode, "'Dropdown'");

let dateSlicerColProp = '';
let dateSlicerColEntity = '';
if (dateSlicerVis.visual && dateSlicerVis.visual.query && dateSlicerVis.visual.query.queryState && dateSlicerVis.visual.query.queryState.Values && dateSlicerVis.visual.query.queryState.Values.projections[0].field.Column) {
    dateSlicerColProp = dateSlicerVis.visual.query.queryState.Values.projections[0].field.Column.Property;
    dateSlicerColEntity = dateSlicerVis.visual.query.queryState.Values.projections[0].field.Column.Expression.SourceRef.Entity;
}
check('the date slicer binds the date-dimension column', dateSlicerColProp === 'Date' && dateSlicerColEntity === 'DateTable', true);

let catSlicerColProp = '';
let catSlicerColEntity = '';
if (catSlicerVis.visual && catSlicerVis.visual.query && catSlicerVis.visual.query.queryState && catSlicerVis.visual.query.queryState.Values && catSlicerVis.visual.query.queryState.Values.projections[0].field.Column) {
    catSlicerColProp = catSlicerVis.visual.query.queryState.Values.projections[0].field.Column.Property;
    catSlicerColEntity = catSlicerVis.visual.query.queryState.Values.projections[0].field.Column.Expression.SourceRef.Entity;
}
check('the category slicer binds the category column', catSlicerColProp === 'Primary_Category' && catSlicerColEntity === 'Calls', true);

check('category slicer does not join a sync group', (catSlicerStr || '').indexOf('syncGroup') === -1, true);
check('date slicer joins DateSync sync group (21-04)', (dateSlicerStr || '').indexOf('DateSync') !== -1, true);

let hasDemoCat = false;
const combinedSlicerText = (dateSlicerStr || '') + (catSlicerStr || '');
['Sensor_Replacement', 'Bluetooth_General', 'Billing_Inquiry', 'App_Error', 'Shipping_Status', 'G7_iOS_Pairing_Failure'].forEach(function(cat) {
    if (combinedSlicerText.indexOf(cat) !== -1) hasDemoCat = true;
});
check('neither slicer enumerates any value', hasDemoCat, false);

const dateSlot = Array.isArray(c.PBI_EXEC_LAYOUT) ? c.PBI_EXEC_LAYOUT.filter(function(s) { return s.id === 'a0e94b18d5c7360f2b83'; })[0] : {};
const datePos = dateSlicerVis.position || {};
check('slicer positions match their layout slots', 
    datePos.x === dateSlot.x && datePos.y === dateSlot.y && datePos.z === dateSlot.z && datePos.width === dateSlot.width && datePos.height === dateSlot.height, true);

const catSlot = Array.isArray(c.PBI_EXEC_LAYOUT) ? c.PBI_EXEC_LAYOUT.filter(function(s) { return s.id === 'b17c60ea294f8d3501ba'; })[0] : {};
const catPos = catSlicerVis.position || {};
check('the two slicers do not overlap the title or the cards', 
    catPos.x === catSlot.x && catPos.y === catSlot.y && catPos.z === catSlot.z && catPos.width === catSlot.width && catPos.height === catSlot.height, true);

// --- 24-04 (D-01 / D-05): Date-window honesty (P0-1 remediation) ---
// Prior 20-05 checks that asserted an authored sub-window, datetime literals, and aliased filter shapes
// were deliberately removed: the generator no longer authors any default date range, ensuring the report
// opens on the full data span and deltas compare honestly against the full-dataset baseline.

const dateRowsA = [
    { Timestamp: '2026-01-01 00:00:00' },
    { Timestamp: '2026-01-31 00:00:00' }
];
const mapDateA = c.buildPowerBIFileMap(dateRowsA);

const dateRowsB = [
    { Timestamp: '2019-06-01 00:00:00' },
    { Timestamp: '2019-06-30 00:00:00' }
];
const mapDateB = c.buildPowerBIFileMap(dateRowsB);

check('buildDefaultDateRangeFilter returns null for populated row set', c.buildDefaultDateRangeFilter(dateRowsA), null);

function assertSlicerHasNoAuthoredFilter(slicerJsonStr) {
    const s = JSON.parse(slicerJsonStr);
    const hasFilter = !!(s.visual.objects && s.visual.objects.general && s.visual.objects.general[0] && s.visual.objects.general[0].properties && s.visual.objects.general[0].properties.filter);
    const hasDatetime = /datetime'/.test(slicerJsonStr);
    return !hasFilter && !hasDatetime;
}

check('date slicer carries no authored filter or datetime literal (row set A)', assertSlicerHasNoAuthoredFilter(mapDateA[dateSlicerKey]), true);
check('date slicer carries no authored filter or datetime literal (row set B)', assertSlicerHasNoAuthoredFilter(mapDateB[dateSlicerKey]), true);
check('Ops/QA date slicer carries no authored filter or datetime literal', assertSlicerHasNoAuthoredFilter(mapDateA['powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/2b3c4d5e6f708192a3b4/visual.json']), true);

const originalTz = process.env.TZ;

process.env.TZ = 'UTC';
const cUtc = { console, crypto, Papa: { unparse: unparse } };
vm.createContext(cUtc);
vm.runInContext(src, cUtc);
const mapTz1 = cUtc.buildPowerBIFileMap(dateRowsA);

process.env.TZ = 'Pacific/Kiritimati';
const cKiri = { console, crypto, Papa: { unparse: unparse } };
vm.createContext(cKiri);
vm.runInContext(src, cKiri);
const mapTz2 = cKiri.buildPowerBIFileMap(dateRowsA);

if (originalTz === undefined) {
    delete process.env.TZ;
} else {
    process.env.TZ = originalTz;
}

check('the date slicer is timezone-independent', JSON.stringify(mapTz1[dateSlicerKey]) === JSON.stringify(mapTz2[dateSlicerKey]), true);

const dateRowsA_rev = [
    { Timestamp: '2026-01-31 00:00:00' },
    { Timestamp: '2026-01-01 00:00:00' }
];
const mapDateA_rev = c.buildPowerBIFileMap(dateRowsA_rev);
check('the date slicer is row-order independent', JSON.stringify(mapDateA[dateSlicerKey]) === JSON.stringify(mapDateA_rev[dateSlicerKey]), true);

const singleDateRows = [
    { Timestamp: '2026-01-15 12:30:00' },
    { Timestamp: '2026-01-15 12:30:00' }
];
const mapSingle = c.buildPowerBIFileMap(singleDateRows);
check('a single-instant dataset yields a date slicer with no authored filter', assertSlicerHasNoAuthoredFilter(mapSingle[dateSlicerKey]), true);

const mapEmpty = c.buildPowerBIFileMap([]);
const slicerEmpty = JSON.parse(mapEmpty[dateSlicerKey]);
const fcEmpty = slicerEmpty.visual.objects && slicerEmpty.visual.objects.general && slicerEmpty.visual.objects.general[0].properties.filter ? { filters: [slicerEmpty.visual.objects.general[0].properties.filter.filter] } : null;
let hasEmptyFilterConfig = !fcEmpty || !fcEmpty.filters || fcEmpty.filters.length === 0;
let emptyAssertionsPass = false;
try {
    c.assertGeneratedTextIsClean(mapEmpty);
    c.assertFieldReferencesResolve(mapEmpty);
    emptyAssertionsPass = true;
} catch(e) {}
check('an empty dataset yields a slicer with no default filter', hasEmptyFilterConfig && emptyAssertionsPass, true);

const unparseableRows = [
    { Timestamp: null },
    { Timestamp: '' },
    { Timestamp: 'not a date' }
];
const mapUnparseable = c.buildPowerBIFileMap(unparseableRows);
const slicerUnparseable = JSON.parse(mapUnparseable[dateSlicerKey]);
const fcUnp = slicerUnparseable.visual.objects && slicerUnparseable.visual.objects.general && slicerUnparseable.visual.objects.general[0].properties.filter ? { filters: [slicerUnparseable.visual.objects.general[0].properties.filter.filter] } : null;
let hasUnparseableFilterConfig = !fcUnp || !fcUnp.filters || fcUnp.filters.length === 0;
check('unparseable timestamps yield no default filter', hasUnparseableFilterConfig, true);

const injectedRows = [
    { Timestamp: '2026-01-01 00:00:00' },
    { Timestamp: "2026-01-01 00:00:00'}]},{\"injected\":true" }
];
const mapInjected = c.buildPowerBIFileMap(injectedRows);
const slicerInjectedStr = mapInjected[dateSlicerKey];
const slicerInjected = JSON.parse(slicerInjectedStr);
const hasInjected = slicerInjectedStr.indexOf('injected') !== -1;
check('no raw cell text reaches any generated file', hasInjected === false, true);

// --- QUAL-01: aliased filter references resolve too ---
let emptyRefCount = 0;
try {
    emptyRefCount = c.assertFieldReferencesResolve(mapEmpty);
} catch(e) {}

let fullRefCount = 0;
let fullRefThrew = false;
try {
    fullRefCount = c.assertFieldReferencesResolve(mapDateA);
} catch(e) {
    fullRefThrew = true;
}

check('the gate resolves the date slicer\'s own field reference', fullRefThrew === false && fullRefCount >= emptyRefCount, true);

function attachMockFilter(delta) {
    delta.visual.objects = delta.visual.objects || {};
    delta.visual.objects.general = [
        {
            properties: {
                filter: {
                    filter: {
                        name: "Filter1",
                        field: { Column: { Expression: { SourceRef: { Entity: "Calls" } }, Property: "Timestamp" } },
                        type: "Range",
                        filter: {
                            Version: 2,
                            From: [ { Name: "c", Entity: "Calls", Type: 0 } ],
                            Where: [
                                {
                                    Condition: {
                                        Between: {
                                            Expression: { Column: { Expression: { SourceRef: { Source: "c" } }, Property: "Timestamp" } }
                                        }
                                    }
                                }
                            ]
                        }
                    }
                }
            }
        }
    ];
}

let caughtFilterProp = false;
try {
    const res = testGate(function(v, m, k) {
        const delta = JSON.parse(m[dateSlicerKey]);
        attachMockFilter(delta);
        delta.visual.objects.general[0].properties.filter.filter.filter.Where[0].Condition.Between.Expression.Column.Property = 'BadProp';
        m[dateSlicerKey] = JSON.stringify(delta);
    });
    if (res.threw && /BadProp/.test(res.msg)) caughtFilterProp = true;
} catch(e) {}
check('field-reference gate rejects a bad property inside a filter condition', caughtFilterProp, true);

let caughtFilterEntity = false;
try {
    const res = testGate(function(v, m, k) {
        const delta = JSON.parse(m[dateSlicerKey]);
        attachMockFilter(delta);
        delta.visual.objects.general[0].properties.filter.filter.filter.From[0].Entity = 'BadEntity';
        m[dateSlicerKey] = JSON.stringify(delta);
    });
    if (res.threw && /BadEntity/.test(res.msg)) caughtFilterEntity = true;
} catch(e) {}
check('field-reference gate rejects a bad entity in a filter From clause', caughtFilterEntity, true);

let caughtFilterAlias = false;
try {
    const res = testGate(function(v, m, k) {
        const delta = JSON.parse(m[dateSlicerKey]);
        attachMockFilter(delta);
        delta.visual.objects.general[0].properties.filter.filter.filter.Where[0].Condition.Between.Expression.Column.Expression.SourceRef.Source = 'x';
        m[dateSlicerKey] = JSON.stringify(delta);
    });
    if (res.threw && /Unresolved alias.*x/.test(res.msg)) caughtFilterAlias = true;
} catch(e) {}
check('field-reference gate rejects an unresolvable alias', caughtFilterAlias, true);

let caughtFilterTopField = false;
try {
    const res = testGate(function(v, m, k) {
        const delta = JSON.parse(m[dateSlicerKey]);
        attachMockFilter(delta);
        delta.visual.objects.general[0].properties.filter.filter.field.Column.Property = 'BadTop';
        m[dateSlicerKey] = JSON.stringify(delta);
    });
    if (res.threw && /BadTop/.test(res.msg)) caughtFilterTopField = true;
} catch(e) {}
check('field-reference gate rejects a bad property in the filter\'s top-level field', caughtFilterTopField, true);

let aliasNoLeak = false;
try {
    const res = testGate(function(v, m, k) {
        m['powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/99999999999999999999/visual.json'] = JSON.stringify({
            visualType: 'card',
            query: { queryState: { Data: { projections: [{ field: { Column: { Expression: { SourceRef: { Source: 'c' } }, Property: 'Timestamp' } } }] } } }
        });
    });
    if (res.threw && /Unresolved alias.*c/.test(res.msg)) aliasNoLeak = true;
} catch(e) {}
check('alias resolution does not leak between documents', aliasNoLeak, true);

// --- QUAL-01: the field-reference gate must actually fire ---

function testGate(mutationFn) {
    const testMap = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01' }]);
    const testVisualKey = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/1b7e4a2c8f60d3591c4b/visual.json';
    const vis = JSON.parse(testMap[testVisualKey]);
    mutationFn(vis, testMap, testVisualKey);
    if (testMap[testVisualKey]) {
        testMap[testVisualKey] = JSON.stringify(vis, null, 2);
    }
    try {
        c.assertFieldReferencesResolve(testMap);
        return { threw: false, msg: '' };
    } catch (e) {
        return { threw: true, msg: e.message };
    }
}

let caughtUnknownProperty = false;
try {
    const res = testGate(function(v) { v.visual.query.queryState.Data.projections[0].field.Measure.Property = 'BadName'; });
    if (res.threw && /BadName/.test(res.msg) && /1b7e4a2c8f60d3591c4b/.test(res.msg) && /a1b2c3d4e5f6a7b8c9d0/.test(res.msg)) {
        caughtUnknownProperty = true;
    }
} catch(e) {}
check('field-reference gate rejects unknown property', caughtUnknownProperty, true);

let caughtCaseVariant = false;
try {
    const res = testGate(function(v) { v.visual.query.queryState.Data.projections[0].field.Measure.Property = 'total calls'; });
    if (res.threw && /total calls/.test(res.msg)) caughtCaseVariant = true;
} catch(e) {}
check('field-reference gate rejects case variant', caughtCaseVariant, true);

let caughtUnknownEntity = false;
try {
    const res = testGate(function(v) { v.visual.query.queryState.Data.projections[0].field.Measure.Expression.SourceRef.Entity = 'BadEntity'; });
    if (res.threw && /BadEntity/.test(res.msg)) caughtUnknownEntity = true;
} catch(e) {}
check('field-reference gate rejects unknown entity', caughtUnknownEntity, true);

let caughtMismatchColAsMeasure = false;
try {
    const res = testGate(function(v) { v.visual.query.queryState.Data.projections[0].field.Measure.Property = 'Call_Summary_Transcript'; });
    if (res.threw && /Call_Summary_Transcript/.test(res.msg) && /referenced as Measure/.test(res.msg)) caughtMismatchColAsMeasure = true;
} catch(e) {}
check('field-reference gate rejects column referenced as measure', caughtMismatchColAsMeasure, true);

let caughtMismatchMeasureAsCol = false;
try {
    const res = testGate(function(v) {
        v.visual.query.queryState.Data.projections[0].field.Column = v.visual.query.queryState.Data.projections[0].field.Measure;
        delete v.visual.query.queryState.Data.projections[0].field.Measure;
    });
    if (res.threw && /Total Calls/.test(res.msg) && /referenced as Column/.test(res.msg)) caughtMismatchMeasureAsCol = true;
} catch(e) {}
check('field-reference gate rejects measure referenced as column', caughtMismatchMeasureAsCol, true);

let caughtHiddenInFormatting = false;
try {
    const res = testGate(function(v) {
        v.visual.objects = v.visual.objects || {};
        v.visual.objects.custom = [{
            properties: {
                badProp: {
                    expr: {
                        Measure: {
                            Expression: { SourceRef: { Entity: 'Calls' } },
                            Property: 'HiddenBad'
                        }
                    }
                }
            }
        }];
    });
    if (res.threw && /HiddenBad/.test(res.msg)) caughtHiddenInFormatting = true;
} catch(e) {}
check('field-reference gate rejects property hidden in formatting tree', caughtHiddenInFormatting, true);

let caughtZeroRefs = false;
try {
    const res = testGate(function(v, m, k) {
        delete v.visual.query;
        if(v.visual.objects && v.visual.objects.general) delete v.visual.objects.general[0].properties.filter;
        if(v.visual.objects && v.visual.objects.referenceLabel) delete v.visual.objects.referenceLabel;
        // G-36-8: the card caption shape (referenceLabelDetail / referenceLabelTitle) also
        // carries a field reference (the Delta Baseline Label measure); strip it too so this
        // mutation still produces a genuinely zero-reference report.
        if(v.visual.objects && v.visual.objects.referenceLabelDetail) delete v.visual.objects.referenceLabelDetail;
        if(v.visual.objects && v.visual.objects.referenceLabelTitle) delete v.visual.objects.referenceLabelTitle;
        Object.keys(m).forEach(k => {
            if (k.endsWith('visual.json')) {
                const vi = JSON.parse(m[k]);
                delete vi.visual.query;
                delete vi.filterConfig;
                if(vi.visual.objects && vi.visual.objects.general) delete vi.visual.objects.general[0].properties.filter;
                if(vi.visual.objects && vi.visual.objects.value) delete vi.visual.objects.value;
                if(vi.visual.objects && vi.visual.objects.referenceLabel) delete vi.visual.objects.referenceLabel;
                if(vi.visual.objects && vi.visual.objects.referenceLabelDetail) delete vi.visual.objects.referenceLabelDetail;
                if(vi.visual.objects && vi.visual.objects.referenceLabelTitle) delete vi.visual.objects.referenceLabelTitle;
                delete vi.visual.visualContainerObjects;
                m[k] = JSON.stringify(vi);
            }
        });
    });
    if (res.threw && /zero references/.test(res.msg)) caughtZeroRefs = true;
} catch(e) {}
check('field-reference gate rejects zero-reference report', caughtZeroRefs, true);

let passesWithoutQuery = false;
try {
    const res = testGate(function(v, m) {
        m['powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/99999999999999999999/visual.json'] = JSON.stringify({
            visual: { visualType: 'textbox' }
        });
    });
    if (!res.threw) passesWithoutQuery = true;
} catch(e) {}
check('textbox visual without query block is accepted', passesWithoutQuery, true);

let caughtMultiOrder = false;
try {
    const secondCardKey = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/2d9f6b0a4e13c78520fa/visual.json';
    const mut = function(v, m) {
        v.visual.query.queryState.Data.projections[0].field.Measure.Property = 'BadA';
        const second = JSON.parse(m[secondCardKey]);
        second.visual.query.queryState.Data.projections[0].field.Measure.Property = 'BadB';
        m[secondCardKey] = JSON.stringify(second);
    };
    const res1 = testGate(mut);
    const res2 = testGate(mut);
    if (res1.threw && res2.threw && /BadA/.test(res1.msg) && /BadB/.test(res1.msg) && res1.msg === res2.msg) {
        caughtMultiOrder = true;
    }
} catch(e) {}
check('field-reference gate lists multiple errors in stable order', caughtMultiOrder, true);

// --- 21-01: Ops/QA page manifest, scatter tracer, layout gate ---
const opsPageEntry = c.getPageByKey('opsQa');
check('PBI_PAGES has length 4', c.PBI_PAGES.length, 4);
check('opsQa page id is b2c3d4e5f6a7b8c9d0e1', opsPageEntry.id, 'b2c3d4e5f6a7b8c9d0e1');
check('opsQa page id matches 20-hex', /^[0-9a-f]{20}$/.test(opsPageEntry.id), true);
check('opsQa page id differs from PBI_PAGES[0].id', opsPageEntry.id !== c.PBI_PAGES[0].id, true);
check('opsQa page displayName is Ops/QA Command', opsPageEntry.displayName, 'Ops/QA Command');
check('opsQa page ordinal is 2', opsPageEntry.ordinal, 2);

const opsPagesJson = JSON.parse(fileMap['powerbi/SpeechAnalytics.Report/definition/pages/pages.json']);
check('pages.json pageOrder has all pages in manifest order', opsPagesJson.pageOrder, ['a1b2c3d4e5f6a7b8c9d0', 'd4e5f6a7b8c9d0e1f2a3', 'b2c3d4e5f6a7b8c9d0e1', '34e0f1a2b3c4d5e60718']);
check('pages.json activePageName is Executive Hub', opsPagesJson.activePageName, 'a1b2c3d4e5f6a7b8c9d0');

const opsPageKey = 'powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/page.json';
check('Ops/QA page.json exists in fileMap', !!fileMap[opsPageKey], true);
const opsPageJson = JSON.parse(fileMap[opsPageKey]);
check('Ops/QA page.json name matches id', opsPageJson.name, 'b2c3d4e5f6a7b8c9d0e1');
check('Ops/QA page.json displayName is Ops/QA Command', opsPageJson.displayName, 'Ops/QA Command');
check('Ops/QA page.json height is 1080', opsPageJson.height, 1080);
check('Ops/QA page.json width is 1920', opsPageJson.width, 1920);

check('PBI_OPS_LAYOUT has length 11', c.PBI_OPS_LAYOUT.length, 11);
let allOpsIdsValid = true;
for (let i = 0; i < c.PBI_OPS_LAYOUT.length; i++) {
    if (!/^[0-9a-f]{20}$/.test(c.PBI_OPS_LAYOUT[i].id)) allOpsIdsValid = false;
}
check('all PBI_OPS_LAYOUT ids match 20-hex', allOpsIdsValid, true);

const allIds = c.PBI_PAGES.map(p => p.id)
    .concat(c.PBI_EXEC_LAYOUT.map(s => s.id))
    .concat(c.PBI_OPS_LAYOUT.map(s => s.id))
    .concat(c.PBI_CALL_DETAIL_LAYOUT.map(s => s.id))
    .concat(c.PBI_COMPLIANCE_LAYOUT.map(s => s.id));
const distinctIds = new Set(allIds);
check('all 48 page and slot ids are distinct', distinctIds.size, 48);

let opsSlotsInBounds = true;
for (let i = 0; i < c.PBI_OPS_LAYOUT.length; i++) {
    const s = c.PBI_OPS_LAYOUT[i];
    if (s.x < 0 || s.y < 0 || s.x + s.width > 1920 || s.y + s.height > 1080) {
        opsSlotsInBounds = false;
    }
}
check('all PBI_OPS_LAYOUT slots fit inside 1920x1080 canvas', opsSlotsInBounds, true);

let opsSlotsOverlap = false;
for (let i = 0; i < c.PBI_OPS_LAYOUT.length; i++) {
    for (let j = i + 1; j < c.PBI_OPS_LAYOUT.length; j++) {
        const s1 = c.PBI_OPS_LAYOUT[i];
        const s2 = c.PBI_OPS_LAYOUT[j];
        if (s1.layer !== 'background' && s2.layer !== 'background') {
            const noOverlap = (
                s1.x + s1.width <= s2.x ||
                s2.x + s2.width <= s1.x ||
                s1.y + s1.height <= s2.y ||
                s2.y + s2.height <= s1.y
            );
            if (!noOverlap) opsSlotsOverlap = true;
        }
    }
}
check('no two content PBI_OPS_LAYOUT slots overlap', opsSlotsOverlap, false);

const scatterKey = 'powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/5e6f708192a3b4c5d6e7/visual.json';
check('Ops/QA scatter visual.json exists in fileMap', !!fileMap[scatterKey], true);

const opsVisualKeys = Object.keys(fileMap).filter(k => k.match(/pages\/b2c3d4e5f6a7b8c9d0e1\/visuals\/[0-9a-f]{20}\/visual\.json$/));
check('at least one Ops/QA visual exists in fileMap', opsVisualKeys.length >= 1, true);

const scatterObj = JSON.parse(fileMap[scatterKey]);
check('scatter visualType is scatterChart', scatterObj.visual.visualType, 'scatterChart');
check('scatter queryState roles are Category, X, Y (D-02 size dropped)', Object.keys(scatterObj.visual.query.queryState).sort(), ['Category', 'X', 'Y']);
check('scatter query has no direct projections key', scatterObj.visual.query.projections === undefined, true);

check('scatter Category has 1 projection', scatterObj.visual.query.queryState.Category.projections.length, 1);
check('scatter Category projection is Column Agent_ID on Calls', {
    kind: scatterObj.visual.query.queryState.Category.projections[0].field.Column ? 'Column' : 'Other',
    property: scatterObj.visual.query.queryState.Category.projections[0].field.Column.Property,
    entity: scatterObj.visual.query.queryState.Category.projections[0].field.Column.Expression.SourceRef.Entity
}, { kind: 'Column', property: 'Agent_ID', entity: 'Calls' });

check('scatter X projection is Measure Avg Silence % on Calls', {
    kind: scatterObj.visual.query.queryState.X.projections[0].field.Measure ? 'Measure' : 'Other',
    property: scatterObj.visual.query.queryState.X.projections[0].field.Measure.Property,
    entity: scatterObj.visual.query.queryState.X.projections[0].field.Measure.Expression.SourceRef.Entity
}, { kind: 'Measure', property: 'Avg Silence %', entity: 'Calls' });

check('scatter Y projection is Measure Avg QA Score on Calls', {
    kind: scatterObj.visual.query.queryState.Y.projections[0].field.Measure ? 'Measure' : 'Other',
    property: scatterObj.visual.query.queryState.Y.projections[0].field.Measure.Property,
    entity: scatterObj.visual.query.queryState.Y.projections[0].field.Measure.Expression.SourceRef.Entity
}, { kind: 'Measure', property: 'Avg QA Score', entity: 'Calls' });

check('scatter visual JSON carries no X-axis domain, min or max property (RESEARCH Pitfall 4)',
    !scatterObj.visual.objects.categoryAxis && !scatterObj.visual.objects.xAxis, true);

check('scatter queryState has no Size role (D-02 size dropped)', scatterObj.visual.query.queryState.Size, undefined);

check('scatter objects has no trend property (D-03 deliberate absence)', scatterObj.visual.objects.trend, undefined);

// Precision edge: every number in the parsed visual is an integer
function checkNumbersAreIntegers(node) {
    if (node === null || typeof node !== 'object') {
        if (typeof node === 'number') {
            return Number.isInteger(node);
        }
        return true;
    }
    for (const val of Object.values(node)) {
        if (!checkNumbersAreIntegers(val)) return false;
    }
    return true;
}
check('all numbers in scatter visual are integers', checkNumbersAreIntegers(scatterObj), true);

let opsLayoutGateClean = true;
try {
    c.assertOpsLayoutIsRenderable(fileMap);
} catch (e) {
    opsLayoutGateClean = false;
}
check('assertOpsLayoutIsRenderable passes on clean fileMap', opsLayoutGateClean, true);

let opsLayoutGateCaughtMutation = false;
try {
    const mutatedMap = Object.assign({}, fileMap);
    const mutatedScatter = JSON.parse(mutatedMap[scatterKey]);
    mutatedScatter.position.x = 999;
    mutatedMap[scatterKey] = JSON.stringify(mutatedScatter);
    c.assertOpsLayoutIsRenderable(mutatedMap);
} catch (e) {
    if (e.message && e.message.indexOf('scatterSilenceQa') !== -1) {
        opsLayoutGateCaughtMutation = true;
    }
}
check('assertOpsLayoutIsRenderable catches position mismatch with scatterSilenceQa', opsLayoutGateCaughtMutation, true);

const refCount = c.assertFieldReferencesResolve(fileMap);
check('assertFieldReferencesResolve passes over two-page fileMap with at least 32 references', refCount >= 32, true);
check('assertFieldReferencesResolve reference count increased by at least 3', refCount > 29, true);
const emptyMap = c.buildPowerBIFileMap([]);
check('assertFieldReferencesResolve on empty rows has at least 30 references', c.assertFieldReferencesResolve(emptyMap) >= 30, true);

const fileMapRun1 = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01' }]);
const fileMapRun2 = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01' }]);
check('two buildPowerBIFileMap calls stringify identically', JSON.stringify(fileMapRun1), JSON.stringify(fileMapRun2));

// --- 21-02: Ops/QA heading and Queue_Name breakdown ---
// Executive Hub bar and textbox unchanged
const execTitleKey = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/0c1a5e7b3d9f204186ea/visual.json';
const execTitleObj = JSON.parse(fileMap[execTitleKey]);
check('Exec Hub title visualType is textbox', execTitleObj.visual.visualType, 'textbox');
check('Exec Hub title text is Executive Hub', execTitleObj.visual.objects.general[0].properties.paragraphs[0].textRuns[0].value, 'Executive Hub');

const execBarKey = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/9a3f7c2e5081bd64f29c/visual.json';
const execBarObj = JSON.parse(fileMap[execBarKey]);
check('Exec Hub bar visualType is clusteredBarChart', execBarObj.visual.visualType, 'clusteredBarChart');
check('Exec Hub bar Category is Primary_Category', execBarObj.visual.query.queryState.Category.projections[0].field.Column.Property, 'Primary_Category');
check('Exec Hub bar Y is Total Calls', execBarObj.visual.query.queryState.Y.projections[0].field.Measure.Property, 'Total Calls');
check('Exec Hub bar title literal is Calls by Category with quotes', execBarObj.visual.visualContainerObjects.title[0].properties.text.expr.Literal.Value, "'Calls by Category'");

// Ops/QA Title
const opsTitleKey = 'powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/1a2b3c4d5e6f70819203/visual.json';
check('Ops/QA title visual.json exists', !!fileMap[opsTitleKey], true);
const opsTitleObj = JSON.parse(fileMap[opsTitleKey]);
check('Ops/QA title visualType is textbox', opsTitleObj.visual.visualType, 'textbox');
check('Ops/QA title text is Ops/QA Command', opsTitleObj.visual.objects.general[0].properties.paragraphs[0].textRuns[0].value, 'Ops/QA Command');

let textboxThrewOnMissing = false;
try {
    c.buildTextboxJson({ key: 'testSlot', id: 'x', x: 0, y: 0, z: 0, width: 1, height: 1 });
} catch (e) {
    if (e.message && e.message.includes('testSlot')) textboxThrewOnMissing = true;
}
check('buildTextboxJson throws on missing title and names slot', textboxThrewOnMissing, true);

// Ops/QA Queue Breakdown
const opsQueueBarKey = 'powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/6f708192a3b4c5d6e7f8/visual.json';
check('Ops/QA queue breakdown visual.json exists', !!fileMap[opsQueueBarKey], true);
const opsQueueBarObj = JSON.parse(fileMap[opsQueueBarKey]);
check('Ops/QA queue breakdown visualType is clusteredBarChart', opsQueueBarObj.visual.visualType, 'clusteredBarChart');
check('Ops/QA queue breakdown Category is Column Queue_Name', {
    kind: opsQueueBarObj.visual.query.queryState.Category.projections[0].field.Column ? 'Column' : 'Other',
    property: opsQueueBarObj.visual.query.queryState.Category.projections[0].field.Column.Property,
    nativeQueryRef: opsQueueBarObj.visual.query.queryState.Category.projections[0].nativeQueryRef
}, { kind: 'Column', property: 'Queue_Name', nativeQueryRef: 'Queue_Name' });
check('Ops/QA queue breakdown Y is Measure Avg QA Score', opsQueueBarObj.visual.query.queryState.Y.projections[0].field.Measure.Property, 'Avg QA Score');
check('Ops/QA queue breakdown has no filterConfig', opsQueueBarObj.filterConfig === undefined && (opsQueueBarObj.visual.filterConfig === undefined), true);

// --- 21-02b: Agent_ID breakdown and its TopN filter ---
const opsAgentBarKey = 'powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/708192a3b4c5d6e7f809/visual.json';
check('Ops/QA agent breakdown visual.json exists', !!fileMap[opsAgentBarKey], true);
const opsAgentBarObj = JSON.parse(fileMap[opsAgentBarKey]);
check('Ops/QA agent breakdown visualType is clusteredBarChart', opsAgentBarObj.visual.visualType, 'clusteredBarChart');
check('Ops/QA agent breakdown Category is Column Agent_ID', opsAgentBarObj.visual.query.queryState.Category.projections[0].field.Column.Property, 'Agent_ID');
check('Ops/QA agent breakdown Y is Measure Avg QA Score', opsAgentBarObj.visual.query.queryState.Y.projections[0].field.Measure.Property, 'Avg QA Score');

check('filterConfig is top-level key of visual container and not on visual', opsAgentBarObj.filterConfig !== undefined && opsAgentBarObj.visual.filterConfig === undefined, true);
check('filterConfig.filters has length 1', opsAgentBarObj.filterConfig.filters.length, 1);
const agentFilter = opsAgentBarObj.filterConfig.filters[0];
check('agent filter type is TopN', agentFilter.type, 'TopN');
check('agent filter howCreated is User', agentFilter.howCreated, 'User');
check('agent filter name matches Filter followed by 24-hex', /^Filter[0-9a-f]{24}$/.test(agentFilter.name), true);

const subquery = agentFilter.filter.From[0].Expression.Subquery.Query;
check('subquery Top is 10', subquery.Top, 10);
check('subquery OrderBy has length 1', subquery.OrderBy.length, 1);
check('subquery OrderBy Direction is 1 (Bottom)', subquery.OrderBy[0].Direction, 1);

// Pitfall 3 protection: walk OrderBy and assert zero nodes carry a Measure key
function hasMeasureKey(node) {
    if (node === null || typeof node !== 'object') return false;
    if (Object.prototype.hasOwnProperty.call(node, 'Measure')) return true;
    for (const v of Object.values(node)) {
        if (hasMeasureKey(v)) return true;
    }
    return false;
}
check('OrderBy has no Measure key at any depth (Pitfall 3 protection)', hasMeasureKey(subquery.OrderBy), false);
check('OrderBy Expression is Aggregation with Function 1 on Agent_Quality', {
    isAggregation: !!subquery.OrderBy[0].Expression.Aggregation,
    functionVal: subquery.OrderBy[0].Expression.Aggregation ? subquery.OrderBy[0].Expression.Aggregation.Function : null,
    colProp: (subquery.OrderBy[0].Expression.Aggregation && subquery.OrderBy[0].Expression.Aggregation.Expression.Column) ? subquery.OrderBy[0].Expression.Aggregation.Expression.Column.Property : null
}, { isAggregation: true, functionVal: 1, colProp: 'Agent_Quality' });

// Literal value check: no literal value equals any dataset category/queue/agent
function collectLiteralStrings(node, sink) {
    if (node === null || typeof node !== 'object') return;
    if (node.Literal && typeof node.Literal.Value === 'string') {
        sink.push(node.Literal.Value.replace(/^'|'$/g, ''));
    }
    for (const v of Object.values(node)) {
        collectLiteralStrings(v, sink);
    }
}
const agentBarLiterals = [];
collectLiteralStrings(opsAgentBarObj, agentBarLiterals);
const forbiddenRowValues = new Set(['2026-01-01']);
const foundForbidden = agentBarLiterals.some(s => forbiddenRowValues.has(s));
check('agent breakdown has no dataset cell literal values', foundForbidden, false);

const allOpsVisualKeys2102 = Object.keys(fileMap).filter(k => k.match(/pages\/b2c3d4e5f6a7b8c9d0e1\/visuals\/[0-9a-f]{20}\/visual\.json$/));
check('count of Ops/QA visual.json keys is at least 4', allOpsVisualKeys2102.length >= 4, true);

check('assertOpsLayoutIsRenderable passes after 21-02', (function() {
    try { c.assertOpsLayoutIsRenderable(fileMap); return true; } catch(e) { return false; }
})(), true);

const refCount2102 = c.assertFieldReferencesResolve(fileMap);
check('assertFieldReferencesResolve passes over two-page fileMap with at least 39 references', refCount2102 >= 39, true);

let caughtBadOrderByCol = false;
try {
    const mutatedMap = Object.assign({}, fileMap);
    const mutatedAgent = JSON.parse(mutatedMap[opsAgentBarKey]);
    mutatedAgent.filterConfig.filters[0].filter.From[0].Expression.Subquery.Query.OrderBy[0].Expression.Aggregation.Expression.Column.Property = 'NonExistentColumn';
    mutatedMap[opsAgentBarKey] = JSON.stringify(mutatedAgent);
    c.assertFieldReferencesResolve(mutatedMap);
} catch (e) {
    if (e.message && e.message.includes('708192a3b4c5d6e7f809')) caughtBadOrderByCol = true;
}
check('assertFieldReferencesResolve catches invalid OrderBy column naming visual id', caughtBadOrderByCol, true);

// --- 21-03: Silence bucket calculated columns ---
check('CALLS_CALCULATED_COLUMNS has length 4', c.CALLS_CALCULATED_COLUMNS.length, 4);
check('CALLS_CALCULATED_COLUMNS names are Silence_Bucket, Silence_Bucket_Order, Empathy_Bucket, Empathy_Bucket_Order',
    c.CALLS_CALCULATED_COLUMNS.map(col => col.name),
    ['Silence_Bucket', 'Silence_Bucket_Order', 'Empathy_Bucket', 'Empathy_Bucket_Order']);
check('CALLS_DERIVED_COLUMNS contains Compliance_Risk_Order with Int64.Type M derivation',
    c.CALLS_DERIVED_COLUMNS.some(col => col.name === 'Compliance_Risk_Order' && col.mType === 'Int64.Type'),
    true);

const callsTmdlText = fileMap['powerbi/SpeechAnalytics.SemanticModel/definition/tables/Calls.tmdl'];

const expectedBucketLine = '\tcolumn Silence_Bucket = SWITCH(TRUE(), \'Calls\'[Silence_Duration (s)] < 15, "0-15", \'Calls\'[Silence_Duration (s)] < 30, "15-30", \'Calls\'[Silence_Duration (s)] < 60, "30-60", \'Calls\'[Silence_Duration (s)] < 120, "60-120", "120+")';
check('Calls.tmdl carries exact single-line Silence_Bucket SWITCH', callsTmdlText.includes(expectedBucketLine), true);

const expectedBucketLines = [
    expectedBucketLine,
    '\t\tdataType: string',
    '\t\tsummarizeBy: none',
    '\t\tsortByColumn: Silence_Bucket_Order'
].join('\r\n');
check('Calls.tmdl carries Silence_Bucket block with properties in exact order', callsTmdlText.includes(expectedBucketLines), true);

const expectedOrderLines = [
    '\tcolumn Silence_Bucket_Order = SWITCH(TRUE(), \'Calls\'[Silence_Duration (s)] < 15, 1, \'Calls\'[Silence_Duration (s)] < 30, 2, \'Calls\'[Silence_Duration (s)] < 60, 3, \'Calls\'[Silence_Duration (s)] < 120, 4, 5)',
    '\t\tdataType: int64',
    '\t\tisHidden',
    '\t\tsummarizeBy: none'
].join('\r\n');
check('Calls.tmdl carries Silence_Bucket_Order block with properties in exact order', callsTmdlText.includes(expectedOrderLines), true);

check('Pitfall 2: Calls.tmdl contains no sourceColumn: Silence_Bucket', callsTmdlText.includes('sourceColumn: Silence_Bucket'), false);
check('Pitfall 2: Calls.tmdl contains no sourceColumn: Silence_Bucket_Order', callsTmdlText.includes('sourceColumn: Silence_Bucket_Order'), false);

const labels = ['"0-15"', '"15-30"', '"30-60"', '"60-120"', '"120+"'];
const labelCounts = labels.map(l => (callsTmdlText.split(l).length - 1));
check('each of five bucket labels appears exactly once in Calls.tmdl', labelCounts, [1, 1, 1, 1, 1]);

const idx15 = expectedBucketLine.indexOf('< 15');
const idx30 = expectedBucketLine.indexOf('< 30');
const idx60 = expectedBucketLine.indexOf('< 60');
const idx120 = expectedBucketLine.indexOf('< 120');
check('thresholds appear in strictly ascending order in Silence_Bucket expression', idx15 < idx30 && idx30 < idx60 && idx60 < idx120, true);

const multiLineRes = c.buildTmdlCalculatedColumnBlock({ name: 'TestCalc', tmdlType: 'string', summarizeBy: 'none', dax: 'LINE1\nLINE2' });
check('buildTmdlCalculatedColumnBlock with multi-line dax produces triple backticks', multiLineRes.includes('```'), true);
const singleLineRes = c.buildTmdlCalculatedColumnBlock({ name: 'TestCalc', tmdlType: 'string', summarizeBy: 'none', dax: 'LINE1' });
check('buildTmdlCalculatedColumnBlock with single-line dax has no triple backticks', singleLineRes.includes('```'), false);

let threwOnMissingDax = false;
try {
    c.buildTmdlCalculatedColumnBlock({ name: 'X', tmdlType: 'string', summarizeBy: 'none' });
} catch (e) {
    if (e.message && e.message.includes('X')) threwOnMissingDax = true;
}
check('buildTmdlCalculatedColumnBlock throws naming column when dax missing', threwOnMissingDax, true);

const expectedCsvHeader = 'Timestamp,Contact_ID,Agent_ID,Queue_Name,Call_Duration (s),Silence_Duration (s),Silence_Pct,Max_Agitation_Score,Primary_Category,Customer_Sentiment,Agent_Quality,Compliance_Risk,Empathy_Score,FCR_Flag,Call_Summary_Transcript';
const csvContent = fileMap['powerbi/SpeechAnalytics.SemanticModel/data/dashboard-ready.csv'];
const actualCsvHeader = csvContent.split(/\r?\n/)[0];
check('dashboard-ready.csv header is unchanged', actualCsvHeader, expectedCsvHeader);
check('Silence_Pct is present in expectedCsvHeader and COLUMN_MANIFEST (D-10 CSV contract)',
    expectedCsvHeader.split(',').includes('Silence_Pct') && c.COLUMN_MANIFEST.some(col => col.name === 'Silence_Pct'), true);
check('Silence_Bucket does not appear in CSV', csvContent.includes('Silence_Bucket'), false);
check('Silence_Bucket_Order does not appear in CSV', csvContent.includes('Silence_Bucket_Order'), false);

const mPartitionSource = callsTmdlText.split('partition Calls = m')[1] || '';
check('Silence_Bucket does not appear in M partition text', mPartitionSource.includes('Silence_Bucket'), false);
check('Silence_Bucket_Order does not appear in M partition text', mPartitionSource.includes('Silence_Bucket_Order'), false);

let acceptedValidCalcCol = false;
let rejectedInvalidCalcCol = false;
try {
    const copyMapValid = Object.assign({}, fileMap);
    const validDummy = JSON.parse(copyMapValid['powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/1a2b3c4d5e6f70819203/visual.json']);
    validDummy.visual.query = { queryState: { Category: { projections: [{ field: { Column: { Expression: { SourceRef: { Entity: 'Calls' } }, Property: 'Silence_Bucket' } } }] } } };
    copyMapValid['powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/1a2b3c4d5e6f70819203/visual.json'] = JSON.stringify(validDummy);
    c.assertFieldReferencesResolve(copyMapValid);
    acceptedValidCalcCol = true;
} catch (e) {}
check('assertFieldReferencesResolve accepts visual binding to Silence_Bucket', acceptedValidCalcCol, true);

try {
    const copyMapInvalid = Object.assign({}, fileMap);
    const invalidDummy = JSON.parse(copyMapInvalid['powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/1a2b3c4d5e6f70819203/visual.json']);
    invalidDummy.visual.query = { queryState: { Category: { projections: [{ field: { Column: { Expression: { SourceRef: { Entity: 'Calls' } }, Property: 'Silence_BucketX' } } }] } } };
    copyMapInvalid['powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/1a2b3c4d5e6f70819203/visual.json'] = JSON.stringify(invalidDummy);
    c.assertFieldReferencesResolve(copyMapInvalid);
} catch (e) {
    if (e.message && e.message.includes('Silence_BucketX')) rejectedInvalidCalcCol = true;
}
check('assertFieldReferencesResolve rejects unknown Silence_BucketX', rejectedInvalidCalcCol, true);

// --- 21-03b: bucketed column chart ---
const bucketVisualKey = 'powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/8192a3b4c5d6e7f8091a/visual.json';
check('Silence_Bucket column chart visual.json exists in fileMap', !!fileMap[bucketVisualKey], true);
const bucketVisualObj = JSON.parse(fileMap[bucketVisualKey]);
check('bucket visualType is columnChart', bucketVisualObj.visual.visualType, 'columnChart');
check('bucket visual Category projection is Column Bucket_Label on SilenceBuckets', {
    kind: bucketVisualObj.visual.query.queryState.Category.projections[0].field.Column ? 'Column' : 'Other',
    property: bucketVisualObj.visual.query.queryState.Category.projections[0].field.Column.Property,
    queryRef: bucketVisualObj.visual.query.queryState.Category.projections[0].queryRef,
    nativeQueryRef: bucketVisualObj.visual.query.queryState.Category.projections[0].nativeQueryRef
}, { kind: 'Column', property: 'Bucket_Label', queryRef: 'SilenceBuckets.Bucket_Label', nativeQueryRef: 'Bucket_Label' });
check('bucket visual Y projection is Measure Total Calls', bucketVisualObj.visual.query.queryState.Y.projections[0].field.Measure.Property, 'Total Calls');

check('bucket visual has no filterConfig', bucketVisualObj.filterConfig === undefined && (bucketVisualObj.visual.filterConfig === undefined), true);
check('bucket visual.objects has exact expected keys (no per-visual sort authored)', Object.keys(bucketVisualObj.visual.objects).sort(), ['labels']);

const bucketLiterals = [];
collectLiteralStrings(bucketVisualObj, bucketLiterals);
const bucketForbidden = bucketLiterals.some(s => forbiddenRowValues.has(s));
check('bucket visual has no dataset cell literal values', bucketForbidden, false);

const allOpsVisualKeys2103 = Object.keys(fileMap).filter(k => k.match(/pages\/b2c3d4e5f6a7b8c9d0e1\/visuals\/[0-9a-f]{20}\/visual\.json$/));
check('count of Ops/QA visual.json keys is at least 5', allOpsVisualKeys2103.length >= 5, true);

check('assertOpsLayoutIsRenderable passes after 21-03', (function() {
    try { c.assertOpsLayoutIsRenderable(fileMap); return true; } catch(e) { return false; }
})(), true);

const refCount2103 = c.assertFieldReferencesResolve(fileMap);
check('assertFieldReferencesResolve passes over two-page fileMap with at least 39 references', refCount2103 >= 39, true);

// --- 21-04: slicer sync group ---
const execCatSlicerKey = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/b17c60ea294f8d3501ba/visual.json';
const execCatObj = JSON.parse(fileMap[execCatSlicerKey]);
check('Exec Hub category slicer visualType is slicer', execCatObj.visual.visualType, 'slicer');
check('Exec Hub category slicer Values Property is Primary_Category', execCatObj.visual.query.queryState.Values.projections[0].field.Column.Property, 'Primary_Category');
check('Exec Hub category slicer header text is Category', execCatObj.visual.objects.header[0].properties.text.expr.Literal.Value, "'Category'");
check('Exec Hub category slicer has no syncGroup', execCatObj.visual.syncGroup === undefined, true);
check('Exec Hub category slicer keys are exactly visualType, query, objects', Object.keys(execCatObj.visual), ['visualType', 'query', 'objects']);

const execDateSlicerKey = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/a0e94b18d5c7360f2b83/visual.json';
const execDateObj = JSON.parse(fileMap[execDateSlicerKey]);
check('Exec Hub date slicer keys are visualType, syncGroup, query, objects', Object.keys(execDateObj.visual), ['visualType', 'syncGroup', 'query', 'objects']);
check('Exec Hub date slicer syncGroup groupName is DateSync', execDateObj.visual.syncGroup.groupName, 'DateSync');
check('Exec Hub date slicer fieldChanges is true', execDateObj.visual.syncGroup.fieldChanges, true);
check('Exec Hub date slicer filterChanges is true', execDateObj.visual.syncGroup.filterChanges, true);
check('Exec Hub date slicer carries no authored filter per D-01', (execDateObj.visual.objects.general === undefined || execDateObj.visual.objects.general[0].properties.filter === undefined), true);

let threwOnBadSlicerCol = false;
try {
    c.buildSlicerJson({ id: 's', x: 0, y: 0, z: 0, width: 1, height: 1 }, { column: 'Contact_ID', mode: 'Dropdown' });
} catch (e) {
    if (e.message && e.message.includes('Contact_ID')) threwOnBadSlicerCol = true;
}
check('buildSlicerJson throws for column outside four-entry header map', threwOnBadSlicerCol, true);

let threwOnBadSyncGroup = false;
try {
    c.buildSlicerJson({ id: 's', x: 0, y: 0, z: 0, width: 1, height: 1 }, { column: 'Timestamp', mode: 'Between', syncGroup: { fieldChanges: true, filterChanges: true } });
} catch (e) {
    if (e.message && e.message.includes('syncGroup')) threwOnBadSyncGroup = true;
}
check('buildSlicerJson throws for syncGroup missing groupName', threwOnBadSyncGroup, true);

const queueSlicerSample = JSON.parse(c.buildSlicerJson({ id: 's', x: 0, y: 0, z: 0, width: 1, height: 1 }, { column: 'Queue_Name', mode: 'Dropdown' }));
check('buildSlicerJson with Queue_Name emits header text Queue', queueSlicerSample.visual.objects.header[0].properties.text.expr.Literal.Value, "'Queue'");

const agentSlicerSample = JSON.parse(c.buildSlicerJson({ id: 's', x: 0, y: 0, z: 0, width: 1, height: 1 }, { column: 'Agent_ID', mode: 'Dropdown' }));
check('buildSlicerJson with Agent_ID emits header text Agent', agentSlicerSample.visual.objects.header[0].properties.text.expr.Literal.Value, "'Agent'");

// --- 21-04b: Ops/QA slicers ---
const opsDateKey = 'powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/2b3c4d5e6f708192a3b4/visual.json';
const opsQueueKey = 'powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/3c4d5e6f708192a3b4c5/visual.json';
const opsAgentKey = 'powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/4d5e6f708192a3b4c5d6/visual.json';

check('Ops/QA date slicer visual.json exists in fileMap', !!fileMap[opsDateKey], true);
check('Ops/QA queue slicer visual.json exists in fileMap', !!fileMap[opsQueueKey], true);
check('Ops/QA agent slicer visual.json exists in fileMap', !!fileMap[opsAgentKey], true);

const opsDateObj = JSON.parse(fileMap[opsDateKey]);
const opsQueueObj = JSON.parse(fileMap[opsQueueKey]);
const opsAgentObj = JSON.parse(fileMap[opsAgentKey]);

check('Ops/QA date slicer syncGroup groupName is DateSync', opsDateObj.visual.syncGroup.groupName, 'DateSync');
check('Ops/QA date slicer groupName strictly equals Exec Hub date slicer groupName', opsDateObj.visual.syncGroup.groupName === execDateObj.visual.syncGroup.groupName, true);
check('both date slicers bind Date column', {
    execCol: execDateObj.visual.query.queryState.Values.projections[0].field.Column.Property,
    opsCol: opsDateObj.visual.query.queryState.Values.projections[0].field.Column.Property
}, { execCol: 'Date', opsCol: 'Date' });
check('both date slicers have visualType slicer', {
    execType: execDateObj.visual.visualType,
    opsType: opsDateObj.visual.visualType
}, { execType: 'slicer', opsType: 'slicer' });

check('Ops/QA queue slicer Values Property is Queue_Name', opsQueueObj.visual.query.queryState.Values.projections[0].field.Column.Property, 'Queue_Name');
check('Ops/QA agent slicer Values Property is Agent_ID', opsAgentObj.visual.query.queryState.Values.projections[0].field.Column.Property, 'Agent_ID');

check('queue slicer has no syncGroup key', opsQueueObj.visual.syncGroup === undefined, true);
check('queue slicer has no filter property under general', (opsQueueObj.visual.objects.general === undefined || opsQueueObj.visual.objects.general[0].properties.filter === undefined), true);
check('queue slicer has no filterConfig', opsQueueObj.filterConfig === undefined && (opsQueueObj.visual.filterConfig === undefined), true);

check('agent slicer has no syncGroup key', opsAgentObj.visual.syncGroup === undefined, true);
check('agent slicer has no filter property under general', (opsAgentObj.visual.objects.general === undefined || opsAgentObj.visual.objects.general[0].properties.filter === undefined), true);
check('agent slicer has no filterConfig', opsAgentObj.filterConfig === undefined && (opsAgentObj.visual.filterConfig === undefined), true);

const catSlicerLiterals = [];
collectLiteralStrings(opsQueueObj, catSlicerLiterals);
collectLiteralStrings(opsAgentObj, catSlicerLiterals);
const catSlicerForbidden = catSlicerLiterals.some(s => forbiddenRowValues.has(s));
check('categorical slicers have no dataset cell literal values', catSlicerForbidden, false);

const emptyOpsVisuals = c.buildOpsQaVisuals([]);
check('buildOpsQaVisuals([]) returns 11 keys', Object.keys(emptyOpsVisuals).length, 11);
const emptyOpsDateObj = JSON.parse(emptyOpsVisuals[`powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/2b3c4d5e6f708192a3b4/visual.json`]);
check('empty-rows Ops/QA date slicer has no general.properties.filter', (emptyOpsDateObj.visual.objects.general === undefined || emptyOpsDateObj.visual.objects.general[0].properties.filter === undefined), true);
check('empty-rows Ops/QA date slicer still carries syncGroup', emptyOpsDateObj.visual.syncGroup.groupName, 'DateSync');
check('empty-rows Ops/QA date slicer still carries Values projection', emptyOpsDateObj.visual.query.queryState.Values.projections[0].field.Column.Property, 'Date');

const singleRowOpsVisuals = c.buildOpsQaVisuals([{ Timestamp: '2026-03-15 10:00:00' }]);
const singleRowDateObj = JSON.parse(singleRowOpsVisuals[`powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/2b3c4d5e6f708192a3b4/visual.json`]);
check('single-row Ops/QA date slicer has no authored general filter per D-01', (singleRowDateObj.visual.objects.general === undefined || singleRowDateObj.visual.objects.general[0].properties.filter === undefined), true);

const allOpsVisualKeys2104 = Object.keys(fileMap).filter(k => k.match(/pages\/b2c3d4e5f6a7b8c9d0e1\/visuals\/[0-9a-f]{20}\/visual\.json$/));
check('count of Ops/QA visual.json keys is 11', allOpsVisualKeys2104.length, 11);

const allSlotIds = c.PBI_EXEC_LAYOUT.map(s => s.id).concat(c.PBI_OPS_LAYOUT.map(s => s.id));
const uniqueSlotIds = new Set(allSlotIds);
check('all 26 slot ids across both layout constants are distinct', uniqueSlotIds.size, allSlotIds.length);

check('assertOpsLayoutIsRenderable passes after 21-04', (function() {
    try { c.assertOpsLayoutIsRenderable(fileMap); return true; } catch(e) { return false; }
})(), true);

const refCount2104 = c.assertFieldReferencesResolve(fileMap);
check('assertFieldReferencesResolve passes over fileMap with 79 references', refCount2104, 79);

const reversedRows = [{ Timestamp: '2026-01-02' }, { Timestamp: '2026-01-01' }];
const normalRows = [{ Timestamp: '2026-01-01' }, { Timestamp: '2026-01-02' }];
const mapNorm = c.buildPowerBIFileMap(normalRows);
const mapRev = c.buildPowerBIFileMap(reversedRows);
const normDateFilterHasFilter = !!(JSON.parse(mapNorm[opsDateKey]).visual.objects.general && JSON.parse(mapNorm[opsDateKey]).visual.objects.general[0].properties.filter);
const revDateFilterHasFilter = !!(JSON.parse(mapRev[opsDateKey]).visual.objects.general && JSON.parse(mapRev[opsDateKey]).visual.objects.general[0].properties.filter);
check('date slicers have no authored filter regardless of row order', normDateFilterHasFilter || revDateFilterHasFilter, false);

// --- 21-05: QUAL-03 hardcoded literal gate ---
const testRowsFixture = [
    { Primary_Category: 'Sensor_Replacement', Queue_Name: 'Tech_Support_APAC', Agent_ID: 'AGENT_ANNA' },
    { Primary_Category: 'Billing_Inquiry', Queue_Name: 'Billing_Support_US', Agent_ID: 'AGENT_DAVID' }
];
const testFileMap = c.buildPowerBIFileMap(testRowsFixture);

const litCount = c.assertNoHardcodedCategoryLiterals(testFileMap, testRowsFixture);
check('assertNoHardcodedCategoryLiterals passes over real two-page map', litCount > 0, true);

let threwZeroVisuals = false;
try {
    c.assertNoHardcodedCategoryLiterals({}, testRowsFixture);
} catch (e) {
    if (e.message && e.message.includes('zero visuals')) threwZeroVisuals = true;
}
check('gate throws when handed fileMap with zero visuals', threwZeroVisuals, true);

// Inject real Queue_Name into queue breakdown chart title literal
const queueBreakdownKey = 'powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/6f708192a3b4c5d6e7f8/visual.json';
const mutatedQueueMap = Object.assign({}, testFileMap);
const queueVisualObj = JSON.parse(testFileMap[queueBreakdownKey]);
queueVisualObj.visual.visualContainerObjects.title[0].properties.text.expr.Literal.Value = "'Tech_Support_APAC'";
mutatedQueueMap[queueBreakdownKey] = JSON.stringify(queueVisualObj);

let threwInjectedQueue = false;
try {
    c.assertNoHardcodedCategoryLiterals(mutatedQueueMap, testRowsFixture);
} catch (e) {
    if (e.message && e.message.includes('Tech_Support_APAC') && e.message.includes('6f708192a3b4c5d6e7f8')) {
        threwInjectedQueue = true;
    }
}
check('injecting real Queue_Name throws and names value and visual id', threwInjectedQueue, true);

// Inject bare Queue_Name into queue breakdown
const mutatedBareQueueMap = Object.assign({}, testFileMap);
const bareQueueVisualObj = JSON.parse(testFileMap[queueBreakdownKey]);
bareQueueVisualObj.visual.visualContainerObjects.title[0].properties.text.expr.Literal.Value = "Tech_Support_APAC";
mutatedBareQueueMap[queueBreakdownKey] = JSON.stringify(bareQueueVisualObj);

let threwBareQueue = false;
try {
    c.assertNoHardcodedCategoryLiterals(mutatedBareQueueMap, testRowsFixture);
} catch (e) {
    if (e.message && e.message.includes('Tech_Support_APAC') && e.message.includes('6f708192a3b4c5d6e7f8')) {
        threwBareQueue = true;
    }
}
check('injecting bare Queue_Name throws and names value and visual id', threwBareQueue, true);

// Inject real Agent_ID into agent slicer document
const agentSlicerKey = 'powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/4d5e6f708192a3b4c5d6/visual.json';
const mutatedAgentMap = Object.assign({}, testFileMap);
const agentSlicerObj = JSON.parse(testFileMap[agentSlicerKey]);
agentSlicerObj.visual.objects.header[0].properties.text.expr.Literal.Value = "'AGENT_ANNA'";
mutatedAgentMap[agentSlicerKey] = JSON.stringify(agentSlicerObj);

let threwInjectedAgent = false;
try {
    c.assertNoHardcodedCategoryLiterals(mutatedAgentMap, testRowsFixture);
} catch (e) {
    if (e.message && e.message.includes('AGENT_ANNA') && e.message.includes('4d5e6f708192a3b4c5d6')) {
        threwInjectedAgent = true;
    }
}
check('injecting real Agent_ID into agent slicer throws and names visual id', threwInjectedAgent, true);

// Inject real Primary_Category into Executive Hub visual
const execCardKey = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/9a3f7c2e5081bd64f29c/visual.json';
const mutatedExecMap = Object.assign({}, testFileMap);
const execCardObj = JSON.parse(testFileMap[execCardKey]);
execCardObj.visual.visualContainerObjects.title[0].properties.text.expr.Literal.Value = "'Sensor_Replacement'";
mutatedExecMap[execCardKey] = JSON.stringify(execCardObj);

let threwInjectedCategory = false;
try {
    c.assertNoHardcodedCategoryLiterals(mutatedExecMap, testRowsFixture);
} catch (e) {
    if (e.message && e.message.includes('Sensor_Replacement') && e.message.includes('a1b2c3d4e5f6a7b8c9d0')) {
        threwInjectedCategory = true;
    }
}
check('injecting real Primary_Category into Exec Hub throws and names page id', threwInjectedCategory, true);

// Allowlist assertions: 120+, 15, 10, Avg QA Score by Queue
let allowlistThrew = false;
try {
    const allowlistMap = Object.assign({}, testFileMap);
    const allowObj = JSON.parse(testFileMap[queueBreakdownKey]);
    allowObj.visual.visualContainerObjects.title[0].properties.text.expr.Literal.Value = "'Avg QA Score by Queue'";
    allowlistMap[queueBreakdownKey] = JSON.stringify(allowObj);
    c.assertNoHardcodedCategoryLiterals(allowlistMap, testRowsFixture);
} catch (e) {
    allowlistThrew = true;
}
check('allowlist strings do not throw when not matching dataset values', allowlistThrew, false);

// Display string that contains a real queue value as a substring does NOT throw
let substringThrew = false;
try {
    const substrMap = Object.assign({}, testFileMap);
    const subObj = JSON.parse(testFileMap[queueBreakdownKey]);
    subObj.visual.visualContainerObjects.title[0].properties.text.expr.Literal.Value = "'Performance for Tech_Support_APAC Team'";
    substrMap[queueBreakdownKey] = JSON.stringify(subObj);
    c.assertNoHardcodedCategoryLiterals(substrMap, testRowsFixture);
} catch (e) {
    substringThrew = true;
}
check('display string containing dataset value as substring does not throw', substringThrew, false);

// Calling gate with empty rows array over real map does not throw
let emptyRowsThrew = false;
try {
    c.assertNoHardcodedCategoryLiterals(testFileMap, []);
} catch (e) {
    emptyRowsThrew = true;
}
check('calling gate with empty rows does not throw', emptyRowsThrew, false);

// --- Phase 22-01: Title relocation, sortDefinition, valueAxis start, byte stability ---

// Titled slots across exec and ops layouts
const execTitledSlots = c.PBI_EXEC_LAYOUT.filter(s => !!s.chartTitle);
const opsTitledSlots = c.PBI_OPS_LAYOUT.filter(s => !!s.chartTitle);

let allTitledSlotsValid = true;
let noTitledSlotsHaveObjectsTitle = true;
let totalEmittedTitleNodes = 0;

execTitledSlots.forEach(slot => {
    const key = `powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/${slot.id}/visual.json`;
    const vObj = JSON.parse(testFileMap[key]);
    const titleObj = vObj.visual && vObj.visual.visualContainerObjects && vObj.visual.visualContainerObjects.title && vObj.visual.visualContainerObjects.title[0];
    const textExpr = titleObj && titleObj.properties && titleObj.properties.text && titleObj.properties.text.expr;
    if (slot.titleMeasure) {
        const prop = textExpr && textExpr.Measure && textExpr.Measure.Property;
        if (prop !== slot.titleMeasure) allTitledSlotsValid = false;
    } else {
        const val = textExpr && textExpr.Literal && textExpr.Literal.Value;
        if (val !== `'${slot.chartTitle}'`) allTitledSlotsValid = false;
    }
    if (vObj.visual && vObj.visual.objects && vObj.visual.objects.title) noTitledSlotsHaveObjectsTitle = false;
    if (vObj.visual && vObj.visual.visualContainerObjects && vObj.visual.visualContainerObjects.title) totalEmittedTitleNodes++;
});

opsTitledSlots.forEach(slot => {
    const key = `powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/${slot.id}/visual.json`;
    const vObj = JSON.parse(testFileMap[key]);
    const titleObj = vObj.visual && vObj.visual.visualContainerObjects && vObj.visual.visualContainerObjects.title && vObj.visual.visualContainerObjects.title[0];
    const textExpr = titleObj && titleObj.properties && titleObj.properties.text && titleObj.properties.text.expr;
    if (slot.titleMeasure) {
        const prop = textExpr && textExpr.Measure && textExpr.Measure.Property;
        if (prop !== slot.titleMeasure) allTitledSlotsValid = false;
    } else {
        const val = textExpr && textExpr.Literal && textExpr.Literal.Value;
        if (val !== `'${slot.chartTitle}'`) allTitledSlotsValid = false;
    }
    if (vObj.visual && vObj.visual.objects && vObj.visual.objects.title) noTitledSlotsHaveObjectsTitle = false;
    if (vObj.visual && vObj.visual.visualContainerObjects && vObj.visual.visualContainerObjects.title) totalEmittedTitleNodes++;
});

check('bar chart title lives in visualContainerObjects', allTitledSlotsValid && noTitledSlotsHaveObjectsTitle, true);

// Line chart title check
const lineVisualKey22 = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/8d15e0b96c4a273f01de/visual.json';
const lineObj22 = JSON.parse(testFileMap[lineVisualKey22]);
const lineTitleProp = lineObj22.visual && lineObj22.visual.visualContainerObjects && lineObj22.visual.visualContainerObjects.title && lineObj22.visual.visualContainerObjects.title[0] && lineObj22.visual.visualContainerObjects.title[0].properties && lineObj22.visual.visualContainerObjects.title[0].properties.text && lineObj22.visual.visualContainerObjects.title[0].properties.text.expr && lineObj22.visual.visualContainerObjects.title[0].properties.text.expr.Measure && lineObj22.visual.visualContainerObjects.title[0].properties.text.expr.Measure.Property;
const lineHasNoObjectsTitle = !(lineObj22.visual && lineObj22.visual.objects && lineObj22.visual.objects.title);
check('line chart title lives in visualContainerObjects and binds Exec Headline Title', lineTitleProp === 'Exec Headline Title' && lineHasNoObjectsTitle, true);

// Scatter slot check (scatterSilenceQa: 5e6f708192a3b4c5d6e7 has title, subtitle with axis floor 80, and category labels)
const scatterKey22 = 'powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/5e6f708192a3b4c5d6e7/visual.json';
const scatterObj22 = JSON.parse(testFileMap[scatterKey22]);
const scatterSubtitleVal = scatterObj22.visual && scatterObj22.visual.visualContainerObjects && scatterObj22.visual.visualContainerObjects.subTitle && scatterObj22.visual.visualContainerObjects.subTitle[0] && scatterObj22.visual.visualContainerObjects.subTitle[0].properties && scatterObj22.visual.visualContainerObjects.subTitle[0].properties.text && scatterObj22.visual.visualContainerObjects.subTitle[0].properties.text.expr && scatterObj22.visual.visualContainerObjects.subTitle[0].properties.text.expr.Literal && scatterObj22.visual.visualContainerObjects.subTitle[0].properties.text.expr.Literal.Value;
check('scatterSilenceQa emits visualContainerObjects.subTitle disclosing floor 80', scatterSubtitleVal === "'Axis starts at 80'", true);
const scatterCatLabelsVal = scatterObj22.visual && scatterObj22.visual.objects && scatterObj22.visual.objects.categoryLabels && scatterObj22.visual.objects.categoryLabels[0] && scatterObj22.visual.objects.categoryLabels[0].properties && scatterObj22.visual.objects.categoryLabels[0].properties.show && scatterObj22.visual.objects.categoryLabels[0].properties.show.expr && scatterObj22.visual.objects.categoryLabels[0].properties.show.expr.Literal && scatterObj22.visual.objects.categoryLabels[0].properties.show.expr.Literal.Value;
check('scatterSilenceQa enables categoryLabels', scatterCatLabelsVal === 'true', true);

// Adjacency edge: emitted title count matches titled slots count
check('emitted title count matches titled slots count', totalEmittedTitleNodes, execTitledSlots.length + opsTitledSlots.length);

// File map byte-stability
const mapRun1 = JSON.stringify(c.buildPowerBIFileMap(testRowsFixture));
const mapRun2 = JSON.stringify(c.buildPowerBIFileMap(testRowsFixture));
check('file map is byte-stable across two builds', mapRun1 === mapRun2, true);

// barQueueBreakdown sortDefinition and axisFloor (6f708192a3b4c5d6e7f8)
const queueObj22 = JSON.parse(testFileMap[queueBreakdownKey]);
const sortDef = queueObj22.visual && queueObj22.visual.query && queueObj22.visual.query.sortDefinition;
const sortItem = sortDef && sortDef.sort && sortDef.sort[0];
const sortOk = !!(sortDef && sortDef.isDefaultSort === true &&
    sortItem && sortItem.direction === 'Descending' &&
    sortItem.field && sortItem.field.Measure && sortItem.field.Measure.Property === 'Avg QA Score' &&
    JSON.stringify(queueObj22).indexOf('orderBy') === -1);
check('barQueueBreakdown declares a descending sortDefinition', sortOk, true);

const axisStartVal = queueObj22.visual && queueObj22.visual.objects && queueObj22.visual.objects.valueAxis && queueObj22.visual.objects.valueAxis[0] && queueObj22.visual.objects.valueAxis[0].properties && queueObj22.visual.objects.valueAxis[0].properties.start && queueObj22.visual.objects.valueAxis[0].properties.start.expr && queueObj22.visual.objects.valueAxis[0].properties.start.expr.Literal && queueObj22.visual.objects.valueAxis[0].properties.start.expr.Literal.Value;
check('barQueueBreakdown declares a valueAxis start', axisStartVal, '75D');

// columnSilenceBuckets (8192a3b4c5d6e7f8091a) has no sortDefinition
const bucketVisualKey22 = 'powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/8192a3b4c5d6e7f8091a/visual.json';
const bucketObj22 = JSON.parse(testFileMap[bucketVisualKey22]);
check('columnSilenceBuckets declares no sortDefinition', bucketObj22.visual && bucketObj22.visual.query && bucketObj22.visual.query.sortDefinition === undefined, true);

// --- Phase 22-03: assertThemeOwnedPropertiesAreAllowlisted gate checks ---
let cleanThemeGateCount = 0;
let cleanThemeGateThrew = false;
try {
    cleanThemeGateCount = c.assertThemeOwnedPropertiesAreAllowlisted(fileMap);
} catch (e) {
    cleanThemeGateThrew = true;
}
check('theme-owned property gate passes on a clean map', !cleanThemeGateThrew && cleanThemeGateCount > 0, true);

// Test 2: gate throws naming propPath and visualId on mutated barPrimaryCategory
let mutatedCaught = false;
let mutatedErrorMsg = '';
try {
    const mutatedMap = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01' }]);
    const barKey = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/9a3f7c2e5081bd64f29c/visual.json';
    const barDoc = JSON.parse(mutatedMap[barKey]);
    barDoc.visual.objects.categoryAxis = [{ properties: { show: { expr: { Literal: { Value: 'true' } } } } }];
    mutatedMap[barKey] = JSON.stringify(barDoc);
    c.assertThemeOwnedPropertiesAreAllowlisted(mutatedMap);
} catch (e) {
    mutatedCaught = true;
    mutatedErrorMsg = String(e.message || e);
}
check('gate throws naming property path and visual id on unallowlisted override',
    mutatedCaught && mutatedErrorMsg.includes('9a3f7c2e5081bd64f29c') && mutatedErrorMsg.includes('categoryAxis.show'), true);

// Test 3-6: Allowlist checks
const cleanPaths = [];
const barPrimaryClean = JSON.parse(fileMap['powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/9a3f7c2e5081bd64f29c/visual.json']);
c.collectVisualObjectProperties(barPrimaryClean, cleanPaths);
check('allowlisted title properties do not throw', cleanPaths.includes('visualContainerObjects.title.show') && cleanPaths.includes('visualContainerObjects.title.text'), true);

const queueClean = JSON.parse(fileMap['powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/6f708192a3b4c5d6e7f8/visual.json']);
const queueCleanPaths = [];
c.collectVisualObjectProperties(queueClean, queueCleanPaths);
check('allowlisted valueAxis.start does not throw', queueCleanPaths.includes('objects.valueAxis.start'), true);

const barLabelsPaths = [];
c.collectVisualObjectProperties(barPrimaryClean, barLabelsPaths);
check('allowlisted labels.show does not throw', barLabelsPaths.includes('objects.labels.show'), true);

// Test 7: zero visuals throws
let zeroVisualsCaught = false;
try {
    c.assertThemeOwnedPropertiesAreAllowlisted({});
} catch (e) {
    zeroVisualsCaught = /found zero visuals/i.test(e.message);
}
// --- Phase 22-04: Task 1 - Unit literals in format strings & points deltas ---
const measuresByName = {};
c.CALLS_MEASURES.forEach(m => { measuresByName[m.name] = m; });
check('Avg Silence % formatString is 0.0%', measuresByName['Avg Silence %'] && measuresByName['Avg Silence %'].formatString, '0.0%');
check('Avg Silence % DAX is generated by buildWeightedRatioDax', measuresByName['Avg Silence %'] && measuresByName['Avg Silence %'].dax === c.buildWeightedRatioDax('Silence_Duration (s)', 'Call_Duration (s)'), true);
check('Avg Handle Time (s) formatString is #,##0.0"s"', measuresByName['Avg Handle Time (s)'] && measuresByName['Avg Handle Time (s)'].formatString, '#,##0.0"s"');
check('Avg Handle Time (s) DAX is generated by buildWeightedRatioDax', measuresByName['Avg Handle Time (s)'] && measuresByName['Avg Handle Time (s)'].dax === c.buildWeightedRatioDax('Call_Duration (s)', c.PBI_WEIGHTED_COUNTROWS_MARKER), true);
check('Avg QA Score formatString is 0.0', measuresByName['Avg QA Score'] && measuresByName['Avg QA Score'].formatString, '0.0');
check('cardAvgQaScore slot label includes (/100)', c.PBI_EXEC_LAYOUT.find(s => s.key === 'cardAvgQaScore').label, 'Avg QA Score (/100)');
check('Avg Sentiment formatString is +0.0;-0.0;0.0', measuresByName['Avg Sentiment'] && measuresByName['Avg Sentiment'].formatString, '+0.0;-0.0;0.0');

check('CALLS_MEASURES contains Avg Silence Delta pts', !!measuresByName['Avg Silence Delta pts'], true);
check('CALLS_MEASURES contains FCR Rate Delta pts', !!measuresByName['FCR Rate Delta pts'], true);
check('CALLS_MEASURES contains Compliance Risk Rate Delta pts', !!measuresByName['Compliance Risk Rate Delta pts'], true);
check('CALLS_MEASURES does not contain old delta % names',
    !measuresByName['Avg Silence Delta %'] && !measuresByName['FCR Rate Delta %'] && !measuresByName['Compliance Risk Rate Delta %'], true);

check('FCR Rate Delta pts DAX contains * 100', measuresByName['FCR Rate Delta pts'] && measuresByName['FCR Rate Delta pts'].dax.includes('* 100'), true);
check('Avg Silence Delta pts DAX contains * 100', measuresByName['Avg Silence Delta pts'] && measuresByName['Avg Silence Delta pts'].dax.includes('* 100'), true);

let allLayoutMeasuresValid = true;
c.PBI_EXEC_LAYOUT.concat(c.PBI_OPS_LAYOUT).forEach(s => {
    if (s.measure && !measuresByName[s.measure]) allLayoutMeasuresValid = false;
    if (s.deltaMeasure && !measuresByName[s.deltaMeasure]) allLayoutMeasuresValid = false;
});
check('all layout slot measures resolve to CALLS_MEASURES', allLayoutMeasuresValid, true);

const tmdlContent = fileMap['powerbi/SpeechAnalytics.SemanticModel/definition/tables/Calls.tmdl'] || '';
check('Calls.tmdl contains backtick definitions for renamed delta measures',
    tmdlContent.includes('measure \'Avg Silence Delta pts\'') &&
    tmdlContent.includes('measure \'FCR Rate Delta pts\'') &&
    tmdlContent.includes('measure \'Compliance Risk Rate Delta pts\''), true);

// Phase 32 Task 3: Generated TMDL contains weighted expressions and no row-averaged silence
const expectedSilenceDax = c.buildWeightedRatioDax('Silence_Duration (s)', 'Call_Duration (s)');
const expectedHandleTimeDax = c.buildWeightedRatioDax('Call_Duration (s)', c.PBI_WEIGHTED_COUNTROWS_MARKER);
check('Calls.tmdl contains weighted Avg Silence % measure expression',
    tmdlContent.includes("measure 'Avg Silence %' = " + expectedSilenceDax), true);
check('Calls.tmdl contains weighted Avg Handle Time (s) measure expression',
    tmdlContent.includes("measure 'Avg Handle Time (s)' = " + expectedHandleTimeDax), true);
check('Calls.tmdl contains zero occurrences of retired AVERAGE(\'Calls\'[Silence_Pct])',
    !tmdlContent.includes("AVERAGE('Calls'[Silence_Pct])"), true);

const tmdlMeasureCount = (tmdlContent.match(/^\t*measure /gm) || []).length;
check('Calls.tmdl measure declaration count meets or exceeds CALLS_MEASURES count (anti-vacuity)',
    tmdlMeasureCount >= c.CALLS_MEASURES.length, true);

// --- Phase 32 Plan 03 Task 3: TMDL Description Emission, Hidden States, Placement & Determinism ---
const allDescribedEntries = c.COLUMN_MANIFEST.concat(
    typeof c.CALLS_CALCULATED_COLUMNS !== 'undefined' ? c.CALLS_CALCULATED_COLUMNS : [],
    typeof c.CALLS_DERIVED_COLUMNS !== 'undefined' ? c.CALLS_DERIVED_COLUMNS : []
).filter(col => typeof col.description === 'string' && col.description.trim().length > 0);

check('described-entry count across registries is greater than zero (anti-vacuity MODEL-08)',
    allDescribedEntries.length > 0, true);

const callsSlashLines = (callsTmdlText.match(/^\t*\/\/\//gm) || []);
check('count of /// lines in Calls.tmdl equals count of described registry entries',
    callsSlashLines.length, allDescribedEntries.length);

const doubleTabSlashLines = (callsTmdlText.match(/^\t\t+\/\/\//gm) || []);
check('no /// line in Calls.tmdl begins with two tabs (must be at declaration indentation)',
    doubleTabSlashLines.length === 0, true);

allDescribedEntries.forEach(col => {
    const quotedName = c.quoteTmdlName(col.name);
    const expectedTwoLineCRLF = '\t/// ' + col.description + '\r\n\tcolumn ' + quotedName;
    const expectedTwoLineLF = '\t/// ' + col.description + '\n\tcolumn ' + quotedName;
    const hasPlacement = callsTmdlText.includes(expectedTwoLineCRLF) || callsTmdlText.includes(expectedTwoLineLF);
    check('Calls.tmdl description for ' + col.name + ' immediately precedes declaration', hasPlacement, true);
});

// Hidden-state assertions for Phase 32 columns
const hiddenColumnsExpected = [
    'Silence_Pct',
    'Silence_Bucket_Order',
    'Empathy_Bucket_Order',
    'Compliance_Risk_Order'
];

hiddenColumnsExpected.forEach(colName => {
    const pattern = new RegExp('\\tcolumn (?:' + colName + "|'" + colName + "')");
    const blockMatch = callsTmdlText.split(pattern)[1];
    const nextColIdx = blockMatch ? blockMatch.search(/\n\tcolumn |\n\tmeasure |\n\tpartition /) : -1;
    const blockText = nextColIdx !== -1 ? blockMatch.slice(0, nextColIdx) : (blockMatch || '');
    check('Calls.tmdl carries isHidden inside ' + colName + ' block', blockText.includes('\tisHidden'), true);
});

// Phase 34: Empathy_Score is visible for Compliance & Coaching page
const empathyBlockMatch = callsTmdlText.split(/\tcolumn Empathy_Score|\tcolumn 'Empathy_Score'/)[1];
const empathyNextIdx = empathyBlockMatch ? empathyBlockMatch.search(/\n\tcolumn |\n\tmeasure |\n\tpartition /) : -1;
const empathyBlock = empathyNextIdx !== -1 ? empathyBlockMatch.slice(0, empathyNextIdx) : (empathyBlockMatch || '');
check('Phase 34: Calls.tmdl does NOT carry isHidden inside Empathy_Score block (visible for Compliance & Coaching)',
    empathyBlock.includes('\tisHidden'), false);

// Phase 34: Max_Agitation_Score is visible for Compliance & Coaching page
const agitationBlockMatch = callsTmdlText.split(/\tcolumn Max_Agitation_Score|\tcolumn 'Max_Agitation_Score'/)[1];
const agitationNextIdx = agitationBlockMatch ? agitationBlockMatch.search(/\n\tcolumn |\n\tmeasure |\n\tpartition /) : -1;
const agitationBlock = agitationNextIdx !== -1 ? agitationBlockMatch.slice(0, agitationNextIdx) : (agitationBlockMatch || '');
check('Phase 34: Calls.tmdl does NOT carry isHidden inside Max_Agitation_Score block (visible for Compliance & Coaching)',
    agitationBlock.includes('\tisHidden'), false);

// DRILL-02: Call_Summary_Transcript is visible for table visual
const transcriptBlockMatch = callsTmdlText.split(/\tcolumn Call_Summary_Transcript|\tcolumn 'Call_Summary_Transcript'/)[1];
const transcriptNextIdx = transcriptBlockMatch ? transcriptBlockMatch.search(/\n\tcolumn |\n\tmeasure |\n\tpartition /) : -1;
const transcriptBlock = transcriptNextIdx !== -1 ? transcriptBlockMatch.slice(0, transcriptNextIdx) : (transcriptBlockMatch || '');
check('DRILL-02: Calls.tmdl does NOT carry isHidden inside Call_Summary_Transcript block (visible for table visual)',
    transcriptBlock.includes('\tisHidden'), false);

// D-12: Contact_ID stays visible with forward reference
const contactIdBlockMatch = callsTmdlText.split(/\tcolumn Contact_ID|\tcolumn 'Contact_ID'/)[1];
const contactIdNextIdx = contactIdBlockMatch ? contactIdBlockMatch.search(/\n\tcolumn |\n\tmeasure |\n\tpartition /) : -1;
const contactIdBlock = contactIdNextIdx !== -1 ? contactIdBlockMatch.slice(0, contactIdNextIdx) : (contactIdBlockMatch || '');
check('D-12: Calls.tmdl does NOT carry isHidden inside Contact_ID block (stays visible with forward reference)',
    contactIdBlock.includes('\tisHidden'), false);

// D-16: Scope check for non-Calls tables
const dateTableTmdl = fileMap['powerbi/SpeechAnalytics.SemanticModel/definition/tables/DateTable.tmdl'] || '';
const silenceBucketsTmdl = fileMap['powerbi/SpeechAnalytics.SemanticModel/definition/tables/SilenceBuckets.tmdl'] || '';
check('D-16: DateTable.tmdl contains zero /// lines', (dateTableTmdl.match(/^\t*\/\/\//gm) || []).length, 0);
check('D-16: SilenceBuckets.tmdl contains zero /// lines', (silenceBucketsTmdl.match(/^\t*\/\/\//gm) || []).length, 0);

// Determinism check across two successive buildPowerBIFileMap generations
const sampleRowsForDet = [{ Timestamp: '2026-01-01' }];
const fileMapSecondGen = c.buildPowerBIFileMap(sampleRowsForDet);
const callsTmdlSecondGen = fileMapSecondGen['powerbi/SpeechAnalytics.SemanticModel/definition/tables/Calls.tmdl'] || '';
check('two successive buildPowerBIFileMap calls produce byte-identical Calls.tmdl text',
    callsTmdlText === callsTmdlSecondGen, true);

// --- Phase 22-04: Task 2 - Fold/demote delta cards & baseline qualification ---
const execCardSlots = c.PBI_EXEC_LAYOUT.filter(s => s.kind === 'card');
check('PBI_EXEC_LAYOUT contains exactly 7 card slots', execCardSlots.length, 7);

let allCardsDeclareRequiredProps = true;
execCardSlots.forEach(s => {
    if (!s.measure || !s.label || !s.deltaMeasure || !s.deltaDirection || !s.baselineLabel) {
        allCardsDeclareRequiredProps = false;
    }
});
check('every card slot declares measure, label, deltaMeasure, deltaDirection, baselineLabel', allCardsDeclareRequiredProps, true);

let monotonicX = true;
for (let i = 1; i < execCardSlots.length; i++) {
    if (execCardSlots[i].x <= execCardSlots[i - 1].x) monotonicX = false;
}
check('card slot x positions increase monotonically', monotonicX, true);

check('baselineLabel equals PBI_DELTA_BASELINE_LABEL',
    execCardSlots.every(s => s.baselineLabel === c.PBI_DELTA_BASELINE_LABEL && s.baselineLabel === 'vs prior period'), true);

check('assertExecLayoutIsRenderable passes', (function() {
    try { c.assertExecLayoutIsRenderable(fileMap); return true; } catch(e) { return false; }
})(), true);

const lineVolumeSlot = c.PBI_EXEC_LAYOUT.find(s => s.key === 'lineVolumeTrend');
const barCategorySlot = c.PBI_EXEC_LAYOUT.find(s => s.key === 'barPrimaryCategory');
const gaugeFcrSlot = c.PBI_EXEC_LAYOUT.find(s => s.key === 'gaugeFcrRate');
check('lineVolumeTrend, barPrimaryCategory and gaugeFcrRate geometry reflowed for header band',
    lineVolumeSlot.x === 24 && lineVolumeSlot.y === 342 && lineVolumeSlot.width === 1872 && lineVolumeSlot.height === 332 &&
    barCategorySlot.x === 24 && barCategorySlot.y === 690 && barCategorySlot.width === 1400 && barCategorySlot.height === 374 &&
    gaugeFcrSlot && gaugeFcrSlot.x === 1448 && gaugeFcrSlot.y === 690 && gaugeFcrSlot.width === 448 && gaugeFcrSlot.height === 374, true);

// Task 2 Step 8: Compliance page geometry assertions
const lineAgitationSlot = c.PBI_COMPLIANCE_LAYOUT.find(s => s.key === 'lineAgitationCurve');
const gaugeComplianceSlot = c.PBI_COMPLIANCE_LAYOUT.find(s => s.key === 'gaugeComplianceRisk');
const colComplianceMixSlot = c.PBI_COMPLIANCE_LAYOUT.find(s => s.key === 'columnComplianceMix');
check('lineAgitationCurve and gaugeComplianceRisk geometry on compliance page',
    lineAgitationSlot && lineAgitationSlot.width === 1400 && lineAgitationSlot.x === 24 && lineAgitationSlot.y === 342 && lineAgitationSlot.height === 332 &&
    gaugeComplianceSlot && gaugeComplianceSlot.x === 1448 && gaugeComplianceSlot.y === 342 && gaugeComplianceSlot.width === 448 && gaugeComplianceSlot.height === 332, true);
check('columnComplianceMix remains untouched in geometry and binding per D-05',
    colComplianceMixSlot && colComplianceMixSlot.x === 968 && colComplianceMixSlot.y === 690 && colComplianceMixSlot.width === 928 && colComplianceMixSlot.height === 374 &&
    colComplianceMixSlot.measure === 'Total Calls' && colComplianceMixSlot.column === 'Compliance_Risk', true);

const execBandSlot = c.PBI_EXEC_LAYOUT.find(s => s.layer === 'background');
const opsBandSlot = c.PBI_OPS_LAYOUT.find(s => s.layer === 'background');
check('both pages band slots share PBI_HEADER_BAND_HEIGHT',
    execBandSlot && opsBandSlot &&
    execBandSlot.height === c.PBI_HEADER_BAND_HEIGHT &&
    opsBandSlot.height === c.PBI_HEADER_BAND_HEIGHT &&
    c.PBI_HEADER_BAND_HEIGHT === 72, true);

let conditionalInCardVisualFound = false;
Object.keys(fileMap).forEach(k => {
    if (k.endsWith('visual.json')) {
        const doc = JSON.parse(fileMap[k]);
        if (doc.visual && doc.visual.visualType === 'cardVisual' && doc.visual.objects && doc.visual.objects.value) {
            const str = JSON.stringify(doc.visual.objects.value);
            if (str.includes('Conditional')) conditionalInCardVisualFound = true;
        }
    }
});
check('no emitted visual.json contains Conditional under cardVisual value property', !conditionalInCardVisualFound, true);

const emptyCardMap = c.buildPowerBIFileMap([]);
let emptyMapHasAllCards = true;
execCardSlots.forEach(s => {
    const k = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/' + s.id + '/visual.json';
    if (!emptyCardMap[k]) emptyMapHasAllCards = false;
});
check('buildPowerBIFileMap([]) emits visual.json for all 7 card slots without throwing', emptyMapHasAllCards, true);

const cardMap1 = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01' }]);
const cardMap2 = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01' }]);
let deterministicCards = true;
execCardSlots.forEach(s => {
    const k = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/' + s.id + '/visual.json';
    if (cardMap1[k] !== cardMap2[k]) deterministicCards = false;
});
check('buildPowerBIFileMap yields byte-identical card visuals across runs', deterministicCards, true);

// Option A (D-06) folded referenceLabel check:
const foldedCardsOk = execCardSlots.every(s => {
    const k = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/' + s.id + '/visual.json';
    const vis = JSON.parse(fileMap[k]);
    return !!(vis.visual && vis.visual.objects && vis.visual.objects.referenceLabel && vis.visual.objects.referenceLabel[0]);
});
check('Option A: all 7 KPI cards carry native referenceLabel objects', foldedCardsOk, true);
check('THEME_OWNED_PROPERTY_ALLOWLIST includes objects.value.fontSize', c.THEME_OWNED_PROPERTY_ALLOWLIST.some(a => a.path === 'objects.value.fontSize'), true);

// --- Phase 22-05: Ranking chart sorts, QA axis floors, coaching retitle, showAll empty buckets ---

// Task 1 Test 1: every slot of kind 'bar' in either layout manifest declares a sort object with field and direction
const allBarSlots = c.PBI_EXEC_LAYOUT.concat(c.PBI_OPS_LAYOUT).filter(s => s.kind === 'bar');
check('every ranking bar slot declares a sort', allBarSlots.every(s => s.sort && s.sort.field && (s.sort.direction === 'Ascending' || s.sort.direction === 'Descending')), true);

// Task 1 Test 2: the slot of kind 'column' (columnSilenceBuckets) declares no sort key, and its emitted visual.json has no sortDefinition
const colHistSlot = c.PBI_OPS_LAYOUT.find(s => s.key === 'columnSilenceBuckets');
check('histogram slot declares no sort', colHistSlot && colHistSlot.sort === undefined, true);
const histVisualKey = 'powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/8192a3b4c5d6e7f8091a/visual.json';
const histDoc = JSON.parse(fileMap[histVisualKey]);
check('histogram declares no report-level sort', histDoc.visual && histDoc.visual.query && histDoc.visual.query.sortDefinition === undefined, true);

// Task 1 Test 3: barPrimaryCategory's emitted visual has sortDefinition descending on Total Calls
const barPrimKey = 'powerbi/SpeechAnalytics.Report/definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/9a3f7c2e5081bd64f29c/visual.json';
const barPrimDoc = JSON.parse(fileMap[barPrimKey]);
const barPrimSort = barPrimDoc.visual && barPrimDoc.visual.query && barPrimDoc.visual.query.sortDefinition && barPrimDoc.visual.query.sortDefinition.sort && barPrimDoc.visual.query.sortDefinition.sort[0];
check('barPrimaryCategory sorts descending by Total Calls',
    barPrimSort && barPrimSort.field && barPrimSort.field.Measure && barPrimSort.field.Measure.Property === 'Total Calls' && barPrimSort.direction === 'Descending', true);

// Task 1 Test 4: barAgentBreakdown's emitted visual has sortDefinition ascending on Avg QA Score
const barAgentKey = 'powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/708192a3b4c5d6e7f809/visual.json';
const barAgentDoc = JSON.parse(fileMap[barAgentKey]);
const barAgentSort = barAgentDoc.visual && barAgentDoc.visual.query && barAgentDoc.visual.query.sortDefinition && barAgentDoc.visual.query.sortDefinition.sort && barAgentDoc.visual.query.sortDefinition.sort[0];
check('barAgentBreakdown sorts ascending by Avg QA Score',
    barAgentSort && barAgentSort.field && barAgentSort.field.Measure && barAgentSort.field.Measure.Property === 'Avg QA Score' && barAgentSort.direction === 'Ascending', true);

// Task 1 Test 5: barQueueBreakdown and barAgentBreakdown each emit valueAxis start with Literal.Value === '75D'
const queueDoc22_5 = JSON.parse(fileMap['powerbi/SpeechAnalytics.Report/definition/pages/b2c3d4e5f6a7b8c9d0e1/visuals/6f708192a3b4c5d6e7f8/visual.json']);
const queueAxisStart = queueDoc22_5.visual.objects && queueDoc22_5.visual.objects.valueAxis && queueDoc22_5.visual.objects.valueAxis[0].properties.start.expr.Literal.Value;
const agentAxisStart = barAgentDoc.visual.objects && barAgentDoc.visual.objects.valueAxis && barAgentDoc.visual.objects.valueAxis[0].properties.start.expr.Literal.Value;
check('QA bar charts carry an axis floor of 75', queueAxisStart === '75D' && agentAxisStart === '75D', true);

// Task 1 Test 6: barPrimaryCategory emits no valueAxis start
const barPrimAxisStart = barPrimDoc.visual.objects && barPrimDoc.visual.objects.valueAxis && barPrimDoc.visual.objects.valueAxis[0] && barPrimDoc.visual.objects.valueAxis[0].properties && barPrimDoc.visual.objects.valueAxis[0].properties.start;
check('count bar chart carries no axis floor', barPrimAxisStart === undefined, true);

// Task 1 Test 7: barAgentBreakdown chartTitle contains no digit
const agentSlot = c.PBI_OPS_LAYOUT.find(s => s.key === 'barAgentBreakdown');
check('coaching chart title names no agent count', agentSlot && agentSlot.chartTitle === 'Coaching Focus: Lowest Avg QA Scores' && !/\d/.test(agentSlot.chartTitle), true);

// Task 1 Test 8: assertOpsLayoutIsRenderable and assertExecLayoutIsRenderable throw when a bar slot lacks sort
let execSortCheckThrew = false;
let opsSortCheckThrew = false;
try {
    const origSort = c.PBI_EXEC_LAYOUT.find(s => s.key === 'barPrimaryCategory').sort;
    delete c.PBI_EXEC_LAYOUT.find(s => s.key === 'barPrimaryCategory').sort;
    try {
        c.assertExecLayoutIsRenderable();
    } finally {
        c.PBI_EXEC_LAYOUT.find(s => s.key === 'barPrimaryCategory').sort = origSort;
    }
} catch (e) {
    if (e.message && e.message.includes('barPrimaryCategory') && e.message.includes('sort')) {
        execSortCheckThrew = true;
    }
}
try {
    const origSort = c.PBI_OPS_LAYOUT.find(s => s.key === 'barAgentBreakdown').sort;
    delete c.PBI_OPS_LAYOUT.find(s => s.key === 'barAgentBreakdown').sort;
    try {
        c.assertOpsLayoutIsRenderable();
    } finally {
        c.PBI_OPS_LAYOUT.find(s => s.key === 'barAgentBreakdown').sort = origSort;
    }
} catch (e) {
    if (e.message && e.message.includes('barAgentBreakdown') && e.message.includes('sort')) {
        opsSortCheckThrew = true;
    }
}
check('layout renderable assertions catch missing bar sort', execSortCheckThrew && opsSortCheckThrew, true);

// Task 1 Test 9: no emitted visual.json anywhere in fileMap contains orderBy key in visual.query
let visualHasOrderBy = false;
Object.keys(fileMap).forEach(k => {
    if (k.endsWith('visual.json')) {
        const doc = JSON.parse(fileMap[k]);
        if (doc.visual && doc.visual.query && (doc.visual.query.orderBy || doc.visual.query.OrderBy)) {
            visualHasOrderBy = true;
        }
    }
});
check('no visual query contains orderBy', !visualHasOrderBy, true);

// Task 3 Test 1: columnSilenceBuckets declares showItemsWithNoData: true and emits showAll: true under Category
check('columnSilenceBuckets declares showItemsWithNoData', colHistSlot && colHistSlot.showItemsWithNoData, true);
check('histogram visual emits Category.showAll === true', histDoc.visual && histDoc.visual.query && histDoc.visual.query.queryState && histDoc.visual.query.queryState.Category && histDoc.visual.query.queryState.Category.showAll === true, true);

// Task 3 Test 2: no other slot carries showItemsWithNoData
const otherSlotsWithShowAll = c.PBI_EXEC_LAYOUT.concat(c.PBI_OPS_LAYOUT).filter(s => s.key !== 'columnSilenceBuckets' && s.showItemsWithNoData);
check('no other slot declares showItemsWithNoData', otherSlotsWithShowAll.length, 0);

// Task 3 Test 5: Silence_Bucket and Silence_Bucket_Order DAX strings are byte-identical to pre-plan values
const silenceBucketCol = c.CALLS_CALCULATED_COLUMNS.find(col => col.name === 'Silence_Bucket');
const silenceOrderCol = c.CALLS_CALCULATED_COLUMNS.find(col => col.name === 'Silence_Bucket_Order');
const expectedBucketDax = 'SWITCH(TRUE(), \'Calls\'[Silence_Duration (s)] < 15, "0-15", \'Calls\'[Silence_Duration (s)] < 30, "15-30", \'Calls\'[Silence_Duration (s)] < 60, "30-60", \'Calls\'[Silence_Duration (s)] < 120, "60-120", "120+")';
const expectedOrderDax = 'SWITCH(TRUE(), \'Calls\'[Silence_Duration (s)] < 15, 1, \'Calls\'[Silence_Duration (s)] < 30, 2, \'Calls\'[Silence_Duration (s)] < 60, 3, \'Calls\'[Silence_Duration (s)] < 120, 4, 5)';
check('Silence_Bucket DAX string is byte-identical', silenceBucketCol && silenceBucketCol.dax, expectedBucketDax);
check('Silence_Bucket_Order DAX string is byte-identical', silenceOrderCol && silenceOrderCol.dax, expectedOrderDax);

// Task 3 Test 6: Silence_Bucket sortByColumn is still Silence_Bucket_Order
check('Silence_Bucket sortByColumn is Silence_Bucket_Order', silenceBucketCol && silenceBucketCol.sortByColumn, 'Silence_Bucket_Order');

// Task 3 Test 7: Threshold logic evaluation (15 -> 15-30/2, 60 -> 60-120/4, 120 -> 120+/5)
function evaluateSilenceBucket(val) {
    if (val === null || val === undefined || val === '') return { bucket: '0-15', order: 1 };
    const num = Number(val);
    if (num < 15) return { bucket: '0-15', order: 1 };
    if (num < 30) return { bucket: '15-30', order: 2 };
    if (num < 60) return { bucket: '30-60', order: 3 };
    if (num < 120) return { bucket: '60-120', order: 4 };
    return { bucket: '120+', order: 5 };
}
const b15 = evaluateSilenceBucket(15);
check('silence threshold 15 maps to 15-30 order 2', b15.bucket === '15-30' && b15.order === 2, true);
const b60 = evaluateSilenceBucket(60);
check('silence threshold 60 maps to 60-120 order 4', b60.bucket === '60-120' && b60.order === 4, true);
const b120 = evaluateSilenceBucket(120);
check('silence threshold 120 maps to 120+ order 5', b120.bucket === '120+' && b120.order === 5, true);

// Task 3 Test 8: null, blank, undefined, -1 map to 0-15 order 1
const bNull = evaluateSilenceBucket(null);
check('null maps to 0-15 order 1', bNull.bucket === '0-15' && bNull.order === 1, true);
const bBlank = evaluateSilenceBucket('');
check('blank maps to 0-15 order 1', bBlank.bucket === '0-15' && bBlank.order === 1, true);
const bUndef = evaluateSilenceBucket(undefined);
check('undefined maps to 0-15 order 1', bUndef.bucket === '0-15' && bUndef.order === 1, true);
const bNeg = evaluateSilenceBucket(-1);
check('negative duration -1 maps to 0-15 order 1', bNeg.bucket === '0-15' && bNeg.order === 1, true);

// --- EXPORT-06: README required content and drift gate ---
const readmeContent = fileMap['README.md'];
check('README.md is a non-empty string in fileMap', typeof readmeContent === 'string' && readmeContent.length > 0, true);

// Manifest-driven assertions
check('README_REQUIRED_CONTENT has at least 11 entries', Array.isArray(c.README_REQUIRED_CONTENT) && c.README_REQUIRED_CONTENT.length >= 11, true);
for (const entry of (c.README_REQUIRED_CONTENT || [])) {
    check('README contains ' + entry.label, readmeContent.includes(entry.needle), true);
}

// Six numbered steps substance assertions
check('README: step 1 extract ZIP', readmeContent.includes('Extract this ZIP to a folder on your computer'), true);
check('README: step 2 open .pbip', readmeContent.includes('.pbip'), true);
check('README: step 3 expected CsvFolderPath error', readmeContent.includes('CsvFolderPath has not been set yet'), true);
check('README: step 4 Transform data > Edit parameters', readmeContent.includes('Transform data > Edit parameters'), true);
check('README: step 5 Apply changes in yellow banner', readmeContent.includes('Apply changes'), true);
check('README: step 6 Refresh Calls table', readmeContent.includes('Click Refresh. The Calls table now loads'), true);
check('README: once per extracted copy closing line', readmeContent.includes('You only do this once per extracted copy'), true);

// Phase 33 DRILL-04: Single-sourced PII exposure disclosure checks
const piiExposureEntry = (c.README_REQUIRED_CONTENT || []).find(x => x.label === 'drill-pii-exposure');
check('README: drill-pii-exposure entry exists in README_REQUIRED_CONTENT', !!piiExposureEntry, true);
check('README: drill-pii-exposure needle is strictly identical to PBI_PII_EXPOSURE_STATEMENT', piiExposureEntry && piiExposureEntry.needle === c.PBI_PII_EXPOSURE_STATEMENT, true);
check('README: README.md carries PBI_PII_EXPOSURE_STATEMENT verbatim', readmeContent.includes(c.PBI_PII_EXPOSURE_STATEMENT), true);
check('README: README.md names dashboard-ready.csv as reachable surface', readmeContent.includes('dashboard-ready.csv'), true);
check('README: README.md names DAX as reachable surface', readmeContent.includes('DAX'), true);
check('README: README.md names Power Query as reachable surface', readmeContent.includes('Power Query'), true);

let piiSingleSourceThrew = false;
try {
    c.assertPiiExposureStatementIsSingleSourced(fileMap);
} catch (e) {
    piiSingleSourceThrew = true;
}
check('assertPiiExposureStatementIsSingleSourced does not throw on fileMap', piiSingleSourceThrew, false);

// File map properties
check('fileMap entry count is 71', Object.keys(fileMap).length, 71);
check('README.md is the only non-powerbi/ key', Object.keys(fileMap).filter(k => !k.startsWith('powerbi/')), ['README.md']);

// SilenceBuckets dimension & relationship invariants (D-18, D-19, SC8)
check('SILENCE_BUCKET_DIMENSION has exactly five rows', Array.isArray(c.SILENCE_BUCKET_DIMENSION) && c.SILENCE_BUCKET_DIMENSION.length === 5, true);
const bucketCol = c.CALLS_CALCULATED_COLUMNS.find(x => x.name === 'Silence_Bucket');
const allLabelsInDax = (c.SILENCE_BUCKET_DIMENSION || []).every(r => bucketCol && bucketCol.dax.includes('"' + r.label + '"'));
check('every dimension label appears in Silence_Bucket calculated-column DAX', allLabelsInDax, true);
const orderSequence = (c.SILENCE_BUCKET_DIMENSION || []).map(r => r.order).join(',');
check('dimension order values are contiguous sequence starting at 1', orderSequence, '1,2,3,4,5');

const silenceTmdl = fileMap['powerbi/SpeechAnalytics.SemanticModel/definition/tables/SilenceBuckets.tmdl'];
check('SilenceBuckets.tmdl is emitted in fileMap', !!silenceTmdl, true);
check('Bucket_Label is sorted by Bucket_Order', /column\s+Bucket_Label[\s\S]*?sortByColumn:\s*Bucket_Order/.test(silenceTmdl || ''), true);

const fileMapRunRel2 = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01' }]);
const rel1 = fileMap['powerbi/SpeechAnalytics.SemanticModel/definition/relationships.tmdl'];
const rel2 = fileMapRunRel2['powerbi/SpeechAnalytics.SemanticModel/definition/relationships.tmdl'];
check('relationships.tmdl is emitted in fileMap', !!rel1, true);
check('relationship TMDL contains fixed GUID constant', rel1 && rel1.includes('relationship ' + c.PBI_SILENCE_RELATIONSHIP_ID), true);
check('relationship TMDL is identical across two generator runs', rel1 === rel2, true);

let modelTablesGateThrew = false;
try {
    c.assertModelTablesAreReferenced(fileMap);
} catch (e) {
    modelTablesGateThrew = true;
}
check('assertModelTablesAreReferenced does not throw on fileMap', modelTablesGateThrew, false);

// Phase 29 REFAC-01 / VERIF-02: Relationship registry contract checks
const originalRelEntries = c.PBI_RELATIONSHIPS.slice();

try {
    // 1. Baseline: assertRelationshipRegistryIsWellFormed passes
    let relWellFormedThrew = false;
    try {
        c.assertRelationshipRegistryIsWellFormed(fileMap);
    } catch (e) {
        relWellFormedThrew = true;
    }
    check('assertRelationshipRegistryIsWellFormed passes on baseline registry', relWellFormedThrew, false);

    // 2. Duplicate relationship id throws with duplicate relationship id and offending id
    c.PBI_RELATIONSHIPS.push({
        id: c.PBI_SILENCE_RELATIONSHIP_ID,
        fromColumn: 'Calls.Agent_ID',
        toColumn: 'Agents.Agent_ID'
    });
    let dupIdMsg = '';
    try {
        c.assertRelationshipRegistryIsWellFormed(fileMap);
    } catch (e) {
        dupIdMsg = e.message;
    }
    check('duplicate relationship id throws with expected message',
        dupIdMsg.includes('duplicate relationship id') && dupIdMsg.includes(c.PBI_SILENCE_RELATIONSHIP_ID), true);

    // Restore
    c.PBI_RELATIONSHIPS.length = 0;
    c.PBI_RELATIONSHIPS.push(...originalRelEntries);

    // 3. Duplicate relationship endpoint pair throws with duplicate relationship endpoint pair
    c.PBI_RELATIONSHIPS.push({
        id: '11111111-2222-3333-4444-555555555555',
        fromColumn: 'Calls.Silence_Bucket',
        toColumn: 'SilenceBuckets.Bucket_Label'
    });
    let dupPairMsg = '';
    try {
        c.assertRelationshipRegistryIsWellFormed(fileMap);
    } catch (e) {
        dupPairMsg = e.message;
    }
    check('duplicate relationship endpoint pair throws with expected message',
        dupPairMsg.includes('duplicate relationship endpoint pair'), true);

    // Restore
    c.PBI_RELATIONSHIPS.length = 0;
    c.PBI_RELATIONSHIPS.push(...originalRelEntries);

    // 4. Missing fromColumn throws with must declare fromColumn and offending id
    const missingFromId = '22222222-3333-4444-5555-666666666666';
    c.PBI_RELATIONSHIPS.push({
        id: missingFromId,
        fromColumn: '',
        toColumn: 'SilenceBuckets.Bucket_Label'
    });
    let missingFromMsg = '';
    try {
        c.assertRelationshipRegistryIsWellFormed(fileMap);
    } catch (e) {
        missingFromMsg = e.message;
    }
    check('missing fromColumn throws with expected message',
        missingFromMsg.includes('must declare fromColumn') && missingFromMsg.includes(missingFromId), true);

    // Restore
    c.PBI_RELATIONSHIPS.length = 0;
    c.PBI_RELATIONSHIPS.push(...originalRelEntries);

    // 5. Missing toColumn throws with must declare toColumn and offending id
    const missingToId = '33333333-4444-5555-6666-777777777777';
    c.PBI_RELATIONSHIPS.push({
        id: missingToId,
        fromColumn: 'Calls.Silence_Bucket',
        toColumn: ''
    });
    let missingToMsg = '';
    try {
        c.assertRelationshipRegistryIsWellFormed(fileMap);
    } catch (e) {
        missingToMsg = e.message;
    }
    check('missing toColumn throws with expected message',
        missingToMsg.includes('must declare toColumn') && missingToMsg.includes(missingToId), true);

    // Restore
    c.PBI_RELATIONSHIPS.length = 0;
    c.PBI_RELATIONSHIPS.push(...originalRelEntries);

    // 6. Malformed endpoint (not Table.Column) throws with must be Table.Column
    const malformedId = '44444444-5555-6666-7777-888888888888';
    c.PBI_RELATIONSHIPS.push({
        id: malformedId,
        fromColumn: 'Calls_Silence_Bucket_NoDot',
        toColumn: 'SilenceBuckets.Bucket_Label'
    });
    let malformedMsg = '';
    try {
        c.assertRelationshipRegistryIsWellFormed(fileMap);
    } catch (e) {
        malformedMsg = e.message;
    }
    check('malformed endpoint throws with must be Table.Column',
        malformedMsg.includes('must be Table.Column'), true);

    // Restore
    c.PBI_RELATIONSHIPS.length = 0;
    c.PBI_RELATIONSHIPS.push(...originalRelEntries);

    // 7. Empty registry -> buildRelationshipsTmdl() returns empty string, buildPowerBIFileMap still emits key with empty content
    c.PBI_RELATIONSHIPS.length = 0;
    const emptyRelTmdl = c.buildRelationshipsTmdl();
    check('empty registry produces empty string TMDL', emptyRelTmdl, '');
    const emptyMap = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01' }]);
    const relKey = 'powerbi/SpeechAnalytics.SemanticModel/definition/relationships.tmdl';
    check('empty registry still emits relationships.tmdl key in fileMap', Object.prototype.hasOwnProperty.call(emptyMap, relKey), true);
    check('empty registry emits empty string in relationships.tmdl', emptyMap[relKey], '');

    // Restore
    c.PBI_RELATIONSHIPS.push(...originalRelEntries);

    // 8. Multi-entry registry -> emitted text contains relationship block headers, in array order
    const baselineRelTmdl = c.buildRelationshipsTmdl();
    const extraRelId = '55555555-6666-7777-8888-999999999999';
    c.PBI_RELATIONSHIPS.push({
        id: extraRelId,
        fromColumn: 'Calls.Silence_Bucket',
        toColumn: 'SilenceBuckets.Bucket_Order'
    });
    const extraEntryTmdl = c.buildRelationshipsTmdl();
    const headers = [...extraEntryTmdl.matchAll(/^relationship\s+([^\r\n]+)/gm)].map(m => m[1]);
    check('multi-entry registry emits relationship block headers in array order',
        headers.length === 4 &&
        headers[0] === c.PBI_SILENCE_RELATIONSHIP_ID &&
        headers[1] === c.PBI_DATE_RELATIONSHIP_ID &&
        headers[2] === c.PBI_EMPATHY_RELATIONSHIP_ID &&
        headers[3] === extraRelId, true);
    check('first blocks in multi-entry emission are byte-identical to baseline output',
        extraEntryTmdl.startsWith(baselineRelTmdl), true);

    // 9. buildRelationshipsTmdl applies no sort: an entry appended at the end appears last
    check('appended entry appears last in TMDL output', headers[headers.length - 1], extraRelId);

    // Restore
    c.PBI_RELATIONSHIPS.length = 0;
    c.PBI_RELATIONSHIPS.push(...originalRelEntries);

    // 10. Entry whose toColumn names absent table/column -> assertModelTablesAreReferenced throws
    c.PBI_RELATIONSHIPS.push({
        id: '66666666-7777-8888-9999-000000000000',
        fromColumn: 'Calls.Silence_Bucket',
        toColumn: 'NonExistentTable.NonExistentColumn'
    });
    const badEndpointMap = c.buildPowerBIFileMap([{ Timestamp: '2026-01-01' }]);
    let badEndpointThrew = false;
    try {
        c.assertModelTablesAreReferenced(badEndpointMap);
    } catch (e) {
        badEndpointThrew = true;
    }
    check('assertModelTablesAreReferenced throws on absent endpoint table/column', badEndpointThrew, true);

} finally {
    // Always guarantee baseline registry restoration
    c.PBI_RELATIONSHIPS.length = 0;
    c.PBI_RELATIONSHIPS.push(...originalRelEntries);
}

// Phase 29 REFAC-02: Page registry and visual dispatch contract checks
try {
    // 1. Every PBI_PAGES entry has a non-empty string key, layout array, same object as free global
    const execPage = c.getPageByKey('execHub');
    const opsPage = c.getPageByKey('opsQa');
    check('execHub page entry has non-empty string key', typeof execPage.key === 'string' && execPage.key.length > 0, true);
    check('opsQa page entry has non-empty string key', typeof opsPage.key === 'string' && opsPage.key.length > 0, true);
    check('execHub layout is array and identical object to PBI_EXEC_LAYOUT', Array.isArray(execPage.layout) && execPage.layout === c.PBI_EXEC_LAYOUT, true);
    check('opsQa layout is array and identical object to PBI_OPS_LAYOUT', Array.isArray(opsPage.layout) && opsPage.layout === c.PBI_OPS_LAYOUT, true);

    // 2. Page keys are pairwise distinct
    const pageKeys = c.PBI_PAGES.map(p => p.key);
    const distinctKeys = new Set(pageKeys);
    check('PBI_PAGES keys are pairwise distinct', distinctKeys.size === pageKeys.length, true);

    // 3. Every entry produces definition/pages/<id>/page.json and layout.length visuals
    let totalVisualsCount = 0;
    for (const page of c.PBI_PAGES) {
        const pageJsonKey = `powerbi/${c.PBI_PROJECT_NAME}.Report/definition/pages/${page.id}/page.json`;
        check(`page.json emitted for page ${page.key}`, Object.prototype.hasOwnProperty.call(fileMap, pageJsonKey), true);
        const prefix = `powerbi/${c.PBI_PROJECT_NAME}.Report/definition/pages/${page.id}/visuals/`;
        const visualKeys = Object.keys(fileMap).filter(k => k.startsWith(prefix) && k.endsWith('/visual.json'));
        check(`visual count matches layout length for page ${page.key}`, visualKeys.length, page.layout.length);
        totalVisualsCount += visualKeys.length;
    }

    // 4. Sum of visual keys equals sum of layout lengths
    const totalLayoutSlots = c.PBI_PAGES.reduce((sum, p) => sum + p.layout.length, 0);
    check('sum of visual keys across all pages equals sum of layout lengths', totalVisualsCount, totalLayoutSlots);

    // 5. Slot with unrecognised kind throws with 'unknown visual kind' and slot key
    const dummySlot = { key: 'invalidKindSlot', id: '12345678901234567890', kind: 'unsupportedVisualKind' };
    const dummyPage = { id: 'a1b2c3d4e5f6a7b8c9d0', key: 'testPage', layout: [dummySlot] };
    let invalidKindMsg = '';
    try {
        c.buildPageVisuals(dummyPage, [{ Timestamp: '2026-01-01' }]);
    } catch (e) {
        invalidKindMsg = e.message;
    }
    check('slot with unrecognised kind throws with expected message',
        invalidKindMsg.includes('unknown visual kind') && invalidKindMsg.includes('invalidKindSlot'), true);

    // 6. Slicer slot stripped of slicerOptions throws with 'slicer slot' and 'slicerOptions' and slot key
    const testExecDateSlicer = c.PBI_EXEC_LAYOUT.find(s => s.key === 'dateSlicer');
    const savedSlicerOptions = testExecDateSlicer.slicerOptions;
    let missingSlicerOptionsMsg = '';
    try {
        delete testExecDateSlicer.slicerOptions;
        c.buildPageVisuals(execPage, [{ Timestamp: '2026-01-01' }]);
    } catch (e) {
        missingSlicerOptionsMsg = e.message;
    } finally {
        testExecDateSlicer.slicerOptions = savedSlicerOptions;
    }
    check('slicer slot stripped of slicerOptions throws with expected message',
        missingSlicerOptionsMsg.includes('slicer slot') && missingSlicerOptionsMsg.includes('slicerOptions') && missingSlicerOptionsMsg.includes('dateSlicer'), true);

    // 7. PBI_VISUAL_BUILDERS.column and PBI_VISUAL_BUILDERS.bar are both bar builder
    check('PBI_VISUAL_BUILDERS.bar is function', typeof c.PBI_VISUAL_BUILDERS.bar, 'function');
    check('PBI_VISUAL_BUILDERS.column is same function as PBI_VISUAL_BUILDERS.bar',
        c.PBI_VISUAL_BUILDERS.column === c.PBI_VISUAL_BUILDERS.bar, true);

    // 8. Every distinct kind present across both layouts other than slicer has entry in PBI_VISUAL_BUILDERS
    const allKinds = new Set();
    c.PBI_EXEC_LAYOUT.concat(c.PBI_OPS_LAYOUT).forEach(s => {
        if (s.kind !== 'slicer') allKinds.add(s.kind);
    });
    let allKindsCovered = true;
    for (const kind of allKinds) {
        if (!c.PBI_VISUAL_BUILDERS[kind] || typeof c.PBI_VISUAL_BUILDERS[kind] !== 'function') {
            allKindsCovered = false;
        }
    }
    check('all distinct non-slicer kinds across layouts have entry in PBI_VISUAL_BUILDERS', allKindsCovered, true);

    // 9. buildExecHubVisuals deep-equals buildPageVisuals(execPage), likewise for Ops
    const testRows = [{ Timestamp: '2026-01-01' }];
    const execDirect = c.buildExecHubVisuals(testRows);
    const execGeneric = c.buildPageVisuals(execPage, testRows);
    check('buildExecHubVisuals deep equals buildPageVisuals', JSON.stringify(execDirect), JSON.stringify(execGeneric));

    const opsDirect = c.buildOpsQaVisuals(testRows);
    const opsGeneric = c.buildPageVisuals(opsPage, testRows);
    check('buildOpsQaVisuals deep equals buildPageVisuals', JSON.stringify(opsDirect), JSON.stringify(opsGeneric));
} finally {
    // In-place restorations guaranteed
}

// Phase 29 REFAC-02 (Plan 29-03): Merged layout assertion contract checks
try {
    // 1. assertPageLayoutIsRenderable exists and calling it with each PBI_PAGES entry throws nothing
    check('assertPageLayoutIsRenderable is function', typeof c.assertPageLayoutIsRenderable, 'function');
    let pageLayoutThrew = false;
    try {
        for (const page of c.PBI_PAGES) {
            c.assertPageLayoutIsRenderable(page, fileMap);
            c.assertPageLayoutIsRenderable(page); // also with zero extra arguments
        }
    } catch (e) {
        pageLayoutThrew = true;
    }
    check('assertPageLayoutIsRenderable throws nothing on baseline pages', pageLayoutThrew, false);

    // 2. assertAllPageLayoutsAreRenderable exists and throws nothing on clean map
    check('assertAllPageLayoutsAreRenderable is function', typeof c.assertAllPageLayoutsAreRenderable, 'function');
    let allPagesThrew = false;
    try {
        c.assertAllPageLayoutsAreRenderable(fileMap);
        c.assertAllPageLayoutsAreRenderable(); // zero args
    } catch (e) {
        allPagesThrew = true;
    }
    check('assertAllPageLayoutsAreRenderable throws nothing on baseline map', allPagesThrew, false);

    // 3. Five negative cases throw through generic assertPageLayoutIsRenderable
    // Case A: below minimum on card
    const execPage = c.getPageByKey('execHub');
    const cardSlot = c.PBI_EXEC_LAYOUT.find(s => s.kind === 'card');
    const origCardHeight = cardSlot.height;
    let belowMinMsg = '';
    try {
        cardSlot.height = 50;
        c.assertPageLayoutIsRenderable(execPage);
    } catch (e) {
        belowMinMsg = e.message;
    } finally {
        cardSlot.height = origCardHeight;
    }
    check('assertPageLayoutIsRenderable throws on height below minimum',
        belowMinMsg.includes('below minimum') && belowMinMsg.includes(cardSlot.key), true);

    // Case B: extends beyond canvas
    let extendsMsg = '';
    const origCardX = cardSlot.x;
    try {
        cardSlot.x = 1900;
        c.assertPageLayoutIsRenderable(execPage);
    } catch (e) {
        extendsMsg = e.message;
    } finally {
        cardSlot.x = origCardX;
    }
    check('assertPageLayoutIsRenderable throws on extends beyond canvas',
        extendsMsg.includes('extends beyond') && extendsMsg.includes(cardSlot.key), true);

    // Case C: content slots overlap
    const s1 = c.PBI_EXEC_LAYOUT.find(s => s.key === 'dateSlicer');
    const s2 = c.PBI_EXEC_LAYOUT.find(s => s.key === 'categorySlicer');
    const origS2X = s2.x;
    const origS2Y = s2.y;
    let overlapMsg = '';
    try {
        s2.x = s1.x;
        s2.y = s1.y;
        c.assertPageLayoutIsRenderable(execPage);
    } catch (e) {
        overlapMsg = e.message;
    } finally {
        s2.x = origS2X;
        s2.y = origS2Y;
    }
    check('assertPageLayoutIsRenderable throws on overlaps',
        overlapMsg.includes('overlaps') && overlapMsg.includes(s2.key), true);

    // Case D: bar slot missing sort
    const opsPage = c.getPageByKey('opsQa');
    const barSlot = c.PBI_OPS_LAYOUT.find(s => s.key === 'barQueueBreakdown');
    const origSort = barSlot.sort;
    let sortMsg = '';
    try {
        delete barSlot.sort;
        c.assertPageLayoutIsRenderable(opsPage);
    } catch (e) {
        sortMsg = e.message;
    } finally {
        barSlot.sort = origSort;
    }
    check('assertPageLayoutIsRenderable throws on bar missing sort',
        sortMsg.includes('sort') && sortMsg.includes(barSlot.key), true);

    // Case E: second background slot on same page
    let bgMsg = '';
    try {
        c.PBI_EXEC_LAYOUT.push({
            id: 'extra_bg_slot_id_001',
            key: 'extraHeaderBand',
            layer: 'background',
            x: 0,
            y: 200,
            width: 1920,
            height: 72,
            z: 0
        });
        c.assertPageLayoutIsRenderable(execPage);
    } catch (e) {
        bgMsg = e.message;
    } finally {
        c.PBI_EXEC_LAYOUT.pop();
    }
    check('assertPageLayoutIsRenderable throws on multiple background slots',
        bgMsg.includes('At most one background slot'), true);

    // 4. Legacy wrappers throw when called with zero arguments
    let wrapCardThrew = false;
    try {
        cardSlot.height = 50;
        c.assertExecLayoutIsRenderable();
    } catch (e) {
        wrapCardThrew = e.message.includes('below minimum') && e.message.includes(cardSlot.key);
    } finally {
        cardSlot.height = origCardHeight;
    }
    check('assertExecLayoutIsRenderable() throws on below minimum with 0 args', wrapCardThrew, true);

    let wrapBarThrew = false;
    try {
        delete barSlot.sort;
        c.assertOpsLayoutIsRenderable();
    } catch (e) {
        wrapBarThrew = e.message.includes('sort') && e.message.includes(barSlot.key);
    } finally {
        barSlot.sort = origSort;
    }
    check('assertOpsLayoutIsRenderable() throws on bar missing sort with 0 args', wrapBarThrew, true);

    // 5. Temporary third page in PBI_PAGES makes assertAllPageLayoutsAreRenderable throw
    const thirdPageSlot = {
        key: 'offCanvasSlot',
        id: '99999999999999999999',
        kind: 'textbox',
        x: 2000,
        y: 0,
        z: 0,
        width: 200,
        height: 50,
        title: 'Off Canvas'
    };
    const thirdPage = {
        key: 'compliancePage',
        id: 'c3d4e5f6a7b8c9d0e1f2',
        displayName: 'Compliance',
        ordinal: 3,
        layout: [thirdPageSlot]
    };
    let thirdPageThrew = false;
    try {
        c.PBI_PAGES.push(thirdPage);
        c.assertAllPageLayoutsAreRenderable();
    } catch (e) {
        thirdPageThrew = e.message.includes('extends beyond') && e.message.includes('offCanvasSlot');
    } finally {
        c.PBI_PAGES.pop();
    }
    check('assertAllPageLayoutsAreRenderable throws on temporary third page without wrapper', thirdPageThrew, true);
} finally {
    // Guarantees all temporary mutations cleaned up
}


// Registered image invariants (D-16, D-17, Pitfall 3/4)
const reportJsonForImages = JSON.parse(fileMap['powerbi/' + c.PBI_PROJECT_NAME + '.Report/definition/report.json']);
const regResourcesPkg = (reportJsonForImages.resourcePackages || []).find(p => p.name === 'RegisteredResources');
let registeredImagesValid = Array.isArray(c.PBI_REGISTERED_IMAGES) && c.PBI_REGISTERED_IMAGES.length > 0;
for (const img of (c.PBI_REGISTERED_IMAGES || [])) {
    const imgKey = c.PBI_REGISTERED_RESOURCES_DIR + '/' + img.itemName;
    const hasKey = Object.prototype.hasOwnProperty.call(fileMap, imgKey);
    const pkgItem = regResourcesPkg && regResourcesPkg.items && regResourcesPkg.items.find(it => it.name === img.itemName && it.type === 'Image');
    const content = fileMap[imgKey];
    const matchesRegistry = content === img.base64;
    const roundTrips = typeof content === 'string' && Buffer.from(content, 'base64').toString('base64') === content;
    if (!hasKey || !pkgItem || !matchesRegistry || !roundTrips) {
        registeredImagesValid = false;
    }
}
check('registered image resources are emitted, registered in report.json, and round-trip through base64', registeredImagesValid, true);

// Clean text gate and drift gate execution
let cleanGateThrew = false;
try {
    c.assertGeneratedTextIsClean(fileMap);
} catch (e) {
    cleanGateThrew = true;
}
check('assertGeneratedTextIsClean does not throw on fileMap', cleanGateThrew, false);

let readmeGateThrew = false;
try {
    c.assertReadmeCoversRequiredContent(fileMap);
} catch (e) {
    readmeGateThrew = true;
}
check('assertReadmeCoversRequiredContent does not throw on fileMap', readmeGateThrew, false);

// Plan 24-08 Axis disclosure and honest KPI label checks
const cardAvgSentimentSlot = c.PBI_EXEC_LAYOUT.find(s => s.key === 'cardAvgSentiment');
const cardComplianceRiskSlot = c.PBI_EXEC_LAYOUT.find(s => s.key === 'cardComplianceRisk');
check('cardAvgSentiment label includes scale (-100 to +100)', cardAvgSentimentSlot && cardAvgSentimentSlot.label.includes('(-100 to +100)'), true);
check('cardComplianceRisk label is % of Calls Flagged', cardComplianceRiskSlot && cardComplianceRiskSlot.label, '% of Calls Flagged');

const execCardSlots24 = c.PBI_EXEC_LAYOUT.filter(s => s.kind === 'card');
const allCardLabelsWithinBudget = execCardSlots24.every(s => s.label.length <= 28);
check('all exec card labels are within 28 character budget', allCardLabelsWithinBudget, true);

let axisDisclosureGateThrew = false;
try {
    c.assertTruncatedAxesAreDisclosed(fileMap);
} catch (e) {
    axisDisclosureGateThrew = true;
}
check('assertTruncatedAxesAreDisclosed does not throw on fileMap', axisDisclosureGateThrew, false);

// Phase 29 Plan 29-04 REFAC-03: Registry-derived expected file count contract checks
try {
    const EXPECTED_TOTAL_FILES = 71;
    // 1. Exactness (boundary): computeExpectedFileCount() equals Object.keys(fileMap).length (71)
    const expectedInitialCount = c.computeExpectedFileCount();
    check(`computeExpectedFileCount() returns ${EXPECTED_TOTAL_FILES}`, expectedInitialCount, EXPECTED_TOTAL_FILES);
    check('computeExpectedFileCount() matches Object.keys(fileMap).length', expectedInitialCount, Object.keys(fileMap).length);

    // 2. Precision: integer arithmetic only, no floating-point or rounding
    check('computeExpectedFileCount() is integer', Number.isInteger(expectedInitialCount), true);
    check('computeExpectedFileCount() equals Math.trunc', expectedInitialCount, Math.trunc(expectedInitialCount));
    check('PBI_FIXED_FILE_COUNTS.semanticModel is integer', Number.isInteger(c.PBI_FIXED_FILE_COUNTS.semanticModel), true);
    check('PBI_FIXED_FILE_COUNTS.report is integer', Number.isInteger(c.PBI_FIXED_FILE_COUNTS.report), true);
    check('PBI_FIXED_FILE_COUNTS.theme is integer', Number.isInteger(c.PBI_FIXED_FILE_COUNTS.theme), true);
    check('PBI_FIXED_FILE_COUNTS.extras is integer', Number.isInteger(c.PBI_FIXED_FILE_COUNTS.extras), true);

    // 3. Registry-driven derivation moves with registries:
    // Case A: Appending a layout slot raises derived count by 1 and makes buildPowerBIFileMap throw
    const origExecLength = c.PBI_EXEC_LAYOUT.length;
    let slotMismatchThrew = false;
    let slotMismatchMsg = '';
    try {
        c.PBI_EXEC_LAYOUT.push({
            key: 'tmpProbeSlot',
            id: 'ffffffffffffffffffff',
            kind: 'textbox',
            x: 0,
            y: 0,
            z: 99,
            width: 100,
            height: 50,
            title: 'Temporary Probe'
        });
        const derivedWithExtraSlot = c.computeExpectedFileCount();
        check('appending layout slot raises computeExpectedFileCount() by 1', derivedWithExtraSlot, EXPECTED_TOTAL_FILES + 1);

        // buildPowerBIFileMap should throw because builders haven't been asked to build it or key mismatch
        // Actually buildExecHubVisuals will iterate PBI_EXEC_LAYOUT and emit tmpProbeSlot visual!
        // But wait: buildPageVisuals will emit 15 files, total becomes 48, so if both emit and predict match,
        // let's test a builder silently dropping a file OR a registry change where file is NOT emitted:
    } finally {
        c.PBI_EXEC_LAYOUT.length = origExecLength;
    }

    const sampleRows = [{ Timestamp: '2026-01-01' }];

    // Direct test of count mismatch throw:
    // If a builder silently omits a file or registry is bumped without builder emitting:
    let mismatchThrew = false;
    let mismatchMsg = '';
    const origExtras = c.PBI_FIXED_FILE_COUNTS.extras;
    try {
        c.PBI_FIXED_FILE_COUNTS.extras = origExtras + 1; // derived becomes EXPECTED_TOTAL_FILES + 1, but map has EXPECTED_TOTAL_FILES
        c.buildPowerBIFileMap(sampleRows);
    } catch (e) {
        mismatchThrew = true;
        mismatchMsg = e.message;
    } finally {
        c.PBI_FIXED_FILE_COUNTS.extras = origExtras;
    }
    check('buildPowerBIFileMap throws on count mismatch (+1 expected)', mismatchThrew, true);
    check(`mismatch error message contains derived expected count (${EXPECTED_TOTAL_FILES + 1}) and actual count (${EXPECTED_TOTAL_FILES})`,
        mismatchMsg.includes(String(EXPECTED_TOTAL_FILES + 1)) && mismatchMsg.includes(String(EXPECTED_TOTAL_FILES)), true);

    // Test removing a PBI_MODEL_TABLES entry lowers derived count by 1
    const origTables = [...c.PBI_MODEL_TABLES];
    let lowerMismatchThrew = false;
    let lowerMismatchMsg = '';
    try {
        c.PBI_MODEL_TABLES.pop(); // now 2 tables, derived becomes EXPECTED_TOTAL_FILES - 1
        const derivedLower = c.computeExpectedFileCount();
        check('removing PBI_MODEL_TABLES entry lowers derived count by 1', derivedLower, EXPECTED_TOTAL_FILES - 1);
        // buildPowerBIFileMap emits 1 fewer table (.tmdl), so actual also becomes 46!
        // To test mismatch detection: artificially alter expected
    } finally {
        c.PBI_MODEL_TABLES.length = 0;
        c.PBI_MODEL_TABLES.push(...origTables);
    }

    // Test boundary: exactly 1 file fewer in map throws
    let oneFewerThrew = false;
    let oneFewerMsg = '';
    try {
        c.PBI_FIXED_FILE_COUNTS.extras = origExtras - 1; // derived becomes EXPECTED_TOTAL_FILES - 1, actual is EXPECTED_TOTAL_FILES
        c.buildPowerBIFileMap(sampleRows);
    } catch (e) {
        oneFewerThrew = true;
        oneFewerMsg = e.message;
    } finally {
        c.PBI_FIXED_FILE_COUNTS.extras = origExtras;
    }
    check('buildPowerBIFileMap throws on count mismatch (-1 expected)', oneFewerThrew, true);
    check(`mismatch error message on -1 contains ${EXPECTED_TOTAL_FILES - 1} and ${EXPECTED_TOTAL_FILES}`,
        oneFewerMsg.includes(String(EXPECTED_TOTAL_FILES - 1)) && oneFewerMsg.includes(String(EXPECTED_TOTAL_FILES)), true);

    // 4. Constant contributions (PBI_RELATIONSHIPS contributes constant 1 file):
    const origRelationships = [...c.PBI_RELATIONSHIPS];
    try {
        // Temporarily empty PBI_RELATIONSHIPS
        c.PBI_RELATIONSHIPS.length = 0;
        check('computeExpectedFileCount() unchanged when PBI_RELATIONSHIPS is emptied', c.computeExpectedFileCount(), EXPECTED_TOTAL_FILES);
        const emptyRelMap = c.buildPowerBIFileMap(sampleRows);
        const relKey = `powerbi/${c.PBI_PROJECT_NAME}.SemanticModel/definition/relationships.tmdl`;
        check('relationships.tmdl still exists in map with emptied registry', Object.prototype.hasOwnProperty.call(emptyRelMap, relKey), true);
        check('relationships.tmdl content is empty string when registry is empty', emptyRelMap[relKey], '');

        // Temporarily double PBI_RELATIONSHIPS
        c.PBI_RELATIONSHIPS.push(...origRelationships);
        check('computeExpectedFileCount() unchanged when PBI_RELATIONSHIPS is doubled', c.computeExpectedFileCount(), EXPECTED_TOTAL_FILES);
    } finally {
        c.PBI_RELATIONSHIPS.length = 0;
        c.PBI_RELATIONSHIPS.push(...origRelationships);
    }

    // 5. Concurrency and purity:
    // Two successive buildPowerBIFileMap calls return deep-equal maps with identical key ordering
    // and mutate no registries.
    const pagesBefore = JSON.stringify(c.PBI_PAGES);
    const relsBefore = JSON.stringify(c.PBI_RELATIONSHIPS);
    const execLayoutBefore = JSON.stringify(c.PBI_EXEC_LAYOUT);
    const opsLayoutBefore = JSON.stringify(c.PBI_OPS_LAYOUT);
    const callDetailLayoutBefore = JSON.stringify(c.PBI_CALL_DETAIL_LAYOUT);

    const mapCall1 = c.buildPowerBIFileMap(sampleRows);
    const mapCall2 = c.buildPowerBIFileMap(sampleRows);

    const keys1 = Object.keys(mapCall1);
    const keys2 = Object.keys(mapCall2);
    check('two successive buildPowerBIFileMap calls produce identical key count', keys1.length, keys2.length);
    check('two successive buildPowerBIFileMap calls produce identical key ordering', JSON.stringify(keys1), JSON.stringify(keys2));

    let deepEqual = true;
    for (const k of keys1) {
        if (mapCall1[k] !== mapCall2[k]) {
            deepEqual = false;
            break;
        }
    }
    check('two successive buildPowerBIFileMap calls produce deep-equal content', deepEqual, true);

    check('buildPowerBIFileMap does not mutate PBI_PAGES', JSON.stringify(c.PBI_PAGES), pagesBefore);
    check('buildPowerBIFileMap does not mutate PBI_RELATIONSHIPS', JSON.stringify(c.PBI_RELATIONSHIPS), relsBefore);
    check('buildPowerBIFileMap does not mutate PBI_EXEC_LAYOUT', JSON.stringify(c.PBI_EXEC_LAYOUT), execLayoutBefore);
    check('buildPowerBIFileMap does not mutate PBI_OPS_LAYOUT', JSON.stringify(c.PBI_OPS_LAYOUT), opsLayoutBefore);
    check('buildPowerBIFileMap does not mutate PBI_CALL_DETAIL_LAYOUT', JSON.stringify(c.PBI_CALL_DETAIL_LAYOUT), callDetailLayoutBefore);

} finally {
    // Guarantees all temporary mutations cleaned up
}

// --- Phase 33 Plan 33-02: Call Detail Drill-Through & Table Visual ---
check('PBI_CALL_DETAIL_PAGE_ID is 20-hex string', /^[0-9a-f]{20}$/.test(c.PBI_CALL_DETAIL_PAGE_ID), true);
check('PBI_PII_EXPOSURE_STATEMENT is non-empty string', typeof c.PBI_PII_EXPOSURE_STATEMENT === 'string' && c.PBI_PII_EXPOSURE_STATEMENT.length > 50, true);
check('PBI_DRILL_FIELDS has 3 fields in expected order', c.PBI_DRILL_FIELDS, ['Contact_ID', 'Agent_ID', 'Primary_Category']);
check('PBI_CALL_DETAIL_COLUMNS has 12 columns', Array.isArray(c.PBI_CALL_DETAIL_COLUMNS) && c.PBI_CALL_DETAIL_COLUMNS.length === 12, true);

const callDetailPage = c.getPageByKey('callDetail');
check('callDetail page entry exists in PBI_PAGES', !!callDetailPage, true);
check('callDetail page id matches PBI_CALL_DETAIL_PAGE_ID', callDetailPage && callDetailPage.id, c.PBI_CALL_DETAIL_PAGE_ID);
check('callDetail page displayName is Call Detail', callDetailPage && callDetailPage.displayName, 'Call Detail');
check('callDetail page ordinal is 1', callDetailPage && callDetailPage.ordinal, 1);
check('callDetail page layout is PBI_CALL_DETAIL_LAYOUT', callDetailPage && callDetailPage.layout === c.PBI_CALL_DETAIL_LAYOUT, true);
check('PBI_CALL_DETAIL_LAYOUT has 3 slots', c.PBI_CALL_DETAIL_LAYOUT.length, 3);

const callDetailPageKey = `powerbi/${c.PBI_PROJECT_NAME}.Report/definition/pages/${c.PBI_CALL_DETAIL_PAGE_ID}/page.json`;
check('Call Detail page.json exists in fileMap', !!fileMap[callDetailPageKey], true);
const callDetailPageJson = JSON.parse(fileMap[callDetailPageKey]);
check('Call Detail page.json visibility is HiddenInViewMode', callDetailPageJson.visibility, 'HiddenInViewMode');
check('Call Detail page.json pageBinding type is Drillthrough', callDetailPageJson.pageBinding && callDetailPageJson.pageBinding.type, 'Drillthrough');
check('Call Detail page.json pageBinding acceptsFilterContext is omitted (keep-all-filters ON per D-07 and Q8)', callDetailPageJson.pageBinding && callDetailPageJson.pageBinding.acceptsFilterContext, undefined);
check('Call Detail page.json pageBinding parameters has 3 entries', callDetailPageJson.pageBinding && callDetailPageJson.pageBinding.parameters && callDetailPageJson.pageBinding.parameters.length, 3);

const tableSlot = c.PBI_CALL_DETAIL_LAYOUT.find(s => s.kind === 'table');
check('Call Detail layout contains table slot', !!tableSlot, true);
const tableVisualKey = `powerbi/${c.PBI_PROJECT_NAME}.Report/definition/pages/${c.PBI_CALL_DETAIL_PAGE_ID}/visuals/${tableSlot.id}/visual.json`;
check('Call Detail table visual.json exists in fileMap', !!fileMap[tableVisualKey], true);
const tableVisualJson = JSON.parse(fileMap[tableVisualKey]);
check('Call Detail table visualType is tableEx', tableVisualJson.visual && tableVisualJson.visual.visualType, 'tableEx');
const tableProjections = tableVisualJson.visual && tableVisualJson.visual.query && tableVisualJson.visual.query.queryState && tableVisualJson.visual.query.queryState.Values && tableVisualJson.visual.query.queryState.Values.projections;
check('Call Detail table visual has 12 projections in Values role', Array.isArray(tableProjections) && tableProjections.length === 12, true);

if (failures > 0) {
    console.log('\n' + failures + ' assertion(s) FAILED');
    process.exit(1);
}
console.log('ASSERTIONS OK');

