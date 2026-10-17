/**
 * llm.mjs — AI 层的 Node 入口
 *
 * 真正的逻辑都在 llm-core.mjs（浏览器与 Node 共用同一份 prompt 和校验）。
 * 这里只做一件事：把「环境变量 LLM_*」读进配置对象，再转交 core。
 *
 * 配置优先级：请求体 llm 字段 > 环境变量 LLM_* > 内置默认
 */

import { DEFAULT_BASE, llmStatusOf, testLlmWith } from './llm-core.mjs';

export * from './llm-core.mjs';

const env = (k) => (typeof process !== 'undefined' ? process.env?.[k] : undefined);

/* ------------------------------------------------------------------ *
 * 配置（Node 专用：能读环境变量）
 * ------------------------------------------------------------------ */
export function readLlmConfig(overrides = {}) {
  const rawProtocol = String(overrides.protocol || env('LLM_PROTOCOL') || 'openai').toLowerCase();
  const protocol = rawProtocol === 'anthropic' ? 'anthropic' : 'openai';
  const num = (v, def, lo, hi) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.max(lo, Math.min(hi, n));
  };
  return {
    protocol,
    baseUrl: String(overrides.baseUrl || env('LLM_BASE_URL') || DEFAULT_BASE[protocol]).trim(),
    apiKey: String(overrides.apiKey || env('LLM_API_KEY') || '').trim(),
    model: String(overrides.model || env('LLM_MODEL') || (protocol === 'anthropic' ? 'claude-3-5-sonnet-latest' : 'gpt-4o-mini')).trim(),
    timeoutMs: num(overrides.timeoutMs || env('LLM_TIMEOUT_MS') || 60000, 60000, 5000, 180000),
    temperature: num(overrides.temperature ?? env('LLM_TEMPERATURE') ?? 0.3, 0.3, 0, 1.5),
    maxTokens: num(overrides.maxTokens || env('LLM_MAX_TOKENS') || 3000, 3000, 256, 8000),
    source: overrides.apiKey ? 'request' : (env('LLM_API_KEY') ? 'env' : 'none'),
  };
}

export function llmStatus(cfg = readLlmConfig()) {
  const s = llmStatusOf(cfg);
  return {
    ...s,
    envVars: ['LLM_PROTOCOL', 'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_TIMEOUT_MS'],
  };
}

export async function testLlm(cfg = readLlmConfig()) {
  return testLlmWith(cfg);
}
