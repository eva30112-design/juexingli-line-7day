// store.js — 極簡的訂閱者資料存放（JSON 檔）。
// 正式上線若使用者量大，可改成資料庫（如 Redis / Postgres），介面相同即可。
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'subscribers.json');

function loadAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return {}; }
}
function saveAll(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// 取得單一使用者
function get(userId) {
  return loadAll()[userId] || null;
}

// 新增/重設一位訂閱者（開始 7 天）
function start(userId) {
  const all = loadAll();
  all[userId] = {
    userId,
    startDate: todayStr(),   // 開始日期 YYYY-MM-DD
    day: 1,                  // 已寄出到第幾天（follow 當下就寄 Day1）
    lastPushDate: todayStr() // 最後一次推播日期，避免同一天重複推
  };
  saveAll(all);
  return all[userId];
}

// 更新使用者欄位
function update(userId, patch) {
  const all = loadAll();
  if (!all[userId]) return null;
  all[userId] = { ...all[userId], ...patch };
  saveAll(all);
  return all[userId];
}

function list() {
  return Object.values(loadAll());
}

function todayStr(d = new Date()) {
  // 以 Asia/Taipei 為準
  const t = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

module.exports = { get, start, update, list, todayStr };
