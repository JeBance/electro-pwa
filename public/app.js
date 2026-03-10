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
async function setView(view) {
  currentView = view;
  // При переходе на обогреватели — обновляем данные
  if (view === 'heaters') {
    await loadData();
  }
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
    // Handle 204 No Content (DELETE success)
    if (res.status === 204) {
      return { success: true };
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
  const warehouseHeaters = [];
  
  heaters.forEach(h => {
    if (h.status === 'warehouse') {
      warehouseHeaters.push(h);
    } else {
      const key = h.premise_id || 0;
      if (!premiseMap.has(key)) premiseMap.set(key, []);
      premiseMap.get(key).push(h);
    }
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
    
    const hasNote = p.note && p.note.trim() !== '';
    const notePreview = hasNote ? p.note.substring(0, 50) + (p.note.length > 50 ? '...' : '') : '';

    html += `
      <div class="card">
        <div class="card-header">
          <div style="flex:1">
            <span class="card-title">${p.name}</span>
            <span class="card-subtitle">${p.number || ''}</span>
            ${hasNote ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:4px">📝 ${notePreview}</div>` : ''}
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-secondary btn-small" onclick="showPremiseNoteModal(${p.id}, '${p.name.replace(/'/g, "\\'")}', '${p.note ? p.note.replace(/'/g, "\\'") : ''}')" title="Заметка">📝</button>
          </div>
        </div>
        ${items.map(h => renderHeaterItem(h)).join('')}
      </div>
    `;
  });

  // Warehouse block
  if (warehouseHeaters.length > 0) {
    html += `
      <div class="card">
        <div class="card-header">
          <span class="card-title">📦 Склад</span>
          <span class="card-subtitle">${warehouseHeaters.length} шт.</span>
        </div>
        ${warehouseHeaters.map(h => renderHeaterItem(h)).join('')}
      </div>
    `;
  }

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

function getHeaterIcon(protectionType) {
  const icons = {
    'Конвектор': '⚡',
    'Радиатор масляный': '💧',
    'Тепловая завеса': '🌪️',
    'Тепловая пушка': '🌬️'
  };
  return icons[protectionType] || '🔥';
}

function renderHeaterItem(h) {
  const sticker = h.sticker_number ? `<span class="sticker-number">${h.sticker_number}</span> ` : '';
  const icon = getHeaterIcon(h.protection_type);
  return `
    <div class="list-item" onclick="showHeaterDetail(${h.id})">
      <div class="list-item-icon">${icon}</div>
      <div class="list-item-content">
        <div class="list-item-title">${sticker}${h.name}</div>
        <div class="list-item-subtitle">${h.serial || 'Б/Н'} • ${h.power_w ? h.power_w + ' Вт' : ''}</div>
      </div>
      ${getStatusBadge(h.status)}
    </div>
  `;
}

function toggleSort(field) {
  if (sortField === field) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortField = field;
    sortDir = 'asc';
  }
  render();
}

function setFilter(status) {
  filterStatus = status || '';
  render();
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
      (h.serial && h.serial.toLowerCase().includes(q)) ||
      (h.sticker_number && h.sticker_number.toLowerCase().includes(q))
    );
  }

  filtered.sort((a, b) => {
    let aVal = a[sortField] || '';
    let bVal = b[sortField] || '';
    // Handle premise_name from joined data
    if (sortField === 'premise_name') {
      aVal = a.premise_name || '';
      bVal = b.premise_name || '';
    }
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const sortIcon = (field) => sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  let html = `
    <div class="search-box">
      <input type="text" placeholder="Поиск по названию, серийнику, наклейке..." value="${searchQuery}" oninput="searchQuery = this.value; render()">
    </div>
    <div class="filters">
      <div class="filter-chip ${!filterStatus ? 'active' : ''}" onclick="setFilter('')">Все</div>
      <div class="filter-chip ${filterStatus === 'active' ? 'active' : ''}" onclick="setFilter('active')">🟢 Активные</div>
      <div class="filter-chip ${filterStatus === 'repair' ? 'active' : ''}" onclick="setFilter('repair')">🟡 Ремонт</div>
      <div class="filter-chip ${filterStatus === 'warehouse' ? 'active' : ''}" onclick="setFilter('warehouse')">🔵 Склад</div>
    </div>
  `;

  if (filtered.length === 0) {
    html += `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <div class="empty-state-text">Ничего не найдено</div>
      </div>
    `;
  } else {
    html += `
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th onclick="toggleSort('sticker_number')">Инв. №${sortIcon('sticker_number')}</th>
              <th onclick="toggleSort('premise_name')">Помещение${sortIcon('premise_name')}</th>
              <th onclick="toggleSort('name')">Наименование${sortIcon('name')}</th>
              <th onclick="toggleSort('serial')">Зав. №${sortIcon('serial')}</th>
              <th onclick="toggleSort('voltage_v')">U, В${sortIcon('voltage_v')}</th>
              <th onclick="toggleSort('power_w')">P, Вт${sortIcon('power_w')}</th>
              <th onclick="toggleSort('heating_element')">Нагреватель${sortIcon('heating_element')}</th>
              <th onclick="toggleSort('protection_type')">Исполнение${sortIcon('protection_type')}</th>
              <th onclick="toggleSort('manufacture_date')">Дата изг.${sortIcon('manufacture_date')}</th>
              <th onclick="toggleSort('decommission_date')">Дата вывода${sortIcon('decommission_date')}</th>
              <th onclick="toggleSort('last_modified')">Изменён${sortIcon('last_modified')}</th>
              <th onclick="toggleSort('status')">Статус${sortIcon('status')}</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(h => `
              <tr onclick="showHeaterDetail(${h.id})" style="cursor:pointer">
                <td>${h.sticker_number ? `<span class="sticker-number">${h.sticker_number}</span>` : '—'}</td>
                <td>${h.premise_name || '—'}</td>
                <td>${h.name}</td>
                <td>${h.serial || 'Б/Н'}</td>
                <td>${h.voltage_v || '—'}</td>
                <td>${h.power_w ? h.power_w : (h.power_kw ? Math.round(h.power_kw * 1000) : '—')}</td>
                <td>${h.heating_element || '—'}</td>
                <td>${h.protection_type || '—'}</td>
                <td>${formatDate(h.manufacture_date)}</td>
                <td>${formatDate(h.decommission_date)}</td>
                <td>${formatDate(h.last_modified)}</td>
                <td>${getStatusBadge(h.status)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
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
      <div class="admin-section-title">База данных</div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="btn btn-secondary btn-small" onclick="exportDatabase()">📥 Экспорт БД</button>
        <button class="btn btn-secondary btn-small" onclick="showImportModal()">📤 Импорт БД</button>
        <button class="btn btn-secondary btn-small" onclick="toggleShowDeleted()">
          ${showDeleted ? '👁️ Скрыть удалённые' : '👁️ Показать удалённые'}
        </button>
      </div>
    </div>
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
      <div class="nav-item ${currentView === 'heaters' ? 'active' : ''}" data-view="heaters" onclick="setView('heaters'); return false;">
        <span class="nav-icon">🔥</span>
        <span>Обогреватели</span>
      </div>
      ${currentUser.role === 'admin' ? `
        <div class="nav-item ${currentView === 'admin' ? 'active' : ''}" data-view="admin" onclick="setView('admin'); return false;">
          <span class="nav-icon">⚙️</span>
          <span>Админка</span>
        </div>
      ` : ''}
      <div class="nav-item ${currentView === 'profile' ? 'active' : ''}" data-view="profile" onclick="setView('profile'); return false;">
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
  const lastObjectId = localStorage.getItem('last_object_id') || '';
  const objectsHtml = objects.map(o => `<option value="${o.id}" ${o.id == lastObjectId ? 'selected' : ''}>${o.name}</option>`).join('');

  // Дата вывода по умолчанию (+10 лет от текущей даты)
  const defaultDecommission = new Date();
  defaultDecommission.setFullYear(defaultDecommission.getFullYear() + 10);
  const defaultDecommissionStr = defaultDecommission.toISOString().split('T')[0];

  showModal(`
    <div class="modal-header">
      <div class="modal-title">Добавить обогреватель</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form onsubmit="handleAddHeater(event)">
      <div class="input-group">
        <label>Объект</label>
        <select name="object_id" required onchange="localStorage.setItem('last_object_id', this.value); updatePremisesSelect(this.value)">
          <option value="">Выберите объект</option>
          ${objectsHtml}
        </select>
      </div>
      <div class="input-group">
        <label>Помещение (место установки)</label>
        <select name="premise_id" id="premise-select">
          <option value="">Без помещения (на склад)</option>
        </select>
      </div>
      <div class="input-group">
        <label>Марка, наименование (тип)</label>
        <input type="text" name="name" placeholder="Например: ОБП-1200" required>
      </div>
      <div class="input-group">
        <label>Заводской №</label>
        <input type="text" name="serial" placeholder="Серийный номер">
      </div>
      <div class="input-group">
        <label>Инв. № (наклейка)</label>
        <input type="text" name="sticker_number" placeholder="Авто" id="sticker-number-input">
      </div>
      <div class="input-group">
        <label>Напряжение, В</label>
        <input type="number" name="voltage_v" value="220">
      </div>
      <div class="input-group">
        <label>Мощность, Вт</label>
        <input type="number" name="power_w" placeholder="1200" step="1">
      </div>
      <div class="input-group">
        <label>Нагревательный элемент</label>
        <input type="text" name="heating_element" value="ТЭН">
      </div>
      <div class="input-group">
        <label>Исполнение (тип защиты)</label>
        <select name="protection_type">
          <option value="Конвектор">Конвектор</option>
          <option value="Радиатор масляный">Радиатор масляный</option>
          <option value="Тепловая завеса">Тепловая завеса</option>
          <option value="Тепловая пушка">Тепловая пушка</option>
        </select>
      </div>
      <div class="input-group">
        <label>Дата изготовления</label>
        <input type="date" name="manufacture_date" onchange="updateDecommissionDate(this.value)">
      </div>
      <div class="input-group">
        <label>Дата вывода из эксплуатации</label>
        <input type="date" name="decommission_date" value="${defaultDecommissionStr}" id="decommission-date">
      </div>
      <div class="input-group">
        <label>Статус</label>
        <select name="status" onchange="toggleMoveField(this.value)">
          <option value="active">Активен</option>
          <option value="repair">В ремонте</option>
          <option value="warehouse">На складе</option>
          <option value="moved">Перемещён</option>
        </select>
      </div>
      <div class="input-group" id="move-premise-group" style="display:none">
        <label>Новое помещение</label>
        <select name="move_premise_id" id="move-premise-select">
          <option value="">Выберите помещение</option>
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
  
  // Загружаем следующий номер наклейки
  loadNextStickerNumber();
  
  // Инициализируем поле перемещения
  setTimeout(() => toggleMoveField('active'), 0);
}

async function loadNextStickerNumber() {
  try {
    const stickers = await api('/stickers');
    const maxNum = stickers.reduce((max, s) => {
      const num = parseInt(s.number) || 0;
      return num > max ? num : max;
    }, 0);
    const nextNum = String(maxNum + 1).padStart(3, '0');
    const input = $('#sticker-number-input');
    if (input) {
      input.value = nextNum;
      input.placeholder = nextNum;
    }
  } catch (err) {
    console.error('Failed to load sticker number:', err);
  }
}

function toggleMoveField(status) {
  const group = $('#move-premise-group');
  const select = $('#move-premise-select');
  if (group && select) {
    if (status === 'moved') {
      group.style.display = 'block';
      select.required = true;
      // Заполняем список помещений
      const currentObjectId = localStorage.getItem('last_object_id');
      const filtered = premises.filter(p => !currentObjectId || p.object_id == currentObjectId);
      select.innerHTML = '<option value="">Выберите помещение</option>' +
        filtered.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    } else {
      group.style.display = 'none';
      select.required = false;
      select.value = '';
    }
  }
}

function toggleEditMoveField(status, currentPremiseId) {
  const group = $('#edit-move-premise-group');
  const select = $('#edit-move-premise-select');
  if (group && select) {
    if (status === 'moved') {
      group.style.display = 'block';
      select.required = true;
      // Не показываем текущее помещение в списке
      const filtered = premises.filter(p => p.id !== currentPremiseId);
      select.innerHTML = '<option value="">Выберите помещение</option>' +
        filtered.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    } else {
      group.style.display = 'none';
      select.required = false;
      select.value = '';
    }
  }
}

function updateDecommissionDate(manufactureDate) {
  if (!manufactureDate) return;
  const date = new Date(manufactureDate);
  date.setFullYear(date.getFullYear() + 10);
  const decommissionInput = $('#decommission-date');
  if (decommissionInput) {
    decommissionInput.value = date.toISOString().split('T')[0];
  }
}

function updateEditDecommissionDate(manufactureDate) {
  if (!manufactureDate) return;
  const date = new Date(manufactureDate);
  date.setFullYear(date.getFullYear() + 10);
  const decommissionInput = $('#edit-decommission-date');
  if (decommissionInput) {
    decommissionInput.value = date.toISOString().split('T')[0];
  }
}

function updatePremisesSelect(objectId) {
  const select = $('#premise-select');
  if (!select) return;
  
  const filtered = premises.filter(p => p.object_id == objectId);
  select.innerHTML = '<option value="">Без помещения (на склад)</option>' +
    filtered.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

async function handleAddHeater(e) {
  e.preventDefault();
  e.stopPropagation();
  
  console.log('handleAddHeater called');
  
  const form = e.currentTarget || e.target;
  console.log('Form element:', form);
  
  if (!form) {
    console.error('Form not found');
    return;
  }
  
  const objectId = parseInt(form.object_id?.value);
  
  if (!objectId) {
    showToast('Ошибка: выберите объект');
    return;
  }
  
  // Сохраняем последний выбранный объект
  localStorage.setItem('last_object_id', objectId);

  const status = form.status?.value;
  let premiseId = form.premise_id?.value ? parseInt(form.premise_id.value) : null;

  // Если статус "Перемещён", используем новое помещение
  if (status === 'moved' && form.move_premise_id?.value) {
    premiseId = parseInt(form.move_premise_id.value);
  }
  
  // Если статус "На складе", убираем помещение
  if (status === 'warehouse') {
    premiseId = null;
  }

  const data = {
    object_id: objectId,
    premise_id: premiseId,
    name: form.name?.value,
    serial: form.serial?.value || null,
    sticker_number: form.sticker_number?.value || null,
    voltage_v: parseInt(form.voltage_v?.value) || 220,
    power_w: form.power_w?.value ? parseInt(form.power_w.value) : null,
    heating_element: form.heating_element?.value || 'ТЭН',
    protection_type: form.protection_type?.value || 'Конвектор',
    manufacture_date: form.manufacture_date?.value || null,
    decommission_date: form.decommission_date?.value || null,
    status: status
  };

  console.log('Creating heater:', data);

  try {
    const response = await api('/heaters', { method: 'POST', body: JSON.stringify(data) });
    console.log('Create response:', response);
    
    // Close modal immediately after successful save
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
      modal.remove();
      console.log('Modal removed');
    }
    
    // Refresh data
    await loadData();
    render();
    
    showToast('Обогреватель добавлен');
  } catch (err) {
    console.error('Create error:', err);
    showToast('Ошибка: ' + err.message);
  }
}

function showHeaterDetail(id) {
  const heater = heaters.find(h => h.id === id);
  if (!heater) return;

  selectedHeater = heater;
  const premise = premises.find(p => p.id === heater.premise_id);
  const obj = objects.find(o => o.id === premise?.object_id);
  
  // Формируем заголовок: Инв. № - Название
  const stickerTitle = heater.sticker_number ? `${heater.sticker_number} - ` : '';

  let html = `
    <div class="modal-header">
      <div class="modal-title">${stickerTitle}${heater.name}</div>
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
        <div class="detail-label">Инв. №</div>
        <div class="detail-value">${heater.sticker_number ? `<span class="sticker-number">${heater.sticker_number}</span>` : '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Зав. №</div>
        <div class="detail-value">${heater.serial || '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Напряжение, В</div>
        <div class="detail-value">${heater.voltage_v || '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Мощность, Вт</div>
        <div class="detail-value">${heater.power_w || (heater.power_kw ? Math.round(heater.power_kw * 1000) : '—')}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Нагревательный элемент</div>
        <div class="detail-value">${heater.heating_element || '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Исполнение</div>
        <div class="detail-value">${heater.protection_type || '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Дата изготовления</div>
        <div class="detail-value">${formatDate(heater.manufacture_date)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Дата вывода</div>
        <div class="detail-value">${formatDate(heater.decommission_date)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Статус</div>
        <div class="detail-value">${getStatusBadge(heater.status)}</div>
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
          <div class="timeline-text">${e.comment || ''}<br><small>${e.user_name || 'Система'}</small></div>
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

  // Дата вывода по умолчанию (+10 лет от даты изготовления)
  let defaultDecommission = '';
  if (heater.manufacture_date) {
    const date = new Date(heater.manufacture_date);
    date.setFullYear(date.getFullYear() + 10);
    defaultDecommission = date.toISOString().split('T')[0];
  }

  showModal(`
    <div class="modal-header">
      <div class="modal-title">Редактировать</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form onsubmit="handleEditHeater(event, ${id})">
      <div class="input-group">
        <label>Объект</label>
        <select name="object_id" required onchange="localStorage.setItem('last_object_id', this.value); updatePremisesSelect(this.value)">
          <option value="">Объект</option>
          ${objectsHtml}
        </select>
      </div>
      <div class="input-group">
        <label>Помещение</label>
        <select name="premise_id" id="premise-select-edit">
          <option value="">Без помещения (на склад)</option>
          ${premisesHtml}
        </select>
      </div>
      <div class="input-group">
        <label>Марка, наименование</label>
        <input type="text" name="name" value="${heater.name}" required>
      </div>
      <div class="input-group">
        <label>Заводской №</label>
        <input type="text" name="serial" value="${heater.serial || ''}">
      </div>
      <div class="input-group">
        <label>Напряжение, В</label>
        <input type="number" name="voltage_v" value="${heater.voltage_v || 220}">
      </div>
      <div class="input-group">
        <label>Мощность, Вт</label>
        <input type="number" name="power_w" value="${heater.power_w || (heater.power_kw ? Math.round(heater.power_kw * 1000) : '')}">
      </div>
      <div class="input-group">
        <label>Нагревательный элемент</label>
        <input type="text" name="heating_element" value="${heater.heating_element || 'ТЭН'}">
      </div>
      <div class="input-group">
        <label>Исполнение (тип защиты)</label>
        <select name="protection_type">
          <option value="Конвектор" ${heater.protection_type === 'Конвектор' ? 'selected' : ''}>Конвектор</option>
          <option value="Радиатор масляный" ${heater.protection_type === 'Радиатор масляный' ? 'selected' : ''}>Радиатор масляный</option>
          <option value="Тепловая завеса" ${heater.protection_type === 'Тепловая завеса' ? 'selected' : ''}>Тепловая завеса</option>
          <option value="Тепловая пушка" ${heater.protection_type === 'Тепловая пушка' ? 'selected' : ''}>Тепловая пушка</option>
        </select>
      </div>
      <div class="input-group">
        <label>Дата изготовления</label>
        <input type="date" name="manufacture_date" value="${heater.manufacture_date || ''}" onchange="updateEditDecommissionDate(this.value)">
      </div>
      <div class="input-group">
        <label>Дата вывода из эксплуатации</label>
        <input type="date" name="decommission_date" value="${heater.decommission_date || defaultDecommission}" id="edit-decommission-date">
      </div>
      <div class="input-group">
        <label>Статус</label>
        <select name="status" onchange="toggleEditMoveField(this.value, ${heater.premise_id})">
          <option value="active" ${heater.status === 'active' ? 'selected' : ''}>Активен</option>
          <option value="repair" ${heater.status === 'repair' ? 'selected' : ''}>В ремонте</option>
          <option value="warehouse" ${heater.status === 'warehouse' ? 'selected' : ''}>На складе</option>
          <option value="moved" ${heater.status === 'moved' ? 'selected' : ''}>Перемещён</option>
        </select>
      </div>
      <div class="input-group" id="edit-move-premise-group" style="display:none">
        <label>Новое помещение</label>
        <select name="move_premise_id" id="edit-move-premise-select">
          <option value="">Выберите помещение</option>
          ${premisesHtml}
        </select>
      </div>
      <button type="submit" class="btn btn-primary">Сохранить</button>
    </form>
  `);
  
  // Показываем поле перемещения если статус уже "moved"
  if (heater.status === 'moved') {
    setTimeout(() => toggleEditMoveField('moved', heater.premise_id), 0);
  }
}

async function handleEditHeater(e, id) {
  e.preventDefault();
  e.stopPropagation();

  console.log('handleEditHeater called with id:', id);
  
  const form = e.currentTarget || e.target;
  console.log('Form element:', form);
  
  if (!form) {
    console.error('Form not found');
    return;
  }
  
  const status = form.status?.value;
  let premiseId = form.premise_id?.value ? parseInt(form.premise_id.value) : null;

  // Если статус "Перемещён", используем новое помещение
  if (status === 'moved' && form.move_premise_id?.value) {
    premiseId = parseInt(form.move_premise_id.value);
  }

  // Если статус "На складе", убираем помещение
  if (status === 'warehouse') {
    premiseId = null;
  }

  const data = {
    premise_id: premiseId,
    name: form.name?.value,
    serial: form.serial?.value || null,
    voltage_v: parseInt(form.voltage_v?.value) || 220,
    power_w: form.power_w?.value ? parseInt(form.power_w.value) : null,
    heating_element: form.heating_element?.value || 'ТЭН',
    protection_type: form.protection_type?.value,
    manufacture_date: form.manufacture_date?.value || null,
    decommission_date: form.decommission_date?.value || null,
    status: status
  };

  console.log('Saving heater:', id, data);

  try {
    const response = await api(`/heaters/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });

    console.log('Save response:', response);
    
    // Close modal immediately after successful save
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
      modal.remove();
      console.log('Modal removed');
    }
    
    // Refresh data
    await loadData();
    render();
    
    showToast('Изменения сохранены');
  } catch (err) {
    console.error('Save error:', err);
    showToast('Ошибка: ' + err.message);
  }
}

function showPremiseNoteModal(premiseId, premiseName, currentNote) {
  showModal(`
    <div class="modal-header">
      <div class="modal-title">Заметка: ${premiseName}</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="input-group">
      <textarea name="note" rows="5" placeholder="Введите заметку..." style="width:100%;padding:12px;background:var(--input-bg);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:14px;resize:vertical">${currentNote || ''}</textarea>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-primary" onclick="savePremiseNote(${premiseId})" style="flex:1">Сохранить</button>
      ${currentNote ? `<button class="btn btn-danger" onclick="deletePremiseNote(${premiseId})" style="flex:1">Удалить</button>` : ''}
    </div>
  `);
}

async function savePremiseNote(premiseId) {
  const modal = document.querySelector('.modal-overlay');
  const textarea = modal?.querySelector('textarea[name="note"]');
  const note = textarea?.value || '';

  try {
    await api(`/premises/${premiseId}/note`, {
      method: 'PUT',
      body: JSON.stringify({ note })
    });

    closeModal();
    showToast('Заметка сохранена');
    await loadData();
    render();
  } catch (err) {
    showToast('Ошибка: ' + err.message);
  }
}

async function deletePremiseNote(premiseId) {
  if (!confirm('Удалить заметку?')) return;

  try {
    await api(`/premises/${premiseId}/note`, {
      method: 'DELETE'
    });

    closeModal();
    showToast('Заметка удалена');
    await loadData();
    render();
  } catch (err) {
    showToast('Ошибка: ' + err.message);
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
let showDeleted = false;

async function loadAdminData() {
  try {
    const [usersData, objectsData, premisesData] = await Promise.all([
      api('/users'),
      api(`/objects?include_deleted=${showDeleted}`),
      api(`/premises?include_deleted=${showDeleted}`)
    ]);

    // Обновляем глобальные массивы
    objects = objectsData;
    premises = premisesData;

    // Render users
    const usersList = $('#users-list');
    if (usersList) {
      usersList.innerHTML = usersData.map(u => `
        <div class="settings-item">
          <div style="flex:1">
            <div class="settings-item-label">${u.login} (${getRoleName(u.role)})</div>
            ${u.role !== 'admin' ? `<button class="btn btn-secondary btn-small" onclick="showUserObjectsModal(${u.id}, '${u.login}')" style="margin-top:4px">👁️ Объекты</button>` : ''}
          </div>
          <div style="display:flex;gap:4px;align-items:center">
            <button class="btn btn-secondary btn-small" onclick="showEditUserModal(${u.id}, '${u.login}', '${u.role}')" title="Редактировать">✏️</button>
            <select onchange="updateUserRole(${u.id}, this.value)" ${u.id === currentUser.id ? 'disabled' : ''}>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Админ</option>
              <option value="electrician" ${u.role === 'electrician' ? 'selected' : ''}>Электрик</option>
              <option value="commander" ${u.role === 'commander' ? 'selected' : ''}>Командир</option>
            </select>
          </div>
        </div>
      `).join('');
    }

    // Render objects
    const objectsList = $('#objects-list');
    if (objectsList) {
      objectsList.innerHTML = objectsData.map(o => `
        <div class="settings-item">
          <span class="settings-item-label">${o.name}${o.code ? ` (${o.code})` : ''}${o.deleted_at ? ' <span class="badge badge-repair">Удалён</span>' : ''}</span>
          <div style="display:flex;gap:4px">
            ${o.deleted_at ? `<button class="btn btn-secondary btn-small" onclick="restoreObject(${o.id})">Восстановить</button>` : `<button class="btn btn-secondary btn-small" onclick="showEditObjectModal(${o.id}, '${o.name.replace(/'/g, "\\'")}', '${o.code ? o.code.replace(/'/g, "\\'") : ''}')" title="Редактировать">✏️</button>`}
            <button class="btn btn-danger btn-small" onclick="deleteObject(${o.id})">${o.deleted_at ? '×' : 'Удалить'}</button>
          </div>
        </div>
      `).join('');
    }

    // Render premises
    const premisesList = $('#premises-list');
    if (premisesList) {
      premisesList.innerHTML = premisesData.map(p => `
        <div class="settings-item">
          <span class="settings-item-label">${p.name} (${p.object_name || '?'})${p.deleted_at ? ' <span class="badge badge-repair">Удалён</span>' : ''}</span>
          <div style="display:flex;gap:4px">
            ${p.deleted_at ? `<button class="btn btn-secondary btn-small" onclick="restorePremise(${p.id})">Восстановить</button>` : `<button class="btn btn-secondary btn-small" onclick="showEditPremiseModal(${p.id}, '${p.name.replace(/'/g, "\\'")}', '${p.number ? p.number.replace(/'/g, "\\'") : ''}', '${p.type}', ${p.object_id})" title="Редактировать">✏️</button>`}
            <button class="btn btn-danger btn-small" onclick="deletePremise(${p.id})">${p.deleted_at ? '×' : 'Удалить'}</button>
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load admin data:', err);
  }
}

function toggleShowDeleted() {
  showDeleted = !showDeleted;
  loadAdminData();
}

async function exportDatabase() {
  try {
    const data = await api('/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `electro-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Экспорт выполнен');
  } catch (err) {
    showToast(err.message);
  }
}

function showImportModal() {
  showModal(`
    <div class="modal-header">
      <div class="modal-title">Импорт базы данных</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div style="padding:20px 0">
      <p style="margin-bottom:16px;color:var(--text-secondary)">Загрузите JSON файл с данными экспорта</p>
      <input type="file" id="import-file" accept=".json,application/json" style="width:100%;padding:12px;background:var(--input-bg);border:1px solid var(--border);border-radius:8px;color:var(--text-primary)">
      <button class="btn btn-primary" onclick="handleImport()" style="margin-top:16px">Импортировать</button>
    </div>
  `);
}

async function handleImport() {
  const fileInput = $('#import-file');
  const file = fileInput.files[0];
  if (!file) {
    showToast('Выберите файл');
    return;
  }
  
  try {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const response = await api('/import', {
          method: 'POST',
          body: JSON.stringify(data)
        });
        closeModal();
        showToast(`Импорт выполнен: ${Object.entries(response.imported).map(([k,v]) => `${k}: ${v}`).join(', ')}`);
        await loadData();
        await loadAdminData();
      } catch (err) {
        showToast('Ошибка импорта: ' + err.message);
      }
    };
    reader.readAsText(file);
  } catch (err) {
    showToast('Ошибка чтения файла: ' + err.message);
  }
}

async function showUserObjectsModal(userId, userName) {
  try {
    const [allObjects, userObjects] = await Promise.all([
      api('/objects'),
      api(`/users/${userId}/objects`)
    ]);

    console.log('All objects:', allObjects);
    console.log('User objects:', userObjects);

    // Convert to numbers for consistent comparison
    const userObjectIds = new Set(userObjects.map(o => parseInt(o.object_id)));

    console.log('User object IDs:', Array.from(userObjectIds));

    let objectsHtml;
    if (allObjects.length === 0) {
      objectsHtml = '<div style="padding:16px 0;color:var(--text-secondary)">Нет объектов</div>';
    } else {
      objectsHtml = allObjects.map(o => {
        const objectId = parseInt(o.id);
        const isChecked = userObjectIds.has(objectId);
        console.log(`Object ${o.id} (${o.name}): ${isChecked ? 'checked' : 'unchecked'}`);
        return `
          <label style="display:flex;align-items:center;gap:8px;padding:8px 0">
            <input type="checkbox" name="object_${o.id}" ${isChecked ? 'checked' : ''} value="${o.id}">
            ${o.name}${o.code ? ` (${o.code})` : ''}
          </label>
        `;
      }).join('');
    }

    showModal(`
      <div class="modal-header">
        <div class="modal-title">Объекты: ${userName}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div style="padding:16px 0;max-height:400px;overflow-y:auto">
        ${objectsHtml}
      </div>
      <button class="btn btn-primary" onclick="saveUserObjects(${userId})">Сохранить</button>
    `);
  } catch (err) {
    console.error('showUserObjectsModal error:', err);
    showToast('Ошибка: ' + err.message);
  }
}

async function saveUserObjects(userId) {
  const modal = $('.modal-overlay');
  if (!modal) {
    showToast('Ошибка: модальное окно не найдено');
    return;
  }
  
  const checkboxes = modal.querySelectorAll('input[type="checkbox"]:checked');
  const objectIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

  console.log('Saving user objects:', { userId, objectIds });

  try {
    const response = await api(`/users/${userId}/objects`, {
      method: 'PUT',
      body: JSON.stringify({ object_ids: objectIds })
    });
    
    console.log('Save response:', response);
    
    closeModal();
    showToast('Права доступа обновлены');
    await loadAdminData();
  } catch (err) {
    console.error('saveUserObjects error:', err);
    showToast('Ошибка: ' + err.message);
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
    await loadAdminData();
  } catch (err) {
    showToast(err.message);
  }
}

function showEditUserModal(userId, login, role) {
  showModal(`
    <div class="modal-header">
      <div class="modal-title">Редактировать: ${login}</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form onsubmit="handleEditUser(event, ${userId})">
      <div class="input-group">
        <label>Логин</label>
        <input type="text" name="login" value="${login}" required>
      </div>
      <div class="input-group">
        <label>Новый пароль (оставьте пустым, чтобы не менять)</label>
        <input type="password" name="password" placeholder="••••••••">
      </div>
      <div class="input-group">
        <label>Роль</label>
        <select name="role">
          <option value="admin" ${role === 'admin' ? 'selected' : ''}>Администратор</option>
          <option value="electrician" ${role === 'electrician' ? 'selected' : ''}>Электрик</option>
          <option value="commander" ${role === 'commander' ? 'selected' : ''}>Командир</option>
        </select>
      </div>
      <button type="submit" class="btn btn-primary">Сохранить</button>
    </form>
  `);
}

async function handleEditUser(e, userId) {
  e.preventDefault();
  const form = e.target;
  const data = {
    role: form.role.value
  };
  
  if (form.password.value) {
    data.password = form.password.value;
  }
  
  try {
    await api(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
    closeModal();
    showToast('Пользователь обновлён');
    await loadAdminData();
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

function showEditObjectModal(objectId, name, code) {
  showModal(`
    <div class="modal-header">
      <div class="modal-title">Редактировать объект</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form onsubmit="handleEditObject(event, ${objectId})">
      <div class="input-group">
        <label>Название</label>
        <input type="text" name="name" value="${name}" required>
      </div>
      <div class="input-group">
        <label>Код</label>
        <input type="text" name="code" value="${code}">
      </div>
      <button type="submit" class="btn btn-primary">Сохранить</button>
    </form>
  `);
}

async function handleEditObject(e, objectId) {
  e.preventDefault();
  const form = e.target;
  try {
    await api(`/objects/${objectId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: form.name.value,
        code: form.code.value || null
      })
    });
    closeModal();
    showToast('Объект обновлён');
    loadAdminData();
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteObject(id) {
  if (!confirm('Удалить объект? Данные можно будет восстановить.')) return;
  try {
    const response = await api(`/objects/${id}`, { method: 'DELETE' });
    if (response.offline) {
      showToast('Офлайн: операция сохранена в очередь');
    } else {
      showToast('Объект удалён');
    }
    await loadAdminData();
  } catch (err) {
    console.error('Delete object error:', err);
    showToast(err.message || 'Ошибка при удалении');
  }
}

async function restoreObject(id) {
  try {
    await api(`/objects/${id}/restore`, { method: 'POST' });
    showToast('Объект восстановлен');
    await loadAdminData();
  } catch (err) {
    showToast(err.message);
  }
}

async function showAddPremiseModal() {
  // Загружаем объекты если пустые
  if (objects.length === 0) {
    await loadData();
  }
  const lastObjectId = localStorage.getItem('last_object_id') || '';
  const objectsHtml = objects.map(o => `<option value="${o.id}" ${o.id == lastObjectId ? 'selected' : ''}>${o.name}</option>`).join('');

  showModal(`
    <div class="modal-header">
      <div class="modal-title">Добавить помещение</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form onsubmit="handleAddPremise(event)">
      <div class="input-group">
        <select name="object_id" required onchange="localStorage.setItem('last_object_id', this.value); updatePremisesSelect(this.value)">
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
    const objectId = parseInt(form.object_id.value);
    // Сохраняем последний выбранный объект
    localStorage.setItem('last_object_id', objectId);

    await api('/premises', {
      method: 'POST',
      body: JSON.stringify({
        object_id: objectId,
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

function showEditPremiseModal(premiseId, name, number, type, objectId) {
  const objectsHtml = objects.map(o => 
    `<option value="${o.id}" ${o.id == objectId ? 'selected' : ''}>${o.name}</option>`
  ).join('');

  showModal(`
    <div class="modal-header">
      <div class="modal-title">Редактировать помещение</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form onsubmit="handleEditPremise(event, ${premiseId})">
      <div class="input-group">
        <label>Объект</label>
        <select name="object_id" required>
          <option value="">Выберите объект</option>
          ${objectsHtml}
        </select>
      </div>
      <div class="input-group">
        <label>Название</label>
        <input type="text" name="name" value="${name}" required>
      </div>
      <div class="input-group">
        <label>Номер</label>
        <input type="text" name="number" value="${number}">
      </div>
      <div class="input-group">
        <label>Тип</label>
        <select name="type">
          <option value="wagon" ${type === 'wagon' ? 'selected' : ''}>Вагон</option>
          <option value="room" ${type === 'room' ? 'selected' : ''}>Помещение</option>
          <option value="building" ${type === 'building' ? 'selected' : ''}>Здание</option>
        </select>
      </div>
      <button type="submit" class="btn btn-primary">Сохранить</button>
    </form>
  `);
}

async function handleEditPremise(e, premiseId) {
  e.preventDefault();
  const form = e.target;
  try {
    await api(`/premises/${premiseId}`, {
      method: 'PUT',
      body: JSON.stringify({
        object_id: parseInt(form.object_id.value),
        name: form.name.value,
        number: form.number.value || null,
        type: form.type.value
      })
    });
    closeModal();
    showToast('Помещение обновлено');
    loadAdminData();
  } catch (err) {
    showToast(err.message);
  }
}

async function deletePremise(id) {
  if (!confirm('Удалить помещение? Данные можно будет восстановить.')) return;
  try {
    await api(`/premises/${id}`, { method: 'DELETE' });
    showToast('Помещение удалено');
    await loadAdminData();
  } catch (err) {
    showToast(err.message);
  }
}

async function restorePremise(id) {
  try {
    await api(`/premises/${id}/restore`, { method: 'POST' });
    showToast('Помещение восстановлено');
    await loadAdminData();
  } catch (err) {
    showToast(err.message);
  }
}

// View mode toggle
function toggleViewMode() {
  viewMode = viewMode === 'premises' ? 'list' : 'premises';
  // Обновляем переключатель
  const toggle = $('.toggle');
  if (toggle) {
    toggle.classList.toggle('active', viewMode === 'list');
  }
  // Обновляем контент
  const content = $('.content');
  if (content) {
    content.innerHTML = renderHeaters();
  }
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
    await setView('heaters');
  } else {
    await setView('login');
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

// Make functions globally accessible for onclick handlers
window.showUserObjectsModal = showUserObjectsModal;
window.saveUserObjects = saveUserObjects;
window.toggleSort = toggleSort;
window.setFilter = setFilter;
window.renderHeaters = renderHeaters;
window.handleEditHeater = handleEditHeater;
window.handleAddHeater = handleAddHeater;
window.showPremiseNoteModal = showPremiseNoteModal;
window.savePremiseNote = savePremiseNote;
window.deletePremiseNote = deletePremiseNote;
window.showEditUserModal = showEditUserModal;
window.handleEditUser = handleEditUser;
window.showEditObjectModal = showEditObjectModal;
window.handleEditObject = handleEditObject;
window.showEditPremiseModal = showEditPremiseModal;
window.handleEditPremise = handleEditPremise;
