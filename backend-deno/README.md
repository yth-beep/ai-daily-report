# 反馈后端 · Deno Deploy + Deno KV（主后端）

日报页面的「加重 / 减轻」按钮调用这个后端。它是**主后端**：`*.deno.dev` 在当前网络可访问。
原有的 Cloudflare Worker（`backend/`）**保留作为备用**，代码不动；两者 HTTP 契约完全一致，
前端和 `scripts/sync_feedback.py` 不需要区分是哪个后端。

> 为什么需要后端：GitHub Pages 是纯静态站点，浏览器里既不能安全保存 GitHub Token，
> 也没有任何位置能持久写回仓库。权重必须存在一个有状态的服务里，所以需要这个后端。

## API

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/health` | 无 | `{ ok: true, version: "1.0.0" }` |
| POST | `/api/feedback` | `X-Feedback-Key` | 应用一次 `+1` / `-1` |
| GET | `/api/weights` | `X-Feedback-Key` | 返回各领域累计权重 |

请求体：

```json
{ "domain": "ai-embedded", "delta": 1, "date": "2026-11-14", "eventId": "<UUID v4>" }
```

响应示例：

```json
{ "ok": true, "domain": "ai-embedded", "delta": 1, "weight": 3, "updatedAt": "2026-11-14T14:00:00.000Z" }
{ "ok": true, "idempotent": true, "domain": "ai-embedded", "weight": 3, "updatedAt": "..." }
{ "ok": true, "weights": { "ai-embedded": { "weight": 3, "updatedAt": "..." } } }
```

状态码：`200` 成功 · `400` 参数/JSON 非法 · `401` 密钥缺失或错误 · `404` 未知路由 ·
`405` 方法错误 · `409` 原子冲突重试耗尽（本次未写入） · `413` 请求体超过 4KB · `500` 内部错误（不返回细节）。

## 数据与并发

Deno KV 中两类 key 完全分开：

| Key | Value | 过期 |
|---|---|---|
| `["weight", <domain>]` | `{ weight: -10..10, updatedAt: ISO }` | 不过期 |
| `["event", <uuid>]` | `{ domain, delta, at }` | 约 30 天 |

每次写都是一次原子提交，同时校验两个条件：

1. `weight` 条目的 `versionstamp` 未被别人改动（避免丢失更新）；
2. `event` key 仍然不存在（同一个 `eventId` 只生效一次）。

提交冲突时重新读取并重试，**最多 5 次**；仍然失败就返回 `409`，不会静默丢弃这次反馈。
权重被限制在 `[-10, +10]`。

不记录 IP、User-Agent、Cookie 或任何个人信息。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `FEEDBACK_KEY` | 是 | 前端 `X-Feedback-Key` 要比对的共享密钥。**未配置时所有受保护接口一律 401**（空密钥不放行）。 |
| `ALLOWED_DOMAINS` | 否 | 允许的领域 ID，逗号分隔，默认 `ai-embedded`。必须与 `config/topics.json` 里 `enabled` 的领域一致。 |

密钥只存在于 Deno Deploy 的环境变量里，**不要写进仓库、不要写进 `docs/assets/feedback-config.js`**。

## 本地开发

```bash
cd backend-deno

deno task check   # 类型检查（main.ts + test.ts）
deno task test    # 34 项测试，全部用内存 KV mock，不联网
deno task dev     # 本地启动，默认 http://localhost:8000
```

本地跑服务的等价命令（`deno.json` 已经声明 `"unstable": ["kv"]`，所以不用手动加 `--unstable-kv`）：

```bash
deno run --allow-net --allow-env --allow-read --allow-write main.ts
```

用 curl 验证（把 `$KEY` 换成你本机设置的值）：

```bash
curl http://localhost:8000/health
curl -H "X-Feedback-Key: $KEY" http://localhost:8000/api/weights
curl -X POST http://localhost:8000/api/feedback \
  -H "Content-Type: application/json" -H "X-Feedback-Key: $KEY" \
  -d '{"domain":"ai-embedded","delta":1,"date":"2026-11-14","eventId":"11111111-2222-4333-8444-555555555555"}'
```

本地 KV 落在 Deno 自己的缓存目录里，不会在项目目录生成文件。

## 部署到 Deno Deploy（人工步骤）

前置：一个 GitHub 账号即可登录 Deno Deploy（免费额度足够这个用途）。以下步骤由你本人完成，
不需要把任何密码或密钥发给其他人。

1. **登录并创建项目**

   打开 <https://dash.deno.com/>，用 GitHub 账号登录 → `New Project`。
   项目名建议 `ai-daily-report-feedback`，入口文件选本仓库的 `backend-deno/main.ts`
   （可以直接连 GitHub 仓库，也可以先用 CLI 部署一次再在面板里绑定）。

2. **设置环境变量**

   项目页 → `Settings` → `Environment Variables`：

   - `FEEDBACK_KEY` = 你自己生成的一串随机字符（建议 32 位以上，例如
     `openssl rand -hex 24` 或 PowerShell `-join ((48..57)+(97..102) | Get-Random -Count 48 | % {[char]$_})`）
   - `ALLOWED_DOMAINS` = `ai-embedded`

   保存后重新部署一次让变量生效。

3. **部署（CLI 方式）**

   ```bash
   # 安装 deployctl（二选一）
   deno install -gArf jsr:@deno/deployctl
   npm i -g deployctl

   cd backend-deno
   deployctl deploy --project=ai-daily-report-feedback --prod main.ts
   ```

   首次运行会打开浏览器让你授权，授权由你本人完成。
   （具体子命令以 `deployctl --help` 为准；图形界面里点 `Deploy` 也能达到同样效果。）

4. **拿到 URL**

   部署成功后项目域名形如：

   ```
   https://ai-daily-report-feedback.<你的-org>.deno.dev
   ```

   先验证：

   ```bash
   curl https://ai-daily-report-feedback.<你的-org>.deno.dev/health
   # {"ok":true,"version":"1.0.0"}
   ```

5. **填进前端**

   编辑 `docs/assets/feedback-config.js`，把 `apiUrl` 换成上面这个域名（**不要**带 `/api/...` 路径，
   前端会自己拼）：

   ```js
   window.FEEDBACK_CONFIG = { apiUrl: "https://ai-daily-report-feedback.xxx.deno.dev" };
   ```

   然后提交并推送这个文件，Pages 更新后按钮才会真正可用。

6. **本机同步权重（可选但推荐）**

   ```powershell
   $env:FEEDBACK_API_URL = "https://ai-daily-report-feedback.xxx.deno.dev"
   $env:FEEDBACK_KEY     = "<同一个 FEEDBACK_KEY>"
   python scripts/sync_feedback.py --backend
   ```

   `run_boot.py` / `run_nightly.py` 会自动调用同一套同步逻辑，不需要手动跑。

## 轮换密钥

1. 在 Deno Deploy 的 `Settings → Environment Variables` 把 `FEEDBACK_KEY` 改成新值并重新部署；
2. 本机 `$env:FEEDBACK_KEY` 同步改成新值；
3. 各设备打开日报页点一次「加重/减轻」，弹窗里输入新密钥（旧的会返回 401，页面会提示）；
4. 或者让用户在浏览器里清除本站 localStorage 后再输入。

旧的 `eventId` 回执不受影响（它们只记 `domain/delta/at`，不含密钥）。

## 与 Cloudflare 版的关系

- `backend/`（Cloudflare Worker + Workers KV）代码保持不变，作为备用。
- 两个后端的路由、鉴权头、请求体、响应体、状态码语义一致，前端与同步脚本可无缝切换。
- 切换方式只有一个：改 `docs/assets/feedback-config.js` 的 `apiUrl`。
- 当前网络无法访问 `*.workers.dev`，所以主后端用 Deno Deploy。

## 已知限制

- 测试全部使用内存 KV mock，**没有对真实 Deno Deploy 跑过端到端**；首次部署后请用上面的 `curl` 自查一遍。
- 日期范围校验用「年份 2024 ~ 当前年+1」近似，不按 `Asia/Shanghai` 精确到天。
- 若使用 Deno Deploy 的早期访问版运行时（要求 `export default { fetch }`），需要额外适配；
  当前实现按经典运行时的 `Deno.serve` 编写。
- 本地 `Deno.openKv()` 在 Deno 2.9 仍需 `--unstable-kv`，已在 `deno.json` 的 `"unstable": ["kv"]` 中声明；
  Deno Deploy 运行时不需要这个标志。
