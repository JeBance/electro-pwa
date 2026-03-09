// Database for offline storage
const db = new Dexie('ElectroDB');
db.version(1).stores({
  heaters: 'id, premise_id, status, name, serial',
  premises: 'id, object_id, name, type',
  objects: 'id, name, code',
  users: 'id, login, role',
  events: 'id, heater_id, event_type, created_at',
  syncQueue: '++id, action, endpoint, method, data, timestamp'
});

// State
let currentUser = null;
let currentView = 'login';
let heaters = [];
let premises = [];
let objects = [];
let viewMode = 'premises'; // 'premises' or 'list'
let sortField = 'name';
let sortDir = 'asc';
let selectedHeater = null;
let filterStatus = '';
let filterObject = '';
let filterPremise = '';
let searchQuery = '';

// API base URL
const API_BASE = '';

// Utility functions
function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return document.querySelectorAll(selector);
}

function createElement(tag, className = '', html = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (html) el.innerHTML = html;
  return el;
}

function showToast(message) {
  const existing = $('.toast');
  if (existing) existing.remove();
  
  const toast = createElement('div', 'toast', message);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return date.toLocaleDateString('ru-RU', { 
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

function getStatusBadge(status) {
  const labels = {
    active: { text: 'Активен', class: 'badge-active', icon: '🟢' },
    repair: { text: 'В ремонте', class: 'badge-repair', icon: '🟡' },
    warehouse: { text: 'На складе', class: 'badge-warehouse', icon: '🔵' },
    moved: { text: 'Перемещён', class: 'badge-moved', icon: '🟠' }
  };
  const s = labels[status] || labels.active;
  return `<span class="badge ${s.class}">${s.icon} ${s.text}</span>`;
}

function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

// Navigation
function setView(view) {
  currentView = view;
  render();
}

function setBottomNav(view) {
  $$('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });
}

// API calls
async function api(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
  
  const isOnline = navigator.onLine;
  
  // For offline, queue the operation
  if (!isOnline && options.method !== 'GET') {
    await db.syncQueue.add({
      action: endpoint,
      endpoint,
      method: options.method,
      data: options.body ? JSON.parse(options.body) : null,
      timestamp: Date.now()
    });
    showToast('Офлайн: операция сохранена в очередь');
    return { offline: true };
  }
  
  try {
    const res = await fetch(`${API_BASE}/api${endpoint}`, { ...options, headers });
    if (res.status === 401) {
      logout();
      throw new Error('Unauthorized');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (err) {
    if (!isOnline && options.method === 'GET') {
      // Return cached data for GET requests
      return await getCachedData(endpoint);
    }
    throw err;
  }
}

async function getCachedData(endpoint) {
  if (endpoint.startsWith('/heaters')) {
    return await db.heaters.toArray();
  }
  if (endpoint.startsWith('/premises')) {
    return await db.premises.toArray();
  }
  if (endpoint.startsWith('/objects')) {
    return await db.objects.toArray();
  }
  return [];
}

async function cacheData(endpoint, data) {
  if (endpoint.startsWith('/heaters')) {
    await db.heaters.clear();
    await db.heaters.bulkAdd(data);
  }
  if (endpoint.startsWith('/premises')) {
    await db.premises.clear();
    await db.premises.bulkAdd(data);
  }
  if (endpoint.startsWith('/objects')) {
    await db.objects.clear();
    await db.objects.bulkAdd(data);
  }
}

// Auth
async function login(login, password) {
  try {
    const data = await api('/login', {
      method: 'POST',
      body: JSON.stringify({ login, password })
    });
    localStorage.setItem('token', data.token);
    currentUser = data.user;
    showToast('Вход выполнен');
    setView('heaters');
  } catch (err) {
    showToast(err.message || 'Ошибка входа');
    throw err;
  }
}

function logout() {
  localStorage.removeItem('token');
  currentUser = null;
  setView('login');
}

function checkAuth() {
  const token = localStorage.getItem('token');
  if (!token) return false;
  
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp * 1000 < Date.now()) {
      logout();
      return false;
    }
    currentUser = payload;
    return true;
  } catch {
    logout();
    return false;
  }
}

// Data loading
async function loadData() {
  try {
    const [heatersData, premisesData, objectsData] = await Promise.all([
      api('/heaters'),
      api('/premises'),
      api('/objects')
    ]);
    
    heaters = heatersData;
    premises = premisesData;
    objects = objectsData;
    
    await cacheData('/heaters', heatersData);
    await cacheData('/premises', premisesData);
    await cacheData('/objects', objectsData);
  } catch (err) {
    console.error('Failed to load data:', err);
  }
}

// Render functions
function renderLogin() {
  return `
    <div class="login-screen">
      <div class="login-logo">ELECTRO</div>
      <form class="login-form" onsubmit="handleLogin(event)">
        <div class="input-group">
          <input type="text" name="login" placeholder="Логин" required autocomplete="username">
        </div>
        <div class="input-group">
          <input type="password" name="password" placeholder="Пароль" required autocomplete="current-password">
        </div>
        <button type="submit" class="btn btn-primary">Войти</button>
      </form>
    </div>
  `;
}

function renderHeader() {
  const titles = {
    heaters: 'Обогреватели',
    admin: 'Админка',
    profile: 'Профиль'
  };
  
  return `
    <header class="header">
      <div class="header-title">${titles[currentView] || 'ELECTRO'}</div>
      <div class="header-actions">
        ${currentView === 'heaters' ? `
          <div class="toggle-container">
            <span>Вагоны</span>
            <div class="toggle ${viewMode === 'list' ? 'active' : ''}" onclick="toggleViewMode()"></div>
            <span>Список</span>
          </div>
        ` : ''}
      </div>
    </header>
  `;
}

function renderHeaters() {
  if (viewMode === 'premises') {
    return renderPremisesView();
  }
  return renderListView();
}

function renderPremisesView() {
  const premiseMap = new Map();
  heaters.forEach(h => {
    const key = h.premise_id || 0;
    if (!premiseMap.has(key)) premiseMap.set(key, []);
    premiseMap.get(key).push(h);
  });
  
  let html = '';
  
  // Group without premise
  const noPremise = premiseMap.get(0) || [];
  if (noPremise.length > 0) {
    html += `<div class="card">
      <div class="card-header"><span class="card-title">Без помещения</span></div>
      ${noPremise.map(h => renderHeaterItem(h)).join('')}
    </div>`;
  }
  
  // Group by premise
  premises.forEach(p => {
    const items = premiseMap.get(p.id) || [];
    if (items.length === 0) return;
    
    html += `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${p.name}</span>
          <span class="card-subtitle">${p.number || ''}</span>
        </div>
        ${items.map(h => renderHeaterItem(h)).join('')}
      </div>
    `;
  });
  
  if (!html) {
    html = `
      <div class="empty-state">
        <div class="empty-state-icon">📦</div>
        <div class="empty-state-text">Нет обогревателей</div>
      </div>
    `;
  }
  
  return html;
}

function renderHeaterItem(h) {
  const sticker = h.sticker_number ? `<span class="sticker-number">${h.sticker_number}</span>` : '';
  return `
    <div class="list-item" onclick="showHeaterDetail(${h.id})">
      <div class="list-item-icon">🔥</div>
      <div class="list-item-content">
        <div class="list-item-title">${h.name} ${sticker}</div>
        <div class="list-item-subtitle">${h.serial || 'Б/Н'} • ${h.power_kw ? h.power_kw + ' кВт' : ''}</div>
      </div>
      ${getStatusBadge(h.status)}
    </div>
  `;
}

function renderListView() {
  // Filter and sort
  let filtered = [...heaters];
  
  if (filterStatus) filtered = filtered.filter(h => h.status === filterStatus);
  if (filterObject) filtered = filtered.filter(h => h.object_id == filterObject);
  if (filterPremise) filtered = filtered.filter(h => h.premise_id == filterPremise);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(h => 
      h.name.toLowerCase().includes(q) || 
      (h.serial && h.serial.toLowerCase().includes(q))
    );
  }
  
  filtered.sort((a, b) => {
    let aVal = a[sortField] || '';
    let bVal = b[sortField] || '';
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  
  const sortIcon = (field) => sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
  
  let html = `
    <div class="search-box">
      <input type="text" placeholder="Поиск..." value="${searchQuery}" oninput="searchQuery = this.value; renderHeaters()">
    </div>
    <div class="filters">
      <div class="filter-chip ${!filterStatus ? 'active' : ''}" onclick="filterStatus = ''; renderHeaters()">Все</div>
      <div class="filter-chip ${filterStatus === 'active' ? 'active' : ''}" onclick="filterStatus = 'active'; renderHeaters()">🟢 Активные</div>
      <div class="filter-chip ${filterStatus === 'repair' ? 'active' : ''}" onclick="filterStatus = 'repair'; renderHeaters()">🟡 Ремонт</div>
      <div class="filter-chip ${filterStatus === 'warehouse' ? 'active' : ''}" onclick="filterStatus = 'warehouse'; renderHeaters()">🔵 Склад</div>
    </div>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th onclick="sortField = 'name'; sortDir = sortField === 'name' && sortDir === 'asc' ? 'desc' : 'asc'; renderHeaters()">Название${sortIcon('name')}</th>
            <th onclick="sortField = 'serial'; sortDir = sortField === 'serial' && sortDir === 'asc' ? 'desc' : 'asc'; renderHeaters()">Серийник${sortIcon('serial')}</th>
            <th onclick="sortField = 'power_kw'; sortDir = sortField === 'power_kw' && sortDir === 'asc' ? 'desc' : 'asc'; renderHeaters()">Мощность${sortIcon('power_kw')}</th>
            <th onclick="sortField = 'status'; sortDir = sortField === 'status' && sortDir === 'asc' ? 'desc' : 'asc'; renderHeaters()">Статус${sortIcon('status')}</th>
            <th>Наклейка</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(h => `
            <tr onclick="showHeaterDetail(${h.id})" style="cursor:pointer">
              <td>${h.name}</td>
              <td>${h.serial || 'Б/Н'}</td>
              <td>${h.power_kw ? h.power_kw + ' кВт' : '—'}</td>
              <td>${getStatusBadge(h.status)}</td>
              <td>${h.sticker_number ? `<span class="sticker-number">${h.sticker_number}</span>` : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  
  if (filtered.length === 0) {
    html = `
      <div class="search-box">
        <input type="text" placeholder="Поиск..." value="${searchQuery}" oninput="searchQuery = this.value; renderHeaters()">
      </div>
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <div class="empty-state-text">Ничего не найдено</div>
      </div>
    `;
  }
  
  return html;
}

function renderAdmin() {
  if (currentUser?.role !== 'admin') {
    return `<div class="empty-state"><div class="empty-state-text">Доступ запрещён</div></div>`;
  }
  
  return `
    <div class="admin-section">
      <div class="admin-section-title">Пользователи</div>
      <div id="users-list"></div>
      <button class="btn btn-secondary btn-small" onclick="showAddUserModal()" style="margin-top:10px">+ Добавить</button>
    </div>
    <div class="admin-section">
      <div class="admin-section-title">Объекты</div>
      <div id="objects-list"></div>
      <button class="btn btn-secondary btn-small" onclick="showAddObjectModal()" style="margin-top:10px">+ Добавить</button>
    </div>
    <div class="admin-section">
      <div class="admin-section-title">Помещения</div>
      <div id="premises-list"></div>
      <button class="btn btn-secondary btn-small" onclick="showAddPremiseModal()" style="margin-top:10px">+ Добавить</button>
    </div>
  `;
}

function renderProfile() {
  const isOnline = navigator.onLine;
  
  return `
    <div class="profile-header">
      <div class="profile-avatar">${getInitials(currentUser?.login || 'U')}</div>
      <div class="profile-name">${currentUser?.login || 'Гость'}</div>
      <div class="profile-role">${getRoleName(currentUser?.role)}</div>
      <div class="profile-status">
        <span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>
        <span>${isOnline ? 'Онлайн' : 'Офлайн'}</span>
      </div>
    </div>
    <div class="settings-list">
      <div class="settings-item">
        <span class="settings-item-label">Синхронизация</span>
        <span id="sync-status">—</span>
      </div>
      <button class="btn btn-danger" onclick="logout()" style="margin-top:20px">Выйти</button>
    </div>
  `;
}

function getRoleName(role) {
  const names = { admin: 'Администратор', electrician: 'Электрик', commander: 'Командир' };
  return names[role] || role;
}

function renderBottomNav() {
  if (!currentUser) return '';
  
  return `
    <nav class="bottom-nav">
      <div class="nav-item ${currentView === 'heaters' ? 'active' : ''}" data-view="heaters" onclick="setView('heaters')">
        <span class="nav-icon">🔥</span>
        <span>Обогреватели</span>
      </div>
      ${currentUser.role === 'admin' ? `
        <div class="nav-item ${currentView === 'admin' ? 'active' : ''}" data-view="admin" onclick="setView('admin')">
          <span class="nav-icon">⚙️</span>
          <span>Админка</span>
        </div>
      ` : ''}
      <div class="nav-item ${currentView === 'profile' ? 'active' : ''}" data-view="profile" onclick="setView('profile')">
        <span class="nav-icon">👤</span>
        <span>Профиль</span>
      </div>
    </nav>
  `;
}

function renderFAB() {
  if (currentView !== 'heaters') return '';
  if (currentUser?.role === 'commander') return '';
  
  return `<button class="fab" onclick="showAddHeaterModal()">+</button>`;
}

// Main render
function render() {
  const app = $('#app');
  
  if (!currentUser && currentView !== 'login') {
    currentView = 'login';
  }
  
  let html = '';
  
  if (currentView === 'login') {
    html = renderLogin();
  } else {
    html = renderHeader();
    html += '<div class="content">';
    
    if (currentView === 'heaters') {
      html += renderHeaters();
    } else if (currentView === 'admin') {
      html += renderAdmin();
      setTimeout(loadAdminData, 0);
    } else if (currentView === 'profile') {
      html += renderProfile();
      setTimeout(updateSyncStatus, 0);
    }
    
    html += '</div>';
    html += renderBottomNav();
    html += renderFAB();
  }
  
  app.innerHTML = html;
  setBottomNav(currentView);
}

// Modal functions
function showModal(content) {
  const overlay = createElement('div', 'modal-overlay');
  overlay.innerHTML = `<div class="modal">${content}</div>`;
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
  document.body.appendChild(overlay);
}

function closeModal() {
  const modal = $('.modal-overlay');
  if (modal) modal.remove();
}

function showAddHeaterModal() {
  const objectsHtml = objects.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
  
  showModal(`
    <div class="modal-header">
      <div class="modal-title">Добавить обогреватель</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form onsubmit="handleAddHeater(event)">
      <div class="input-group">
        <select name="object_id" required onchange="updatePremisesSelect(this.value)">
          <option value="">Выберите объект</option>
          ${objectsHtml}
        </select>
      </div>
      <div class="input-group">
        <select name="premise_id" id="premise-select" required>
          <option value="">Сначала выберите объект</option>
        </select>
      </div>
      <div class="input-group">
        <input type="text" name="name" placeholder="Название" required>
      </div>
      <div class="input-group">
        <input type="text" name="serial" placeholder="Серийный номер">
      </div>
      <div class="input-group">
        <input type="number" name="power_kw" placeholder="Мощность (кВт)" step="0.1">
      </div>
      <div class="input-group">
        <input type="number" name="elements" placeholder="Количество секций">
      </div>
      <div class="input-group">
        <input type="date" name="manufacture_date" placeholder="Дата изготовления">
      </div>
      <div class="input-group">
        <select name="status">
          <option value="active">Активен</option>
          <option value="repair">В ремонте</option>
          <option value="warehouse">На складе</option>
          <option value="moved">Перемещён</option>
        </select>
      </div>
      <div class="photo-upload">
        <button type="button" class="photo-btn" onclick="selectPhoto('camera')">📷 Камера</button>
        <button type="button" class="photo-btn" onclick="selectPhoto('gallery')">🖼️ Галерея</button>
      </div>
      <img id="photo-preview" class="photo-preview" style="display:none">
      <input type="hidden" name="photo_data" id="photo-data">
      <button type="submit" class="btn btn-primary">Сохранить</button>
    </form>
  `);
}

function updatePremisesSelect(objectId) {
  const select = $('#premise-select');
  const filtered = premises.filter(p => p.object_id == objectId);
  select.innerHTML = '<option value="">Выберите помещение</option>' +
    filtered.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

async function handleAddHeater(e) {
  e.preventDefault();
  const form = e.target;
  const data = {
    object_id: parseInt(form.object_id.value),
    premise_id: parseInt(form.premise_id.value),
    name: form.name.value,
    serial: form.serial.value || null,
    power_kw: form.power_kw.value ? parseFloat(form.power_kw.value) : null,
    elements: form.elements.value ? parseInt(form.elements.value) : null,
    manufacture_date: form.manufacture_date.value || null,
    status: form.status.value
  };
  
  try {
    await api('/heaters', { method: 'POST', body: JSON.stringify(data) });
    closeModal();
    showToast('Обогреватель добавлен');
    await loadData();
    renderHeaters();
  } catch (err) {
    showToast(err.message);
  }
}

function showHeaterDetail(id) {
  const heater = heaters.find(h => h.id === id);
  if (!heater) return;
  
  selectedHeater = heater;
  const premise = premises.find(p => p.id === heater.premise_id);
  const obj = objects.find(o => o.id === premise?.object_id);
  
  let html = `
    <div class="modal-header">
      <div class="modal-title">${heater.name}</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    ${heater.photo_url ? `<img src="${heater.photo_url}" class="detail-image">` : ''}
    <div class="detail-grid">
      <div class="detail-item">
        <div class="detail-label">Объект</div>
        <div class="detail-value">${obj?.name || '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Помещение</div>
        <div class="detail-value">${premise?.name || '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Серийник</div>
        <div class="detail-value">${heater.serial || 'Б/Н'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Мощность</div>
        <div class="detail-value">${heater.power_kw ? heater.power_kw + ' кВт' : '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Статус</div>
        <div class="detail-value">${getStatusBadge(heater.status)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Наклейка</div>
        <div class="detail-value">${heater.sticker_number ? `<span class="sticker-number">${heater.sticker_number}</span>` : '—'}</div>
      </div>
    </div>
    <div class="admin-section-title">История</div>
    <div id="heater-events" class="timeline"></div>
  `;
  
  if (currentUser?.role !== 'commander') {
    html += `
      <div style="margin-top:16px;display:flex;gap:8px">
        <button class="btn btn-secondary btn-small" onclick="showEditHeaterModal(${heater.id})">Редактировать</button>
        <button class="btn btn-secondary btn-small" onclick="showHistoryModal(${heater.id})">История</button>
      </div>
    `;
  }
  
  showModal(html);
  loadHeaterEvents(heater.id);
}

async function loadHeaterEvents(heaterId) {
  try {
    const events = await api(`/events?heater_id=${heaterId}&limit=20`);
    const container = $('#heater-events');
    if (!container) return;
    
    if (events.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Нет событий</div></div>';
      return;
    }
    
    container.innerHTML = events.map(e => `
      <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <div class="timeline-date">${formatDate(e.created_at)}</div>
          <div class="timeline-text">${e.comment || e.event_type} <br><small>${e.user_name || 'Система'}</small></div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load events:', err);
  }
}

function showEditHeaterModal(id) {
  const heater = heaters.find(h => h.id === id);
  if (!heater) return;
  
  const premise = premises.find(p => p.id === heater.premise_id);
  const objectsHtml = objects.map(o => 
    `<option value="${o.id}" ${o.id === premise?.object_id ? 'selected' : ''}>${o.name}</option>`
  ).join('');
  
  const premisesHtml = premises
    .filter(p => p.object_id === premise?.object_id)
    .map(p => `<option value="${p.id}" ${p.id === heater.premise_id ? 'selected' : ''}>${p.name}</option>`)
    .join('');
  
  showModal(`
    <div class="modal-header">
      <div class="modal-title">Редактировать</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form onsubmit="handleEditHeater(event, ${id})">
      <div class="input-group">
        <select name="object_id" required onchange="updatePremisesSelect(this.value)">
          <option value="">Объект</option>
          ${objectsHtml}
        </select>
      </div>
      <div class="input-group">
        <select name="premise_id" id="premise-select-edit" required>
          <option value="">Помещение</option>
          ${premisesHtml}
        </select>
      </div>
      <div class="input-group">
        <input type="text" name="name" value="${heater.name}" required>
      </div>
      <div class="input-group">
        <input type="text" name="serial" value="${heater.serial || ''}" placeholder="Серийный номер">
      </div>
      <div class="input-group">
        <input type="number" name="power_kw" value="${heater.power_kw || ''}" placeholder="Мощность (кВт)" step="0.1">
      </div>
      <div class="input-group">
        <select name="status">
          <option value="active" ${heater.status === 'active' ? 'selected' : ''}>Активен</option>
          <option value="repair" ${heater.status === 'repair' ? 'selected' : ''}>В ремонте</option>
          <option value="warehouse" ${heater.status === 'warehouse' ? 'selected' : ''}>На складе</option>
          <option value="moved" ${heater.status === 'moved' ? 'selected' : ''}>Перемещён</option>
        </select>
      </div>
      <button type="submit" class="btn btn-primary">Сохранить</button>
    </form>
  `);
}

async function handleEditHeater(e, id) {
  e.preventDefault();
  const form = e.target;
  const data = {
    premise_id: parseInt(form.premise_id.value),
    name: form.name.value,
    serial: form.serial.value || null,
    power_kw: form.power_kw.value ? parseFloat(form.power_kw.value) : null,
    status: form.status.value
  };
  
  try {
    await api(`/heaters/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    closeModal();
    showToast('Изменения сохранены');
    await loadData();
    renderHeaters();
  } catch (err) {
    showToast(err.message);
  }
}

function showHistoryModal(heaterId) {
  const heater = heaters.find(h => h.id === heaterId);
  showModal(`
    <div class="modal-header">
      <div class="modal-title">История: ${heater?.name}</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div id="history-timeline" class="timeline"></div>
  `);
  loadHeaterEvents(heaterId);
  setTimeout(() => {
    const container = $('#heater-events');
    if (container) {
      const timeline = $('#history-timeline');
      if (timeline && container.innerHTML) {
        timeline.innerHTML = container.innerHTML;
      }
    }
  }, 100);
}

// Admin functions
async function loadAdminData() {
  try {
    const [usersData, objectsData, premisesData] = await Promise.all([
      api('/users'),
      api('/objects'),
      api('/premises')
    ]);

    // Обновляем глобальные массивы
    objects = objectsData;
    premises = premisesData;

    // Render users
    const usersList = $('#users-list');
    if (usersList) {
      usersList.innerHTML = usersData.map(u => `
        <div class="settings-item">
          <span class="settings-item-label">${u.login} (${getRoleName(u.role)})</span>
          <select onchange="updateUserRole(${u.id}, this.value)" ${u.id === currentUser.id ? 'disabled' : ''}>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Админ</option>
            <option value="electrician" ${u.role === 'electrician' ? 'selected' : ''}>Электрик</option>
            <option value="commander" ${u.role === 'commander' ? 'selected' : ''}>Командир</option>
          </select>
        </div>
      `).join('');
    }

    // Render objects
    const objectsList = $('#objects-list');
    if (objectsList) {
      objectsList.innerHTML = objectsData.map(o => `
        <div class="settings-item">
          <span class="settings-item-label">${o.name}${o.code ? ` (${o.code})` : ''}</span>
          <button class="btn btn-danger btn-small" onclick="deleteObject(${o.id})">Удалить</button>
        </div>
      `).join('');
    }

    // Render premises
    const premisesList = $('#premises-list');
    if (premisesList) {
      premisesList.innerHTML = premisesData.map(p => `
        <div class="settings-item">
          <span class="settings-item-label">${p.name} (${p.object_name || '?'})</span>
          <button class="btn btn-danger btn-small" onclick="deletePremise(${p.id})">Удалить</button>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load admin data:', err);
  }
}

function showAddUserModal() {
  showModal(`
    <div class="modal-header">
      <div class="modal-title">Добавить пользователя</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form onsubmit="handleAddUser(event)">
      <div class="input-group">
        <input type="text" name="login" placeholder="Логин" required>
      </div>
      <div class="input-group">
        <input type="password" name="password" placeholder="Пароль" required>
      </div>
      <div class="input-group">
        <select name="role">
          <option value="commander">Командир</option>
          <option value="electrician">Электрик</option>
          <option value="admin">Администратор</option>
        </select>
      </div>
      <button type="submit" class="btn btn-primary">Добавить</button>
    </form>
  `);
}

async function handleAddUser(e) {
  e.preventDefault();
  const form = e.target;
  try {
    await api('/users', {
      method: 'POST',
      body: JSON.stringify({
        login: form.login.value,
        password: form.password.value,
        role: form.role.value
      })
    });
    closeModal();
    showToast('Пользователь добавлен');
    loadAdminData();
  } catch (err) {
    showToast(err.message);
  }
}

async function updateUserRole(id, role) {
  try {
    await api(`/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) });
    showToast('Роль обновлена');
  } catch (err) {
    showToast(err.message);
  }
}

function showAddObjectModal() {
  showModal(`
    <div class="modal-header">
      <div class="modal-title">Добавить объект</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form onsubmit="handleAddObject(event)">
      <div class="input-group">
        <input type="text" name="name" placeholder="Название" required>
      </div>
      <div class="input-group">
        <input type="text" name="code" placeholder="Код">
      </div>
      <button type="submit" class="btn btn-primary">Добавить</button>
    </form>
  `);
}

async function handleAddObject(e) {
  e.preventDefault();
  const form = e.target;
  try {
    await api('/objects', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name.value,
        code: form.code.value || null
      })
    });
    closeModal();
    showToast('Объект добавлен');
    loadAdminData();
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteObject(id) {
  if (!confirm('Удалить объект?')) return;
  try {
    await api(`/objects/${id}`, { method: 'DELETE' });
    showToast('Объект удалён');
    loadAdminData();
  } catch (err) {
    showToast(err.message);
  }
}

async function showAddPremiseModal() {
  // Загружаем объекты если пустые
  if (objects.length === 0) {
    await loadData();
  }
  const objectsHtml = objects.map(o => `<option value="${o.id}">${o.name}</option>`).join('');

  showModal(`
    <div class="modal-header">
      <div class="modal-title">Добавить помещение</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form onsubmit="handleAddPremise(event)">
      <div class="input-group">
        <select name="object_id" required>
          <option value="">Объект</option>
          ${objectsHtml}
        </select>
      </div>
      <div class="input-group">
        <input type="text" name="name" placeholder="Название" required>
      </div>
      <div class="input-group">
        <input type="text" name="number" placeholder="Номер">
      </div>
      <div class="input-group">
        <select name="type">
          <option value="wagon">Вагон</option>
          <option value="room">Помещение</option>
          <option value="building">Здание</option>
        </select>
      </div>
      <button type="submit" class="btn btn-primary">Добавить</button>
    </form>
  `);
}

async function handleAddPremise(e) {
  e.preventDefault();
  const form = e.target;
  try {
    await api('/premises', {
      method: 'POST',
      body: JSON.stringify({
        object_id: parseInt(form.object_id.value),
        name: form.name.value,
        number: form.number.value || null,
        type: form.type.value
      })
    });
    closeModal();
    showToast('Помещение добавлено');
    loadAdminData();
  } catch (err) {
    showToast(err.message);
  }
}

async function deletePremise(id) {
  if (!confirm('Удалить помещение?')) return;
  try {
    await api(`/premises/${id}`, { method: 'DELETE' });
    showToast('Помещение удалено');
    loadAdminData();
  } catch (err) {
    showToast(err.message);
  }
}

// View mode toggle
function toggleViewMode() {
  viewMode = viewMode === 'premises' ? 'list' : 'premises';
  renderHeaters();
}

// Event handlers
async function handleLogin(e) {
  e.preventDefault();
  const form = e.target;
  await login(form.login.value, form.password.value);
}

async function updateSyncStatus() {
  const count = await db.syncQueue.count();
  const el = $('#sync-status');
  if (el) {
    el.textContent = count > 0 ? `В очереди: ${count}` : 'Нет операций';
  }
}

// Initialize
async function init() {
  if (checkAuth()) {
    await loadData();
    setView('heaters');
  } else {
    setView('login');
  }
  
  // Listen for online/offline
  window.addEventListener('online', () => {
    showToast('Онлайн');
    render();
    syncQueue();
  });
  
  window.addEventListener('offline', () => {
    showToast('Офлайн');
    render();
  });
}

init();
