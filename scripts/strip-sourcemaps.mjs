import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
let n = 0;
for (const f of readdirSync(dir)) {
  if (!/\.(js|css)$/.test(f)) continue;
  const p = join(dir, f);
  const s = readFileSync(p, 'utf8');
  // 我们不分发 .map（省 5.6MB），所以把 dangling 的 sourceMappingURL 去掉，免得控制台一堆 404
  const t = s.replace(/\n?\/\/# sourceMappingURL=.*$/m, '').replace(/\n?\/\*# sourceMappingURL=.*?\*\/\s*$/m, '');
  if (t !== s) { writeFileSync(p, t); n++; }
}
console.log(`清理 sourceMappingURL：${n} 个文件`);
