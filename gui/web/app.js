var selectedPath = null;
var progressTimer = null;

function initApp() {
    var btnAdd = document.getElementById('btn-add-files');
    if (btnAdd) {
        btnAdd.addEventListener('click', onAddFilesClick);
    }
    var btnClear = document.getElementById('btn-clear-all');
    if (btnClear) {
        btnClear.addEventListener('click', onClearAllClick);
    }
    var sourceScroll = document.getElementById('preview-source-scroll');
    var transformedScroll = document.getElementById('preview-transformed-scroll');
    syncScroll(sourceScroll, transformedScroll);

    var radioSep = document.getElementById('mode-separate');
    if (radioSep) {
        radioSep.addEventListener('change', onModeChange);
    }
    var radioComb = document.getElementById('mode-combined');
    if (radioComb) {
        radioComb.addEventListener('change', onModeChange);
    }
    onModeChange();

    var btnConvert = document.getElementById('btn-convert');
    if (btnConvert) {
        btnConvert.addEventListener('click', onConvertClick);
    }
    var btnChange = document.getElementById('btn-change-output');
    if (btnChange) {
        btnChange.addEventListener('click', onChangeOutputClick);
    }

    window.pywebview.api.list_files().then(function (rows) {
        refreshFileList(rows);
    });
    window.pywebview.api.get_output_dir().then(renderOutputPath);
}

function onChangeOutputClick() {
    window.pywebview.api.pick_output_folder().then(renderOutputPath);
}

function onAddFilesClick() {
    window.pywebview.api.pick_files().then(function (rows) {
        if (rows) {
            clearBanner();
            refreshFileList(rows);
            autoSelectFirstValid(rows);
            window.pywebview.api.get_output_dir().then(renderOutputPath);
        }
    });
}

function addFiles(paths) {
    return window.pywebview.api.add_files(paths).then(function (rows) {
        if (rows) {
            refreshFileList(rows);
            window.pywebview.api.get_output_dir().then(renderOutputPath);
        }
        return rows;
    });
}

function onClearAllClick() {
    selectedPath = null;
    window.pywebview.api.clear().then(function (rows) {
        refreshFileList(rows);
        renderPreview({ columns: [] });
    });
}

function refreshFileList(rows) {
    renderFileList(rows);
    var emptyEl = document.getElementById('file-list-empty');
    if (emptyEl) {
        emptyEl.style.display = (!rows || rows.length === 0) ? 'block' : 'none';
    }
    if (selectedPath && rows) {
        var stillExists = rows.some(function (r) {
            return r.path === selectedPath;
        });
        if (!stillExists) {
            selectedPath = null;
            renderPreview({ columns: [] });
        }
    }
}

function renderFileList(rows) {
    var list = document.getElementById('file-list');
    if (!list) {
        return;
    }
    list.textContent = '';
    if (!rows) {
        return;
    }

    rows.forEach(function (row) {
        var li = document.createElement('li');
        li.className = 'file-row';
        if (row.path) {
            li.setAttribute('data-path', row.path);
        }
        if (row.state === 'missing') {
            li.classList.add('is-invalid');
        } else if (row.state === 'error') {
            li.classList.add('is-error');
        }
        if (selectedPath && row.path === selectedPath) {
            li.classList.add('is-selected');
        }

        var check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'file-check';
        check.checked = Boolean(row.checked);
        if (row.state !== 'valid') {
            check.disabled = true;
        }
        check.addEventListener('change', function () {
            window.pywebview.api.set_checked(row.path, check.checked)
                .then(function (updated) {
                    refreshFileList(updated);
                });
        });

        var nameSpan = document.createElement('span');
        nameSpan.className = 'file-name';
        nameSpan.textContent = row.name || '';

        var statusSpan = document.createElement('span');
        statusSpan.className = 'file-status';
        statusSpan.textContent = row.status || '';

        var removeBtn = document.createElement('button');
        removeBtn.className = 'file-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            window.pywebview.api.remove_file(row.path)
                .then(function (updated) {
                    refreshFileList(updated);
                });
        });

        li.appendChild(check);
        li.appendChild(nameSpan);
        li.appendChild(statusSpan);
        li.appendChild(removeBtn);

        li.addEventListener('click', function (e) {
            if (e.target !== check && e.target !== removeBtn) {
                selectFile(row.path);
            }
        });

        list.appendChild(li);
    });
}

function selectFile(path) {
    selectedPath = path;
    var list = document.getElementById('file-list');
    if (list) {
        var items = list.querySelectorAll('.file-row');
        items.forEach(function (el) {
            if (el.getAttribute('data-path') === path) {
                el.classList.add('is-selected');
            } else {
                el.classList.remove('is-selected');
            }
        });
    }
    window.pywebview.api.preview(path).then(function (payload) {
        renderPreview(payload);
    });
}

function autoSelectFirstValid(rows) {
    if (!rows || rows.length === 0) {
        return;
    }
    if (selectedPath) {
        var current = rows.find(function (r) {
            return r.path === selectedPath;
        });
        if (current && current.state === 'valid') {
            return;
        }
    }
    var firstValid = rows.find(function (r) {
        return r.state === 'valid';
    });
    if (firstValid) {
        selectFile(firstValid.path);
    }
}

function renderPreview(payload) {
    var emptyEl = document.getElementById('preview-empty');
    var captionEl = document.getElementById('preview-caption');
    var srcTable = document.getElementById('preview-source-table'); // SOURCE is plain (null mask)
    var trTable = document.getElementById('preview-transformed-table');

    if (!payload || !payload.columns || !payload.columns.length) {
        if (emptyEl) emptyEl.style.display = 'block';
        if (captionEl) captionEl.textContent = '';
        if (srcTable) srcTable.textContent = '';
        if (trTable) trTable.textContent = '';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    renderCaption(payload);
    buildTable(srcTable, payload.columns, payload.source_rows, null);
    buildTable(trTable, payload.columns, payload.transformed_rows, payload.changed);
}

function buildTable(tableEl, columns, rows, changed) {
    if (!tableEl) {
        return;
    }
    tableEl.textContent = '';

    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    columns.forEach(function (col) {
        var th = document.createElement('th');
        th.textContent = col;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    tableEl.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (var r = 0; r < rows.length; r++) {
        var tr = document.createElement('tr');
        var rowData = rows[r];
        for (var c = 0; c < columns.length; c++) {
            var td = document.createElement('td');
            var val = rowData[c];
            td.textContent = (val !== undefined && val !== null) ? String(val) : '';
            if (changed && changed[r] && changed[r][c]) {
                td.className = 'cell-changed';
            }
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    }
    tableEl.appendChild(tbody);
}

function renderCaption(payload) {
    var captionEl = document.getElementById('preview-caption');
    if (!captionEl) {
        return;
    }
    captionEl.textContent = 'Showing ' + payload.shown_rows + ' of ' +
        payload.total_rows + ' rows \u00b7 ' + payload.changed_cells + ' cells changed';
}

function syncScroll(a, b) {
    var syncing = false;
    if (!a || !b) {
        return;
    }
    a.addEventListener('scroll', function () {
        if (!syncing) {
            syncing = true;
            b.scrollLeft = a.scrollLeft;
            b.scrollTop = a.scrollTop;
            syncing = false;
        }
    });
    b.addEventListener('scroll', function () {
        if (!syncing) {
            syncing = true;
            a.scrollLeft = b.scrollLeft;
            a.scrollTop = b.scrollTop;
            syncing = false;
        }
    });
}

function currentMode () {
    var radioCombined = document.getElementById('mode-combined');
    return (radioCombined && radioCombined.checked) ? 'combined' : 'separate';
}

function currentCombineName () {
    var el = document.getElementById('combined-name');
    return el ? el.value : '';
}

function onModeChange() {
    var radioCombined = document.getElementById('mode-combined');
    var isCombined = radioCombined && radioCombined.checked;
    var group = document.getElementById('combined-name-group');
    if (group) {
        group.style.display = isCombined ? 'flex' : 'none';
    }
}

function setRunControlsDisabled(disabled) {
    var ids = [
        'btn-add-files',
        'btn-clear-all',
        'mode-separate',
        'mode-combined',
        'btn-change-output',
        'combined-name',
        'btn-convert'
    ];
    ids.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
            el.disabled = disabled;
        }
    });
    var checks = document.querySelectorAll('.file-check');
    checks.forEach(function (el) {
        el.disabled = disabled;
    });
    var removes = document.querySelectorAll('.file-remove');
    removes.forEach(function (el) {
        el.disabled = disabled;
    });
    if (!disabled) {
        window.pywebview.api.list_files().then(refreshFileList);
    }
}

function startProgressPoll() {
    stopProgressPoll();
    progressTimer = setInterval(function () {
        window.pywebview.api.get_progress().then(renderProgress);
    }, 200);
}

function stopProgressPoll() {
    if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
    }
}

function onCancelClick() {
    window.pywebview.api.cancel();
}

function renderProgress(prog) {
    if (!prog || !prog.running) {
        return;
    }
    var note = document.getElementById('phase27-note');
    if (!note) {
        return;
    }
    var total = prog.total || 0;
    var done = prog.done || 0;
    var pct = total > 0 ? Math.round((done / total) * 100) : 0;

    var container = note.querySelector('.banner-progress');
    if (!container) {
        note.textContent = '';
        container = document.createElement('div');
        container.className = 'banner-progress';

        var track = document.createElement('div');
        track.className = 'progress-track';
        var fill = document.createElement('div');
        fill.className = 'progress-fill';
        track.appendChild(fill);
        container.appendChild(track);

        var counter = document.createElement('span');
        counter.className = 'progress-counter';
        container.appendChild(counter);

        var btnCancel = document.createElement('button');
        btnCancel.className = 'banner-cancel';
        btnCancel.textContent = 'Cancel';
        btnCancel.addEventListener('click', onCancelClick);
        container.appendChild(btnCancel);

        note.appendChild(container);
    }

    var fillEl = note.querySelector('.progress-fill');
    if (fillEl) {
        fillEl.style.width = pct + '%';
    }
    var counterEl = note.querySelector('.progress-counter');
    if (counterEl) {
        var txt = 'Converting ' + done + ' of ' + total;
        if (prog.current) {
            txt += ' (' + prog.current + ')';
        }
        if (prog.cancel_requested) {
            txt += ' - Cancelling...';
        }
        counterEl.textContent = txt;
    }
}

function onConvertClick() {
    clearBanner();
    var mode = currentMode();
    var outPathEl = document.getElementById('output-path');
    var outDir = outPathEl ? outPathEl.value : '';
    var combineName = currentCombineName();
    setRunControlsDisabled(true);
    startProgressPoll();
    window.pywebview.api.convert(mode, outDir, combineName)
        .then(function (result) {
            stopProgressPoll();
            setRunControlsDisabled(false);
            renderBanner(result);
        });
}

function renderOutputPath(path) {
    var el = document.getElementById('output-path');
    if (el && typeof path === 'string') {
        el.value = path;
    }
}

function clearBanner() {
    var el = document.getElementById('phase27-note');
    if (el) {
        el.textContent = '';
    }
}

function onOpenFolderClick() {
    window.pywebview.api.open_output_folder().then(function (res) {
        if (res && !res.ok) {
            var headline = document.querySelector('.banner-headline');
            if (headline) {
                headline.textContent = res.error || 'Failed to open folder';
            }
        }
    });
}

function renderBanner(result) {
    var note = document.getElementById('phase27-note');
    if (!note || !result) {
        return;
    }
    note.textContent = '';

    var headline = document.createElement('span');
    headline.className = 'banner-headline';
    headline.textContent = result.message || '';
    note.appendChild(headline);

    var actions = document.createElement('div');
    actions.className = 'banner-actions';

    if (result.aborted !== 'no-files') {
        var btnOpen = document.createElement('button');
        btnOpen.className = 'banner-open-folder';
        btnOpen.textContent = 'Open Folder';
        btnOpen.addEventListener('click', onOpenFolderClick);
        actions.appendChild(btnOpen);
    }

    var btnDismiss = document.createElement('button');
    btnDismiss.className = 'banner-dismiss';
    btnDismiss.textContent = 'Dismiss';
    btnDismiss.addEventListener('click', clearBanner);
    actions.appendChild(btnDismiss);
    note.appendChild(actions);

    var written = result.written || [];
    var skipped = result.skipped || [];
    var failed = result.failed || [];
    var cancelled = result.cancelled || [];
    var totalItems = written.length + skipped.length + failed.length + cancelled.length;

    if (totalItems > 0) {
        var btnToggle = document.createElement('button');
        btnToggle.className = 'banner-toggle';
        btnToggle.textContent = 'Details';
        note.appendChild(btnToggle);

        var detailList = document.createElement('ul');
        detailList.className = 'banner-detail';
        detailList.style.display = 'none';

        btnToggle.addEventListener('click', function () {
            if (detailList.style.display === 'none') {
                detailList.style.display = 'block';
            } else {
                detailList.style.display = 'none';
            }
        });

        for (var i = 0; i < written.length; i++) {
            var item = document.createElement('li');
            item.className = 'banner-detail-item';
            item.textContent = written[i].name;
            detailList.appendChild(item);
        }
        for (var j = 0; j < skipped.length; j++) {
            var sItem = document.createElement('li');
            sItem.className = 'banner-detail-item';
            sItem.textContent = skipped[j].name + ': ' + skipped[j].reason;
            detailList.appendChild(sItem);
        }
        for (var k = 0; k < failed.length; k++) {
            var fItem = document.createElement('li');
            fItem.className = 'banner-detail-item is-failed';
            fItem.textContent = failed[k].name + ': ' + failed[k].error;
            detailList.appendChild(fItem);
        }
        for (var c = 0; c < cancelled.length; c++) {
            var cItem = document.createElement('li');
            cItem.className = 'banner-detail-item';
            cItem.textContent = cancelled[c].name + ': cancelled';
            detailList.appendChild(cItem);
        }
        note.appendChild(detailList);
    }
}


window.addEventListener('pywebviewready', initApp);
