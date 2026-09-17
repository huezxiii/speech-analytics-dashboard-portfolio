import json
from pathlib import Path
import subprocess
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_no_proprietary_terms_in_web_tier():
    prohibited = ['dexcom', 'callminer', 'g7', 'g6', 'nadine', 'bilog', 'taguinod']
    web_files = [
        REPO_ROOT / 'index.html',
        REPO_ROOT / 'stats.js',
        REPO_ROOT / 'charts.js',
        REPO_ROOT / 'brand.css',
    ]

    for f in web_files:
        assert f.exists(), f"File {f.name} is missing"
        text = f.read_text(encoding='utf-8').lower()
        for term in prohibited:
            assert term not in text, f"Prohibited term '{term}' found in {f.name}!"


def test_index_html_has_all_tab_and_canvas_elements():
    html = (REPO_ROOT / 'index.html').read_text(encoding='utf-8')

    # All 4 tabs
    assert 'data-tab="tab1"' in html
    assert 'data-tab="tab2"' in html
    assert 'data-tab="tab3"' in html
    assert 'data-tab="tab4"' in html

    # Required canvas elements
    canvases = [
        'volumeSentimentChart',
        'categoryDistributionChart',
        'fcrSentimentMatrixChart',
        'volumeSilenceChart',
        'talkSilenceDoughnutChart',
        'silenceHistogramChart',
        'hipaaGaugeChart',
        'agentRadarChart',
        'agitationCurveChart',
        'empathyBarChart',
        'queryVelocityChart',
        'proximityScatterChart',
    ]
    for c in canvases:
        assert f'id="{c}"' in html, f"Canvas element #{c} missing from index.html"

    # Local vendor scripts loaded
    assert 'src="vendor/chart.umd.min.js"' in html
    assert 'src="vendor/papaparse.min.js"' in html
    assert 'src="vendor/jszip.min.js"' in html
    assert 'src="stats.js"' in html
    assert 'src="charts.js"' in html


def test_stats_js_execution():
    node_test = """
    const { computeDatasetStats, formatDateDisplay, humanizeCategory } = require('./stats.js');
    const assert = require('assert');

    assert.strictEqual(humanizeCategory('Mobile_App_Connection_Failure'), 'Mobile App Connection Failure');
    assert.strictEqual(formatDateDisplay('2026-08-24'), 'August 24, 2026');

    const sampleRows = [
        { Timestamp: '2026-08-20 10:00:00', Silence_Pct: '10', Customer_Sentiment: '50', FCR_Flag: '1', Primary_Category: 'Account_Access' },
        { Timestamp: '2026-08-25 15:00:00', Silence_Pct: '50', Customer_Sentiment: '-50', FCR_Flag: '0', Primary_Category: 'Mobile_App_Connection_Failure' }
    ];

    const stats = computeDatasetStats(sampleRows);
    assert(stats !== null);
    assert.strictEqual(stats.rowCount, 2);
    assert.strictEqual(stats.meanSilencePct, 30);
    assert.strictEqual(stats.meanSentiment, 0);
    assert.strictEqual(stats.meanFCR, 50);
    console.log('STATS_JS_OK');
    """
    res = subprocess.run(['node', '-e', node_test], cwd=str(REPO_ROOT), capture_output=True, text=True)
    assert res.returncode == 0, f"Node execution error: {res.stderr}"
    assert 'STATS_JS_OK' in res.stdout
