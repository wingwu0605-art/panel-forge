# PanelForge 原生壳（Android 起步）

目标：解决网页做不到的两件事 —— **和别的绘画 App 一键来回**，以及**本地工程文件/离线**。

网页版仍然是同一套代码：壳里跑的就是 `site/` 的构建产物，只是检测到壳之后界面走性能档
（`body[data-shell]`：关掉 backdrop-filter、动画压到 180ms、热区提层）。

---

## 一、要先装的东西（本机目前一个都没有）

| 需要 | 说明 |
| --- | --- |
| **JDK 17 或 21** | Capacitor 6 / AGP 8 要求 JDK 17+ |
| **Android SDK**（platform-tools、build-tools、platform android-34+） | 命令行装也行，Android Studio 会帮你装齐 |
| Android Studio（可选但强烈建议） | 模拟器 + Logcat + 布局检查器，调 WebView 性能全靠它 |

Windows 上最快的一套：

```powershell
# 1) JDK（二选一）
winget install --id Microsoft.OpenJDK.21
# 或 winget install --id EclipseAdoptium.Temurin.21.JDK

# 2) Android Studio（自带 SDK Manager，装完打开一次让它装 SDK）
winget install --id Google.AndroidStudio

# 3) 装完后把 SDK 路径写进环境变量（Studio 默认装在这里）
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
setx PATH "$env:PATH;$env:LOCALAPPDATA\Android\Sdk\platform-tools"
```

装完 `adb devices` 能看到手机（先在手机里开发者选项 → USB 调试）就齐了。

---

## 二、跑起来

```powershell
cd native
npm install                 # 已装过一次；换机器要重装
node scripts/sync-site.mjs  # 把仓库根 site/ 同步到 native/www
npx cap sync android        # 同步产物 + 4 个原生插件
cd android
./gradlew assembleDebug     # 出包：app/build/outputs/apk/debug/app-debug.apk
# 或者直接跑到手机：
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

只想打开 Studio 调：`npx cap open android`。

> ⚠️ 根仓库的 `site/` 每次改完前端都要重新同步：`node scripts/sync-site.mjs && npx cap sync android`。

---

## 三、已经写好的原生部分

| 文件 | 作用 |
| --- | --- |
| `android/app/src/main/java/art/wingwu/panelforge/MainActivity.java` | 接住 `ACTION_SEND`（首次启动 & 已在前台都处理） |
| `.../ShareTargetPlugin.java` | 把 `content://` 图片读成 base64 交给前端（WebView 里 fetch 不了 content://） |
| `AndroidManifest.xml` | 加了 `<intent-filter>`：`ACTION_SEND` + `image/*`，所以别的 App 分享时会出现 PanelForge |
| `capacitor.config.json` | appId `art.wingwu.panelforge`、webDir `www`、深色背景（避免启动白闪） |

对应的前端逻辑（`web/app.js`）：

- `SHELL` 检测 → `body[data-shell]` 性能档
- `shareOrDownload()` → 导出/分享按钮：壳里走 Capacitor Filesystem+Share，浏览器里走 Web Share，都没有就下载
- `pullSharedImage()` / `initShareIn()` → 启动和回到前台时取分享进来的图，自动填进**当前选中的格子**（没选中就第一空格）

## 四、验证清单（这一轮要跑通的四条）

1. 装包能启动，界面正常、能画（Canvas 在 WebView 里跑 Klecks）
2. 在相册/别的 App 里「分享 → PanelForge」，切回来图自动进格子
3. 绘制页「分享」能拉起系统分享面板，把这一格发给别的 App
4. 手感/帧率可接受：`chrome://inspect`（手机连电脑后在电脑 Chrome 里看 WebView）

## 五、已知限制

- **不能装第三方笔刷引擎**：现在还是 Klecks 在 WebView 里跑，压力感应走 WebView 的 PointerEvent（Android 上支持部分压感笔）。
- **接收分享目前填「当前选中格」**：要做到分享时带上"填哪一格"，得在 intent 里带 extra，或让用户在壳里先选中格子（下一轮）。
- **iOS / Windows / 鸿蒙还没做**：代码结构上 Android 这层（MainActivity + 插件）对应 iOS 的 Share Extension / AppDelegate、Windows 的 Tauri command，逻辑可以照搬。
