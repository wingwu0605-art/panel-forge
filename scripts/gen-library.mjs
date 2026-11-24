#!/usr/bin/env node
/**
 * gen-library.mjs — 生成「扩展模板库」：日漫 / 韩漫条漫 / 国风 / 通用，每类 1000+ 套
 *
 *   node scripts/gen-library.mjs                 # 生成 lib/packs/{jp,kr,cn,core}.mjs（每类 1200，和仓库里的一模一样）
 *   node scripts/gen-library.mjs --append --target 1500   # 扩充：现有的全保留，每类往后追加到 1500
 *   node scripts/gen-library.mjs --target 1200   # 每类目标数
 *   node scripts/gen-library.mjs --culture jp    # 只生成一类
 *   node scripts/gen-library.mjs --sheet 120     # 另外写 out/gen-sheet-<类>.html（每类随机抽 120 套看效果）
 *   node scripts/gen-library.mjs --phrases       # 列出名字 / 说明里用到的全部固定短语（给词表对照）
 *   node scripts/gen-library.mjs --dry           # 只统计，不写文件
 *
 * 种子固定 → 同一份代码永远生成同一批模板（编号稳定）。生成好的包提交进仓库；
 * 以后改了生成器再跑，旧编号可能对应到不同版式 —— 所以包是「数据」，不要随手重生成；
 * 真要扩充就加 --append（保留现有包里的全部模板，只往后追加新编号）。
 *
 * 流程（每一套）：挑版式家族 → 挑戏路 → 定格数 → 排拍子（beats.mjs）→ 出盒子树（grammar.mjs）
 *   → 算几何、放插入格、定阅读顺序 → 体检（quality.mjs）→ 配景别 / 标签 / 戏路 / 名字 / 说明（label.mjs）
 *   → 和已有的（含手做的 138 套）比，几乎一样就丢掉 → 收下。
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSlots, finalizeTemplate, PAGE_PRESETS } from '../lib/geometry.mjs';
import { INTENTS } from '../lib/taxonomy.mjs';
import { makeRng, round2 } from './libgen/rng.mjs';
import { beatScript, panelCountFor, intentClass } from './libgen/beats.mjs';
import { DRAFTERS } from './libgen/grammar.mjs';
import { checkQuality, checkInset, fingerprint, DedupeIndex } from './libgen/quality.mjs';
import { pickRole, deriveTags, pickIntents, systemLabel, structureLabel, featureLabel, describe } from './libgen/label.mjs';
import curatedJp from '../lib/library-jp.mjs';
import curatedCn from '../lib/library-cn.mjs';
import curatedKr from '../lib/library-kr.mjs';
import curatedCore from '../lib/library-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);

const TARGET = Number(arg('--target', 1200));   // 和仓库里的包一致：不带参数重跑 = 原样复现
const ONLY = arg('--culture', null);
const SHEET = Number(arg('--sheet', 0));
const DRY = has('--dry');
const APPEND = has('--append');

/* ------------------------------------------------------------------ *
 * 家族（版式体系）与戏路权重
 * ------------------------------------------------------------------ */
const int = (rng, [a, b]) => rng.int(a, b);
const BIG_BEAT = ['impact', 'climax', 'reveal', 'scenery', 'magic', 'disaster', 'war', 'emotion', 'horror', 'silence', 'travel'];
const KOMA = ['gag', 'daily', 'food', 'romance', 'dialogue', 'work'];
const HOT = ['action', 'impact', 'chase', 'sport', 'war', 'magic', 'disaster', 'horror', 'climax'];

export const FAMILIES = {
  jp: [
    { id: 'jp-page', w: 0.86, drafter: 'page', ratio: [['a4', 0.8], ['b5', 0.2]], reading: 'rtl', frame: [['ink', 1]], margin: [22, 34], gutter: [10, 20], opts: { vP: 0.22 } },
    { id: 'jp-spread', w: 0.05, drafter: 'landscape', ratio: [['wide', 1]], reading: 'rtl', frame: [['ink', 1]], margin: [18, 26], gutter: [10, 16], n: [[3, 2], [4, 3], [5, 3], [6, 2], [7, 1]] },
    { id: 'jp-splash', w: 0.04, drafter: 'splash', ratio: [['a4', 0.8], ['b5', 0.2]], reading: 'rtl', frame: [['ink', 1]], margin: [22, 30], gutter: [12, 18], n: [[1, 1], [2, 2], [3, 2]], intents: BIG_BEAT },
    { id: 'jp-4koma', w: 0.05, drafter: 'koma4', ratio: [['a4', 0.65], ['square', 0.35]], reading: 'rtl', frame: [['ink', 1]], margin: [26, 40], gutter: [12, 24], n: [[4, 3], [8, 1]], intents: KOMA },
  ],
  kr: [
    { id: 'kr-strip', w: 0.8, drafter: 'strip', ratio: 'byCount', reading: 'vertical', frame: [['none', 1]], margin: [40, 70], gutter: [40, 120] },
    { id: 'kr-fast', w: 0.2, drafter: 'strip', ratio: 'byCount', reading: 'vertical', frame: [['hairline', 1]], margin: [28, 42], gutter: [16, 32], intents: HOT },
  ],
  cn: [
    { id: 'cn-strip', w: 0.5, drafter: 'strip', ratio: 'byCount', reading: 'vertical', frame: [['none', 0.72], ['hairline', 0.28]], margin: [44, 72], gutter: [40, 110] },
    { id: 'cn-page', w: 0.38, drafter: 'page', ratio: [['a4', 0.6], ['p34', 0.4]], reading: 'ltr', frame: [['bold', 0.7], ['ink', 0.3]], margin: [26, 38], gutter: [14, 24], opts: { vP: 0.36, titleP: 0.28 } },
    { id: 'cn-longscroll', w: 0.1, drafter: 'landscape', ratio: [['wide', 1]], reading: 'ltr', frame: [['bold', 0.55], ['none', 0.45]], margin: [20, 34], gutter: [12, 26], n: [[3, 2], [4, 3], [5, 3], [6, 2], [7, 1]] },
    { id: 'cn-4koma', w: 0.02, drafter: 'koma4', ratio: [['p34', 0.6], ['square', 0.4]], reading: 'ltr', frame: [['bold', 1]], margin: [26, 40], gutter: [14, 26], n: [[4, 1]], intents: KOMA },
  ],
  core: [
    { id: 'core-grid', w: 0.33, drafter: 'bsp', ratio: [['a4', 0.45], ['p34', 0.2], ['square', 0.2], ['wide', 0.15]], reading: 'ltr', frame: [['ink', 1]], margin: [22, 30], gutter: [10, 18] },
    { id: 'core-bsp', w: 0.33, drafter: 'bsp', ratio: [['a4', 0.45], ['p34', 0.2], ['square', 0.2], ['wide', 0.15]], reading: 'ltr', frame: [['ink', 1]], margin: [22, 30], gutter: [10, 18] },
    { id: 'core-page', w: 0.13, drafter: 'page', ratio: [['a4', 0.6], ['p34', 0.4]], reading: 'ltr', frame: [['ink', 1]], margin: [22, 30], gutter: [10, 18], opts: { vP: 0.18 } },
    { id: 'core-wide', w: 0.1, drafter: 'landscape', ratio: [['wide', 1]], reading: 'ltr', frame: [['ink', 1]], margin: [18, 28], gutter: [10, 18], n: [[3, 1], [4, 2], [5, 2], [6, 3], [8, 2], [9, 1]], opts: { gridOk: true } },
    { id: 'core-poster', w: 0.04, drafter: 'poster', ratio: [['a4', 0.6], ['p34', 0.4]], reading: 'ltr', frame: [['ink', 1]], margin: [24, 34], gutter: [12, 20], n: [[2, 2], [3, 3], [4, 3], [5, 2]] },
    { id: 'core-splash', w: 0.03, drafter: 'splash', ratio: [['a4', 0.5], ['p34', 0.3], ['square', 0.2]], reading: 'ltr', frame: [['ink', 1]], margin: [22, 30], gutter: [12, 18], n: [[1, 1], [2, 2], [3, 2]], intents: BIG_BEAT },
    { id: 'core-strip', w: 0.04, drafter: 'strip', ratio: 'byCount', reading: 'vertical', frame: [['ink', 1]], margin: [34, 50], gutter: [28, 60] },
  ],
};

const IW = {
  jp: { action: 2.0, impact: 1.4, chase: 1.3, emotion: 1.4, dialogue: 1.5, reveal: 1.2, suspense: 1.2, horror: 1.1, romance: 1.5, gag: 1.5, inner: 1.1, montage: 0.9, silence: 0.8, daily: 1.4, climax: 1.3, scenery: 0.8, sport: 1.3, food: 1.0, war: 0.8, court: 0.7, work: 0.7, medical: 0.7, magic: 1.2, disaster: 0.7, investigate: 1.0, travel: 0.8 },
  kr: { romance: 1.8, daily: 1.5, emotion: 1.6, dialogue: 1.5, suspense: 1.4, horror: 1.3, inner: 1.4, silence: 1.2, action: 1.3, chase: 1.1, reveal: 1.2, climax: 1.1, gag: 1.0, montage: 1.0, scenery: 1.0, impact: 1.0 },
  cn: { action: 1.6, magic: 1.6, war: 1.3, scenery: 1.6, travel: 1.4, inner: 1.3, romance: 1.3, emotion: 1.2, silence: 1.2, climax: 1.2, court: 1.0, food: 1.0 },
  core: {},
};
const intentWeight = (cult, id) => IW[cult][id] ?? (cult === 'core' ? 1 : 0.8);

const STRIP_RATIO = (n) => (n <= 3 ? [['strip', 1]] : n <= 5 ? [['strip', 0.6], ['tall', 0.4]] : n <= 7 ? [['tall', 0.6], ['scroll', 0.4]] : [['scroll', 1]]);

/* ------------------------------------------------------------------ *
 * 插入格摆放
 * ------------------------------------------------------------------ */
function rotPoly(x, y, w, h, deg) {
  const cx = x + w / 2, cy = y + h / 2;
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => [cx + (px - cx) * c - (py - cy) * s, cy + (px - cx) * s + (py - cy) * c]);
}

function placeInset(plan, host, slots, page, rng, ratioKind) {
  const pad = 18;
  let w, h, rot = 0;
  if (plan.kind === 'cutin') {
    w = rng.range(0.2, 0.32) * page.w;
    h = rng.range(0.085, 0.15) * (ratioKind === 'scroll' ? 1414 : page.h);
    rot = round2((rng.chance(0.5) ? 1 : -1) * rng.range(1, 4));
  } else if (plan.kind === 'corner') {
    w = rng.range(0.3, 0.42) * page.w;
    h = rng.range(0.12, 0.19) * page.h;
    rot = round2((rng.chance(0.5) ? 1 : -1) * rng.range(0, 3));
  } else {
    // 题字区：竖长条（横版页面上可以是横条）
    if (page.w > page.h) { w = rng.range(0.2, 0.3) * page.w; h = rng.range(0.08, 0.12) * page.h; }
    else { w = rng.range(0.075, 0.11) * page.w; h = Math.min(rng.range(220, 420), host.h * 0.7); }
  }
  w = Math.min(w, host.w * 0.6);
  h = Math.min(h, host.h * 0.5);
  if (w < 64 || h < 50) return null;
  const corners = rng.shuffle(plan.kind === 'title' ? ['tr', 'tl'] : ['tl', 'tr', 'bl', 'br']);
  for (const c of corners) {
    const jx = rng.range(0, Math.max(0, host.w * 0.08)), jy = rng.range(0, Math.max(0, host.h * 0.08));
    const x = c.endsWith('l') ? host.x + pad + jx : host.x + host.w - w - pad - jx;
    const y = c.startsWith('t') ? host.y + pad + jy : host.y + host.h - h - pad - jy;
    const poly = rotPoly(x, y, w, h, rot);
    const fake = { poly, over: true };
    if (checkInset(fake, host, slots)) continue;
    if (poly.some(([px, py]) => px < 6 || py < 6 || px > page.w - 6 || py > page.h - 6)) continue;
    return { x: round2(x / page.w), y: round2(y / page.h), w: round2(w / page.w), h: round2(h / page.h), rot };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 一套模板：草稿 → 几何 → 体检 → 标注
 * ------------------------------------------------------------------ */
function realize(culture, fam, rng) {
  const intents = Object.keys(INTENTS).filter((id) => !fam.intents || fam.intents.includes(id));
  const intent = rng.weighted(intents.map((id) => [id, intentWeight(culture, id)]));
  const n = fam.n ? rng.weighted(fam.n) : panelCountFor(intent, fam.id, rng);
  const ratio = fam.ratio === 'byCount' ? rng.weighted(STRIP_RATIO(n)) : rng.weighted(fam.ratio);
  const page = PAGE_PRESETS[ratio];
  if (fam.drafter === 'koma4' && ratio === 'square' && n !== 4) return { fail: 'koma4' };
  const seq = beatScript(intent, n, rng);
  const ctx = {
    culture, family: fam.id, intent, cls: intentClass(intent), seq, rng,
    reading: fam.reading, ratio, frame: rng.weighted(fam.frame),
    margin: int(rng, fam.margin), gutter: int(rng, fam.gutter), ...(fam.opts || {}),
  };
  const draft = DRAFTERS[fam.drafter](ctx);
  if (!draft) return { fail: 'draft' };
  const cfg = { page, margin: ctx.margin, gutter: ctx.gutter, reading: ctx.reading };
  let slots = buildSlots(draft.layout, cfg);
  // 插入格
  const insets = [];
  for (const plan of draft.insetPlan) {
    const host = slots.find((s) => s.role === '#' + plan.host);
    if (!host) return { fail: 'inset-host' };
    const rect = placeInset(plan, host, slots, page, rng, page.kind);
    if (!rect) {
      if (plan.kind === 'title') { ctx.flags.title = false; continue; }
      return { fail: 'inset-place' };
    }
    insets.push({ ...rect, role: plan.kind === 'title' ? `#t${plan.host}` : `#${plan.k}`, ...(plan.kind === 'title' ? { note: '题字区', borderless: ctx.frame === 'none' } : {}) });
  }
  if (insets.length) slots = buildSlots(draft.layout, { ...cfg, insets });
  // 阅读顺序：底格按自然顺序必须正好是拍子顺序；插入格 / 题字区插到宿主后面
  const kOf = (s) => (s.role.startsWith('#t') ? Number(s.role.slice(2)) + 0.5 : Number(s.role.slice(1)));
  const baseKs = slots.filter((s) => !s.over).map(kOf);
  for (let i = 1; i < baseKs.length; i++) if (baseKs[i] <= baseKs[i - 1]) return { fail: 'order' };
  const ranked = slots.map((s, i) => [i, kOf(s)]).sort((a, b) => a[1] - b[1]);
  const order = new Array(slots.length);
  ranked.forEach(([i], r) => { order[i] = r + 1; });
  const natural = slots.every((s, i) => s.order === order[i]);
  slots.forEach((s, i) => { s.order = order[i]; });
  // 体检
  const issues = checkQuality(slots, page);
  if (issues.length) return { fail: 'quality:' + issues[0].replace(/\].*/, ']') };
  for (const s of slots.filter((x) => x.over)) {
    const hk = Math.floor(kOf(s) - (String(s.role).startsWith('#t') ? 0.5 : 1));
    const host = slots.find((x) => !x.over && kOf(x) === hk) || slots.find((x) => !x.over && kOf(x) === Math.floor(kOf(s) - 0.5));
    if (host && checkInset(s, host, slots)) return { fail: 'inset-check' };
  }
  // 景别
  const base = slots.filter((s) => !s.over);
  const avgArea = base.reduce((a, s) => a + s.area, 0) / base.length;
  const roleOf = new Map();
  for (const s of slots) {
    const k = kOf(s);
    roleOf.set(s.role, Number.isInteger(k) ? pickRole(seq[k], s, avgArea) : 'silence');
  }
  const layout = mapRoles(draft.layout, roleOf);
  const insetDefs = insets.map((ins) => ({ ...ins, role: roleOf.get(ins.role) }));
  const finalSlots = slots.map((s) => ({ ...s, role: roleOf.get(s.role) }));
  const rolesInOrder = [...finalSlots].sort((a, b) => a.order - b.order).map((s) => s.role);
  const flags = ctx.flags || {};
  const tags = deriveTags({ culture, family: fam.id, intent, slots: finalSlots, page, flags, frame: ctx.frame, roles: rolesInOrder });
  const density = densityOf(finalSlots.length);
  const its = pickIntents(intent, [...finalSlots].sort((a, b) => a.order - b.order), tags, density);
  const sorted = [...finalSlots].sort((a, b) => a.order - b.order);
  return {
    def: {
      family: fam.id, culture, reading: ctx.reading, ratio, frame: ctx.frame, margin: ctx.margin, gutter: ctx.gutter,
      layout, insets: insetDefs.length ? insetDefs : undefined, order: natural ? undefined : order,
      tags, intents: its, panels: finalSlots.length,
      nameParts: [systemLabel(culture, fam.id, intent), structureLabel(fam.id, sorted, flags), featureLabel(flags, rolesInOrder, sorted)],
      desc: describe({ culture, family: fam.id, slots: sorted, flags, intents: its, reading: ctx.reading, page }),
    },
    slots: finalSlots, page, intent,
  };
}

function densityOf(n) { return n <= 3 ? 'low' : n <= 5 ? 'mid' : n <= 8 ? 'high' : 'dense'; }

function mapRoles(node, roleOf) {
  if (node.leaf) return { ...node, role: roleOf.get(node.role) || node.role };
  return { ...node, children: node.children.map((c) => mapRoles(c, roleOf)) };
}

/* ------------------------------------------------------------------ *
 * 包格式（紧凑）：节点 [dir, weights, children, {s,z}?]；叶子 'role' 或 ['role', {b,n,p}]
 * ------------------------------------------------------------------ */
export function encNode(node) {
  if (node.leaf) {
    const o = {};
    if (node.bleed) o.b = node.bleed === true ? 1 : node.bleed;
    if (node.borderless) o.n = 1;
    if (node.pad) o.p = node.pad;
    return Object.keys(o).length ? [node.role, o] : node.role;
  }
  const o = {};
  if (node.slant) o.s = node.slant;
  if (node.zigzag) o.z = 1;
  const a = [node.dir, node.weights.map(round2), node.children.map(encNode)];
  if (Object.keys(o).length) a.push(o);
  return a;
}

const READ_CODE = { rtl: 'r', ltr: 'l', vertical: 'v' };

function packEntry(id, name, def) {
  const e = {
    i: id, n: name, d: def.desc, fm: def.family, r: def.ratio, rd: READ_CODE[def.reading], f: def.frame,
    m: def.margin, g: def.gutter, k: def.panels, t: def.tags, it: def.intents, L: encNode(def.layout),
  };
  if (def.insets) e.x = def.insets.map((s) => [s.x, s.y, s.w, s.h, s.rot || 0, s.role, ...(s.note ? [s.note, s.borderless ? 1 : 0] : [])]);
  if (def.order) e.o = def.order;
  return e;
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */
export async function curatedIndex() {
  const idx = new DedupeIndex();
  for (const raw of [...curatedJp, ...curatedCn, ...curatedKr, ...curatedCore]) {
    const t = finalizeTemplate(raw);
    idx.add(fingerprint(t.slots, t.page, t.ratio));
  }
  return idx;
}

async function loadExisting(culture) {
  try {
    const mod = await import(pathToFileURL(path.join(ROOT, 'lib', 'packs', `${culture}.mjs`)).href + '?t=' + Date.now());
    return mod.default || [];
  } catch { return []; }
}

export async function generate(culture, idx, target) {
  const rng = makeRng(`panel-forge/${culture}/v1`);
  const fams = FAMILIES[culture];
  const out = [];
  const fails = {};
  const famCount = {};
  const intentCount = {};
  const prefix = { jp: 'jpg', kr: 'krg', cn: 'cng', core: 'cog' }[culture];
  let serial = 0;
  const existing = APPEND ? await loadExisting(culture) : [];
  if (existing.length) {
    // 追加模式：已有的全部保留，它们的指纹也进去重表
    const { decodeEntry } = await import('../lib/packs/decode.mjs');
    for (const e of existing) {
      const t = finalizeTemplate(decodeEntry(e, culture));
      idx.add(fingerprint(t.slots, t.page, t.ratio));
      out.push({ entry: e });
      serial = Math.max(serial, Number(String(e.i).split('-').pop()) || 0);
    }
  }
  let attempts = 0;
  const maxAttempts = target * 400;
  while (out.length < target && attempts < maxAttempts) {
    attempts++;
    const fam = rng.weighted(fams.map((f) => [f, f.w]));
    const r = realize(culture, fam, rng);
    if (r.fail) { fails[r.fail] = (fails[r.fail] || 0) + 1; continue; }
    const fp = fingerprint(r.slots, r.page, r.def.ratio);
    if (idx.has(fp)) { fails.dup = (fails.dup || 0) + 1; continue; }
    idx.add(fp);
    serial++;
    const id = `${prefix}-${String(serial).padStart(4, '0')}`;
    const name = [...r.def.nameParts, `#${serial}`].join('·');
    out.push({ entry: packEntry(id, name, r.def), slots: r.slots, page: r.page, def: r.def });
    famCount[fam.id] = (famCount[fam.id] || 0) + 1;
    intentCount[r.intent] = (intentCount[r.intent] || 0) + 1;
  }
  return { out, fails, famCount, intentCount, attempts };
}

async function writePack(culture, items) {
  const dir = path.join(ROOT, 'lib', 'packs');
  await mkdir(dir, { recursive: true });
  // JSON.parse 一个字符串字面量比同样内容的对象字面量解析快好几倍（几千条的大包，手机上差几百毫秒）。
  // 每条一行，方便 git diff 看出改了哪套。
  const json = '[\n' + items.map((x) => JSON.stringify(x.entry)).join(',\n') + '\n]';
  const body = `/* 自动生成：node scripts/gen-library.mjs —— 别手改（要改就改生成器，再用 --append 追加） */\n`
    + `export default JSON.parse('${json.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n\\\n')}');\n`;
  await writeFile(path.join(dir, `${culture}.mjs`), body, 'utf8');
  return Buffer.byteLength(body);
}

async function writeSheet(culture, items, count) {
  const { renderTemplateSVG } = await import('../lib/svg.mjs');
  const { decodeEntry } = await import('../lib/packs/decode.mjs');
  const rng = makeRng('sheet/' + culture);
  const pick = rng.shuffle(items).slice(0, count);
  const cards = pick.map((x) => {
    const t = finalizeTemplate(decodeEntry(x.entry, culture));
    return `<figure><div class="svg">${renderTemplateSVG(t, { width: 180, showNumbers: true, showRoles: false })}</div>`
      + `<figcaption><b>${x.entry.n}</b><br>${x.entry.t.join(' ')}<br><i>${x.entry.it.join(' ')}</i></figcaption></figure>`;
  }).join('\n');
  const html = `<!doctype html><meta charset="utf-8"><title>${culture}</title><style>
body{font:11px -apple-system,'PingFang SC',sans-serif;margin:12px;background:#fafafa}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
figure{margin:0;background:#fff;border:1px solid #ddd;padding:6px}
.svg svg{width:100%;height:auto;max-height:340px;display:block}
figcaption{margin-top:4px;line-height:1.35;color:#333}
</style><main>${cards}</main>`;
  await mkdir(path.join(ROOT, 'out'), { recursive: true });
  const f = path.join(ROOT, 'out', `gen-sheet-${culture}.html`);
  await writeFile(f, html, 'utf8');
  return f;
}

const ORDER = ['jp', 'kr', 'cn', 'core'];

async function main() {
  const idx = await curatedIndex();
  const cultures = ONLY ? [ONLY] : ORDER;
  // 去重表要和「整库一起生成」时一样，否则：单独重跑某一类，结果会和整库重跑对不上；追加的新模板可能和别的类撞版式。
  // 所以先把不在这次范围里的类的现有包放进去重表——整库重生成时是排在前面的类，追加时是其余全部类
  const { decodeEntry } = await import('../lib/packs/decode.mjs');
  const pre = ORDER.filter((c) => !cultures.includes(c) && (APPEND || ORDER.indexOf(c) < ORDER.indexOf(cultures[0])));
  if (APPEND) for (const c of cultures) if (c !== cultures[0]) pre.push(c);
  for (const c of pre) {
    for (const e of await loadExisting(c)) {
      const t = finalizeTemplate(decodeEntry(e, c));
      idx.add(fingerprint(t.slots, t.page, t.ratio));
    }
  }
  const report = {};
  for (const c of cultures) {
    const t0 = Date.now();
    const r = await generate(c, idx, TARGET);
    report[c] = r;
    const ms = Date.now() - t0;
    console.log(`\n■ ${c}: ${r.out.length} 套（尝试 ${r.attempts} 次，${(ms / 1000).toFixed(1)}s）`);
    console.log('  家族:', JSON.stringify(r.famCount));
    console.log('  主戏路:', JSON.stringify(r.intentCount));
    console.log('  丢弃:', JSON.stringify(Object.fromEntries(Object.entries(r.fails).sort((a, b) => b[1] - a[1]))));
    if (!DRY) {
      const bytes = await writePack(c, r.out);
      console.log(`  写入 lib/packs/${c}.mjs  ${(bytes / 1024).toFixed(0)} KB`);
    }
    if (SHEET) console.log('  抽样页:', await writeSheet(c, r.out, SHEET));
  }
  if (has('--phrases')) {
    const all = new Set();
    for (const c of cultures) for (const x of report[c].out) {
      for (const p of String(x.entry.n).split('·')) if (!p.startsWith('#')) all.add(p);
      for (const p of String(x.entry.d).split('；')) all.add(p);
    }
    console.log([...all].sort().join('\n'));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

