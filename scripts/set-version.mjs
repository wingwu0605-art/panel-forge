/**
 * 把仓库根 VERSION 同步到各处，避免"到处都有版本号、处处不一样"。
 *
 *   node scripts/set-version.mjs            # 同步（读 VERSION）
 *   node scripts/set-version.mjs 0.9.1      # 先改 VERSION，再同步（发版用）
 *
 * 落点：
 *   VERSION                                   唯一真源
 *   package.json                              "version"
 *   native/android/app/build.gradle           versionName / versionCode（由 semver 的 patch 累加）
 *   web/index.html                            <meta name="app-version">（应用内展示）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));

function readVersion() {
  if (!existsSync('VERSION')) throw new Error('缺少 VERSION 文件');
  return readFileSync('VERSION', 'utf8').trim();
}

if (args[0]) {
  const v = args[0].trim();
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`版本号要写成 X.Y.Z（收到 ${v}）`);
  writeFileSync('VERSION', v, 'utf8');
  console.log(`VERSION → ${v}`);
}

const version = readVersion();
const [maj, min, pat] = version.split('.').map(Number);
// Android 的 versionCode 必须单调递增：major*10000 + minor*100 + patch
const versionCode = maj * 10000 + min * 100 + pat;

// 1) package.json
{
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  if (pkg.version !== version) {
    pkg.version = version;
    writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`package.json → ${version}`);
  }
}

// 2) Android build.gradle
{
  const p = 'native/android/app/build.gradle';
  if (existsSync(p)) {
    let s = readFileSync(p, 'utf8');
    const before = s;
    if (/versionName\s+"[^"]*"/.test(s)) s = s.replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
    else s = s.replace(/versionCode\s+\d+/, (mm) => `${mm}\n        versionName "${version}"`);
    if (/versionCode\s+\d+/.test(s)) s = s.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
    if (s !== before) {
      writeFileSync(p, s, 'utf8');
      console.log(`android versionName ${version} / versionCode ${versionCode}`);
    }
  }
}

// 3) index.html meta（应用内展示 / 自动化断言）
{
  const p = 'web/index.html';
  let s = readFileSync(p, 'utf8');
  const meta = `<meta name="app-version" content="${version}">`;
  if (s.includes('name="app-version"')) {
    s = s.replace(/<meta name="app-version" content="[^"]*">/, meta);
  } else {
    s = s.replace(/<meta charset="utf-8">/i, `<meta charset="utf-8">\n  ${meta}`);
  }
  // 底部版本号文本（画师版/网页版都显示）
  if (s.includes('id="appVersion"')) {
    s = s.replace(/(id="appVersion"[^>]*>)[^<]*(<)/, `$1v${version}$2`);
    writeFileSync(p, s, 'utf8');
  } else {
    writeFileSync(p, s, 'utf8');
  }
  console.log(`index.html → app-version ${version}`);
}

console.log(`\n当前版本 v${version}（Android versionCode ${versionCode}）`);
