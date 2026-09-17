import ast
import csv
from pathlib import Path
import pytest

import preprocess_core
from preprocess_core import (
    REQUIRED_COLUMNS,
    MissingColumnsError,
    PreprocessError,
    ValidateResult,
    combine,
    extract_number,
    preview,
    process_file,
    validate,
    write_csv,
)

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_core_has_zero_gui_imports():
    """Verify PREP-01: preprocess_core.py has zero GUI or external dependencies."""
    core_file = REPO_ROOT / "preprocess_core.py"
    with open(core_file, "r", encoding="utf-8") as f:
        tree = ast.parse(f.read(), filename=str(core_file))

    disallowed = {"webview", "tkinter", "PyQt5", "PyQt6", "wx", "sys", "subprocess"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root_pkg = alias.name.split('.')[0]
                assert root_pkg not in disallowed, f"Disallowed import found: {alias.name}"
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                root_pkg = node.module.split('.')[0]
                assert root_pkg not in disallowed, f"Disallowed import found: {node.module}"


def test_extract_number_strips_percent_suffix():
    assert extract_number("12.8%") == "12.8"


def test_extract_number_strips_parenthetical_label():
    assert extract_number("38 (Med)") == "38"


def test_extract_number_keeps_negative_sign():
    assert extract_number("-6 (Annoyed)") == "-6"


def test_extract_number_handles_single_digit_with_label():
    assert extract_number("1 (Resolved)") == "1"


def test_extract_number_empty_string_passthrough():
    assert extract_number("") == ""


def test_extract_number_no_digits_returns_input_unchanged():
    assert extract_number("No Risk") == "No Risk"


def test_extract_number_returns_str():
    res = extract_number("12.8%")
    assert isinstance(res, str)
    assert res == "12.8"


def test_process_file_raises_missing_columns_error(tmp_path):
    cols = [c for c in REQUIRED_COLUMNS if c != "Silence_Pct"]
    csv_file = tmp_path / "bad.csv"
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(cols)
        writer.writerow(["val"] * len(cols))

    with pytest.raises(MissingColumnsError) as exc_info:
        process_file(str(csv_file))

    err = exc_info.value
    assert err.path == str(csv_file)
    assert err.missing == ["Silence_Pct"]
    assert "missing required columns: Silence_Pct" in str(err)


def test_process_file_cleans_noise(tmp_path):
    csv_file = tmp_path / "noisy.csv"
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=REQUIRED_COLUMNS)
        writer.writeheader()
        writer.writerow({
            'Timestamp': '2026-08-20 10:00:00',
            'Contact_ID': 'CALL-001',
            'Agent_ID': 'AGENT_ALEX',
            'Queue_Name': 'Tech_Support_US',
            'Call_Duration (s)': '300',
            'Silence_Duration (s)': '45',
            'Silence_Pct': '15.0%',
            'Max_Agitation_Score': '40 (Medium)',
            'Primary_Category': 'Account_Access',
            'Customer_Sentiment': '-15 (Frustrated)',
            'Agent_Quality': '85 (Good)',
            'Compliance_Risk': 'No Risk',
            'Empathy_Score': '90 (High)',
            'FCR_Flag': '1 (Yes)',
            'Call_Summary_Transcript': 'Customer issue resolved cleanly.',
        })

    fieldnames, rows = process_file(str(csv_file))
    assert fieldnames == REQUIRED_COLUMNS
    assert len(rows) == 1
    r = rows[0]
    assert r['Silence_Pct'] == '15.0'
    assert r['Max_Agitation_Score'] == '40'
    assert r['Customer_Sentiment'] == '-15'
    assert r['Agent_Quality'] == '85'
    assert r['Empathy_Score'] == '90'
    assert r['FCR_Flag'] == '1'


def test_combine_sorts_by_timestamp():
    file1_rows = [
        {'Timestamp': '2026-08-22 12:00:00', 'Contact_ID': 'C2'},
        {'Timestamp': '2026-08-20 09:00:00', 'Contact_ID': 'C1'},
    ]
    file2_rows = [
        {'Timestamp': '2026-08-23 15:00:00', 'Contact_ID': 'C3'},
    ]
    cols = ['Timestamp', 'Contact_ID']
    combined_fn, combined_rows = combine([(cols, file1_rows), (cols, file2_rows)])
    assert combined_fn == cols
    assert [r['Contact_ID'] for r in combined_rows] == ['C1', 'C2', 'C3']


def test_validate(tmp_path):
    good_csv = tmp_path / "good.csv"
    with open(good_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=REQUIRED_COLUMNS)
        writer.writeheader()
        writer.writerow({c: "val" for c in REQUIRED_COLUMNS})

    res = validate(str(good_csv))
    assert res.ok is True
    assert res.missing == []
    assert res.row_count == 1


def test_preview(tmp_path):
    csv_file = tmp_path / "preview.csv"
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=REQUIRED_COLUMNS)
        writer.writeheader()
        for i in range(25):
            writer.writerow({
                **{c: "val" for c in REQUIRED_COLUMNS},
                'Silence_Pct': f"{i}.5%",
            })

    data = preview(str(csv_file), limit=10)
    assert len(data['source_rows']) == 10
    assert len(data['transformed_rows']) == 10
    assert len(data['changed']) == 10
    # Silence_Pct was changed from "0.5%" to "0.5"
    silence_idx = data['columns'].index('Silence_Pct')
    assert data['changed'][0][silence_idx] is True
