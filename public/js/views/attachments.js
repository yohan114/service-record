// ============================================================
//  Service record attachments (PDF / images / documents)
//  Used inside the service sheet modal. For an existing record
//  files upload immediately; for a brand-new record they are
//  queued and flushed once the record is saved.
// ============================================================
let pendingAttachments = [];   // File objects waiting for a new record to be saved

function fmtBytes(n) {
    n = +n || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
}
const isImage = m => /^image\//.test(m || '');
const isPdf = m => /pdf/.test(m || '');

function fileGlyph(mime, name) {
    if (isPdf(mime) || /\.pdf$/i.test(name)) return '<span class="att-glyph pdf">PDF</span>';
    if (/\.(docx?|odt)$/i.test(name) || /word/.test(mime)) return '<span class="att-glyph doc">DOC</span>';
    if (/\.(xlsx?|csv|ods)$/i.test(name) || /sheet|excel|csv/.test(mime)) return '<span class="att-glyph xls">XLS</span>';
    return '<span class="att-glyph file">FILE</span>';
}

// Called by the service form whenever the modal opens.
function renderAttachmentsPanel() {
    pendingAttachments = [];
    const addBtn = document.getElementById('ns-attach-add');
    const dz = document.getElementById('ns-attach-dropzone');
    const hint = document.getElementById('ns-attach-hint');
    addBtn.style.display = 'inline-flex';
    dz.style.display = 'block';
    setupDropzone();
    if (currentServiceId) {
        hint.textContent = '';
        loadAttachments(currentServiceId);
    } else {
        hint.textContent = 'Files you add will be saved together with this new service record.';
        document.getElementById('ns-attach-list').innerHTML = '';
    }
}

let dropzoneWired = false;
function setupDropzone() {
    if (dropzoneWired) return;
    dropzoneWired = true;
    const dz = document.getElementById('ns-attach-dropzone');
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files) uploadAttachments(e.dataTransfer.files); });
}

async function loadAttachments(serviceId) {
    const list = document.getElementById('ns-attach-list');
    list.innerHTML = '<div class="loading small">Loading…</div>';
    try {
        const items = await api('/api/services/' + serviceId + '/attachments');
        renderAttachmentList(items);
    } catch (e) { list.innerHTML = '<div class="empty-note err small">Could not load attachments.</div>'; }
}

function renderAttachmentList(items) {
    const list = document.getElementById('ns-attach-list');
    if (!items.length) { list.innerHTML = '<div class="att-empty">No files attached yet.</div>'; return; }
    list.innerHTML = items.map(a => {
        const url = '/api/attachments/' + a.AttachmentID + '/file';
        const thumb = isImage(a.MimeType)
            ? `<a href="${url}" target="_blank" class="att-thumb"><img src="${url}" alt=""></a>`
            : `<a href="${url}" target="_blank" class="att-thumb">${fileGlyph(a.MimeType, a.OriginalName)}</a>`;
        return `
        <div class="att-item">
            ${thumb}
            <div class="att-meta">
                <a href="${url}" target="_blank" class="att-name" title="${esc(a.OriginalName)}">${esc(a.OriginalName)}</a>
                <div class="att-sub">${fmtBytes(a.FileSize)}${a.Caption ? ' · ' + esc(a.Caption) : ''}</div>
            </div>
            <div class="att-actions">
                <a class="btn btn-mini btn-secondary" href="${url}?dl=1">Download</a>
                <button type="button" class="btn btn-mini btn-danger" onclick="deleteAttachment(${a.AttachmentID})">Remove</button>
            </div>
        </div>`;
    }).join('');
}

function renderPendingList() {
    const list = document.getElementById('ns-attach-list');
    if (!pendingAttachments.length) { list.innerHTML = '<div class="att-empty">No files attached yet.</div>'; return; }
    list.innerHTML = pendingAttachments.map((f, i) => `
        <div class="att-item pending">
            <span class="att-thumb">${isImage(f.type) ? '<span class="att-glyph img">IMG</span>' : fileGlyph(f.type, f.name)}</span>
            <div class="att-meta">
                <span class="att-name" title="${esc(f.name)}">${esc(f.name)}</span>
                <div class="att-sub">${fmtBytes(f.size)} · <span class="att-pending-tag">will upload on save</span></div>
            </div>
            <div class="att-actions">
                <button type="button" class="btn btn-mini btn-danger" onclick="removePending(${i})">Remove</button>
            </div>
        </div>`).join('');
}
function removePending(i) { pendingAttachments.splice(i, 1); renderPendingList(); }

const ATT_ALLOWED = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt'];

// Entry point from the file input / dropzone.
function uploadAttachments(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    for (const f of files) {
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        if (!ATT_ALLOWED.includes(ext)) { toast(`“${f.name}” — unsupported type`, 'err'); continue; }
        if (f.size > 25 * 1024 * 1024) { toast(`“${f.name}” exceeds 25 MB`, 'err'); continue; }
        if (currentServiceId) uploadOne(currentServiceId, f);
        else { pendingAttachments.push(f); }
    }
    if (!currentServiceId) renderPendingList();
}

async function uploadOne(serviceId, file) {
    const list = document.getElementById('ns-attach-list');
    const tmp = document.createElement('div');
    tmp.className = 'att-item uploading';
    tmp.innerHTML = `<span class="att-thumb"><span class="att-glyph file">…</span></span>
        <div class="att-meta"><span class="att-name">${esc(file.name)}</span><div class="att-sub">Uploading…</div></div>`;
    if (list.querySelector('.att-empty')) list.innerHTML = '';
    list.appendChild(tmp);
    try {
        const res = await fetch('/api/services/' + serviceId + '/attachments', {
            method: 'POST',
            headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'X-File-Name': encodeURIComponent(file.name)
            },
            body: file
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        toast('Attached “' + file.name + '”');
        loadAttachments(serviceId);
    } catch (e) {
        tmp.remove();
        toast('Upload failed: ' + e.message, 'err');
        if (!list.children.length) renderAttachmentList([]);
    }
}

// Called by the service form right after a NEW record is created.
async function flushPendingAttachments(serviceId) {
    if (!pendingAttachments.length) return;
    const files = pendingAttachments.slice();
    pendingAttachments = [];
    for (const f of files) {
        try {
            await fetch('/api/services/' + serviceId + '/attachments', {
                method: 'POST',
                headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) },
                body: f
            });
        } catch (e) { /* reported per-file below */ }
    }
    toast(files.length + ' file' + (files.length === 1 ? '' : 's') + ' attached');
}

async function deleteAttachment(attId) {
    if (!confirm('Remove this attachment? This cannot be undone.')) return;
    try {
        await api('/api/attachments/' + attId, 'DELETE');
        toast('Attachment removed');
        if (currentServiceId) loadAttachments(currentServiceId);
    } catch (e) { toast('Delete failed: ' + e.message, 'err'); }
}
