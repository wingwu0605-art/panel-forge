/**
 * 靶场 · 「恶意网页」的宿主（模拟你在逛的某个站）
 * 监听 127.0.0.1:7402 —— 注意：端口不同 = 不同的 origin（源）
 * 所以这个页面去访问 7400/7401/7311 都属于「跨源」
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

http.createServer(async (req, res) => {
  try {
    const html = await readFile(path.join(dir, 'evil.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
}).listen(7402, '127.0.0.1', () => {
  console.log('靶场·恶意网页  http://127.0.0.1:7402/');
});
