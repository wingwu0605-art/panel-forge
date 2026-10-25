# PanelForge 原生壳（Android 起步）

目标：解决网页做不到的两件事 —— **和别的绘画 App 一键来回**，以及**本地工程文件/离线**。

网页版仍是同一套代码：壳里跑的就是 `site/` 的构建产物，只是检测到壳之后界面走性能档
（`body[data-shell]`：关掉 backdrop-filter、动画压到 180ms、热区提层）。

**状态：debug APK 已构建通过（5.07 MB，含 78 个前端文件），待装机验证。**

---

## 一、本机已经就绪的环境（2026-10 实测）

| 组件 | 位置 / 版本 |
| --- | --- |
| JDK | `C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot`（**Gradle 8.9 才支持 JDK 21**） |
| Android SDK | `%LOCALAPPDATA%\Android\Sdk`（build-tools 34.0.0 / platform-tools 37 / platforms;android-34） |
| Gradle | wrapper 已改成 **8.9**（原来是 8.2.1，跑不了 JDK 21） |
| 出包产物 | `native/android/app/build/outputs/apk/debug/app-debug.apk` |

三个 Windows 上的坑，已经在仓库里解决，换机器也照这个来：

1. **PowerShell 5.1 按 ANSI 读 .ps1** → 脚本必须是纯 ASCII，否则中文注释会直接把语法搞崩
2. **AGP 拒绝含中文的项目路径** → `android/gradle.properties` 里加了 `android.overridePathCheck=true`
3. **Capacitor CLI 的 TS 配置加载器在 Node 25 上崩** → 配置改用 `capacitor.config.json`

## 二、一条命令出包

```powershell
# 新机器先装 JDK + SDK（Studio 装过一次也行）
powershell -NoProfile -ExecutionPolicy Bypass -File native/scripts/install-sdk.ps1

# 出包（会自动找 JDK/SDK、同步 site/、写 local.properties、跑 gradlew）
powershell -NoProfile -ExecutionPolicy Bypass -File native/scripts/build-android.ps1
```

脚本自己的做的事：

- 找 JDK（Microsoft / Adoptium / Studio JBR）与 SDK，找不到给人话提示
- `node scripts/sync-site.mjs` → `npx cap sync android`
- 写 `android/local.properties`（gradle 认这个，**不需要设 ANDROID_HOME**）
- `gradlew assembleDebug`，失败时不需要你去猜路径问题

> `setx ANDROID_HOME` 那套完全不需要。如果 setx 报「拒绝访问注册表路径」，
> 说明 HKCU\Environment 权限有问题，别跟它较劲 —— 本项目用 local.properties 绕开了。

## 三、装到手机

```powershell
# 手机开发者选项 → USB 调试，然后用 adb 装
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r native/android/app/build/outputs/apk/debug/app-debug.apk
```

也可以把 APK 传到手机上点开安装（记得允许「安装未知来源」）。

## 四、已经写好的原生部分

| 文件 | 作用 |
| --- | --- |
| `android/app/src/main/java/art/wingwu/panelforge/MainActivity.java` | 接住 `ACTION_SEND`（首次启动 & 已在前台都处理） |
| `.../ShareTargetPlugin.java` | 把 `content://` 图片读成 base64 交给前端（WebView 里 fetch 不了 content://） |
| `AndroidManifest.xml` | `ACTION_SEND` + `image/*` 的 intent-filter：别的 App 分享时列表里会出现 PanelForge |
| `capacitor.config.json` | appId `art.wingwu.panelforge`、webDir `www`、深色背景（避免启动白闪）、开 WebView 调试 |

前端对应逻辑（`web/app.js`）：

- `SHELL` 检测 → `body[data-shell]` 性能档
- `shareOrDownload()` → 绘制页「分享」：壳里走 Capacitor Filesystem+Share，浏览器走 Web Share，都没有就下载
- `pullSharedImage()` / `initShareIn()` → 启动和回到前台时取分享进来的图，自动填进**当前选中格**（没选就第一空格）

## 五、装完要验的四条

1. 能启动、界面正常、能画（Klecks 在 WebView 里跑）
2. 相册/别的 App → 分享 → PanelForge，切回来图自动进格子
3. 绘制页「分享」拉起系统分享面板
4. 帧率：手机连电脑后，电脑 Chrome 打开 `chrome://inspect` → 看 WebView 的 Performance

## 六、已知限制

- 引擎还是 Klecks 跑在 WebView 里；Android 压感笔只走 PointerEvent（部分设备支持）
- 接收分享目前填「当前选中格」，还没做到「分享时指定格号」
- iOS / Windows / 鸿蒙还没做：Android 这层（Activity + Plugin）对应 iOS 的 Share Extension、
  Windows 的 Tauri command，逻辑可以照搬
