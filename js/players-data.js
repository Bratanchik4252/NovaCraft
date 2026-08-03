/* ==========================================================================
   players-data.js — поиск игроков и публичные профили
   Если подключён Supabase — данные тянутся из облака (profiles) и кэшируются
   в localStorage. Если нет — фолбэк на localStorage (mc:auth).
   ========================================================================== */

'use strict';

function _authUsers() {
  try {
    return JSON.parse(localStorage.getItem('mc:auth') || '{"users":[],"session":null}').users || [];
  } catch (e) {
    return [];
  }
}

function _coinsOf(u) {
  return (Array.isArray(u.balance) ? u.balance : []).reduce((s, b) => s + (Number(b.balance) || 0), 0);
}

function _toPublic(u) {
  return {
    name: u.name,
    online: false,
    blocks: (u.stats && u.stats.blocks) || 0,
    coins: _coinsOf(u),
    timeHours: (u.stats && u.stats.timeHours) || 0,
    transactions: Array.isArray(u.transactions) ? u.transactions : [],
    privileges: Array.isArray(u.privileges) ? u.privileges : [],
    avatar: u.avatar || null,
    banner: u.banner || null,
    description: u.description || '',
    privacy: u.privacy || {},
  };
}

// Кэш найденных профилей из облака (чтобы повторные заходы были мгновенными).
// Версия в ключе сбрасывает устаревший кэш после изменения формата данных.
const DB_CACHE_KEY = 'mc:db-cache:v2';
const DB_CACHE_TTL = 5 * 60 * 1000; // 5 минут
function _dbCache() {
  try {
    return JSON.parse(localStorage.getItem(DB_CACHE_KEY) || '{}');
  } catch (e) {
    return {};
  }
}
function _dbCacheSet(name, pub) {
  try {
    const c = _dbCache();
    c[String(name).toLowerCase()] = { data: pub, ts: Date.now() };
    localStorage.setItem(DB_CACHE_KEY, JSON.stringify(c));
  } catch (e) {}
}
function _dbCacheGet(name) {
  try {
    const entry = _dbCache()[String(name).toLowerCase()];
    if (!entry) return null;
    if (Date.now() - (entry.ts || 0) > DB_CACHE_TTL) return null;
    return entry.data;
  } catch (e) {
    return null;
  }
}

// Ищет игрока по нику. Возвращает Promise.
// Если Supabase подключён — данные из облака (с кэшем в localStorage).
window.findPlayer = function (name) {
  if (!name) return Promise.resolve(null);
  const key = String(name).toLowerCase();

  if (window.DB && DB.configured && DB.findPlayerByName) {
    // Сначала кэш (5 мин), потом облако
    const cached = _dbCacheGet(name);
    if (cached) return Promise.resolve(cached);
    return DB.findPlayerByName(name).then(u => {
      if (!u) return null;
      const pub = _toPublic(u);
      _dbCacheSet(name, pub);
      return pub;
    }).catch(() => _authUsers().find(x => x.name.toLowerCase() === key) ? _toPublic(_authUsers().find(x => x.name.toLowerCase() === key)) : null);
  }

  const u = _authUsers().find(x => x.name.toLowerCase() === key);
  return Promise.resolve(u ? _toPublic(u) : null);
};

// Поиск по нику. Возвращает Promise.
window.searchPlayers = function (q) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return Promise.resolve([]);

  if (window.DB && DB.configured && DB.searchPlayersByName) {
    return DB.searchPlayersByName(q).then(users =>
      users.map(u => ({
        name: u.name,
        online: false,
        blocks: (u.stats && u.stats.blocks) || 0,
        coins: _coinsOf(u),
        avatar: u.avatar || null,
      }))
    ).catch(() => []);
  }

  return Promise.resolve(
    _authUsers()
      .filter(u => u.name.toLowerCase().includes(q))
      .map(u => ({
        name: u.name,
        online: false,
        blocks: (u.stats && u.stats.blocks) || 0,
        coins: _coinsOf(u),
        avatar: u.avatar || null,
      }))
  );
};
