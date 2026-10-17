/**
 * 靶场 · 「修复后」的代理写法（对照用）
 *
 * 三道门，任一不过就拒绝：
 *   ① 必须带自定义头 x-pf-client: 1
 *      浏览器规则：自定义头 -> 必须先发 CORS 预检 -> 跨站页面发不出来
 *   ② Origin 校验：来源 host 必须和本站 host 一致
 *   ③ 目标地址黑名单：本机 / 内网 / 云元数据地址一律拒绝
 *
 * 注意：本文件故意**不**返回 Access-Control-Allow-Origin，
 *       所以别的网站的脚本连响应都读不到（浏览器层面就截止了）。
 *       服务端三道门的细节用 curl 验证（见 README）。
 *
 * 监听 127.0.0.1:7410
 */
import http from 'node:http';

const PORT = 7410;
const NAME = 'PanelForge';

const isPrivateTarget = (host) => {
  const h = host.toLowerCase();
  const localName = /^(localhost|localhost\.local|.*\.local|.*\.internal)$/.test(h);
  const privateIp = /^(127\.|0\.0\.0\.0|169\.254\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|\[::1\])/.test(h);
  return localName || privateIp;
};

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const deny = (code, msg) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: msg }, null, 2));
  };

  if (u.pathname !== '/api/proxy') return deny(404, 'not found');

  // ① 自定义头门槛（防"盲发简单请求"）
  if (req.headers['x-pf-client'] !== '1') {
    return deny(403, '缺少 x-pf-client 头（仅本站页面可用）');
  }

  // ② 来源校验
  const origin = req.headers.origin;
  if (origin) {
    let sameHost = false;
    try { sameHost = new URL(origin).host === req.headers.host; } catch { sameHost = false; }
    if (!sameHost) return deny(403, `拒绝外部来源调用代理：${origin}`);
  }

  // ③ 目标黑名单（SSRF 防护）
  const target = u.searchParams.get('url');
  if (!target || !/^https?:\/\//.test(target)) return deny(400, '需要 url=http(s)://...');
  let host = '';
  try { host = new URL(target).hostname; } catch { return deny(400, 'url 无法解析'); }
  if (isPrivateTarget(host)) return deny(403, `拒绝访问内网/本机地址：${host}`);

  try {
    const r = await fetch(target, { headers: { 'user-agent': `${NAME}-lab/1.0` } });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(200, {
      'content-type': r.headers.get('content-type') || 'application/octet-stream',
      // 故意不给 ACAO：跨源页面读不到
    });
    res.end(buf);
  } catch (e) {
    deny(502, 'upstream error: ' + e.message);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`靶场·已修复的代理  http://127.0.0.1:${PORT}/api/proxy?url=...`);
});
