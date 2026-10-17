/**
 * library.mjs — 模板总装
 */
import { finalizeTemplate } from './geometry.mjs';
import jp from './library-jp.mjs';
import cn from './library-cn.mjs';
import kr from './library-kr.mjs';
import core from './library-core.mjs';

const RAW = [...core, ...jp, ...cn, ...kr];

const seen = new Set();
export const TEMPLATES = RAW.map((raw) => {
  if (seen.has(raw.id)) throw new Error(`模板 id 重复: ${raw.id}`);
  seen.add(raw.id);
  const t = finalizeTemplate(raw);
  if (raw.slots) {
    t.slots = [...t.slots].sort((a, b) => a.order - b.order).map((s, i) => ({ ...s, order: i + 1 }));
  }
  return t;
});

export const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

export const getTemplate = (id) => BY_ID.get(id) || null;

export function listTemplates({ culture, q, tag, intent, ratio, minPanels, maxPanels, density, limit = 500, offset = 0, sort = 'id' } = {}) {
  let out = TEMPLATES;
  if (culture && culture !== 'all') out = out.filter((t) => t.culture === culture);
  if (ratio) out = out.filter((t) => t.ratio === ratio);
  if (tag) out = out.filter((t) => t.tags.includes(tag));
  if (intent) out = out.filter((t) => t.intents.includes(intent));
  if (density) out = out.filter((t) => t.density === density);
  if (minPanels) out = out.filter((t) => t.slots.length >= minPanels);
  if (maxPanels) out = out.filter((t) => t.slots.length <= maxPanels);
  if (q) {
    const k = q.toLowerCase();
    out = out.filter((t) => (t.id + t.name + t.desc + t.tags.join('')).toLowerCase().includes(k));
  }
  if (sort === 'panels') out = [...out].sort((a, b) => a.slots.length - b.slots.length);
  if (sort === 'panels-desc') out = [...out].sort((a, b) => b.slots.length - a.slots.length);
  return { total: out.length, items: out.slice(offset, offset + limit) };
}

/** 轻量列表项（列表页用，省带宽） */
export const slim = (t) => ({
  id: t.id, name: t.name, culture: t.culture, reading: t.reading, ratio: t.ratio,
  page: t.page, frame: t.frame, tags: t.tags, intents: t.intents, density: t.density,
  desc: t.desc, panels: t.slots.length, margin: t.margin, gutter: t.gutter,
  thumbSlots: t.slots.map((s) => ({ id: s.id, order: s.order, role: s.role, poly: s.poly, over: !!s.over })),
});
