/**
 * 靶场 · 模拟「内网里一个没有鉴权的服务」
 * 相当于：你本机某个只想着"只有我自己能访问，所以不用密码"的程序
 * 监听 127.0.0.1:7401
 */
import http from 'node:http';

const DATA = {
  service: '模拟内部服务（无鉴权）',
  note: '如果这个响应被别的网站读到，就等于"内部数据泄露"',
  user: 'student_demo',
  session: 'INTERNAL-SECRET-123456',
  records: ['内部记录 A', '内部记录 B'],
};

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/profile' || u.pathname === '/') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(DATA, null, 2));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('404');
}).listen(7401, '127.0.0.1', () => {
  console.log('靶场·内部服务  http://127.0.0.1:7401/profile');
});
