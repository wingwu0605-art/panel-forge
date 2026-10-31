/**
 * 生图提示词：三源（规则切分 / AI 优化 / 自己写）+ 形状开头词 + 避免项。
 *
 * 从 app.js 抽出。这里的函数只做"拼字符串 + 读 state"，但需要三样外部能力，
 * 所以用依赖注入而不是直接 import app.js（避免循环依赖）：
 *   · pagePlan()          当前页的分镜计划（规则/AI 提示词来自它）
 *   · activeCharPayload()  人设 / 风格参考（角色一致性那段话与参考图）
 *   · queueSave()         改动后落草稿
 *
 * app.js 启动时调 installPromptDeps(...) 接上即可。
 */
import { state } from './state.mjs';

let deps = {
  pagePlan: () => null,
  activeCharPayload: () => ({ block: '', refs: [] }),
  queueSave: () => {},
};

/** 由 app.js 注入外部依赖（只需调一次） */
export function installPromptDeps(next) {
  deps = { ...deps, ...next };
}

export function autoPromptOf(slot, panel) {
  if (panel?.promptEn) return panel.promptEn;
  const shape = panel?.shape || slot?.shape || null;
  return [shape?.prefixEn, 'single panel, no text'].filter(Boolean).join(', ');
}
/** 这一格的三份提示词：规则切分 / AI 生成 / 用户自己写（前两份由 plan 带下来） */
export function promptParts(slotId) {
  const slot = state.tpl?.slots?.find((s) => s.id === slotId);
  const panel = (deps.pagePlan()?.panels || []).find((p) => p.id === slotId) || null;
  const edit = state.promptEdits?.[slotId] || {};
  // 规则版：AI 覆盖前的那份；AI 版：AI 改写过的那份
  const rule = panel?.promptEnRule || panel?.promptEn || autoPromptOf(slot, panel);
  const ai = panel?.aiOptimized && panel?.promptEn ? panel.promptEn : '';
  const prefix = panel?.shape?.prefixEn || slot?.shape?.prefixEn || '';
  return { rule: rule || '', ai, mine: edit.prompt ?? '', prefix, panel, slot, edit };
}

/** 这一格最终用的提示词：按用户选的来源；手写时也要把「形状开头词」保留在最前面 */
export function effectivePrompt(slotId) {
  const parts = promptParts(slotId);
  const src = state.promptSrc?.[slotId] || 'rule';
  const base = src === 'mine' ? parts.mine : (src === 'ai' ? (parts.ai || parts.rule) : parts.rule);
  const usePrefix = state.promptPrefix?.[slotId] !== false;
  let prompt = base || '';
  if (usePrefix && parts.prefix && !prompt.startsWith(parts.prefix)) {
    prompt = prompt ? `${parts.prefix}, ${prompt}` : parts.prefix;
  }
  const edit = parts.edit;
  const autoNeg = parts.panel?.negative || '';
  return {
    prompt,
    negative: edit.negative ?? autoNeg,
    autoPrompt: parts.rule,
    autoNeg,
    src,
    usePrefix,
    hasAi: !!parts.ai,
    rule: parts.rule,
    ai: parts.ai,
    mine: parts.mine,
    prefix: parts.prefix,
    edited: src === 'mine' ? parts.mine.trim() !== '' : edit.prompt != null,
  };
}
/** 真正发给生图模型的那一段（角色一致性 + 提示词 + 避免项），预览和生图共用 */
export function buildImagePrompt(slotId) {
  const e = effectivePrompt(slotId);
  const chars = deps.activeCharPayload();
  const body = [chars.block, e.prompt].filter(Boolean).join(' ');
  return { ...e, chars, full: e.negative ? `${body} | avoid: ${e.negative}` : body };
}
export function setPromptEdit(slotId, field, value) {
  const e = effectivePrompt(slotId);
  const cur = { ...(state.promptEdits[slotId] || {}) };
  const auto = field === 'prompt' ? e.autoPrompt : e.autoNeg;
  if (value.trim() === auto.trim()) delete cur[field]; else cur[field] = value;
  if (Object.keys(cur).length) state.promptEdits[slotId] = cur; else delete state.promptEdits[slotId];
  deps.queueSave?.();
}
