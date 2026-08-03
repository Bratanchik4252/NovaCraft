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

// Кэш найденных профилей из облака (чтобы повторные заходы были мгновенными)
function _dbCache() {
  try {
    return JSON.parse(localStorage.getItem('mc:db-cache') || '{}');
  } catch (e) {
    return {};
  }
}
function _dbCacheSet(name, pub) {
  try {
    const c = _dbCache();
    c[String(name).toLowerCase()] = pub;
    localStorage.setItem('mc:db-cache', JSON.stringify(c));
  } catch (e) {}
}

// Ищет игрока по нику. Возвращает Promise.
// Если Supabase подключён — данные из облака (с кэшем в localStorage).
window.findPlayer = function (name) {
  if (!name) return Promise.resolve(null);
  const key = String(name).toLowerCase();

  if (window.DB && DB.configured && DB.findPlayerByName) {
    // Сначала кэш, потом облако
    const cached = _dbCache()[key];
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
