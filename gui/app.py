import csv
import ctypes
import json
import os
import sys
import winreg

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

import webview
import preprocess_core

PREVIEW_ROW_LIMIT = 20

_WEBVIEW2_CLIENT_GUID = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
_WEBVIEW2_RUNTIME_KEYS = (
    rf'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{_WEBVIEW2_CLIENT_GUID}',
    rf'SOFTWARE\Microsoft\EdgeUpdate\Clients\{_WEBVIEW2_CLIENT_GUID}',
)
_WEBVIEW2_MISSING_TITLE = 'Speech Analytics Preprocessor - Missing Component'
_WEBVIEW2_MISSING_MESSAGE = (
    "Microsoft Edge WebView2 Runtime (Evergreen) is required to run Speech Analytics Preprocessor.\n\n"
    "The application cannot start because the WebView2 Runtime was not found on this system.\n\n"
    "To resolve this, please install the WebView2 Runtime from:\n"
    "https://developer.microsoft.com/microsoft-edge/webview2/\n"
    "or contact your IT administrator.\n\n"
    "Note: Installing the runtime requires internet access or an offline installer provided by an administrator."
)


def resource_path(relative_path):
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), relative_path)


class Api:
    def __init__(self, window=None, settings_path=None):
        self._files = []
        self._window = window
        self._settings_path = settings_path or self._default_settings_path()
        self._output_dir = self._load_settings().get('output_dir', '')
        self._reset_progress(0)
        self._cancel_requested = False

    def _reset_progress(self, total):
        self._progress = {
            'running': total > 0,
            'total': total,
            'done': 0,
            'current': '',
            'cancel_requested': False,
        }

    def get_progress(self):
        return self._progress

    def cancel(self):
        self._cancel_requested = True
        self._progress['cancel_requested'] = True
        return self._progress

    @staticmethod
    def _default_output_dir(first_input_path):
        return os.path.join(os.path.dirname(os.path.abspath(first_input_path)), 'processed')

    def _find(self, path):
        for row in self._files:
            if row['path'] == path:
                return row
        return None

    def pick_files(self):
        if not self._window:
            return self._files
        paths = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=True,
            file_types=('CSV Files (*.csv)', 'All files (*.*)')
        )
        if not paths:
            return self._files
        return self.add_files(list(paths))

    def add_files(self, paths):
        for raw_path in paths:
            path = os.path.abspath(raw_path)
            name = os.path.basename(path)
            existing = self._find(path)
            try:
                result = preprocess_core.validate(path)
                if result.ok:
                    status = f"valid · {result.row_count} rows"
                    state = "valid"
                    checked = existing['checked'] if existing is not None else True
                    row_count = result.row_count
                else:
                    status = f"missing: {', '.join(result.missing)}"
                    state = "missing"
                    checked = False
                    row_count = result.row_count
            except (OSError, UnicodeDecodeError, csv.Error) as err:
                status = f"error: {err}"
                state = "error"
                checked = False
                row_count = None

            if existing is not None:
                existing['name'] = name
                existing['status'] = status
                existing['state'] = state
                existing['checked'] = checked
                existing['row_count'] = row_count
            else:
                self._files.append({
                    'path': path,
                    'name': name,
                    'status': status,
                    'state': state,
                    'checked': checked,
                    'row_count': row_count
                })
        if not self._output_dir and self._files:
            self._output_dir = self._default_output_dir(self._files[0]['path'])
        return self._files

    def list_files(self):
        return self._files

    def set_checked(self, path, checked):
        row = self._find(os.path.abspath(path))
        if row is not None:
            row['checked'] = bool(checked)
        return self._files

    def remove_file(self, path):
        row = self._find(os.path.abspath(path))
        if row is not None:
            self._files.remove(row)
        return self._files

    def clear(self):
        self._files.clear()
        return self._files

    def preview(self, path):
        p = os.path.abspath(path)
        row = self._find(p)
        if row is None or row['state'] != 'valid':
            return {
                'columns': [],
                'source_rows': [],
                'transformed_rows': [],
                'changed': [],
                'shown_rows': 0,
                'total_rows': 0,
                'changed_cells': 0,
            }
        payload = preprocess_core.preview(p, PREVIEW_ROW_LIMIT)
        shown_rows = len(payload['source_rows'])
        total_rows = row['row_count']
        changed_cells = sum(1 for r in payload['changed'] for c in r if c)
        payload['shown_rows'] = shown_rows
        payload['total_rows'] = total_rows
        payload['changed_cells'] = changed_cells
        return payload

    def get_output_dir(self):
        return self._output_dir

    @staticmethod
    def _output_path_for(input_path, out_dir):
        stem = os.path.splitext(os.path.basename(input_path))[0]
        return os.path.join(out_dir, f"{stem}-dashboard-ready.csv")

    def _checked_valid_rows(self):
        return [r for r in self._files if r['checked'] and r['state'] == 'valid']

    def _read_one(self, path):
        try:
            fieldnames, rows = preprocess_core.process_file(path)
            return (True, fieldnames, rows, '')
        except Exception as err:
            return (False, None, None, str(err))

    def _empty_result(self, mode, out_dir):
        return {
            'ok': False,
            'mode': mode,
            'out_dir': out_dir,
            'written': [],
            'skipped': [],
            'failed': [],
            'cancelled': [],
            'aborted': '',
            'message': '',
        }

    @staticmethod
    def _combined_output_name(combine_name):
        if not combine_name or not isinstance(combine_name, str):
            return 'combined-dashboard-ready.csv'
        name = combine_name.strip()
        if not name:
            return 'combined-dashboard-ready.csv'
        name = os.path.basename(name).split('\\')[-1].split('/')[-1]
        illegal_chars = set('<>:"/\\|?*')
        cleaned = ''.join(c for c in name if c not in illegal_chars and ord(c) >= 32).strip()
        if not cleaned or cleaned in ('.', '..') or cleaned.lower() == '.csv':
            return 'combined-dashboard-ready.csv'
        if not cleaned.lower().endswith('.csv'):
            cleaned += '.csv'
        return cleaned

    @staticmethod
    def _check_writable(out_dir):
        try:
            os.makedirs(out_dir, exist_ok=True)
            probe_path = os.path.join(out_dir, '.preprocessor-write-check')
            with open(probe_path, 'w', encoding='utf-8'):
                pass
            os.remove(probe_path)
            return True
        except OSError:
            return False

    def _preflight(self, rows, mode, out_dir, combine_name):
        res = {
            'ok': True,
            'rows': [],
            'skipped': [],
            'conflicts': [],
            'collisions': [],
            'aborted': '',
            'message': '',
        }

        surviving = []
        for row in rows:
            try:
                v_res = preprocess_core.validate(row['path'])
                if v_res.ok:
                    surviving.append(row)
                else:
                    reason = f"missing columns: {', '.join(v_res.missing)}" if v_res.missing else 'invalid columns'
                    res['skipped'].append({'name': row['name'], 'reason': reason})
            except (OSError, UnicodeDecodeError, csv.Error) as err:
                res['skipped'].append({'name': row['name'], 'reason': str(err)})

        res['rows'] = surviving
        if not surviving:
            res['ok'] = False
            res['aborted'] = 'no-files'
            skipped_names = ', '.join(s['name'] for s in res['skipped'])
            res['message'] = f"All checked files skipped: {skipped_names}" if skipped_names else 'Check at least one valid file in the list.'
            return res

        if not self._check_writable(out_dir):
            res['ok'] = False
            res['aborted'] = 'unwritable'
            res['message'] = f"Cannot write to output folder: {out_dir}. Please use the Change button to choose a writable folder."
            return res

        if mode == 'separate':
            seen_outputs = {}
            for row in surviving:
                p = self._output_path_for(row['path'], out_dir)
                bname = os.path.basename(p)
                if bname in seen_outputs:
                    res['collisions'].append(bname)
                else:
                    seen_outputs[bname] = p
            if res['collisions']:
                colliding = ', '.join(res['collisions'])
                res['ok'] = False
                res['aborted'] = 'output-collision'
                res['message'] = f"Output filename collision detected: {colliding}. Nothing was written."
                return res
            for row in surviving:
                p = self._output_path_for(row['path'], out_dir)
                if os.path.exists(p):
                    res['conflicts'].append(p)
        elif mode == 'combined':
            comb_name = self._combined_output_name(combine_name)
            p = os.path.join(out_dir, comb_name)
            if os.path.exists(p):
                res['conflicts'].append(p)

        return res

    def convert(self, mode, out_dir, combine_name):
        resolved_out = os.path.abspath(out_dir) if out_dir else self._output_dir
        result = self._empty_result(mode, resolved_out)
        result['mode'] = mode
        checked = self._checked_valid_rows()
        if not checked:
            self._reset_progress(0)
            result['aborted'] = 'no-files'
            result['message'] = 'Check at least one valid file in the list.'
            return result

        pre = self._preflight(checked, mode, resolved_out, combine_name)
        result['skipped'] = pre['skipped']
        if not pre['ok']:
            self._reset_progress(0)
            result['aborted'] = pre['aborted']
            result['message'] = pre['message']
            return result

        if pre['conflicts'] and self._window is not None:
            num_conflicts = len(pre['conflicts'])
            total_out = len(pre['rows']) if mode == 'separate' else 1
            conflict_names = ', '.join(os.path.basename(c) for c in pre['conflicts'])
            title = 'Confirm Overwrite'
            message = f"{num_conflicts} of {total_out} output file(s) already exist and will be overwritten: {conflict_names}. Overwrite them?"
            confirmed = self._window.create_confirmation_dialog(title, message)
            if not confirmed:
                self._reset_progress(0)
                result['aborted'] = 'overwrite-cancelled'
                result['message'] = 'Conversion cancelled. Nothing was written.'
                result['ok'] = False
                return result

        surviving = pre['rows']
        self._cancel_requested = False
        self._reset_progress(len(surviving))
        if surviving:
            self._progress['current'] = surviving[0]['name']

        os.makedirs(resolved_out, exist_ok=True)
        try:
            if mode == 'combined':
                accumulated = []
                for row in surviving:
                    if self._cancel_requested:
                        result['aborted'] = 'cancelled'
                        result['cancelled'] = [
                            {'name': r['name'], 'path': os.path.join(resolved_out, self._combined_output_name(combine_name))}
                            for r in surviving[len(accumulated):]
                        ]
                        result['message'] = 'Conversion cancelled. Nothing was written.'
                        result['ok'] = False
                        return result

                    ok, fieldnames, rows, err = self._read_one(row['path'])
                    if not ok:
                        result['failed'].append({'name': row['name'], 'error': err})
                        result['aborted'] = 'combined-input-failed'
                        result['message'] = (
                            f"Conversion aborted: {row['name']} failed to read ({err}). "
                            f"Nothing was written."
                        )
                        result['ok'] = False
                        return result
                    accumulated.append((fieldnames, rows))
                    self._progress['done'] = len(accumulated)
                    next_idx = len(accumulated)
                    self._progress['current'] = surviving[next_idx]['name'] if next_idx < len(surviving) else ''

                merged_fieldnames, merged_rows = preprocess_core.combine(accumulated)
                out_name = self._combined_output_name(combine_name)
                out_path = os.path.join(resolved_out, out_name)
                try:
                    preprocess_core.write_csv(out_path, merged_fieldnames, merged_rows)
                    result['written'].append({
                        'name': out_name,
                        'path': out_path,
                    })
                except OSError as err:
                    result['failed'].append({'name': out_name, 'error': str(err)})
                result['ok'] = len(result['failed']) == 0
                cancelled_part = f", {len(result['cancelled'])} cancelled" if result['cancelled'] else ""
                result['message'] = (
                    f"{len(result['written'])} written, "
                    f"{len(result['skipped'])} skipped, "
                    f"{len(result['failed'])} failed{cancelled_part}"
                )
                return result
            elif mode == 'separate':
                for i, row in enumerate(surviving):
                    if self._cancel_requested:
                        for rem_row in surviving[i:]:
                            result['cancelled'].append({
                                'name': rem_row['name'],
                                'path': self._output_path_for(rem_row['path'], resolved_out)
                            })
                        break

                    ok, fieldnames, rows, err = self._read_one(row['path'])
                    if not ok:
                        result['failed'].append({'name': row['name'], 'error': err})
                    else:
                        out_path = self._output_path_for(row['path'], resolved_out)
                        try:
                            preprocess_core.write_csv(out_path, fieldnames, rows)
                            result['written'].append({
                                'name': os.path.basename(out_path),
                                'path': out_path,
                            })
                        except OSError as err:
                            result['failed'].append({'name': row['name'], 'error': str(err)})

                    self._progress['done'] = i + 1
                    next_idx = i + 1
                    self._progress['current'] = surviving[next_idx]['name'] if next_idx < len(surviving) else ''

                result['ok'] = len(result['failed']) == 0
                cancelled_part = f", {len(result['cancelled'])} cancelled" if result['cancelled'] else ""
                result['message'] = (
                    f"{len(result['written'])} written, "
                    f"{len(result['skipped'])} skipped, "
                    f"{len(result['failed'])} failed{cancelled_part}"
                )
                return result
            else:
                result['aborted'] = 'unknown-mode'
                result['message'] = f"Unknown mode: {mode}"
                return result
        finally:
            self._progress['running'] = False
            self._progress['current'] = ''

    def open_output_folder(self):
        try:
            os.startfile(self._output_dir)
            return {'ok': True, 'error': ''}
        except OSError as err:
            return {'ok': False, 'error': str(err)}

    @staticmethod
    def _default_settings_path():
        base = os.environ.get('APPDATA') or os.path.expanduser('~')
        return os.path.join(base, 'SpeechAnalyticsPreprocessor', 'settings.json')

    def _load_settings(self):
        try:
            with open(self._settings_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict):
                return data
            return {}
        except (OSError, ValueError):
            return {}

    def _save_settings(self):
        try:
            parent = os.path.dirname(self._settings_path)
            os.makedirs(parent, exist_ok=True)
            tmp_path = self._settings_path + '.tmp'
            with open(tmp_path, 'w', encoding='utf-8') as f:
                json.dump({'output_dir': self._output_dir}, f)
            os.replace(tmp_path, self._settings_path)
            return True
        except OSError:
            return False

    def pick_output_folder(self):
        if not self._window:
            return self._output_dir
        paths = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        if not paths:
            return self._output_dir
        return self.set_output_folder(paths[0])

    def set_output_folder(self, path):
        self._output_dir = os.path.abspath(path)
        self._save_settings()
        return self._output_dir


def _webview2_runtime_present():
    hives = (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER)
    for hive in hives:
        for subkey in _WEBVIEW2_RUNTIME_KEYS:
            try:
                with winreg.OpenKey(hive, subkey) as key:
                    pv, _ = winreg.QueryValueEx(key, 'pv')
                    if pv and pv != '0.0.0.0':
                        return True
            except OSError:
                continue
    return False


def _show_missing_webview2_dialog():
    ctypes.windll.user32.MessageBoxW(
        0,
        _WEBVIEW2_MISSING_MESSAGE,
        _WEBVIEW2_MISSING_TITLE,
        0x10
    )


def _ensure_standard_streams():
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w')
    if sys.stderr is None:
        sys.stderr = open(os.devnull, 'w')


def main():
    _ensure_standard_streams()
    if not _webview2_runtime_present():
        _show_missing_webview2_dialog()
        return

    api = Api()
    window = webview.create_window(
        'Acme Analytics - Speech Analytics Preprocessor',
        url=resource_path('web/index.html'),
        js_api=api,
        width=1200,
        height=700,
        min_size=(1000, 700)
    )
    api._window = window
    webview.start()


if __name__ == '__main__':
    main()
