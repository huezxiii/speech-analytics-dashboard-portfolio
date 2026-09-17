import csv
import os
from pathlib import Path
import subprocess
import sys
import pytest

from preprocess_core import REQUIRED_COLUMNS, combine, process_file, write_csv
from generate_mock_data import generate_mock_dataset

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_core_and_cli_byte_parity(tmp_path):
    # 1. Generate a raw test dataset with formatting noise
    raw_csv = tmp_path / "raw_input.csv"
    generate_mock_dataset(filename=str(raw_csv), total_calls=100, seed=42)

    # 2. Add noise to raw input (percentages and labels)
    with open(raw_csv, 'r', encoding='utf-8') as f:
        reader = list(csv.DictReader(f))

    for r in reader:
        r['Silence_Pct'] = f"{r['Silence_Pct']}%"
        r['Agent_Quality'] = f"{r['Agent_Quality']} (QA)"

    with open(raw_csv, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=REQUIRED_COLUMNS)
        writer.writeheader()
        writer.writerows(reader)

    # 3. Process via Core API
    core_out = tmp_path / "core_out.csv"
    fn, rows = process_file(str(raw_csv))
    write_csv(str(core_out), fn, rows)

    # 4. Process via CLI
    cli_out = tmp_path / "cli_out.csv"
    cmd = [
        sys.executable,
        str(REPO_ROOT / "preprocess_cli.py"),
        "--input", str(raw_csv),
        "--output", str(cli_out),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, f"CLI error: {res.stderr}"

    # 5. Verify byte parity
    core_bytes = core_out.read_bytes()
    cli_bytes = cli_out.read_bytes()
    assert core_bytes == cli_bytes, "Core and CLI output differ in byte content!"


def test_multi_file_combine_parity(tmp_path):
    in_dir = tmp_path / "inputs"
    in_dir.mkdir()
    f1 = in_dir / "batch1.csv"
    f2 = in_dir / "batch2.csv"
    generate_mock_dataset(filename=str(f1), total_calls=50, seed=10)
    generate_mock_dataset(filename=str(f2), total_calls=50, seed=20)

    # Core combine
    fn1, rows1 = process_file(str(f1))
    fn2, rows2 = process_file(str(f2))
    comb_fn, comb_rows = combine([(fn1, rows1), (fn2, rows2)])
    core_comb_out = tmp_path / "core_comb.csv"
    write_csv(str(core_comb_out), comb_fn, comb_rows)

    # CLI combine
    cli_comb_out = tmp_path / "cli_comb.csv"
    cmd = [
        sys.executable,
        str(REPO_ROOT / "preprocess_cli.py"),
        "--input", str(in_dir),
        "--output", str(cli_comb_out),
        "--combine",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, f"CLI error: {res.stderr}"

    # Verify byte parity
    assert core_comb_out.read_bytes() == cli_comb_out.read_bytes()
