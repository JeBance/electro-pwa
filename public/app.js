// State
let currentUser = null;
let currentView = 'login';
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

// ===== ИНИЦИАЛИЗАЦИЯ =====
async function initApp() {
  Store.init();

  // Записываем лог инициализации
  if (window.AppLogs) AppLogs.info('Приложение запущено');

  // Проверяем авторизацию
  if (checkAuth()) {
    if (window.AppLogs) AppLogs.success(`Пользователь ${currentUser?.login || 'anonymous'} авторизован`);

    // Загружаем из IndexedDB
    await loadLocalData();
    if (window.AppLogs) AppLogs.info('Данные загружены из IndexedDB');

    // Синхронизация отключена — работаем автономно
    if (window.AppLogs) AppLogs.info('Автономный режим (синхронизация отключена)');
  } else {
    if (window.AppLogs) AppLogs.info('Пользователь не авторизован');
  }

  render();
}

// ===== ЗАГРУЗКА ДАННЫХ (всегда из IndexedDB) =====
async function loadLocalData() {
  window.heaters = await Store.refreshHeaters();
  window.premises = await Store.refreshPremises();
  window.objects = await Store.refreshObjects();
  window.users = await Store.refreshUsers();
  await Store.refreshStickers();
  await Store.refreshEvents();
}

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

// ===== NAVIGATION =====
async function setView(view) {
  currentView = view;

  // При переходе на обогреватели — обновляем данные
  if (view === 'heaters') {
    await loadLocalData();
  }

  render();
}

function setBottomNav(view) {
  $$('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });
}

// ===== API ФУНКЦИИ (offline-first) =====
async function api(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  // GET запросы - только из IndexedDB (через Store)
  if (options.method === 'GET') {
    return await apiGet(endpoint);
  }

  // non-GET запросы - запись в IndexedDB + очередь
  return await apiMutate(endpoint, options, headers);
}

async function apiGet(endpoint) {
  // Маршрутизация к Store методам
  if (endpoint.startsWith('/heaters')) {
    return window.heaters || [];
  }
  if (endpoint.startsWith('/premises')) {
    return window.premises || [];
  }
  if (endpoint.startsWith('/objects')) {
    return window.objects || [];
  }
  if (endpoint.startsWith('/users')) {
    return window.users || [];
  }
  if (endpoint.startsWith('/stickers')) {
    return await Store.getAll('stickers');
  }
  if (endpoint.startsWith('/events')) {
    return await Store.getAll('events');
  }
  if (endpoint.startsWith('/my-objects')) {
    return await Store.getAll('userObjects');
  }
  return [];
}

async function apiMutate(endpoint, options, headers) {
  const data = options.body ? JSON.parse(options.body) : null;

  // Добавляем в очередь синхронизации
  await Store.db.syncQueue.add({
    endpoint,
    method: options.method,
    data,
    timestamp: Date.now()
  });

  // Если онлайн - пробуем отправить сразу
  if (navigator.onLine) {
    try {
      const response = await fetch(`${API_BASE}/api${endpoint}`, {
        ...options,
        headers
      });

      if (response.status === 401) {
        logout();
        throw new Error('Unauthorized');
      }

      if (response.status === 204) {
        return { success: true };
      }

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Request failed');

      // Обновляем локальные данные после успешного запроса
      await Store.syncFromServer();

      return result;
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        // Офлайн - операция уже в очереди
        showToast('Офлайн: операция сохранена в очередь');
        return { offline: true };
      }
      throw err;
    }
  }

  showToast('Офлайн: операция сохранена в очередь');
  return { offline: true };
}

// ===== AUTH =====
async function login(loginVal, password) {
  try {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: loginVal, password })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Ошибка входа');
    }

    const data = await res.json();
    localStorage.setItem('token', data.token);
    currentUser = data.user;

    if (window.AppLogs) AppLogs.success(`Пользователь ${data.user.login} вошёл в систему`);

    // Загружаем только локальные данные из IndexedDB
    await loadLocalData();

    showToast('Вход выполнен');
    setView('heaters');
  } catch (err) {
    console.error('[Login] error:', err);
    if (window.AppLogs) AppLogs.error(`Ошибка входа: ${err.message}`);
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
  if (!token) {
    currentUser = null;
    return false;
  }

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp * 1000 < Date.now()) {
      logout();
      return false;
    }
    currentUser = payload;
    return true;
  } catch (err) {
    console.error('[checkAuth] Invalid token:', err);
    logout();
    return false;
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

  window.heaters.forEach(h => {
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

  // Group by known premises
  window.premises.forEach(p => {
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

  // Group heaters with unknown premises (offline-created premises)
  premiseMap.forEach((items, key) => {
    // Skip if already rendered (key is 0 or known premise ID)
    if (key === 0) return;
    const knownPremise = window.premises.find(p => p.id === key);
    if (knownPremise) return;

    // This is an offline-created premise - show with premise_name from heater
    const premiseName = items[0]?.premise_name || 'Помещение #' + key;
    
    html += `
      <div class="card">
        <div class="card-header">
          <div style="flex:1">
            <span class="card-title">${premiseName}</span>
            <span class="card-subtitle">(офлайн)</span>
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
  const heaterId = String(h.id).startsWith('local_') ? `'${h.id}'` : h.id;
  
  // Индикатор синхронизации
  let syncIndicator = '';
  if (h._sync_status === 'pending' || h._modified) {
    syncIndicator = '<span class="sync-indicator pending" title="Ожидает синхронизации">⏳</span>';
  } else if (h._sync_status === 'failed') {
    syncIndicator = '<span class="sync-indicator failed" title="Ошибка синхронизации">❌</span>';
  }
  
  return `
    <div class="list-item" onclick="showHeaterDetail(${heaterId})">
      <div class="list-item-icon">${icon}</div>
      <div class="list-item-content">
        <div class="list-item-title">${sticker}${h.name} ${syncIndicator}</div>
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
              <th>Действия</th>
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
                <td onclick="event.stopPropagation()">
                  <button class="btn btn-danger btn-small" onclick="deleteHeater(${h.id})" title="Удалить">🗑️</button>
                </td>
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

// ===== ЛОГИРОВАНИЕ =====
const AppLogs = {
  logs: [],
  maxLogs: 100,

  add(message, type = 'info') {
    const log = {
      timestamp: new Date().toISOString(),
      message,
      type
    };
    this.logs.unshift(log);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
    console.log(`[${type.toUpperCase()}] ${message}`);
  },

  info(message) {
    this.add(message, 'info');
  },

  success(message) {
    this.add(message, 'success');
  },

  error(message) {
    this.add(message, 'error');
  },

  warn(message) {
    this.add(message, 'warn');
  },

  getLogs() {
    return this.logs;
  },

  clear() {
    this.logs = [];
  },

  render() {
    const typeIcons = {
      info: 'ℹ️',
      success: '✅',
      error: '❌',
      warn: '⚠️'
    };

    const typeColors = {
      info: '#666',
      success: '#4caf50',
      error: '#f44336',
      warn: '#ff9800'
    };

    if (this.logs.length === 0) {
      return `
        <div class="logs-container">
          <div class="logs-header">
            <span>📋 Журнал операций</span>
            <span class="logs-count">0 записей</span>
          </div>
          <div class="empty-state" style="padding: 20px;">
            <div class="empty-state-text">Нет записей</div>
          </div>
        </div>
      `;
    }

    return `
      <div class="logs-container">
        <div class="logs-header">
          <span>📋 Журнал операций</span>
          <span class="logs-count">${this.logs.length} записей</span>
        </div>
        <div class="logs-list">
          ${this.logs.map(log => {
            const date = new Date(log.timestamp);
            const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const icon = typeIcons[log.type] || 'ℹ️';
            const color = typeColors[log.type] || '#666';
            return `
              <div class="log-item log-item-${log.type}">
                <span class="log-icon" style="color: ${color}">${icon}</span>
                <div class="log-content">
                  <div class="log-message">${log.message}</div>
                  <div class="log-time">${timeStr}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        <button class="btn btn-secondary btn-small" onclick="AppLogs.clear(); renderProfile();" style="margin-top: 10px; width: 100%">🗑️ Очистить логи</button>
      </div>
    `;
  }
};

// Глобальный доступ
window.AppLogs = AppLogs;

function renderProfile() {
  const isOnline = navigator.onLine;
  const logs = AppLogs.getLogs();
  const errorCount = logs.filter(l => l.type === 'error').length;
  const pendingCount = logs.filter(l => l.message.includes('ожидает') || l.message.includes('очередь')).length;

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
      ${isOnline ? `
      <div class="settings-item">
        <button class="btn btn-secondary btn-small" onclick="forceSync()">🔄 Синхронизировать</button>
      </div>
      ` : ''}
      <div class="settings-item" onclick="showQueueDetails()" style="cursor: pointer;">
        <span class="settings-item-label">Операций в очереди</span>
        <span style="color: ${pendingCount > 0 ? 'var(--accent-orange)' : 'inherit'}">${pendingCount > 0 ? pendingCount : '—'}</span>
      </div>
      <div class="settings-item">
        <span class="settings-item-label">Ошибок</span>
        <span style="color: ${errorCount > 0 ? '#f44336' : 'inherit'}">${errorCount > 0 ? errorCount : '—'}</span>
      </div>
      <button class="btn btn-danger" onclick="logout()" style="margin-top:20px">Выйти</button>
    </div>
    ${AppLogs.render()}
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

async function showAddHeaterModal() {
  const lastObjectId = localStorage.getItem('last_object_id') || '';
  const lastPremiseId = localStorage.getItem('last_premise_id') || '';

  // Загружаем объекты и помещения из IndexedDB если пустые
  if (window.objects.length === 0 || window.premises.length === 0) {
    await loadLocalData();
  }

  const objectsHtml = window.objects.map(o => `<option value="${o.uuid}" ${o.uuid == lastObjectId ? 'selected' : ''}>${o.name}</option>`).join('');

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
        <select name="premise_id" id="premise-select" onchange="updatePremiseStatus()">
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
        <select name="status" id="status-select" onchange="toggleMoveField(this.value)">
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
  
  // Initialize premise select with current object and last selected premise
  if (lastObjectId) {
    updatePremisesSelect(lastObjectId, lastPremiseId);
  }
  
  // Загружаем следующий номер наклейки
  loadNextStickerNumber();
  
  // Инициализируем поле перемещения
  setTimeout(() => toggleMoveField('active'), 0);
}

async function loadNextStickerNumber() {
  try {
    // Получаем все наклейки из IndexedDB
    const stickers = await Store.db.stickers.toArray();
    
    // Находим максимальный номер
    let maxNum = 0;
    for (const sticker of stickers) {
      const num = parseInt(sticker.number) || 0;
      if (num > maxNum) maxNum = num;
    }
    
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
      const filtered = window.premises.filter(p => !currentObjectId || p.object_id == currentObjectId);
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
      const filtered = window.premises.filter(p => p.id !== currentPremiseId);
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

function updatePremisesSelect(objectId, lastPremiseId = '') {
  const select = document.getElementById('premise-select');
  if (!select) {
    return;
  }

  if (!objectId) {
    select.innerHTML = '<option value="">Сначала выберите объект</option>';
    return;
  }

  // Фильтруем помещения по object_id или object_uuid
  const filtered = window.premises.filter(p => 
    String(p.object_id) === String(objectId) || 
    String(p.object_uuid) === String(objectId)
  );
  let html = '<option value="">Без помещения (на склад)</option>';

  if (filtered.length > 0) {
    html += filtered.map(p => {
      const isSelected = String(p.id) === String(lastPremiseId) || String(p.uuid) === String(lastPremiseId) ? 'selected' : '';
      return `<option value="${p.uuid || p.id}" ${isSelected}>${p.name}</option>`;
    }).join('');
  }

  select.innerHTML = html;

  // Auto-update status based on premise selection
  updatePremiseStatus();
}

// Auto-update status when premise selection changes
function updatePremiseStatus() {
  const premiseSelect = document.getElementById('premise-select');
  const statusSelect = document.getElementById('status-select');
  
  if (premiseSelect && statusSelect) {
    if (!premiseSelect.value) {
      // No premise selected - set status to warehouse
      statusSelect.value = 'warehouse';
    } else {
      // Premise selected - set status to active (if currently warehouse)
      if (statusSelect.value === 'warehouse') {
        statusSelect.value = 'active';
      }
    }
  }
}

async function handleAddHeater(e) {
  e.preventDefault();

  const form = e.target;
  if (!form || form.tagName !== 'FORM') {
    showToast('Ошибка формы');
    return;
  }

  const objectId = form.object_id?.value;
  if (!objectId) {
    showToast('Выберите объект');
    return;
  }

  const name = form.name?.value;
  if (!name || name.trim() === '') {
    showToast('Введите название');
    return;
  }

  const premiseId = form.premise_id?.value ? form.premise_id.value : null;

  localStorage.setItem('last_object_id', objectId);
  if (premiseId) {
    localStorage.setItem('last_premise_id', premiseId);
  }

  let status = form.status?.value || 'active';
  if (!premiseId) {
    status = 'warehouse';
  }
  if (status === 'moved' && form.move_premise_id?.value) {
    form.premise_id.value = form.move_premise_id.value;
  }
  if (status === 'warehouse') {
    form.premise_id.value = '';
  }

  // Находим UUID объекта и помещения
  const selectedObject = window.objects.find(o => String(o.id) === String(objectId) || o.uuid === objectId);
  // Ищем помещение по UUID или ID
  const selectedPremise = premiseId ? window.premises.find(p => 
    String(p.uuid) === String(premiseId) || String(p.id) === String(premiseId)
  ) : null;

  if (!selectedObject) {
    showToast('Ошибка: объект не найден');
    return;
  }

  const heaterData = {
    object_uuid: selectedObject.uuid,
    premise_uuid: selectedPremise?.uuid || null,
    premise_id: selectedPremise?.id ? parseInt(selectedPremise.id) : null, // Сохраняем локальный ID для оффлайн-помещений
    name: name.trim(),
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

  try {
    // Создаём обогреватель через Store (с UUID)
    const result = await Store.create('heaters', heaterData);

    // Создаём наклейку в IndexedDB
    if (heaterData.sticker_number) {
      await Store.db.stickers.add({
        uuid: Store.generateUUIDSync(),
        heater_uuid: result.uuid,
        heater_id: result.id,
        number: heaterData.sticker_number,
        check_date: new Date().toISOString().split('T')[0],
        electrician_id: currentUser?.id,
        electrician_uuid: currentUser?.uuid,
        created_at: new Date().toISOString(),
        _sync_status: 'synced',
        _modified: false
      });
    }

    // Обновляем window.heaters
    window.heaters = await Store.refreshHeaters();

    const modal = document.querySelector('.modal-overlay');
    if (modal) modal.remove();

    render();
    const msg = `Обогреватель "${heaterData.name}" сохранён`;
    if (window.AppLogs) AppLogs.info(msg);
    showToast(msg);
  } catch (err) {
    console.error('[handleAddHeater] error:', err);
    const msg = `Ошибка: ${err.message}`;
    if (window.AppLogs) AppLogs.error(msg);
    showToast(msg);
  }
}

async function showHeaterDetail(id) {
  // Try to find heater in local cache first
  let heater = window.heaters.find(h => h.id === id);

  // If not found in global array, try IndexedDB (for offline-created heaters)
  if (!heater) {
    heater = await Store.db.heaters.get(id);
  }

  // If still not found, try to load from API
  if (!heater && navigator.onLine) {
    try {
      heater = await api(`/heaters/${id}`);
    } catch (err) {
      console.error('Failed to load heater:', err);
      showToast('Ошибка загрузки данных');
      return;
    }
  }

  if (!heater) {
    showToast('Обогреватель не найден');
    return;
  }

  selectedHeater = heater;

  // Find related data (may be null for offline-created heaters)
  const premise = heater.premise_id ? window.premises.find(p => p.id === heater.premise_id) : null;
  const obj = premise?.object_id ? window.objects.find(o => o.id === premise.object_id) : null;

  // Формируем заголовок: Инв. № - Название
  const stickerTitle = heater.sticker_number ? `${heater.sticker_number} - ` : '';

  // Get object name from heater data if not found in cache (for offline heaters)
  const objectName = obj?.name || (heater.object_name || '—');
  const premiseName = premise?.name || (heater.premise_name || (heater.premise_id ? '—' : '—'));

  let html = `
    <div class="modal-header">
      <div class="modal-title">${stickerTitle}${heater.name}</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    ${heater.photo_url ? `<img src="${heater.photo_url}" class="detail-image">` : ''}
    <div class="detail-grid">
      <div class="detail-item">
        <div class="detail-label">Объект</div>
        <div class="detail-value">${objectName}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Помещение</div>
        <div class="detail-value">${premiseName}</div>
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
        <div class="detail-value">${heater.power_w || '—'}</div>
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
  `;

  if (currentUser?.role !== 'commander') {
    const heaterId = String(heater.id).startsWith('local_') ? `'${heater.id}'` : heater.id;
    html += `
      <div style="margin-top:16px;display:flex;gap:8px">
        <button class="btn btn-secondary btn-small" onclick="showEditHeaterModal(${heaterId})">Редактировать</button>
        <button class="btn btn-secondary btn-small" onclick="showHistoryModal(${heaterId})">История</button>
      </div>
    `;
  }

  showModal(html);
}

async function loadHeaterEvents(heaterId) {
  try {
    let events;
    
    // В оффлайн загружаем из IndexedDB
    if (!navigator.onLine) {
      events = await Store.db.events
        .filter(e => String(e.heater_id) === String(heaterId))
        .sortBy('created_at');
      events = events.reverse().slice(0, 20);
    } else {
      // Онлайн — загружаем с сервера
      events = await api(`/events?heater_id=${heaterId}&limit=20`);
    }
    
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

async function deleteHeater(id) {
  if (!confirm('Удалить обогреватель? Данные можно будет восстановить.')) return;
  try {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
    
    const response = await fetch(`/api/heaters/${id}`, {
      method: 'DELETE',
      headers
    });
    
    if (!response.ok && response.status !== 204) {
      const data = await response.json();
      throw new Error(data.error || 'Ошибка удаления');
    }
    
    showToast('Обогреватель удалён');
    await loadLocalData();
    render();
  } catch (err) {
    console.error('Delete heater error:', err);
    showToast(err.message || 'Ошибка при удалении');
  }
}

async function showEditHeaterModal(id) {
  // Try to find heater in local cache first
  let heater = window.heaters.find(h => h.id === id);

  // If not found in global array, try IndexedDB (for offline-created heaters)
  if (!heater) {
    heater = await Store.db.heaters.get(id);
  }

  // If still not found and online, try to load from API
  if (!heater && navigator.onLine) {
    try {
      heater = await api(`/heaters/${id}`);
    } catch (err) {
      console.error('Failed to load heater:', err);
      showToast('Ошибка загрузки данных');
      return;
    }
  }

  if (!heater) {
    showToast('Обогреватель не найден');
    return;
  }

  // Find current premise (may be null for offline-created premises)
  const currentPremise = heater.premise_id ? window.premises.find(p => 
    p.id === heater.premise_id || p.uuid === heater.premise_uuid
  ) : null;

  // Get object_id from heater data or current premise
  const object_id = heater.object_id || heater.object_uuid || currentPremise?.object_id || currentPremise?.object_uuid;

  // Load objects if not available
  if (window.objects.length === 0) {
    await loadLocalData();
  }

  const objectsHtml = window.objects.map(o =>
    `<option value="${o.uuid || o.id}" ${(o.uuid === object_id || o.id === object_id) ? 'selected' : ''}>${o.name}</option>`
  ).join('');

  // Get all premises for this object (or all premises if object not found)
  const availablePremises = object_id
    ? window.premises.filter(p => p.object_id === object_id || p.object_uuid === object_id)
    : window.premises;

  const premisesHtml = availablePremises.map(p =>
    `<option value="${p.uuid || p.id}" ${String(p.uuid) === String(heater.premise_uuid) || String(p.id) === String(heater.premise_id) ? 'selected' : ''}>${p.name}</option>`
  ).join('');

  // Экранируем специальные символы для HTML
  const escapeHtml = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // Форматируем даты для input type="date" (требуется YYYY-MM-DD)
  const formatDateForInput = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
  };

  const manufactureDateInput = formatDateForInput(heater.manufacture_date);
  const decommissionDateInput = formatDateForInput(heater.decommission_date);

  // Дата вывода по умолчанию (+10 лет от даты изготовления)
  let defaultDecommission = decommissionDateInput;
  if (!defaultDecommission && heater.manufacture_date) {
    const date = new Date(heater.manufacture_date);
    date.setFullYear(date.getFullYear() + 10);
    defaultDecommission = date.toISOString().split('T')[0];
  }

  // ID для формы - оборачиваем в кавычки если строка
  const formId = String(id).startsWith('local_') ? `'${id}'` : id;

  showModal(`
    <div class="modal-header">
      <div class="modal-title">Редактировать</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form onsubmit="handleEditHeater(event, ${formId})">
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
        <input type="number" name="power_w" value="${heater.power_w || ''}">
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
        <input type="date" name="manufacture_date" value="${manufactureDateInput}" onchange="updateEditDecommissionDate(this.value)">
      </div>
      <div class="input-group">
        <label>Дата вывода из эксплуатации</label>
        <input type="date" name="decommission_date" value="${defaultDecommission}" id="edit-decommission-date">
      </div>
      <div class="input-group">
        <label>Статус</label>
        <select name="status" onchange="toggleEditMoveField(this.value, ${heater.premise_id || ''})">
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

  const form = e.target.closest('form');

  if (!form) {
    console.error('Form not found');
    return;
  }

  const status = form.status?.value;
  let premiseId = form.premise_id?.value ? form.premise_id.value : null;

  // Если статус "Перемещён", используем новое помещение
  if (status === 'moved' && form.move_premise_id?.value) {
    premiseId = form.move_premise_id.value;
  }

  // Если статус "На складе", убираем помещение
  if (status === 'warehouse') {
    premiseId = null;
  }

  // Находим UUID помещения если оно выбрано
  let premiseUuid = null;
  if (premiseId) {
    const selectedPremise = window.premises.find(p => 
      String(p.uuid) === String(premiseId) || String(p.id) === String(premiseId)
    );
    if (selectedPremise) {
      premiseUuid = selectedPremise.uuid;
      premiseId = selectedPremise.id; // Используем реальный ID
    }
  }

  const data = {
    premise_uuid: premiseUuid,
    premise_id: premiseId ? parseInt(premiseId) : null,
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

  try {
    // Обновляем через Store
    await Store.update('heaters', id, data);

    // Обновляем window.heaters
    window.heaters = await Store.refreshHeaters();

    // Close modal
    const modal = form.closest('.modal-overlay');
    if (modal) {
      modal.remove();
    }

    render();
    showToast('Изменения сохранены');
  } catch (err) {
    console.error('[handleEditHeater] error:', err);
    const msg = `Ошибка: ${err.message}`;
    if (window.AppLogs) AppLogs.error(msg);
    showToast(msg);
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

  const isOnline = navigator.onLine;

  if (!isOnline) {
    // Offline: update local cache immediately
    const premiseIndex = window.premises.findIndex(p => p.id === premiseId);
    if (premiseIndex !== -1) {
      premises[premiseIndex].note = note;
      await Store.db.premises.update(premiseId, { note });
    }
    
    // Queue for sync
    await Store.db.syncQueue.add({
      action: `/premises/${premiseId}/note`,
      endpoint: `/premises/${premiseId}/note`,
      method: 'PUT',
      data: { note },
      timestamp: Date.now()
    });
    
    closeModal();
    render();
    showToast('Заметка сохранена (синхронизация при подключении)');
  } else {
    // Online: normal API call
    try {
      const response = await api(`/premises/${premiseId}/note`, {
        method: 'PUT',
        body: JSON.stringify({ note })
      });

      if (response.offline) {
        closeModal();
        showToast('Заметка сохранена (синхронизация при подключении)');
      } else {
        closeModal();
        showToast('Заметка сохранена');
        await loadLocalData();
        render();
      }
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  }
}

async function deletePremiseNote(premiseId) {
  if (!confirm('Удалить заметку?')) return;

  const isOnline = navigator.onLine;

  if (!isOnline) {
    // Offline: update local cache immediately
    const premiseIndex = window.premises.findIndex(p => p.id === premiseId);
    if (premiseIndex !== -1) {
      premises[premiseIndex].note = null;
      await Store.db.premises.update(premiseId, { note: null });
    }
    
    // Queue for sync
    await Store.db.syncQueue.add({
      action: `/premises/${premiseId}/note`,
      endpoint: `/premises/${premiseId}/note`,
      method: 'DELETE',
      data: null,
      timestamp: Date.now()
    });
    
    closeModal();
    render();
    showToast('Заметка удалена (синхронизация при подключении)');
  } else {
    // Online: normal API call
    try {
      const response = await api(`/premises/${premiseId}/note`, {
        method: 'DELETE',
        silent: true
      });

      if (response.offline) {
        closeModal();
        showToast('Заметка удалена (синхронизация при подключении)');
      } else {
        closeModal();
        showToast('Заметка удалена');
        await loadLocalData();
        render();
      }
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  }
}

async function showHistoryModal(heaterId) {
  // Ищем обогреватель в window.heaters
  let heater = window.heaters.find(h => String(h.id) === String(heaterId));
  
  // Если не найден, ищем в IndexedDB
  if (!heater) {
    heater = await Store.db.heaters.get(heaterId);
  }
  
  showModal(`
    <div class="modal-header">
      <div class="modal-title">История: ${heater?.name || 'Обогреватель'}</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div id="heater-events" class="timeline"></div>
  `);
  await loadHeaterEvents(heaterId);
}

// Admin functions
let showDeleted = false;

async function loadAdminData() {
  try {
    // Используем только локальные данные из IndexedDB
    const usersData = window.users || [];
    const objectsData = window.objects || [];
    const premisesData = window.premises || [];

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
            <button class="btn btn-danger btn-small" onclick="deleteUser(${u.id}, '${u.login}')" title="Удалить">🗑️</button>
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
        await loadLocalData();
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
    // Use cached data (works offline)
    const allObjects = window.objects.length > 0 ? objects : await Store.db.objects.toArray();
    const userObjects = await fetch(`/api/users/${userId}/objects`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    }).then(r => r.ok ? r.json() : []).catch(() => []);

    // Convert to numbers for consistent comparison
    const userObjectIds = new Set(userObjects.map(o => parseInt(o.object_id)));

    let objectsHtml;
    if (allObjects.length === 0) {
      objectsHtml = '<div style="padding:16px 0;color:var(--text-secondary)">Нет объектов</div>';
    } else {
      objectsHtml = allObjects.map(o => {
        const objectId = parseInt(o.id);
        const isChecked = userObjectIds.has(objectId);
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

  try {
    const response = await api(`/users/${userId}/objects`, {
      method: 'PUT',
      body: JSON.stringify({ object_ids: objectIds }),
      silent: true  // Silent for background sync
    });

    if (response.offline) {
      closeModal();
      showToast('Права доступа сохранены (синхронизация при подключении)');
    } else {
      closeModal();
      showToast('Права доступа обновлены');
      await loadAdminData();
    }
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
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
    
    const response = await fetch('/api/users', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        login: form.login.value,
        password: form.password.value,
        role: form.role.value
      })
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Ошибка добавления');
    }
    
    closeModal();
    showToast('Пользователь добавлен');
    await loadAdminData();
  } catch (err) {
    console.error('[handleAddUser] error:', err);
    showToast(err.message);
  }
}

async function updateUserRole(id, role) {
  try {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
    
    const response = await fetch(`/api/users/${id}/role`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ role })
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Ошибка обновления');
    }
    
    showToast('Роль обновлена');
    await loadAdminData();
  } catch (err) {
    console.error('[updateUserRole] error:', err);
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
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
    
    const response = await fetch(`/api/users/${userId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Ошибка обновления');
    }
    
    closeModal();
    showToast('Пользователь обновлён');
    await loadAdminData();
  } catch (err) {
    console.error('[handleEditUser] error:', err);
    showToast(err.message);
  }
}

async function deleteUser(id, login) {
  if (!confirm(`Удалить пользователя "${login}"? Это действие нельзя отменить.`)) return;
  try {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
    
    const response = await fetch(`/api/users/${id}`, {
      method: 'DELETE',
      headers
    });
    
    if (!response.ok && response.status !== 204) {
      const data = await response.json();
      throw new Error(data.error || 'Ошибка удаления');
    }
    
    showToast('Пользователь удалён');
    await loadAdminData();
  } catch (err) {
    console.error('Delete user error:', err);
    showToast(err.message || 'Ошибка при удалении');
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

  const objectData = {
    name: form.name.value,
    code: form.code.value || null
  };

  try {
    // Создаём через Store (с UUID)
    await Store.create('objects', objectData);

    // Обновляем window.objects
    window.objects = await Store.refreshObjects();

    closeModal();
    render();
    const msg = `Объект "${objectData.name}" сохранён`;
    if (window.AppLogs) AppLogs.info(msg);
    showToast(msg);
  } catch (err) {
    const msg = `Ошибка: ${err.message}`;
    if (window.AppLogs) AppLogs.error(msg);
    showToast(msg);
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

  const objectData = {
    name: form.name.value,
    code: form.code.value || null
  };

  try {
    // Обновляем через Store
    await Store.update('objects', objectId, objectData);

    // Обновляем window.objects
    window.objects = await Store.refreshObjects();

    closeModal();
    render();
    showToast('Объект обновлён');
  } catch (err) {
    const msg = `Ошибка: ${err.message}`;
    if (window.AppLogs) AppLogs.error(msg);
    showToast(msg);
  }
}

async function deleteObject(id) {
  if (!confirm('Удалить объект? Данные можно будет восстановить.')) return;
  try {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
    
    const response = await fetch(`/api/objects/${id}`, {
      method: 'DELETE',
      headers
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Ошибка ${response.status}`);
    }
    
    showToast('Объект удалён');
    await loadAdminData();
  } catch (err) {
    console.error('Delete object error:', err);
    showToast(err.message || 'Ошибка при удалении');
  }
}

async function restoreObject(id) {
  try {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
    
    const response = await fetch(`/api/objects/${id}/restore`, {
      method: 'POST',
      headers
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Ошибка восстановления');
    }
    
    showToast('Объект восстановлен');
    await loadAdminData();
  } catch (err) {
    console.error('Restore object error:', err);
    showToast(err.message);
  }
}

async function showAddPremiseModal() {
  // Загружаем объекты если пустые
  if (window.objects.length === 0) {
    await loadLocalData();
  }
  const lastObjectId = localStorage.getItem('last_object_id') || '';
  const objectsHtml = window.objects.map(o => `<option value="${o.uuid}" ${o.uuid == lastObjectId ? 'selected' : ''}>${o.name}</option>`).join('');

  showModal(`
    <div class="modal-header">
      <div class="modal-title">Добавить помещение</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form onsubmit="handleAddPremise(event)">
      <div class="input-group">
        <select name="object_id" required onchange="localStorage.setItem('last_object_id', this.value)">
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

  const objectId = form.object_id.value;

  // Find object in array or IndexedDB (for offline-created objects)
  let selectedObject = window.objects.find(o => o.id === objectId || o.uuid === objectId);
  if (!selectedObject) {
    selectedObject = await Store.db.objects.get(objectId);
  }

  const premiseData = {
    object_uuid: selectedObject?.uuid || objectId,
    name: form.name.value,
    number: form.number.value || null,
    type: form.type.value
  };

  // Сохраняем последний выбранный объект
  localStorage.setItem('last_object_id', premiseData.object_uuid);

  try {
    // Создаём через Store (с UUID)
    await Store.create('premises', premiseData);

    // Обновляем window.premises
    window.premises = await Store.refreshPremises();

    closeModal();
    render();
    const msg = `Помещение "${premiseData.name}" сохранено`;
    if (window.AppLogs) AppLogs.info(msg);
    showToast(msg);
  } catch (err) {
    const msg = `Ошибка: ${err.message}`;
    if (window.AppLogs) AppLogs.error(msg);
    showToast(msg);
  }
}

function showEditPremiseModal(premiseId, name, number, type, objectId) {
  // Load objects if not available
  if (window.objects.length === 0) {
    loadLocalData();
  }
  
  const objectsHtml = window.objects.map(o => 
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

  const premiseData = {
    object_uuid: form.object_id.value,
    name: form.name.value,
    number: form.number.value || null,
    type: form.type.value
  };

  try {
    // Обновляем через Store
    await Store.update('premises', premiseId, premiseData);

    // Обновляем window.premises
    window.premises = await Store.refreshPremises();

    closeModal();
    render();
    showToast('Помещение обновлено');
  } catch (err) {
    const msg = `Ошибка: ${err.message}`;
    if (window.AppLogs) AppLogs.error(msg);
    showToast(msg);
  }
}

async function deletePremise(id) {
  if (!confirm('Удалить помещение? Данные можно будет восстановить.')) return;
  try {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
    
    const response = await fetch(`/api/premises/${id}`, {
      method: 'DELETE',
      headers
    });
    
    if (!response.ok && response.status !== 204) {
      const data = await response.json();
      throw new Error(data.error || 'Ошибка удаления');
    }
    
    showToast('Помещение удалено');
    await loadAdminData();
  } catch (err) {
    console.error('Delete premise error:', err);
    showToast(err.message || 'Ошибка при удалении');
  }
}

async function restorePremise(id) {
  try {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
    
    const response = await fetch(`/api/premises/${id}/restore`, {
      method: 'POST',
      headers
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Ошибка восстановления');
    }
    
    showToast('Помещение восстановлено');
    await loadAdminData();
  } catch (err) {
    console.error('Restore premise error:', err);
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
  const isOnline = navigator.onLine;
  const el = $('#sync-status');
  if (el) {
    // Get pending records count from all tables
    const tables = ['heaters', 'premises', 'objects'];
    let pendingCount = 0;
    
    for (const table of tables) {
      const pending = await Store.getPending(table);
      pendingCount += pending.length;
    }

    if (!isOnline) {
      el.textContent = pendingCount > 0
        ? `🔴 Офлайн (${pendingCount} ожидает)`
        : '🔴 Офлайн';
    } else {
      el.textContent = pendingCount > 0
        ? `🟡 Синхронизация (${pendingCount})`
        : '🟢 Онлайн';
    }
  }
}

// Initialize - offline first
async function init() {
  // Initialize sync manager
  if (typeof SyncManager !== 'undefined') {
    SyncManager.init();
  }

  if (checkAuth()) {
    // Load data from cache first (works offline)
    await loadLocalData();
    await setView('heaters');
  } else {
    await setView('login');
  }

  // Listen for online/offline
  window.addEventListener('online', () => {
    showToast('🟢 Онлайн');
    render();
    SyncManager.sync();  // Sync any pending operations
    updateSyncStatus();
    // Refresh data from server
    loadLocalData();
  });

  window.addEventListener('offline', () => {
    showToast('🔴 Офлайн');
    render();
    updateSyncStatus();
  });
}

// ===== ИНИЦИАЛИЗАЦИЯ =====
initApp();
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
window.forceSync = forceSync;
window.showEditHeaterModal = showEditHeaterModal;
window.showHistoryModal = showHistoryModal;
window.showQueueDetails = showQueueDetails;
window.clearQueueAndData = clearQueueAndData;

// Force sync function (for manual trigger)
async function forceSync() {
  await SyncManager.sync();
  updateSyncStatus();
}

// Показать детали очереди синхронизации
async function showQueueDetails() {
  // Получаем все pending записи из всех таблиц
  const tables = ['heaters', 'premises', 'objects'];
  const pending = [];
  
  for (const table of tables) {
    const items = await Store.getPending(table);
    pending.push(...items.map(item => ({ ...item, _table: table })));
  }
  
  if (pending.length === 0) {
    showToast('Очередь пуста');
    return;
  }
  
  const html = `
    <div class="modal-header">
      <div class="modal-title">📦 Ожидает синхронизации (${pending.length})</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div style="max-height: 400px; overflow-y: auto;">
      ${pending.map((item) => {
        const statusColors = { pending: '#ff9800', failed: '#f44336' };
        const statusIcons = { pending: '⏳', failed: '❌' };
        const status = item._sync_status || 'pending';
        return `
          <div style="padding: 10px; margin: 5px 0; background: var(--bg-tertiary); border-radius: 8px; border-left: 3px solid ${statusColors[status] || '#666'};">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 600;">${statusIcons[status] || '•'} ${item._table}</span>
              <span style="font-size: 11px; color: var(--text-secondary);">${item.uuid?.substring(0, 8)}...</span>
            </div>
            <div style="font-size: 13px; margin-top: 4px;">${item.name || 'Без названия'}</div>
            ${item._sync_error ? `<div style="font-size: 11px; color: #f44336; margin-top: 4px;">${item._sync_error}</div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
    <div style="margin-top: 15px; display: flex; gap: 10px;">
      <button class="btn btn-secondary btn-small" onclick="closeModal()" style="flex: 1">Закрыть</button>
      <button class="btn btn-danger btn-small" onclick="clearQueueAndData()" style="flex: 1">🗑️ Сброс данных</button>
    </div>
  `;
  
  showModal(html);
}

// Сброс локальных данных (для тестирования)
async function clearQueueAndData() {
  if (!confirm('⚠️ Внимание!\n\nЭто удалит:\n- Все локальные данные (обогреватели, объекты, помещения)\n\nДанные на сервере НЕ будут затронуты.\n\nПродолжить?')) {
    return;
  }

  try {
    // Очищаем все таблицы
    await Store.db.heaters.clear();
    await Store.db.premises.clear();
    await Store.db.objects.clear();
    await Store.db.stickers.clear();
    await Store.db.events.clear();
    await Store.db.syncState.clear();

    // Перезагружаем данные
    await loadLocalData();

    AppLogs.success('Данные очищены');
    showToast('Данные очищены. Перезагрузите страницу.');
    closeModal();
    render();
  } catch (err) {
    AppLogs.error(`Ошибка сброса: ${err.message}`);
    showToast(`Ошибка: ${err.message}`);
  }
}
