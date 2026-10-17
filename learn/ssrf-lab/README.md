# SSRF 教学靶场 · 从一个真实项目里发现的漏洞

> 这是我做的一个漫画分镜排版工具（PanelForge）里的**真实漏洞**，被我复现、修复后的完整教学材料。
> 全部数据是假的，全部服务只在 `127.0.0.1`，代码里没有任何真实业务逻辑。
> **`proxy-bad.mjs` 是故意写坏的**，用于演示，请不要照抄。

## 一、漏洞一句话

一个"帮你抓取远程图片"的接口 `/api/proxy?url=...`，**没有来源校验、没有目标地址校验、还返回 `Access-Control-Allow-Origin: *`**。
结果：**任何网页都能借这台电脑的位置，去访问它内网/本机上的其它服务，并读到返回内容。**

学术名称：**SSRF（Server-Side Request Forgery，服务端请求伪造）**
OWASP 归类：A10:2021 Server-Side Request Forgery。

## 二、怎么跑

```
双击 run-all.bat        （或分别 node victim.mjs / proxy-bad.mjs / proxy-fixed.mjs / evil-server.mjs）
浏览器打开 http://127.0.0.1:7402/
```

| 端口 | 角色 | 说明 |
| --- | --- | --- |
| 7401 | `victim.mjs` | 模拟**内网里一个没有鉴权的服务**（相当于 NAS 管理页 / 摄像头 CGI / 本地 AI 工具 API） |
| 7400 | `proxy-bad.mjs` | **有漏洞的代理**：无门槛 + CORS `*` |
| 7410 | `proxy-fixed.mjs` | **修复后的代理**：自定义头 + 来源校验 + 内网黑名单 |
| 7402 | `evil-server.mjs` | 模拟**你正在逛的恶意网页**（端口不同 = 不同 origin，所以是真正的跨源） |

停止：`stop-all.bat`，或关掉那 4 个黑窗口。

## 三、预期结果（3 个实验）

| 实验 | 请求 | 预期 | 说明 |
| --- | --- | --- | --- |
| A | `/` 直接 `fetch('http://127.0.0.1:7401/profile')` | **失败**（`Failed to fetch`） | 同源策略生效：光靠浏览器，恶意网页读不到别的服务 |
| B | 走 7400 有漏洞的代理取同一个地址 | **成功，读出 `session: INTERNAL-SECRET-123456`** | 这就是漏洞：代理替攻击者取了内网数据，而且它自己声明 CORS `*`，于是攻击者能读 |
| C | 走 7410 修复后的代理 | **失败（读不到响应）** | 修复版不返回跨域头；服务端三道门见下 |

## 四、服务端三道门（用 curl 验证，不受同源策略限制）

```bash
# 1) 不带头 -> 拒绝
curl -i "http://127.0.0.1:7410/api/proxy?url=http://127.0.0.1:7401/profile"
#    HTTP/1.1 403  {"error":"缺少 x-pf-client 头（仅本站页面可用）"}

# 2) 带头，但目标是内网 -> 拒绝
curl -i -H "x-pf-client: 1" "http://127.0.0.1:7410/api/proxy?url=http://127.0.0.1:7401/profile"
#    HTTP/1.1 403  {"error":"拒绝访问内网/本机地址：127.0.0.1"}

# 3) 带头，但来源是别的站 -> 拒绝
curl -i -H "x-pf-client: 1" -H "Origin: https://evil.example" "http://127.0.0.1:7410/api/proxy?url=https://example.com/"
#    HTTP/1.1 403  {"error":"拒绝外部来源调用代理：https://evil.example"}

# 4) 合法：本站页面 + 公网图片 -> 通过
curl -i -H "x-pf-client: 1" "http://127.0.0.1:7410/api/proxy?url=https://example.com/"
#    HTTP/1.1 200
```

## 五、原理分析（这是重点）

### 1. CORS 只挡"读"，不挡"发"

同源策略限制的是**读取响应**。一个简单的 `GET` 请求**照样会发出去**，只是结果读不到。

所以：**如果目标接口有副作用（`/reboot`、`/delete?id=1`），"盲发"也能造成破坏。**
这就是为什么只靠 CORS 不够，必须让请求**发不出去**。

### 2. 为什么"自定义头"能防盲发

浏览器规则：请求一旦带**非简单头**（如 `x-pf-client`），就必须先发 `OPTIONS` 预检。
预检由我们控制——跨站来源会被拒，于是真正的请求根本不会被发出。

这与 CSRF token 的思路同源：**用一个"跨站带不上的东西"来证明请求来源**。

### 3. 为什么 localhost 是重灾区

大量本地服务的设计假设是："只有本机能访问，所以不用密码。"
SSRF 恰好借了**本机的位置**，这个假设就失效了。

### 4. 严重度由上下文决定（同一段代码，两种命运）

| 部署位置 | 能碰到什么 | 严重度 |
| --- | --- | --- |
| 云服务器 | `169.254.169.254` 元数据 → 临时凭证 → 整机失守 | **Critical** |
| 家用笔记本 | 路由器管理页、本地 AI 工具（ComfyUI 8188 / A1111 7860 / Ollama 11434 / Jupyter 8888） | Low–High（取决于旁边跑什么） |

**结论：判断严重度，要问"从那个位置能碰到什么"，而不是"代码里写了什么"。**

### 5. 与本项目的关系

原项目修复后，`/api/proxy` 的默认行为：

- 只在监听 `127.0.0.1` 时启用；对外监听时默认关闭
- 必须带 `x-pf-client: 1`
- `Origin` 必须与 `Host` 一致
- 目标地址黑名单：`localhost` `*.local` `*.internal` `127.` `10.` `192.168.` `172.16-31.` `169.254.`（云元数据）`::1`
- 请求体上限 16MB；CORS 默认同源

## 六、可讨论的问题（留给课程）

1. **黑名单 vs 白名单**：内网 IP 黑名单能绕过吗？（提示：DNS rebinding、IPv6、十进制 IP、`0.0.0.0`、重定向）
2. **为什么"允许 `https://` + 只接受 `image/*`"比黑名单更稳？**
3. **DNS rebinding 如何让"校验时是公网、请求时是内网"？防御方式是什么？**（提示：连接时校验 IP，而不是解析时）
4. **CORS 与 CSRF 的关系**：为什么"没有 CORS 头"不等于"防住了 CSRF"？
5. **如果这个接口必须保留（产品需求），应该怎么设计？**（提示：不走通用 URL，改成本地上传 / 签名 URL / 独立域名隔离）
6. **供应链视角**：一个"图片代理"看起来无害，为什么在威胁建模时会被标成高风险？

## 七、参考

- OWASP · Server-Side Request Forgery：https://owasp.org/Top10/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/
- OWASP · SSRF Prevention Cheat Sheet
- PortSwigger Web Security Academy · SSRF 实验（免费，适合动手）：https://portswigger.net/web-security/ssrf
- Mirai 僵尸网络（2016，弱口令 IoT 的真实后果）：搜索 "Mirai botnet Dyn DNS attack"

## 八、免责

- 全部服务只监听 `127.0.0.1`，不对外网开放
- 全部数据是硬编码的假数据（`INTERNAL-SECRET-123456` 是编的）
- `proxy-bad.mjs` **故意**不安全，仅用于课堂演示
- 不要把这套代码用到任何真实系统
