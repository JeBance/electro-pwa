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
let premiseSortField = 'name'; // 'name', 'number', 'object_name', 'last_modified'
let premiseSortDir = 'asc';

// API base URL
const API_BASE = '';

// ===== ИНИЦИАЛИЗАЦИЯ =====
async function initApp() {
  Store.init();
  SyncManager.init();

  // Записываем лог инициализации
  if (window.AppLogs) AppLogs.info('Приложение запущено');

  // Проверяем авторизацию (теперь асинхронно)
  const isAuth = await checkAuth();
  if (isAuth) {
    if (window.AppLogs) AppLogs.success(`Пользователь ${currentUser?.login || 'anonymous'} авторизован`);

    // Загружаем данные с сервера в IndexedDB
    await loadLocalData();
    if (window.AppLogs) AppLogs.info('Данные загружены из IndexedDB');

    // Если онлайн — синхронизируем с сервером
    if (navigator.onLine) {
      if (window.AppLogs) AppLogs.info('Онлайн — загрузка данных с сервера...');
      await SyncManager.sync();
    } else {
      if (window.AppLogs) AppLogs.warn('Офлайн — работаем с локальными данными');
    }
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

// ===== API ФУНКЦИИ =====
// Прямой fetch к серверу (используется только для логина и редких операций)
async function api(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

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

  return result;
}

// ===== AUTH =====
async function login(loginVal, password) {
  try {
    // Сначала пробуем войти через сервер
    let data;
    let isOfflineLogin = false;

    if (navigator.onLine) {
      try {
        const res = await fetch(`${API_BASE}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: loginVal, password })
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || 'Ошибка входа');
        }

        data = await res.json();
      } catch (fetchErr) {
        // Если ошибка сети — пробуем оффлайн-вход
        if (navigator.onLine === false || fetchErr.message.includes('fetch') || fetchErr.message.includes('NetworkError')) {
          console.log('[Login] Network error, trying offline login');
          isOfflineLogin = true;
        } else {
          throw fetchErr;
        }
      }
    } else {
      // Офлайн — пробуем войти по кэшированным учётным данным
      isOfflineLogin = true;
    }

    // Оффлайн-вход по кэшированным учётным данным
    if (isOfflineLogin) {
      const cachedCreds = await Auth.getCachedCredentials();
      if (!cachedCreds) {
        throw new Error('Офлайн-вход невозможен: нет кэшированных учётных данных');
      }

      // Проверяем совпадение учётных данных
      if (cachedCreds.login !== loginVal || cachedCreds.password !== password) {
        throw new Error('Неверный логин или пароль (офлайн-режим)');
      }

      // Получаем кэшированного пользователя
      const cachedUser = await Auth.getCachedUser();
      if (!cachedUser) {
        throw new Error('Офлайн-вход невозможен: нет кэшированных данных пользователя');
      }

      data = {
        token: localStorage.getItem('token') || 'offline-token',
        user: cachedUser
      };

      console.log('[Login] Offline login successful for:', cachedUser.login);
      if (window.AppLogs) AppLogs.success(`Офлайн-вход: ${cachedUser.login}`);
    }

    // Сохраняем токен и пользователя
    localStorage.setItem('token', data.token);
    currentUser = data.user;

    // Кэшируем учётные данные и пользователя для будущего оффлайн-входа
    await Auth.cacheCredentials(loginVal, password);
    await Auth.cacheUser(data.user);

    if (window.AppLogs) AppLogs.success(`Пользователь ${data.user.login} вошёл в систему`);

    // Загружаем данные с сервера в IndexedDB
    await loadLocalData();

    // Синхронизируем с сервером (отправляем очередь и получаем обновления)
    if (navigator.onLine && !isOfflineLogin) {
      await SyncManager.sync();
    } else if (isOfflineLogin) {
      if (window.AppLogs) AppLogs.info('Вход выполнен в оффлайн-режиме');
      showToast('Вход выполнен (офлайн)');
    }

    if (!isOfflineLogin) {
      showToast('Вход выполнен');
    }

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
  // Очищаем кэшированные учётные данные при выходе
  Auth.clearCachedCredentials();
  Auth.clearCachedUser();
  setView('login');
}

async function checkAuth() {
  const token = localStorage.getItem('token');
  if (!token) {
    // Пробуем восстановить из кэша
    const cachedUser = await Auth.getCachedUser();
    if (cachedUser) {
      currentUser = cachedUser;
      console.log('[checkAuth] Restored from cached user');
      return true;
    }
    currentUser = null;
    return false;
  }

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp * 1000 < Date.now()) {
      // Токен истёк — пробуем использовать кэшированного пользователя
      const cachedUser = await Auth.getCachedUser();
      if (cachedUser) {
        currentUser = cachedUser;
        console.log('[checkAuth] Token expired, using cached user');
        return true;
      }
      logout();
      return false;
    }
    currentUser = payload;
    // Кэшируем пользователя для оффлайн-доступа
    await Auth.cacheUser(payload);
    return true;
  } catch (err) {
    console.error('[checkAuth] Invalid token:', err);
    // При ошибке токена пробуем кэшированного пользователя
    const cachedUser = await Auth.getCachedUser();
    if (cachedUser) {
      currentUser = cachedUser;
      console.log('[checkAuth] Invalid token, using cached user');
      return true;
    }
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
          <button class="print-btn" onclick="showPrintFormsModal()" title="Печать форм">
            🖨️ Печать
          </button>
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
      // Используем premise_uuid для группировки (или premise_id если uuid нет)
      const key = h.premise_uuid || h.premise_id || 0;
      if (!premiseMap.has(key)) premiseMap.set(key, []);
      premiseMap.get(key).push(h);
    }
  });

  // Сортируем помещения
  const sortedPremises = [...window.premises].sort((a, b) => {
    let aVal, bVal;
    
    if (premiseSortField === 'name') {
      aVal = a.name || '';
      bVal = b.name || '';
    } else if (premiseSortField === 'number') {
      aVal = a.number || '';
      bVal = b.number || '';
    } else if (premiseSortField === 'object_name') {
      aVal = a.object_name || '';
      bVal = b.object_name || '';
    } else if (premiseSortField === 'last_modified') {
      // Получаем последнее изменение из обогревателей этого помещения
      const premiseHeaters = premiseMap.get(a.uuid) || premiseMap.get(a.id) || [];
      const aLastMod = premiseHeaters.length > 0 
        ? Math.max(...premiseHeaters.map(h => new Date(h.last_modified || h.created_at).getTime()))
        : 0;
      const bHeaters = premiseMap.get(b.uuid) || premiseMap.get(b.id) || [];
      const bLastMod = bHeaters.length > 0 
        ? Math.max(...bHeaters.map(h => new Date(h.last_modified || h.created_at).getTime()))
        : 0;
      return premiseSortDir === 'asc' ? aLastMod - bLastMod : bLastMod - aLastMod;
    }
    
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    
    if (aVal < bVal) return premiseSortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return premiseSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  let html = '';
  
  // Панель сортировки
  const sortDirText = premiseSortDir === 'asc' ? ' (по возр.)' : ' (по убыв.)';
  html += `
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
      <span style="font-size:12px;color:var(--text-secondary)">Сортировка вагонов:</span>
      <select class="sort-select" onchange="setPremiseSort(this.value)">
        <option value="name"${premiseSortField === 'name' ? ' selected' : ''}>По названию${premiseSortField === 'name' ? sortDirText : ''}</option>
        <option value="number"${premiseSortField === 'number' ? ' selected' : ''}>По номеру${premiseSortField === 'number' ? sortDirText : ''}</option>
        <option value="object_name"${premiseSortField === 'object_name' ? ' selected' : ''}>По объекту${premiseSortField === 'object_name' ? sortDirText : ''}</option>
        <option value="last_modified"${premiseSortField === 'last_modified' ? ' selected' : ''}>По изменению${premiseSortField === 'last_modified' ? sortDirText : ''}</option>
      </select>
      <button class="btn btn-secondary btn-small" onclick="togglePremiseSortDir()" title="Поменять направление">${premiseSortDir === 'asc' ? '↑' : '↓'}</button>
    </div>
  `;

  // Group without premise
  const noPremise = premiseMap.get(0) || [];
  if (noPremise.length > 0) {
    html += `<div class="card">
      <div class="card-header"><span class="card-title">Без помещения</span></div>
      ${noPremise.map(h => renderHeaterItem(h)).join('')}
    </div>`;
  }

  // Group by sorted premises
  sortedPremises.forEach(p => {
    // Ищем обогреватели по UUID или ID помещения
    const items = premiseMap.get(p.uuid) || premiseMap.get(p.id) || [];
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
          <button class="btn btn-secondary btn-small" onclick="showPremiseNoteModal(${p.id}, '${p.name.replace(/'/g, "\\'")}', '${p.note ? p.note.replace(/'/g, "\\'") : ''}')" title="Заметка">📝</button>
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

  // Индикатор синхронизации - показываем только если _sync_status === 'pending' или 'failed'
  // _modified не показываем, так как это технический флаг
  let syncIndicator = '';
  if (h._sync_status === 'pending') {
    syncIndicator = '<span class="sync-indicator pending" title="Ожидает синхронизации">⏳</span>';
  } else if (h._sync_status === 'failed') {
    syncIndicator = '<span class="sync-indicator failed" title="Ошибка синхронизации">❌</span>';
  }

  // Кнопка удаления для админа
  const deleteButton = currentUser?.role === 'admin' ? `
    <button class="btn btn-danger btn-small" onclick="event.stopPropagation(); deleteHeater(${heaterId})" title="Удалить" style="margin-right:8px">🗑️</button>
  ` : '';

  return `
    <div class="list-item" onclick="showHeaterDetail(${heaterId})">
      <div class="list-item-icon">${icon}</div>
      <div class="list-item-content">
        <div class="list-item-title">${sticker}${h.name} ${syncIndicator}</div>
        <div class="list-item-subtitle">${h.serial || 'Б/Н'} • ${h.power_w ? h.power_w + ' Вт' : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${deleteButton}
        ${getStatusBadge(h.status)}
      </div>
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

function setPremiseSort(field) {
  if (premiseSortField === field) {
    premiseSortDir = premiseSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    premiseSortField = field;
    premiseSortDir = 'asc';
  }
  render();
}

function togglePremiseSortDir() {
  premiseSortDir = premiseSortDir === 'asc' ? 'desc' : 'asc';
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
            ${filtered.map(h => {
              const deleteBtn = currentUser?.role === 'admin' 
                ? `<button class="btn btn-danger btn-small" onclick="event.stopPropagation(); deleteHeater(${h.id})" title="Удалить">🗑️</button>`
                : '';
              return `
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
                <td onclick="event.stopPropagation()">${deleteBtn}</td>
              </tr>
            `}).join('')}
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
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-small" onclick="exportDatabase()">📥 Экспорт БД</button>
        <button class="btn btn-secondary btn-small" onclick="showImportModal()">📤 Импорт БД</button>
        <button class="btn btn-secondary btn-small" onclick="toggleShowDeleted()">
          ${showDeleted ? '👁️ Скрыть удалённые' : '👁️ Показать удалённые'}
        </button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <button class="btn btn-danger btn-small" onclick="clearIndexedDB()">🗑️ Очистить IndexedDB</button>
        <button class="btn btn-danger btn-small" onclick="clearServerDatabase()">🗑️ Очистить БД на сервере</button>
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
  const modals = $$('.modal-overlay');
  if (modals.length > 0) {
    // Закрываем последнее открытое модальное окно
    modals[modals.length - 1].remove();
  }
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
      // Не показываем текущее помещение в списке и сортируем по алфавиту с учётом чисел
      const filtered = window.premises
        .filter(p => p.id !== currentPremiseId)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru', { numeric: true, sensitivity: 'base' }));
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

  // Фильтруем помещения по object_id или object_uuid и сортируем по алфавиту с учётом чисел
  const filtered = window.premises.filter(p =>
    String(p.object_id) === String(objectId) ||
    String(p.object_uuid) === String(objectId)
  ).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru', { numeric: true, sensitivity: 'base' }));
  
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

    // Создаём событие о создании обогревателя
    await Store.db.events.add({
      uuid: Store.generateUUIDSync(),
      heater_uuid: result.uuid,
      heater_id: result.id,
      user_uuid: currentUser?.uuid,
      user_id: currentUser?.id,
      event_type: 'status_change',
      from_premise_uuid: null,
      from_premise_id: null,
      to_premise_uuid: heaterData.premise_uuid,
      to_premise_id: heaterData.premise_id,
      old_status: null,
      new_status: heaterData.status,
      comment: `Обогреватель "${heaterData.name}" создан`,
      created_at: new Date().toISOString(),
      _sync_status: 'pending',
      _modified: true
    });

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
        _sync_status: 'pending',
        _modified: true
      });
    }

    // Обновляем ВСЕ данные
    await loadLocalData();

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
    
    // Кнопки для изменения статуса
    const statusButtons = `
      <div style="margin-top:16px">
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">Изменить статус:</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-small ${heater.status === 'active' ? 'btn-primary' : 'btn-secondary'}" onclick="changeHeaterStatus(${heaterId}, 'active')">🟢 Активен</button>
          <button class="btn btn-small ${heater.status === 'repair' ? 'btn-primary' : 'btn-secondary'}" onclick="changeHeaterStatus(${heaterId}, 'repair')">🟡 Ремонт</button>
          <button class="btn btn-small ${heater.status === 'warehouse' ? 'btn-primary' : 'btn-secondary'}" onclick="changeHeaterStatus(${heaterId}, 'warehouse')">🔵 Склад</button>
        </div>
      </div>
    `;
    
    html += `
      ${statusButtons}
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
    let isOnline = navigator.onLine;

    // Сначала пробуем загрузить с сервера
    if (isOnline) {
      try {
        events = await api(`/events?heater_id=${heaterId}&limit=20`);
      } catch (err) {
        // Если ошибка сети, переключаемся в оффлайн-режим
        console.log('[loadHeaterEvents] API error, using offline mode:', err.message);
        isOnline = false;
      }
    }

    // В оффлайн загружаем из IndexedDB
    if (!isOnline) {
      const allEvents = await Store.db.events.toArray();
      // Ищем события по heater_id или heater_uuid
      events = allEvents.filter(e =>
        String(e.heater_id) === String(heaterId) || e.heater_uuid === heaterId
      );
      events = events.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20);
    }

    const container = $('#heater-events');
    if (!container) return;

    if (events.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Нет событий</div></div>';
      return;
    }

    // Для оффлайн-режима загружаем помещения для поиска названий
    let premisesMap = new Map();
    if (!isOnline) {
      const allPremises = await Store.db.premises.toArray();
      allPremises.forEach(p => {
        premisesMap.set(String(p.id), p.name);
        premisesMap.set(String(p.uuid), p.name);
      });
    }

    container.innerHTML = events.map(e => {
      // Формируем текст о перемещении
      let moveText = '';
      // Проверяем оба типа событий: premise_change (перемещение) и status_change со сменой помещения
      if ((e.event_type === 'premise_change' || e.event_type === 'status_change') &&
          (e.from_premise_id !== e.to_premise_id || e.from_premise_uuid !== e.to_premise_uuid)) {
        // В онлайн-режиме используем названия с сервера, в оффлайн - ищем локально
        let fromName = e.from_premise_name;
        let toName = e.to_premise_name;

        if (!isOnline || !fromName) {
          fromName = premisesMap.get(String(e.from_premise_id)) || premisesMap.get(String(e.from_premise_uuid)) || 'без помещения';
        }
        if (!isOnline || !toName) {
          toName = premisesMap.get(String(e.to_premise_id)) || premisesMap.get(String(e.to_premise_uuid)) || 'без помещения';
        }

        moveText = `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px">📍 ${fromName} → ${toName}</div>`;
      }

      return `
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-content">
            <div class="timeline-date">${formatDate(e.created_at)}</div>
            <div class="timeline-text">${e.comment || ''}${moveText}<br><small>${e.user_name || 'Система'}</small></div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load events:', err);
  }
}

async function deleteHeater(id) {
  if (!confirm('Удалить обогреватель? Данные можно будет восстановить.')) return;
  try {
    // Получаем данные обогревателя перед удалением
    const existingHeater = window.heaters.find(h => h.id === id || h.uuid === id);
    
    // Soft delete в IndexedDB
    await Store.update('heaters', id, { deleted_at: new Date().toISOString() });

    // Создаём событие об удалении обогревателя
    if (existingHeater) {
      await Store.db.events.add({
        uuid: Store.generateUUIDSync(),
        heater_uuid: existingHeater.uuid,
        heater_id: id,
        user_uuid: currentUser?.uuid,
        user_id: currentUser?.id,
        event_type: 'status_change',
        from_premise_uuid: existingHeater.premise_uuid,
        from_premise_id: existingHeater.premise_id,
        to_premise_uuid: null,
        to_premise_id: null,
        old_status: existingHeater.status,
        new_status: 'deleted',
        comment: `Обогреватель "${existingHeater.name}" удалён`,
        created_at: new Date().toISOString(),
        _sync_status: 'pending',
        _modified: true
      });
    }

    // Обновляем ВСЕ данные
    await loadLocalData();

    render();
    showToast('Обогреватель удалён');
  } catch (err) {
    console.error('Delete heater error:', err);
    const msg = `Ошибка: ${err.message}`;
    if (window.AppLogs) AppLogs.error(msg);
    showToast(msg);
  }
}

async function showEditHeaterModal(id) {
  // Try to find heater in local cache first
  let heater = window.heaters.find(h => h.id === id);

  // If not found in global array, try IndexedDB by id
  if (!heater) {
    heater = await Store.db.heaters.get(id);
  }
  
  // If still not found, try to find by uuid or id in IndexedDB
  if (!heater) {
    const allHeaters = await Store.db.heaters.toArray();
    heater = allHeaters.find(h => String(h.id) === String(id) || h.uuid === id);
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
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru', { numeric: true, sensitivity: 'base' }))
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
    // Получаем текущие данные обогревателя для сравнения
    const existingHeater = window.heaters.find(h => h.id === id || h.uuid === id);
    
    // Обновляем через Store
    await Store.update('heaters', id, data);

    // Создаём событие об изменении обогревателя
    const changes = [];
    const premiseChanged = existingHeater && 
      existingHeater.premise_name !== (await Store.db.premises.get(data.premise_id))?.name;
    
    if (existingHeater) {
      if (existingHeater.name !== data.name) changes.push(`название: "${existingHeater.name}" → "${data.name}"`);
      if (existingHeater.serial !== data.serial) changes.push(`серийный номер: "${existingHeater.serial}" → "${data.serial}"`);
      if (existingHeater.status !== data.status) changes.push(`статус: "${existingHeater.status}" → "${data.status}"`);
    }

    if (changes.length > 0 || premiseChanged) {
      // Формируем комментарий
      let comment;
      if (premiseChanged && changes.length === 0) {
        // Только перемещение - без дублирования маршрута (он будет в 📍 строке)
        comment = 'Обогреватель перемещён:';
      } else if (premiseChanged) {
        // Перемещение + другие изменения
        comment = `Изменения: ${changes.join(', ')}`;
      } else {
        // Только другие изменения
        comment = `Обогреватель изменён: ${changes.join(', ')}`;
      }
      
      await Store.db.events.add({
        uuid: Store.generateUUIDSync(),
        heater_uuid: existingHeater?.uuid || data.premise_uuid,
        heater_id: id,
        user_uuid: currentUser?.uuid,
        user_id: currentUser?.id,
        event_type: premiseChanged ? 'premise_change' : 'status_change',
        from_premise_uuid: existingHeater?.premise_uuid,
        from_premise_id: existingHeater?.premise_id,
        to_premise_uuid: data.premise_uuid,
        to_premise_id: data.premise_id,
        old_status: existingHeater?.status,
        new_status: data.status,
        comment: comment,
        created_at: new Date().toISOString(),
        _sync_status: 'pending',
        _modified: true
      });
    }

    // Обновляем ВСЕ данные
    await loadLocalData();

    // Обновляем selectedHeater если редактировали текущий обогреватель
    if (selectedHeater && (selectedHeater.id === id || selectedHeater.uuid === id)) {
      const updatedHeater = window.heaters.find(h => h.id === id || h.uuid === id);
      if (updatedHeater) {
        selectedHeater = updatedHeater;
      }
    }

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
    // Загружаем данные из IndexedDB
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

    // Render premises - сортировка по алфавиту с учётом чисел (natural sort)
    const premisesList = $('#premises-list');
    if (premisesList) {
      const sortedPremises = [...premisesData].sort((a, b) => 
        (a.name || '').localeCompare(b.name || '', 'ru', { numeric: true, sensitivity: 'base' })
      );
      premisesList.innerHTML = sortedPremises.map(p => `
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
    // Используем fetch напрямую для получения файла
    const response = await fetch(`${API_BASE}/api/export`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Ошибка экспорта');
    }
    
    const data = await response.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `electro-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    const recordCount = {
      objects: data.objects?.length || 0,
      premises: data.premises?.length || 0,
      heaters: data.heaters?.length || 0,
      stickers: data.stickers?.length || 0,
      events: data.events?.length || 0,
      users: data.users?.length || 0
    };
    
    showToast(`Экспорт выполнен: ${Object.entries(recordCount).map(([k,v]) => `${k}: ${v}`).join(', ')}`);
    if (window.AppLogs) AppLogs.success(`Экспорт БД: ${JSON.stringify(recordCount)}`);
  } catch (err) {
    showToast('Ошибка экспорта: ' + err.message);
    if (window.AppLogs) AppLogs.error('Экспорт БД: ' + err.message);
  }
}

async function clearIndexedDB() {
  if (!confirm('⚠️ Вы уверены, что хотите очистить всю IndexedDB? Это действие необратимо!')) return;
  
  try {
    if (window.Store && window.Store.db) {
      await window.Store.db.heaters.clear();
      await window.Store.db.premises.clear();
      await window.Store.db.objects.clear();
      await window.Store.db.stickers.clear();
      await window.Store.db.events.clear();
      await window.Store.db.users.clear();
      await window.Store.db.userObjects.clear();
      await window.Store.db.syncState.clear();
    }
    
    // Очищаем localStorage (кроме токена)
    const token = localStorage.getItem('token');
    localStorage.clear();
    if (token) localStorage.setItem('token', token);
    
    // Перезагружаем данные
    await loadLocalData();
    render();
    
    showToast('✅ IndexedDB очищена');
    if (window.AppLogs) AppLogs.success('IndexedDB очищена пользователем');
  } catch (err) {
    showToast('Ошибка: ' + err.message);
    if (window.AppLogs) AppLogs.error('Ошибка очистки IndexedDB: ' + err.message);
  }
}

async function clearServerDatabase() {
  if (!confirm('⚠️ Вы уверены, что хотите очистить всю базу данных на сервере? Это действие необратимо!\n\nБудут удалены:\n- Все обогреватели\n- Все помещения\n- Все объекты\n- Все события истории\n- Все пользователи (кроме admin)')) return;

  try {
    const response = await fetch(`${API_BASE}/api/admin/clear-database`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    // Проверяем, что ответ JSON
    const contentType = response.headers.get('content-type');
    
    if (!response.ok) {
      // Пытаемся получить ошибку, но аккуратно
      if (contentType && contentType.includes('application/json')) {
        const error = await response.json();
        throw new Error(error.error || error.message || 'Ошибка сервера');
      } else {
        // Сервер вернул HTML (ошибка 404, 500 и т.д.)
        const text = await response.text();
        console.error('[clearServerDatabase] Server error:', response.status, text.substring(0, 200));
        throw new Error(`Ошибка сервера: ${response.status} ${response.statusText}`);
      }
    }

    // Проверяем, что ответ JSON
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error('[clearServerDatabase] Unexpected response:', text.substring(0, 200));
      throw new Error('Сервер вернул некорректный ответ');
    }

    const result = await response.json();

    // Очищаем локальную IndexedDB после очистки сервера
    if (window.Store && window.Store.db) {
      await window.Store.db.heaters.clear();
      await window.Store.db.premises.clear();
      await window.Store.db.objects.clear();
      await window.Store.db.stickers.clear();
      await window.Store.db.events.clear();
      await window.Store.db.users.clear();
      await window.Store.db.userObjects.clear();
    }

    await loadLocalData();
    render();

    showToast(`✅ БД очищена: ${result.deleted || 0} записей удалено`);
    if (window.AppLogs) AppLogs.success(`БД на сервере очищена: ${result.deleted || 0} записей`);
  } catch (err) {
    showToast('Ошибка: ' + err.message);
    if (window.AppLogs) AppLogs.error('Ошибка очистки БД на сервере: ' + err.message);
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
        
        // Используем fetch напрямую для POST запроса
        const response = await fetch(`${API_BASE}/api/import`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify(data)
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Ошибка импорта');
        }
        
        const result = await response.json();
        closeModal();
        showToast(`Импорт выполнен: ${Object.entries(result.imported).map(([k,v]) => `${k}: ${v}`).join(', ')}`);
        await loadLocalData();
        if (typeof loadAdminData === 'function') {
          await loadAdminData();
        }
        render();
      } catch (err) {
        showToast('Ошибка импорта: ' + err.message);
        if (window.AppLogs) AppLogs.error('Импорт БД: ' + err.message);
      }
    };
    reader.readAsText(file);
  } catch (err) {
    showToast('Ошибка чтения файла: ' + err.message);
    if (window.AppLogs) AppLogs.error('Чтение файла импорта: ' + err.message);
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

    // Обновляем ВСЕ данные (объекты используются в помещениях и обогревателях)
    await loadLocalData();

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

    // Обновляем ВСЕ данные
    await loadLocalData();

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
    // Soft delete в IndexedDB
    await Store.update('objects', id, { deleted_at: new Date().toISOString() });

    // Обновляем ВСЕ данные
    await loadLocalData();

    render();
    showToast('Объект удалён');
  } catch (err) {
    console.error('Delete object error:', err);
    const msg = `Ошибка: ${err.message}`;
    if (window.AppLogs) AppLogs.error(msg);
    showToast(msg);
  }
}

async function restoreObject(id) {
  try {
    // Восстанавливаем в IndexedDB
    await Store.update('objects', id, { deleted_at: null });

    // Обновляем ВСЕ данные
    await loadLocalData();

    render();
    showToast('Объект восстановлен');
  } catch (err) {
    console.error('Restore object error:', err);
    const msg = `Ошибка: ${err.message}`;
    if (window.AppLogs) AppLogs.error(msg);
    showToast(msg);
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

    // Обновляем ВСЕ данные (помещения используются в обогревателях)
    await loadLocalData();

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

    // Обновляем ВСЕ данные
    await loadLocalData();

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
    // Soft delete в IndexedDB
    await Store.update('premises', id, { deleted_at: new Date().toISOString() });

    // Обновляем ВСЕ данные
    await loadLocalData();

    render();
    showToast('Помещение удалено');
  } catch (err) {
    console.error('Delete premise error:', err);
    const msg = `Ошибка: ${err.message}`;
    if (window.AppLogs) AppLogs.error(msg);
    showToast(msg);
  }
}

async function restorePremise(id) {
  try {
    // Восстанавливаем в IndexedDB
    await Store.update('premises', id, { deleted_at: null });

    // Обновляем ВСЕ данные
    await loadLocalData();

    render();
    showToast('Помещение восстановлено');
  } catch (err) {
    console.error('Restore premise error:', err);
    const msg = `Ошибка: ${err.message}`;
    if (window.AppLogs) AppLogs.error(msg);
    showToast(msg);
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

// ===== ИНИЦИАЛИЗАЦИЯ =====
initApp();

// Make functions globally accessible for onclick handlers
window.showUserObjectsModal = showUserObjectsModal;
window.saveUserObjects = saveUserObjects;
window.toggleSort = toggleSort;
window.setPremiseSort = setPremiseSort;
window.togglePremiseSortDir = togglePremiseSortDir;
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
window.changeHeaterStatus = changeHeaterStatus;

// Изменение статуса обогревателя
async function changeHeaterStatus(heaterId, newStatus) {
  try {
    // Получаем текущие данные обогревателя
    const heater = window.heaters.find(h => h.id === heaterId || h.uuid === heaterId) ||
                   await Store.db.heaters.get(heaterId);
    
    if (!heater) {
      showToast('Обогреватель не найден');
      return;
    }
    
    // Обновляем статус
    await Store.update('heaters', heaterId, { status: newStatus });
    
    // Создаём событие об изменении статуса
    const statusNames = {
      active: 'активен',
      repair: 'в ремонте',
      warehouse: 'на складе',
      moved: 'перемещён'
    };
    
    await Store.db.events.add({
      uuid: Store.generateUUIDSync(),
      heater_uuid: heater.uuid,
      heater_id: heaterId,
      user_uuid: currentUser?.uuid,
      user_id: currentUser?.id,
      event_type: 'status_change',
      from_premise_uuid: heater.premise_uuid,
      from_premise_id: heater.premise_id,
      to_premise_uuid: heater.premise_uuid,
      to_premise_id: heater.premise_id,
      old_status: heater.status,
      new_status: newStatus,
      comment: `Статус изменён с "${statusNames[heater.status] || heater.status}" на "${statusNames[newStatus] || newStatus}"`,
      created_at: new Date().toISOString(),
      _sync_status: 'pending',
      _modified: true
    });
    
    // Обновляем данные
    await loadLocalData();
    
    // Закрываем модальное окно если открыто
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
      modal.remove();
    }
    
    render();
    showToast(`Статус изменён на "${statusNames[newStatus] || newStatus}"`);
  } catch (err) {
    console.error('[changeHeaterStatus] error:', err);
    showToast(`Ошибка: ${err.message}`);
  }
}

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

// Очистка дубликатов помещений
async function cleanDuplicatePremises() {
  try {
    const premises = await Store.db.premises.toArray();
    const objects = await Store.db.objects.toArray();
    
    // Группируем по имени + object_id
    const groups = new Map();
    premises.forEach(p => {
      const key = `${p.name}|${p.object_id || p.object_uuid || 'no-object'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    });
    
    let deletedCount = 0;
    for (const [key, group] of groups) {
      if (group.length > 1) {
        // Оставляем запись с UUID, удаляем без UUID
        const withUuid = group.find(p => p.uuid);
        const withoutUuid = group.filter(p => !p.uuid);
        
        for (const p of withoutUuid) {
          // Переназначаем обогреватели на запись с UUID
          if (withUuid) {
            const heaters = await Store.db.heaters.filter(h => h.premise_id === p.id).toArray();
            for (const h of heaters) {
              await Store.db.heaters.update(h.uuid || h.id, {
                ...h,
                premise_uuid: withUuid.uuid,
                premise_id: withUuid.id
              });
            }
          }
          await Store.db.premises.delete(p.id);
          deletedCount++;
        }
      }
    }
    
    await loadLocalData();
    AppLogs.success(`Удалено дубликатов: ${deletedCount}`);
    showToast(`Удалено дубликатов: ${deletedCount}`);
    render();
  } catch (err) {
    AppLogs.error(`Ошибка очистки: ${err.message}`);
    showToast(`Ошибка: ${err.message}`);
  }
}

// Полная очистка всех данных (IndexedDB + кэш)
async function cleanAllFrontendData() {
  if (!confirm('⚠️ Внимание!\n\nЭто удалит:\n- Все локальные данные (обогреватели, объекты, помещения, наклейки)\n- Кэш Service Worker\n- localStorage\n\nДанные на сервере НЕ будут затронуты.\n\nПродолжить?')) {
    return;
  }

  try {
    // Очищаем IndexedDB
    if (window.Store && window.Store.db) {
      await window.Store.db.heaters.clear();
      await window.Store.db.premises.clear();
      await window.Store.db.objects.clear();
      await window.Store.db.stickers.clear();
      await window.Store.db.events.clear();
      await window.Store.db.users.clear();
      await window.Store.db.userObjects.clear();
      await window.Store.db.syncState.clear();
    }
    
    // Очищаем кэш Service Worker
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      for (const cacheName of cacheNames) {
        await caches.delete(cacheName);
      }
    }
    
    // Перезагружаем данные
    await loadLocalData();
    
    AppLogs.success('Все данные очищены');
    showToast('Все данные очищены. Перезагрузите страницу.');
    render();
  } catch (err) {
    AppLogs.error(`Ошибка очистки: ${err.message}`);
    showToast(`Ошибка: ${err.message}`);
  }
}

// Экспорт для консоли
window.cleanDuplicatePremises = cleanDuplicatePremises;
window.cleanAllFrontendData = cleanAllFrontendData;

// ============================================
// PRINT FUNCTIONS - Функции для печати форм
// ============================================

/**
 * Показать модальное окно выбора формы для печати
 */
function showPrintFormsModal() {
  const html = `
    <div class="modal-header">
      <div class="modal-title">️ Печать форм</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="print-forms-modal">
      <p style="margin-bottom: 16px; color: var(--text-secondary);">Выберите форму для печати:</p>
      
      <div class="print-form-option" onclick="selectPrintForm(1)">
        <div class="print-form-option-icon">📋</div>
        <div class="print-form-option-content">
          <div class="print-form-option-title">Форма 1: Перечень приборов</div>
          <div class="print-form-option-desc">Шаблон 6 к приложению 1 - Список электрических отопительных приборов по объекту/помещению</div>
        </div>
      </div>
      
      <div class="print-form-option" onclick="selectPrintForm(2)">
        <div class="print-form-option-icon">📄</div>
        <div class="print-form-option-content">
          <div class="print-form-option-title">Форма 2: Эксплуатационный паспорт</div>
          <div class="print-form-option-desc">Шаблон 7 к приложению 1 - Паспорт на отопительный прибор (история обслуживания)</div>
        </div>
      </div>
    </div>
  `;
  showModal(html);
}

/**
 * Выбор формы для печати
 * @param {number} formType - 1 для перечня, 2 для паспорта
 */
async function selectPrintForm(formType) {
  closeModal();
  
  // Загружаем актуальные данные
  await loadLocalData();
  
  if (formType === 1) {
    showPrintForm1Modal();
  } else if (formType === 2) {
    showPrintForm2Modal();
  }
}

/**
 * Показать модальное окно выбора параметров для Формы 1
 */
function showPrintForm1Modal() {
  // Получаем уникальные объекты
  const objects = [...new Map(window.objects.map(o => [o.uuid || o.id, o])).values()];
  const objectsHtml = objects.map(o => `<option value="${o.uuid || o.id}">${o.name}</option>`).join('');
  
  const html = `
    <div class="modal-header">
      <div class="modal-title">📋 Параметры печати (Форма 1)</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form onsubmit="printForm1(event)">
      <div class="input-group">
        <label>Объект</label>
        <select name="object_id" required onchange="updatePremisesForPrint(this.value)">
          <option value="">Выберите объект</option>
          ${objectsHtml}
        </select>
      </div>
      <div class="input-group">
        <label>Помещение (необязательно)</label>
        <select name="premise_id" id="premise-print-select">
          <option value="">Все помещения</option>
        </select>
      </div>
      <div class="input-group">
        <label>Статус обогревателей</label>
        <select name="status">
          <option value="">Все статусы</option>
          <option value="active">Активные</option>
          <option value="repair">В ремонте</option>
          <option value="warehouse">На складе</option>
          <option value="moved">Перемещённые</option>
        </select>
      </div>
      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button type="submit" class="btn btn-primary" style="flex: 1">🖨️ Печать</button>
        <button type="button" class="btn btn-secondary" onclick="closeModal()" style="flex: 1">Отмена</button>
      </div>
    </form>
  `;
  showModal(html);
}

/**
 * Обновить список помещений для печати
 */
async function updatePremisesForPrint(objectId) {
  const select = document.getElementById('premise-print-select');
  if (!select || !objectId) {
    if (select) select.innerHTML = '<option value="">Все помещения</option>';
    return;
  }
  
  const premises = window.premises.filter(p => 
    String(p.object_id) === String(objectId) || String(p.object_uuid) === String(objectId)
  ).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru', { numeric: true }));
  
  select.innerHTML = '<option value="">Все помещения</option>' +
    premises.map(p => `<option value="${p.uuid || p.id}">${p.name}</option>`).join('');
}

/**
 * Печать Формы 1 - Перечень электрических отопительных приборов
 */
async function printForm1(e) {
  e.preventDefault();
  const form = e.target;
  
  const objectId = form.object_id?.value;
  const premiseId = form.premise_id?.value;
  const statusFilter = form.status?.value;
  
  if (!objectId) {
    showToast('Выберите объект');
    return;
  }
  
  // Фильтруем обогреватели
  let filteredHeaters = window.heaters.filter(h => {
    // Проверка по объекту
    const heaterObject = String(h.object_uuid) === String(objectId) || String(h.object_id) === String(objectId);
    if (!heaterObject) return false;
    
    // Проверка по помещению
    if (premiseId) {
      const heaterPremise = String(h.premise_uuid) === String(premiseId) || String(h.premise_id) === String(premiseId);
      if (!heaterPremise) return false;
    }
    
    // Проверка по статусу
    if (statusFilter && h.status !== statusFilter) return false;
    
    // Исключаем удалённые
    if (h.deleted_at) return false;
    
    return true;
  });
  
  // Сортируем по помещениям, затем по названию
  filteredHeaters.sort((a, b) => {
    const premiseCompare = (a.premise_name || '').localeCompare(b.premise_name || '', 'ru');
    if (premiseCompare !== 0) return premiseCompare;
    return (a.name || '').localeCompare(b.name || '', 'ru');
  });
  
  // Получаем названия объекта и помещения
  const selectedObject = window.objects.find(o => String(o.uuid) === String(objectId) || String(o.id) === String(objectId));
  const selectedPremise = premiseId ? window.premises.find(p => String(p.uuid) === String(premiseId) || String(p.id) === String(premiseId)) : null;
  
  // Генерируем HTML для печати
  const printHtml = generateForm1Html(selectedObject, selectedPremise, filteredHeaters);
  
  // Печатаем
  await printToA4(printHtml);
  
  closeModal();
  showToast(`Напечатано ${filteredHeaters.length} обогревателей`);
}

/**
 * Генерация HTML для Формы 1
 * Создаёт страницы по 10 обогревателей на каждой с разрывом страницы
 */
function generateForm1Html(object, premise, heaters) {
  const currentDate = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const premiseName = premise ? premise.name : 'все помещения';
  const objectName = object?.name || '';

  // Разбиваем обогреватели на страницы по 10 штук
  const heatersPerPage = 10;
  const totalPages = Math.ceil(heaters.length / heatersPerPage) || 1;
  
  const pages = [];
  
  for (let page = 0; page < totalPages; page++) {
    const pageHeaters = heaters.slice(page * heatersPerPage, (page + 1) * heatersPerPage);
    const globalStartIndex = page * heatersPerPage;
    
    // Генерируем строки для текущей страницы
    const rowsHtml = pageHeaters.map((h, index) => {
      const powerW = h.power_w || (h.power_kw ? Math.round(h.power_kw * 1000) : '—');
      const decommissionDate = h.decommission_date ? new Date(h.decommission_date).toLocaleDateString('ru-RU') : '—';

      return `
        <tr>
          <td class="col-num" style="text-align: center;">${globalStartIndex + index + 1}</td>
          <td class="col-name">${h.name || ''}</td>
          <td class="col-small" style="text-align: center;">Б/Н</td>
          <td class="col-small" style="text-align: center;">${h.sticker_number || 'Б/Н'}</td>
          <td class="col-date" style="text-align: center;">${decommissionDate}</td>
          <td class="col-voltage" style="text-align: center;">${h.voltage_v || '—'}</td>
          <td class="col-power" style="text-align: center;">${powerW}</td>
          <td class="col-heater" style="text-align: center;">${h.heating_element || '—'}</td>
          <td class="col-protection" style="text-align: center;">${h.protection_type || '—'}</td>
          <td class="col-location">${h.premise_name || ''}</td>
        </tr>
      `;
    }).join('');

    // Пустые строки для заполнения до 10
    const emptyRows = Math.max(0, heatersPerPage - pageHeaters.length);
    const emptyRowsHtml = Array(emptyRows).fill('<tr><td class="col-num"></td><td class="col-name"></td><td class="col-small"></td><td class="col-small"></td><td class="col-date"></td><td class="col-voltage"></td><td class="col-power"></td><td class="col-heater"></td><td class="col-protection"></td><td class="col-location"></td></tr>').join('');

    // Генерируем страницу
    const pageHtml = `
      <div class="print-page" style="display: block;${page > 0 ? ' page-break-before: always;' : ''}">
        <div class="form-header">
          <div class="form-header-left">
            <div class="approval-block">
              <strong>Согласовано</strong>
              <div style="height: 2px;"></div>
              Начальник пожарной части<br>
              <div style="height: 12px;"></div>
              <span class="signature-line"></span>
              <div style="height: 4px;"></div>
              "__" __________ 202_ г.
            </div>
          </div>
          <div class="form-header-right" style="text-align: right;">
            <div class="approval-block" style="text-align: left; display: inline-block;">
              Шаблон 6 к приложению 1
              <div style="height: 8px;"></div>
              <strong>Утверждаю</strong>
              <div style="height: 2px;"></div>
              Начальник промысла<br>
              <div style="height: 12px;"></div>
              <span class="signature-line"></span>
              <div style="height: 4px;"></div>
              "__" __________ 202_ г.
            </div>
          </div>
        </div>

        <div class="form-header-title"><em>Перечень электрических отопительных приборов</em></div>

        <table class="print-table">
          <thead>
            <tr>
              <th class="col-num" style="white-space: nowrap;">№п/п</th>
              <th class="col-name" style="width: 18%;">Марка, наименование (тип) отопительного прибора</th>
              <th class="col-small">Зав.№</th>
              <th class="col-small">Инв.№</th>
              <th class="col-date">Дата вывода из эксплуатации</th>
              <th class="col-voltage" style="width: 8%;">Напряжение,<br>В</th>
              <th class="col-power" style="width: 8%;">Мощность,<br>Вт</th>
              <th class="col-heater" style="width: 10%;">Нагревательный<br>элемент</th>
              <th class="col-protection" style="width: 16%;">Исполнение (тип защиты)</th>
              <th class="col-location" style="width: 25%;">Место установки</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            ${emptyRowsHtml}
          </tbody>
        </table>

        <div class="form-footer">
          <div class="form-footer-left">
            Составил: Главный специалист УЖО АО "СТНГ"
          </div>
          <div class="form-footer-right">
            <span class="signature-line-long"></span>
            <span>А.С.Сербенюк</span>
          </div>
        </div>
      </div>
    `;
    
    pages.push(pageHtml);
  }
  
  return pages.join('');
}

/**
 * Показать модальное окно выбора параметров для Формы 2
 */
function showPrintForm2Modal() {
  // Получаем уникальные объекты
  const objects = [...new Map(window.objects.map(o => [o.uuid || o.id, o])).values()];
  const objectsHtml = objects.map(o => `<option value="${o.uuid || o.id}">${o.name}</option>`).join('');

  const html = `
    <div class="modal-header">
      <div class="modal-title">📄 Параметры печати (Форма 2)</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form onsubmit="printForm2(event)">
      <div class="input-group">
        <label>Объект</label>
        <select name="object_id" required onchange="updatePremisesForPrint2(this.value)">
          <option value="">Выберите объект</option>
          ${objectsHtml}
        </select>
      </div>
      <div class="input-group">
        <label>Помещение (необязательно)</label>
        <select name="premise_id" id="premise-print-select-2">
          <option value="">Все помещения</option>
        </select>
      </div>
      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button type="submit" class="btn btn-primary" style="flex: 1">🖨️ Печать</button>
        <button type="button" class="btn btn-secondary" onclick="closeModal()" style="flex: 1">Отмена</button>
      </div>
    </form>
  `;
  showModal(html);
}

/**
 * Обновить список помещений для Формы 2
 */
async function updatePremisesForPrint2(objectId) {
  const select = document.getElementById('premise-print-select-2');
  if (!select || !objectId) {
    if (select) select.innerHTML = '<option value="">Все помещения</option>';
    return;
  }
  
  const premises = window.premises.filter(p => 
    String(p.object_id) === String(objectId) || String(p.object_uuid) === String(objectId)
  ).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru', { numeric: true }));
  
  select.innerHTML = '<option value="">Все помещения</option>' +
    premises.map(p => `<option value="${p.uuid || p.id}">${p.name}</option>`).join('');
}

/**
 * Печать Формы 2 - Эксплуатационный паспорт по объекту/помещениям
 */
async function printForm2(e) {
  e.preventDefault();
  const form = e.target;

  const objectId = form.object_id?.value;
  const premiseId = form.premise_id?.value;

  if (!objectId) {
    showToast('Выберите объект');
    return;
  }

  // Фильтруем обогреватели по объекту и помещению
  let filteredHeaters = window.heaters.filter(h => {
    // Проверка по объекту
    const heaterObject = String(h.object_uuid) === String(objectId) || String(h.object_id) === String(objectId);
    if (!heaterObject) return false;
    
    // Проверка по помещению
    if (premiseId) {
      const heaterPremise = String(h.premise_uuid) === String(premiseId) || String(h.premise_id) === String(premiseId);
      if (!heaterPremise) return false;
    }
    
    // Исключаем удалённые
    if (h.deleted_at) return false;
    
    return true;
  });

  // Сортируем по помещениям, затем по названию
  filteredHeaters.sort((a, b) => {
    const premiseCompare = (a.premise_name || '').localeCompare(b.premise_name || '', 'ru');
    if (premiseCompare !== 0) return premiseCompare;
    return (a.name || '').localeCompare(b.name || '', 'ru');
  });

  // Получаем данные объекта и помещения
  const selectedObject = window.objects.find(o => String(o.uuid) === String(objectId) || String(o.id) === String(objectId));
  const selectedPremise = premiseId ? window.premises.find(p => String(p.uuid) === String(premiseId) || String(p.id) === String(premiseId)) : null;

  // Загружаем все события для получения дат создания и ТО
  const allEvents = await Store.db.events.toArray();

  // Генерируем HTML для печати
  const printHtml = generateForm2Html(filteredHeaters, allEvents, selectedObject, selectedPremise);

  // Печатаем
  await printToA4(printHtml);

  closeModal();
  showToast(`Напечатано ${filteredHeaters.length} обогревателей`);
}

/**
 * Генерация HTML для Формы 2
 * @param {Array} heaters - массив обогревателей
 * @param {Array} allEvents - все события для поиска дат
 * @param {Object} object - объект
 * @param {Object} premise - помещение (опционально)
 */
function generateForm2Html(heaters, allEvents, object, premise) {
  const premiseName = premise ? premise.name : 'все помещения';
  const objectName = object?.name || '';

  // Группируем обогреватели по помещениям
  const heatersByPremise = new Map();
  heaters.forEach(h => {
    const key = h.premise_name || 'Без помещения';
    if (!heatersByPremise.has(key)) heatersByPremise.set(key, []);
    heatersByPremise.get(key).push(h);
  });

  // Генерируем строки для каждого обогревателя
  let allRowsHtml = '';
  let rowCount = 0;
  const maxRows = 7; // Максимум строк на странице

  for (const [premiseKey, premiseHeaters] of heatersByPremise) {
    // Заголовок помещения
    allRowsHtml += `
      <tr style="background: #f0f0f0; font-weight: bold;">
        <td class="col-pp" colspan="8"><strong>Помещение: ${premiseKey}</strong></td>
      </tr>
    `;
    rowCount++;

    // Обогреватели этого помещения
    for (const heater of premiseHeaters) {
      if (rowCount >= maxRows) break;

      // Находим дату создания обогревателя (первое событие)
      const heaterEvents = allEvents.filter(ev =>
        String(ev.heater_id) === String(heater.id) || ev.heater_uuid === heater.uuid
      ).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      const creationDate = heaterEvents.length > 0
        ? new Date(heaterEvents[0].created_at).toLocaleDateString('ru-RU')
        : (heater.created_at ? new Date(heater.created_at).toLocaleDateString('ru-RU') : '');

      const manufactureYear = heater.manufacture_date ? new Date(heater.manufacture_date).getFullYear() : '';
      const manufactureDate = heater.manufacture_date ? new Date(heater.manufacture_date).toLocaleDateString('ru-RU') : '';
      const decommissionDate = heater.decommission_date ? new Date(heater.decommission_date).toLocaleDateString('ru-RU') : '';

      // Находим даты ТО (события status_change с переходом в repair и обратно)
      const toDates = [];
      heaterEvents.forEach(ev => {
        if (ev.event_type === 'status_change' && ev.new_status === 'active') {
          toDates.push(new Date(ev.created_at).toLocaleDateString('ru-RU'));
        }
      });
      const toDateStr = toDates.length > 0 ? toDates.join(', ') : '';

      // Заключение
      let conclusion = 'Пригоден к эксплуатации';
      if (heater.status === 'repair') {
        conclusion = 'В ремонте';
      } else if (heater.status === 'warehouse') {
        conclusion = 'На складе';
      }

      allRowsHtml += `
        <tr>
          <td class="col-pp" style="text-align: center;">${rowCount}</td>
          <td class="col-type">${heater.name}${heater.serial ? `<br/><small>зав.№ ${heater.serial}</small>` : ''}${heater.sticker_number ? `<br/><small>[${heater.sticker_number}]</small>` : ''}</td>
          <td class="col-year" style="text-align: center;">${manufactureYear}</td>
          <td class="col-date-wide" style="text-align: center;">${creationDate}</td>
          <td class="col-location-wide">${heater.premise_name || '—'}</td>
          <td class="col-date-wide" style="text-align: center;">${decommissionDate}</td>
          <td class="col-date-wide" style="text-align: center;">${toDateStr}</td>
          <td class="col-conclusion">${conclusion}</td>
        </tr>
      `;
      rowCount++;
    }

    if (rowCount >= maxRows) break;
  }

  // Пустые строки для заполнения
  const emptyRows = Math.max(0, maxRows - rowCount);
  const emptyRowsHtml = Array(emptyRows).fill(`
    <tr>
      <td class="col-pp"></td>
      <td class="col-type"></td>
      <td class="col-year"></td>
      <td class="col-date-wide"></td>
      <td class="col-location-wide"></td>
      <td class="col-date-wide"></td>
      <td class="col-date-wide"></td>
      <td class="col-conclusion"></td>
    </tr>
  `).join('');

  return `
    <div class="print-content" style="display: block;">
      <div style="text-align: center; margin-bottom: 10px; font-size: 11pt; font-weight: bold;">
        Эксплуатационный паспорт на отопительный прибор
      </div>
      <div style="text-align: center; margin-bottom: 15px; font-size: 9pt; color: #666;">
        Шаблон 7 к приложению 1
      </div>

      <table class="print-table passport-table">
        <thead>
          <tr>
            <th class="col-pp">№ пп</th>
            <th class="col-type">Тип прибора/заводской номер</th>
            <th class="col-year">Год<br>выпуска</th>
            <th class="col-date-wide">Дата ввода в<br>эксплуатацию</th>
            <th class="col-location-wide">Место размещения<br>оборудования</th>
            <th class="col-date-wide">Дата вывода из<br>эксплуатации</th>
            <th class="col-date-wide">Дата проведения<br>технического<br>обслуживания</th>
            <th class="col-conclusion">Заключение (пригодность к<br>дальнейшей эксплуатации) /<br>отметки о состоянии прибора,<br>проведённых работах по ТО</th>
          </tr>
        </thead>
        <tbody>
          ${allRowsHtml}
          ${emptyRowsHtml}
        </tbody>
      </table>

      <div style="margin-top: 15px; font-size: 10pt;">
        <strong>Ответственный за пожарную безопасность: должность, Ф.И.О</strong>
      </div>
    </div>
  `;
}

/**
 * Печать HTML контента на А4
 * Открывает страницу предпросмотра, где пользователь может проверить документ перед печатью
 */
async function printToA4(htmlContent) {
  try {
    // Генерируем уникальный ключ для хранения контента
    const printKey = 'print_content_' + Date.now();
    
    // Сохраняем контент в localStorage (надёжнее для больших данных)
    localStorage.setItem(printKey, htmlContent);
    
    // Открываем страницу предпросмотра в новом окне
    const previewUrl = `/print-preview.html?key=${printKey}`;
    const previewWindow = window.open(previewUrl, '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes');
    
    if (!previewWindow) {
      throw new Error('Браузер заблокировал открытие окна предпросмотра. Разрешите всплывающие окна для этого сайта.');
    }
    
    // Проверяем, что окно открылось успешно
    previewWindow.addEventListener('load', () => {
      console.log('Страница предпросмотра загружена');
    });
    
    // Очищаем localStorage после закрытия окна (с задержкой)
    previewWindow.addEventListener('unload', () => {
      setTimeout(() => {
        localStorage.removeItem(printKey);
      }, 5000);
    });
    
  } catch (err) {
    console.error('Print preview error:', err);
    alert('Ошибка открытия предпросмотра: ' + err.message);
  }
}

// Экспорт функций печати
window.showPrintFormsModal = showPrintFormsModal;
window.selectPrintForm = selectPrintForm;
window.printForm1 = printForm1;
window.printForm2 = printForm2;
window.printToA4 = printToA4;
window.generateForm1Html = generateForm1Html;
window.generateForm2Html = generateForm2Html;
