/**
 * 本机存储：localStorage（偏好 / 小记录）+ IndexedDB（草稿 / 图片 Blob / 角色卡）。
 *
 * 所有 localStorage 的 key 都登记在 KEYS 里 —— 以前散落在五六个文件里各写各的，
 * 结果「界面风格」和「折叠状态」撞在同一个 `pf.ui.v1` 上互相覆盖。新增一项先来这里登记。
 * 读写一律吞异常：隐私模式 / 配额满 / 企业策略禁用存储时，界面照常可用，只是不记忆。
 */
export const KEYS = {
  theme: 'pf.theme',            // auto | light | dark（auto 不存）
  accent: 'pf.accent',          // 强调色 id（跟随风格不存）
  style: 'pf.style',            // 风格：classic | glass | minimal | cute（经典不存）
  motion: 'pf.motion',          // reduced（正常不存）
  lang: 'pf.lang.v1',           // zh | en | ja | id（中文不存）
  fold: 'pf.fold.v1',           // 卡片 / 气泡库的折叠记录 {key: open}
  slotSec: 'pf.slotsec',        // 右栏分段的折叠记录
  layout: 'pf.layout.v2',       // 面板管理：{main|artist: {order, hidden, ai}}
  auto: 'pf.auto',              // 全自动模式
  llm: 'pf.llm.v1',             // 当前生效的模型配置（api-static.js 也读这一份）
  charSheet: 'pf.char.v1',      // 角色设定文字
  keys: 'pf.keys.v1',           // 多服务商 Key 列表
  bubUse: 'pf.bub.use',         // 气泡使用次数（「常用」排序）
  styleFollow: 'pf.stylefollow',
  paintPaper: 'pf.paint.paper', // 0 = 透明底
  lines: (tplId) => 'pf.lines.' + tplId,
  rail: (side) => 'pf.rail.' + side,
  // 旧 key：只在迁移时读一次
  legacyUi: 'pf.ui.v1',
  legacySkin: 'pf.skin',
};

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  /** v 为 null / undefined 时删除这一项（「默认值不存」，偏好表保持干净） */
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch { /* ignore */ } },
  json(k, fallback = null) {
    try {
      const v = JSON.parse(localStorage.getItem(k) || 'null');
      return v ?? fallback;
    } catch { return fallback; }
  },
  setJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

/* ------------------------------------------------------------------ IndexedDB */
const DB_NAME = 'panelforge';
const DB_STORE = 'drafts';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
      req.onblocked = () => res(null);
    } catch { res(null); }
  });
  return dbPromise;
}

/** 写一项；value 为 null 时删除。返回是否成功（不可用时返回 false，不抛错） */
export async function idbSet(key, value) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((res) => {
    try {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const os = tx.objectStore(DB_STORE);
      if (value == null) os.delete(key); else os.put(value, key);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
      tx.onabort = () => res(false);
    } catch { res(false); }
  });
}

export async function idbGet(key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((res) => {
    try {
      const r = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}

/** 带超时地读：IndexedDB 被策略卡住时，启动不能跟着卡死 */
export function idbGetWithin(key, ms = 1500) {
  return Promise.race([idbGet(key), new Promise((r) => setTimeout(() => r(null), ms))]);
}
