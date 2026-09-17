"""
Speech Analytics Preprocessor CLI (Sanitized Portfolio Edition)
Headless batch runner for validating, cleaning, and aggregating contact center transcripts.
"""

import argparse
import glob
import os
import sys

from preprocess_core import (
    REQUIRED_COLUMNS,
    MissingColumnsError,
    PreprocessError,
    combine,
    process_file,
    validate,
    write_csv,
)


def main():
    parser = argparse.ArgumentParser(
        description="Batch preprocess and validate speech analytics CSV datasets."
    )
    parser.add_argument(
        '--input', '-i',
        required=True,
        help="Input CSV file or directory containing CSV files.",
    )
    parser.add_argument(
        '--output', '-o',
        required=True,
        help="Output CSV file path (or output directory if not combining).",
    )
    parser.add_argument(
        '--combine', '-c',
        action='store_true',
        help="Combine all input CSVs into a single chronologically sorted dataset.",
    )

    args = parser.parse_args()

    input_path = os.path.abspath(args.input)
    output_path = os.path.abspath(args.output)

    if os.path.isdir(input_path):
        input_files = sorted(glob.glob(os.path.join(input_path, "*.csv")))
    elif os.path.isfile(input_path):
        input_files = [input_path]
    else:
        print(f"Error: Input path not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    if not input_files:
        print(f"Error: No CSV files found in {input_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(input_files)} CSV file(s) to process.")

    # Validate all files upfront
    has_errors = False
    for f in input_files:
        res = validate(f)
        if not res.ok:
            print(f"[FAIL] {os.path.basename(f)} is missing columns: {', '.join(res.missing)}", file=sys.stderr)
            has_errors = True
        else:
            print(f"[OK] {os.path.basename(f)} ({res.row_count} rows)")

    if has_errors:
        print("Aborting: one or more files failed schema validation.", file=sys.stderr)
        sys.exit(1)

    results = []
    for f in input_files:
        try:
            fn, rows = process_file(f)
            results.append((fn, rows))
        except PreprocessError as e:
            print(f"Processing error in {f}: {e}", file=sys.stderr)
            sys.exit(1)

    if args.combine:
        combined_fn, combined_rows = combine(results)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        write_csv(output_path, combined_fn, combined_rows)
        print(f"Combined {len(combined_rows)} total rows into {output_path}")
    else:
        if len(input_files) == 1:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            write_csv(output_path, results[0][0], results[0][1])
            print(f"Wrote {len(results[0][1])} rows to {output_path}")
        else:
            os.makedirs(output_path, exist_ok=True)
            for f, (fn, rows) in zip(input_files, results):
                out_file = os.path.join(output_path, f"cleaned_{os.path.basename(f)}")
                write_csv(out_file, fn, rows)
                print(f"Wrote {len(rows)} rows to {out_file}")

    print("Preprocessing completed successfully.")
    sys.exit(0)


if __name__ == '__main__':
    main()
