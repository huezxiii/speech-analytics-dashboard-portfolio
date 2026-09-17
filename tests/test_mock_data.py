import csv
import os
import subprocess
import pytest
from generate_mock_data import generate_mock_dataset, REQUIRED_COLUMNS

PROHIBITED_TERMS = [
    'dexcom', 'g7', 'g6', 'nadine', 'bilog', 'taguinod', 'clarity', 'glucose'
]

def test_columns_and_row_count(tmp_path):
    out_csv = tmp_path / "test_calls.csv"
    count = generate_mock_dataset(filename=str(out_csv), total_calls=150, seed=123)
    assert count == 150
    assert os.path.exists(out_csv)

    with open(out_csv, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        assert reader.fieldnames == REQUIRED_COLUMNS
        rows = list(reader)
        assert len(rows) == 150

        for row in rows:
            # Check numeric boundaries
            call_dur = int(row['Call_Duration (s)'])
            silence_dur = int(row['Silence_Duration (s)'])
            silence_pct = float(row['Silence_Pct'])
            agitation = int(row['Max_Agitation_Score'])
            sentiment = int(row['Customer_Sentiment'])
            agent_qa = int(row['Agent_Quality'])
            empathy = int(row['Empathy_Score'])
            fcr = int(row['FCR_Flag'])

            assert call_dur > 0
            assert silence_dur >= 0
            assert 0.0 <= silence_pct <= 100.0
            assert 0 <= agitation <= 100
            assert -100 <= sentiment <= 100
            assert 0 <= agent_qa <= 100
            assert 0 <= empathy <= 100
            assert fcr in (0, 1)
            assert row['Compliance_Risk'] in ('No Risk', 'Medium Risk', 'High Risk')

def test_sanitization_zero_proprietary_terms(tmp_path):
    out_csv = tmp_path / "sanitized_test.csv"
    generate_mock_dataset(filename=str(out_csv), total_calls=300, seed=999)

    with open(out_csv, 'r', encoding='utf-8') as f:
        content = f.read().lower()
        for term in PROHIBITED_TERMS:
            assert term not in content, f"Prohibited proprietary term '{term}' found in dataset!"

def test_deterministic_seed(tmp_path):
    csv1 = tmp_path / "seed1.csv"
    csv2 = tmp_path / "seed2.csv"

    generate_mock_dataset(filename=str(csv1), total_calls=50, seed=42)
    generate_mock_dataset(filename=str(csv2), total_calls=50, seed=42)

    with open(csv1, 'rb') as f1, open(csv2, 'rb') as f2:
        assert f1.read() == f2.read(), "Deterministic seed produced mismatched output!"
