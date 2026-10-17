/**
 * 靶场 · 「修复前」的代理写法（⚠ 故意做出漏洞，仅供本机教学，别照抄）
 *
 * 两个错误叠加：
 *   1. 没有任何门槛：谁都能让它去 fetch 任意 URL（SSRF）
 *   2. CORS 全开：别的网站的 JS 不但能发请求，还能**读到返回内容**
 *
 * 监听 127.0.0.1:7400
 */
import http from 'node:http';

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const target = u.searchParams.get('url');
  if (!target) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('usage: /api/proxy?url=http://...');
    return;
  }
  try {
    // ❌ 危险：不校验来源、不校验目标地址
    const r = await fetch(target);
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(200, {
      'content-type': r.headers.get('content-type') || 'text/plain; charset=utf-8',
      'access-control-allow-origin': '*', // ❌ 危险：任何网站都能读
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('upstream error: ' + e.message);
  }
}).listen(7400, '127.0.0.1', () => {
  console.log('靶场·有漏洞的代理  http://127.0.0.1:7400/api/proxy?url=...');
});
