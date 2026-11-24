/**
 * library.mjs — 模板总装
 *
 * 两部分：
 *   ① 精选（curated）：library-{core,jp,cn,kr}.mjs 里手做的 138 套，载入时就算好几何；
 *   ② 扩展（generated）：lib/packs/{jp,kr,cn,core}.mjs，由 scripts/gen-library.mjs 按各家分镜规律生成，
 *      每类 1000+ 套。几何（slots）**用到才算**：模板库列表、筛选、搜索、规则引擎的预筛只看元数据，
 *      画缩略图 / 打开模板 / 节拍对齐时才展开盒子树，算一次缓存下来。
 */
import { finalizeTemplate, PAGE_PRESETS } from './geometry.mjs';
import jp from './library-jp.mjs';
import cn from './library-cn.mjs';
import kr from './library-kr.mjs';
import core from './library-core.mjs';
import packJp from './packs/jp.mjs';
import packKr from './packs/kr.mjs';
import packCn from './packs/cn.mjs';
import packCore from './packs/core.mjs';
import { decodeEntry } from './packs/decode.mjs';

const RAW = [...core, ...jp, ...cn, ...kr];

const seen = new Set();
const CURATED = RAW.map((raw) => {
  if (seen.has(raw.id)) throw new Error(`模板 id 重复: ${raw.id}`);
  seen.add(raw.id);
  const t = finalizeTemplate(raw);
  if (raw.slots) {
    t.slots = [...t.slots].sort((a, b) => a.order - b.order).map((s, i) => ({ ...s, order: i + 1 }));
  }
  t.panels = t.slots.length;
  t.curated = true;
  return t;
});

const READ = { r: 'rtl', l: 'ltr', v: 'vertical' };
const densityOf = (n) => (n <= 3 ? 'low' : n <= 5 ? 'mid' : n <= 8 ? 'high' : 'dense');

/** 生成模板：元数据立刻可用，slots 第一次读到时才展开（结果缓存） */
function lazyTemplate(e, culture) {
  if (seen.has(e.i)) throw new Error(`模板 id 重复: ${e.i}`);
  seen.add(e.i);
  const page = PAGE_PRESETS[e.r] || PAGE_PRESETS.a4;
  const t = {
    id: e.i,
    name: e.n,
    culture,
    reading: READ[e.rd] || 'ltr',
    ratio: page.id,
    page: { w: page.w, h: page.h, kind: page.kind },
    frame: e.f,
    tags: e.t,
    intents: e.it,
    density: densityOf(e.k),
    desc: e.d,
    margin: e.m,
    gutter: e.g,
    panels: e.k,
    family: e.fm,
    generated: true,
  };
  let slots = null;
  Object.defineProperty(t, 'slots', {
    enumerable: true,
    configurable: true,
    get() {
      if (!slots) slots = finalizeTemplate(decodeEntry(e, culture)).slots;
      return slots;
    },
  });
  return t;
}

const GENERATED = [
  ...packJp.map((e) => lazyTemplate(e, 'jp')),
  ...packCn.map((e) => lazyTemplate(e, 'cn')),
  ...packKr.map((e) => lazyTemplate(e, 'kr')),
  ...packCore.map((e) => lazyTemplate(e, 'core')),
];

export const TEMPLATES = [...CURATED, ...GENERATED];

export const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

export const getTemplate = (id) => BY_ID.get(id) || null;

/** 各类数量（精选 + 扩展） */
export const COUNTS = (() => {
  const c = { total: TEMPLATES.length, curated: CURATED.length, generated: GENERATED.length, byCulture: {} };
  for (const t of TEMPLATES) {
    const b = (c.byCulture[t.culture] ||= { total: 0, curated: 0 });
    b.total++;
    if (t.curated) b.curated++;
  }
  return c;
})();

export function listTemplates({ culture, q, tag, intent, ratio, minPanels, maxPanels, density, curated, limit = 500, offset = 0, sort = 'id' } = {}) {
  let out = TEMPLATES;
  if (culture && culture !== 'all') out = out.filter((t) => t.culture === culture);
  if (ratio) out = out.filter((t) => t.ratio === ratio);
  if (tag) out = out.filter((t) => t.tags.includes(tag));
  if (intent) out = out.filter((t) => t.intents.includes(intent));
  if (density) out = out.filter((t) => t.density === density);
  if (minPanels) out = out.filter((t) => t.panels >= minPanels);
  if (maxPanels) out = out.filter((t) => t.panels <= maxPanels);
  if (curated === true) out = out.filter((t) => t.curated);
  if (curated === false) out = out.filter((t) => !t.curated);
  if (q) {
    const k = q.toLowerCase();
    out = out.filter((t) => (t.id + t.name + t.desc + t.tags.join('')).toLowerCase().includes(k));
  }
  if (sort === 'panels') out = [...out].sort((a, b) => a.panels - b.panels);
  if (sort === 'panels-desc') out = [...out].sort((a, b) => b.panels - a.panels);
  return { total: out.length, items: out.slice(offset, offset + limit) };
}

/** 列表项的元数据（不含几何）：模板库列表 / 筛选 / 搜索用 */
export const meta = (t) => ({
  id: t.id, name: t.name, culture: t.culture, reading: t.reading, ratio: t.ratio,
  page: t.page, frame: t.frame, tags: t.tags, intents: t.intents, density: t.density,
  desc: t.desc, panels: t.panels, margin: t.margin, gutter: t.gutter,
  curated: !!t.curated, family: t.family || null,
});

/** 轻量列表项（带缩略图几何，API 用） */
export const slim = (t) => ({
  ...meta(t),
  thumbSlots: t.slots.map((s) => ({ id: s.id, order: s.order, role: s.role, poly: s.poly, over: !!s.over })),
});
