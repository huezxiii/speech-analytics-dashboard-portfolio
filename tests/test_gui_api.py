import csv
import os
from pathlib import Path
import pytest

from gui.app import Api, _webview2_runtime_present
from generate_mock_data import generate_mock_dataset, REQUIRED_COLUMNS

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_webview2_runtime_detected():
    # Should detect Evergreen WebView2 on modern Windows
    present = _webview2_runtime_present()
    assert isinstance(present, bool)


def test_api_add_files_and_preview(tmp_path):
    csv1 = tmp_path / "test1.csv"
    generate_mock_dataset(filename=str(csv1), total_calls=15, seed=1)

    settings_file = tmp_path / "settings.json"
    api = Api(window=None, settings_path=str(settings_file))
    files = api.add_files([str(csv1)])
    assert len(files) == 1
    assert files[0]['state'] == 'valid'
    assert files[0]['row_count'] == 15

    prev = api.preview(str(csv1))
    assert prev['total_rows'] == 15
    assert len(prev['source_rows']) == 15
    assert len(prev['transformed_rows']) == 15


def test_api_convert_combined(tmp_path):
    csv1 = tmp_path / "input1.csv"
    csv2 = tmp_path / "input2.csv"
    generate_mock_dataset(filename=str(csv1), total_calls=20, seed=1)
    generate_mock_dataset(filename=str(csv2), total_calls=25, seed=2)

    settings_file = tmp_path / "settings.json"
    out_dir = tmp_path / "processed"
    api = Api(window=None, settings_path=str(settings_file))
    api.add_files([str(csv1), str(csv2)])

    res = api.convert(mode='combined', out_dir=str(out_dir), combine_name="merged.csv")
    assert res['ok'] is True
    assert len(res['written']) == 1

    merged_path = out_dir / "merged.csv"
    assert merged_path.exists()
    with open(merged_path, 'r', encoding='utf-8') as f:
        reader = list(csv.DictReader(f))
        assert len(reader) == 45


def test_sanitization_in_gui_and_build():
    prohibited = ['dexcom', 'callminer', 'g7', 'g6', 'nadine', 'bilog']
    targets = [
        REPO_ROOT / 'gui' / 'app.py',
        REPO_ROOT / 'gui' / 'web' / 'index.html',
        REPO_ROOT / 'build' / 'preprocessor.spec',
    ]

    for target in targets:
        text = target.read_text(encoding='utf-8').lower()
        for term in prohibited:
            assert term not in text, f"Found prohibited term '{term}' in {target}!"
