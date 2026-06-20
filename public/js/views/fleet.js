// ============================================================
//  Fleet & Filter search and Manual Vehicle Management
// ============================================================
let searchTimeout = null;
const FLEET_LIMIT = 60;
let currentEditVehicleId = null;

function initFleetView() {
    populateFilterDropdowns();
    const input = document.getElementById('searchInput');
    input.addEventListener('input', () => { clearTimeout(searchTimeout); searchTimeout = setTimeout(performSearch, 180); });
    input.addEventListener('keydown', e => { if (e.key === 'Escape') { input.value = ''; performSearch(); } });
}
function applyFilters() { performSearch(); }

function performSearch() {
    const grid = document.getElementById('resultsGrid');
    if (!grid) return;
    const query = document.getElementById('searchInput').value.trim().toUpperCase();
    const brand = document.getElementById('brandFilter').value;
    const vType = document.getElementById('typeFilter').value;

    let matched = globalData.vehicles.filter(v => {
        if (brand && (v.Brand || '').toUpperCase() !== brand) return false;
        if (vType && (v.VehicleType || '').toUpperCase() !== vType) return false;
        if (query) {
            return (v.ECNumber || '').toUpperCase().includes(query) ||
                   (v.RegistrationNo || '').toUpperCase().includes(query) ||
                   (v.Brand || '').toUpperCase().includes(query) ||
                   (v.ModelNo || '').toUpperCase().includes(query) ||
                   (v.VehicleType || '').toUpperCase().includes(query);
        }
        return true;
    });

    const countEl = document.getElementById('resultCount');
    if (!matched.length) {
        grid.innerHTML = '<div class="empty-note">No vehicles found.</div>';
        countEl.textContent = '';
        return;
    }
    const shown = matched.slice(0, FLEET_LIMIT);
    countEl.innerHTML = `Showing <strong>${shown.length}</strong> of ${matched.length}`;
    grid.innerHTML = shown.map(v => `
        <div class="card vehicle-card">
            <div class="card-header">
                <div>
                    <div class="vc-title">${esc(v.ECNumber || 'Unknown')} <span class="muted">${esc(v.VehicleType || '')}</span></div>
                    <div class="vc-sub">${esc(v.Brand || '')} ${esc(v.ModelNo || '')} · ${esc(v.RegistrationNo || '')}</div>
                </div>
            </div>
            <div class="card-body">
                <div class="card-field-label">Capacity</div><div class="card-field-value">${esc(v.Capacity || '-')}</div>
                <div class="card-field-label">Site</div><div class="card-field-value">${esc(v.Site || '-')}</div>
            </div>
            <div class="vc-actions">
                <button class="btn btn-primary btn-block" onclick="openServiceHistory('${v.VehicleID}')">View Service History</button>
                <div style="display: flex; gap: 8px; margin-top: 8px;">
                    <button class="btn btn-secondary" style="flex: 1;" onclick="openNewServiceSheet('${v.VehicleID}')">+ Service</button>
                    <button class="btn btn-secondary" style="flex: 0 0 50px; display: flex; align-items: center; justify-content: center;" onclick="openVehicleModal('${v.VehicleID}')" title="Edit Vehicle Details">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                </div>
            </div>
        </div>`).join('');
}

function populateFilterDropdowns() {
    const brandSelect = document.getElementById('brandFilter');
    const typeSelect = document.getElementById('typeFilter');
    if (!brandSelect || !typeSelect) return;

    const selectedBrand = brandSelect.value;
    const selectedType = typeSelect.value;

    brandSelect.innerHTML = '<option value="">All Brands</option>';
    typeSelect.innerHTML = '<option value="">All Types</option>';

    Array.from(globalData.brands).sort().forEach(b => brandSelect.appendChild(new Option(b, b)));
    Array.from(globalData.types).sort().forEach(t => typeSelect.appendChild(new Option(t, t)));

    if (Array.from(brandSelect.options).some(o => o.value === selectedBrand)) {
        brandSelect.value = selectedBrand;
    }
    if (Array.from(typeSelect.options).some(o => o.value === selectedType)) {
        typeSelect.value = selectedType;
    }
}

// Modal handling
function openVehicleModal(vehicleId = null) {
    currentEditVehicleId = vehicleId;
    const form = document.getElementById('vehicleForm');
    form.reset();

    const titleEl = document.getElementById('vehModalTitle');
    const deleteBtn = document.getElementById('v-delete');
    const saveBtn = document.getElementById('v-save');

    if (vehicleId) {
        titleEl.textContent = 'Edit Vehicle/Machinery Details';
        deleteBtn.style.display = 'inline-block';
        saveBtn.textContent = 'Update Vehicle';

        const v = globalData.vehicleById.get(String(vehicleId));
        if (v) {
            document.getElementById('v-ec').value = v.ECNumber || '';
            document.getElementById('v-reg').value = v.RegistrationNo || '';
            document.getElementById('v-brand').value = v.Brand || '';
            document.getElementById('v-model').value = v.ModelNo || '';
            document.getElementById('v-type').value = v.VehicleType || '';
            document.getElementById('v-desc').value = v.EquipmentDescription || '';
            document.getElementById('v-cap').value = v.Capacity || '';
            document.getElementById('v-year').value = v.YearOfManufacture || '';
            document.getElementById('v-serial').value = v.SerialNo || '';
            document.getElementById('v-chassis').value = v.ChassisNo || '';
            document.getElementById('v-engine').value = v.EngineNo || '';
            document.getElementById('v-gps').value = v.GPSUnit || '';
            document.getElementById('v-site').value = v.Site || '';
            document.getElementById('v-status').value = v.Status || 'Active';
        }
    } else {
        titleEl.textContent = 'Add New Vehicle/Machinery';
        deleteBtn.style.display = 'none';
        saveBtn.textContent = 'Save Vehicle';
    }
    openModal('vehicleModal');
}

async function submitVehicleForm(e) {
    e.preventDefault();
    const ec = document.getElementById('v-ec').value.trim();
    const reg = document.getElementById('v-reg').value.trim();
    const brand = document.getElementById('v-brand').value.trim();
    const model = document.getElementById('v-model').value.trim();
    const type = document.getElementById('v-type').value.trim();

    if (!ec && !reg) {
        alert('Please enter either an E&C Code or a Registration Number to identify the vehicle.');
        return;
    }

    const payload = {
        ECNumber: ec,
        RegistrationNo: reg,
        Brand: brand,
        ModelNo: model,
        VehicleType: type,
        EquipmentDescription: document.getElementById('v-desc').value.trim(),
        Capacity: document.getElementById('v-cap').value.trim(),
        YearOfManufacture: document.getElementById('v-year').value.trim(),
        SerialNo: document.getElementById('v-serial').value.trim(),
        ChassisNo: document.getElementById('v-chassis').value.trim(),
        EngineNo: document.getElementById('v-engine').value.trim(),
        GPSUnit: document.getElementById('v-gps').value.trim(),
        Site: document.getElementById('v-site').value.trim(),
        Status: document.getElementById('v-status').value
    };

    try {
        if (currentEditVehicleId) {
            await api('/api/vehicles/' + currentEditVehicleId, 'PUT', payload);
            toast('Vehicle updated successfully');
        } else {
            await api('/api/vehicles', 'POST', payload);
            toast('Vehicle added successfully');
        }
        closeModal('vehicleModal');
        await refreshCatalog();
        performSearch();
    } catch (err) {
        toast('Failed to save vehicle: ' + err.message, 'err');
    }
}

async function deleteVehicle() {
    if (!currentEditVehicleId) return;
    if (!confirm('Are you sure you want to delete this vehicle? This will permanently remove it from the fleet.')) return;

    try {
        await api('/api/vehicles/' + currentEditVehicleId, 'DELETE');
        toast('Vehicle deleted successfully');
        closeModal('vehicleModal');
        await refreshCatalog();
        performSearch();
    } catch (err) {
        toast('Delete failed: ' + err.message, 'err');
    }
}
