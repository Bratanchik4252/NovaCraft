/* ==========================================================================
   players-data.js — поиск игроков и публичные профили
   Ищет только по зарегистрированным аккаунтам (mc:auth).
   TODO: заменить на API-запросы к бэкенду (/api/players, /api/player?name=)
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

// Ищет игрока по нику среди зарегистрированных аккаунтов.
window.findPlayer = function (name) {
  if (!name) return null;
  const u = _authUsers().find(x => x.name.toLowerCase() === name.toLowerCase());
  return u ? _toPublic(u) : null;
};

// Поиск по нику: только зарегистрированные аккаунты.
window.searchPlayers = function (q) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return [];
  return _authUsers()
    .filter(u => u.name.toLowerCase().includes(q))
    .map(u => ({
      name: u.name,
      online: false,
      blocks: (u.stats && u.stats.blocks) || 0,
      coins: _coinsOf(u),
      avatar: u.avatar || null,
    }));
};
