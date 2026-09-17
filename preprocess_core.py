"""
Speech Analytics Preprocessor Core (Sanitized Portfolio Edition)
Pure-Python preprocessing and validation core with zero GUI dependencies.
Enforces the 15-column schema and normalizes numeric values for client-side analytics.
"""

import collections
import csv
import itertools
import re

ValidateResult = collections.namedtuple('ValidateResult', ['ok', 'missing', 'row_count', 'fieldnames'])


class PreprocessError(Exception):
    """Base for expected domain-level failures raised by this module."""


class MissingColumnsError(PreprocessError):
    def __init__(self, path, missing):
        self.path = path
        self.missing = missing
        super().__init__(f"{path} is missing required columns: {', '.join(missing)}")


REQUIRED_COLUMNS = [
    'Timestamp',
    'Contact_ID',
    'Agent_ID',
    'Queue_Name',
    'Call_Duration (s)',
    'Silence_Duration (s)',
    'Silence_Pct',
    'Max_Agitation_Score',
    'Primary_Category',
    'Customer_Sentiment',
    'Agent_Quality',
    'Compliance_Risk',
    'Empathy_Score',
    'FCR_Flag',
    'Call_Summary_Transcript',
]


def extract_number(val):
    if not val:
        return ""
    # Extract first sequence of digits (including negative sign and decimal)
    match = re.search(r'-?\d+(\.\d+)?', str(val))
    return match.group(0) if match else str(val)


def _clean_row(row):
    cleaned = dict(row)
    cleaned['Silence_Pct'] = extract_number(cleaned.get('Silence_Pct', ''))
    cleaned['Max_Agitation_Score'] = extract_number(cleaned.get('Max_Agitation_Score', ''))
    cleaned['Customer_Sentiment'] = extract_number(cleaned.get('Customer_Sentiment', ''))
    cleaned['Agent_Quality'] = extract_number(cleaned.get('Agent_Quality', ''))
    cleaned['Empathy_Score'] = extract_number(cleaned.get('Empathy_Score', ''))
    cleaned['FCR_Flag'] = extract_number(cleaned.get('FCR_Flag', ''))
    return cleaned


def process_file(filepath):
    """Reads a CSV, validates columns against REQUIRED_COLUMNS, and returns (fieldnames, cleaned_rows)."""
    with open(filepath, 'r', encoding='utf-8') as fin:
        reader = csv.DictReader(fin)
        fieldnames = reader.fieldnames or []

        missing_cols = [col for col in REQUIRED_COLUMNS if col not in fieldnames]
        if missing_cols:
            raise MissingColumnsError(filepath, missing_cols)

        rows = []
        for row in reader:
            rows.append(_clean_row(row))

        return fieldnames, rows


def write_csv(output_path, fieldnames, rows):
    """Writes fieldnames and rows out to a UTF-8 CSV file."""
    with open(output_path, 'w', newline='', encoding='utf-8') as fout:
        writer = csv.DictWriter(fout, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def combine(per_file_results):
    """Combines multiple (fieldnames, rows) tuples into a single sorted dataset."""
    combined_fieldnames = []
    all_rows = []
    for fieldnames, rows in per_file_results:
        if not combined_fieldnames:
            combined_fieldnames = list(fieldnames)
        else:
            for fn in fieldnames:
                if fn not in combined_fieldnames:
                    combined_fieldnames.append(fn)
        all_rows.extend(rows)

    all_rows.sort(key=lambda x: x.get('Timestamp', ''))
    return (combined_fieldnames or [], all_rows)


def validate(path):
    """Validates an input file schema and returns ValidateResult."""
    with open(path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        missing = [c for c in REQUIRED_COLUMNS if c not in fieldnames]
        row_count = sum(1 for _ in reader)
    return ValidateResult(ok=not missing, missing=missing, row_count=row_count, fieldnames=fieldnames)


def preview(path, limit=20):
    """Generates preview payload with source rows, transformed rows, and changed cell masks."""
    with open(path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        columns = list(reader.fieldnames or [])
        raw_rows = list(itertools.islice(reader, limit))

    source_rows = [[r.get(c, '') for c in columns] for r in raw_rows]
    transformed_rows = [[cleaned.get(c, '') for c in columns] for cleaned in (_clean_row(dict(r)) for r in raw_rows)]
    changed = [[str(s) != str(t) for s, t in zip(src, tr)] for src, tr in zip(source_rows, transformed_rows)]

    return {
        'columns': columns,
        'source_rows': source_rows,
        'transformed_rows': transformed_rows,
        'changed': changed,
    }
