// test-index-export.js — Dashboard static DOM and script assertions for filtered export (EXT-03)
const fs = require('fs');
const path = require('path');

const indexHtmlPath = path.join(__dirname, 'index.html');
const s = fs.readFileSync(indexHtmlPath, 'utf8');

// 1. the exportModeFull radio has checked, filtered radio exists, getSelectedExportMode exists
const f = s.indexOf('id="exportModeFull"');
if (f === -1) throw new Error('full-dataset radio id missing');
const seg = s.slice(f, f + 300);
if (seg.indexOf('checked') === -1) {
  throw new Error('full-dataset radio is not pre-selected, which would change existing export behaviour');
}
if (s.indexOf('id="exportModeFiltered"') === -1) throw new Error('filtered radio id missing');
if (s.indexOf('function getSelectedExportMode') === -1) throw new Error('getSelectedExportMode missing');

// 2. globalFilteredData = filtered; appears exactly once; name="exportMode" appears twice
const matchCount = (s.match(/globalFilteredData = filtered;/g) || []).length;
if (matchCount !== 1) {
  throw new Error(`expected globalFilteredData = filtered; to appear exactly once, but found ${matchCount}`);
}
const radioCount = (s.match(/name="exportMode"/g) || []).length;
if (radioCount !== 2) {
  throw new Error(`expected name="exportMode" to appear twice, but found ${radioCount}`);
}

// 3. in handlePbiExportClick, the zero-rows toast comes before generatePowerBIExport and loading state
const h = s.indexOf('async function handlePbiExportClick');
if (h === -1) throw new Error('handlePbiExportClick not found');
const body = s.slice(h, h + 2600);
const guard = body.indexOf('No rows match the active filters');
const loading = body.indexOf("setPbiExportButtonState('loading')");
const gen = body.indexOf('generatePowerBIExport(');
if (guard === -1) throw new Error('filtered-mode zero-row guard message not found');
if (gen === -1) throw new Error('generatePowerBIExport call not found');
if (!(guard < loading && guard < gen)) {
  throw new Error('zero-row guard does not precede the loading state and package generation');
}

console.log('check:export[radio] PASS');
console.log('check:export[assignment] PASS');
console.log('check:export[guard-order] PASS');
console.log('check:export PASS');
