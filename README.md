# AI 与嵌入式 Linux 双领域信息日报（GitHub Pages 站点）

> **阶段：上线前清理（第五阶段）+ 后端迁移（第六、七阶段）+ 采集本地化（第八阶段）。** 站点名称「AI 与嵌入式 Linux 双领域信息日报」，示例/占位页已从站点移除，`reports/` 只放真实日报。
> **反馈主后端为 Cloudflare Pages Functions**（`cloudflare-pages/`，`*.pages.dev` 可访问，复用现有账号、KV 与 `FEEDBACK_KEY`）；Cloudflare Worker（`backend/`）为备用，Deno Deploy 版（`backend-deno/`）因官方停止注册并宣布 2027 年关闭，仅作历史备份。
> **B站采集已本地化**（第 17 节）：插件只提供登录态 + 只读 API，搜索/过滤/字幕/评分由本项目完成，不启动 DSH 模型、不产生 token 费用。
> **逐条反馈 + 聚类权重 + 双领域 + 电源门禁**（第 18、22 节）：每条内容可「加重 / 减轻 / 清除标记」，同一内容只认最后一次选择；前端刷新后仍显示当前状态，历史点击保留审计但不会重复累计。AI 大模型与嵌入式 Linux 独立搜索、归属和展示；采集前必须接外接电源，22:00 汇总不受限。
> **抖音采集也已本地化**（第 19 节）：复用插件的独立浏览器 profile/CDP/本机 OCR，只走 8 个只读动作，不启动 DSH 模型、不调插件 `/run`、不产生 token 费用；B站与抖音各自独立采集，一个平台失败不影响另一个平台出报。
> **日报 AI 总结已接到 WorkBuddy**（第 20 节）：20:30 本地采集并生成输入，21:30 WorkBuddy 使用 `DeepSeek-V4.1-Flash` 总结、分级和推荐，22:00 Windows 任务校验并发布。DSH 模型与插件 `/run` 均不参与日常流程。
> **滚动去重与主题均衡**（第 21 节）：同一视频在最近 7 个自然日内不重复进入 WorkBuddy 或日报；索引只保留紧凑指纹，不扫描全部历史。B站/抖音按领域轮询高命中搜索词，避免嵌入式关键词占满搜索配额。
> 生产流程已部署：GitHub Pages 已上线，Windows 开机、20:30 采集和 22:00 发布任务均已注册；采集仍只执行公开只读动作，不点赞、不评论、不私信、不收藏、不投稿。
> `agent-synergy/` 已废弃，本项目不引用、不复制、不修改其中任何代码，也不把它作为技术底座。

站点同时维护 **AI 大模型** 与 **嵌入式 Linux** 两个独立领域：前者关注模型与 AI 产品生态，后者关注 Linux、开发板、MCU/RTOS、外设和端侧部署。数据链路是：本地采集 → 结构化条目 → 分领域分级日报 Markdown → 渲染成静态页面 → 走发布护栏提交到 Pages。

工作区已存在 `.git`。默认模式下脚本**不执行任何写 Git 操作**；`--publish` 是唯一能触发真实提交推送的开关，且带有源文件、remote、退出码三重护栏。所有发布相关测试都在临时目录 + 本地 bare 仓库完成，从不连接真实 GitHub。

手机稳定入口：<https://yth-beep.github.io/ai-daily-report/reports/latest.html>。`/reports/` 也会自动跳到它；页面始终显示最新一期，每日 22:00 发布后打开或刷新即可看到当天内容，打开状态下每 5 分钟检查一次内容哈希并在新一期出现时自动刷新。

---

## 1. 目录结构

```
E:\大学\项目\
├── docs/                          GitHub Pages 站点目录（Pages 只渲染这里）
│   ├── index.html                 站点首页，列表区块由脚本全量重建
│   ├── today.html                 跳到最新日报的稳定短入口
│   ├── .nojekyll                  跳过 Jekyll 处理，保证静态资源原样发布
│   ├── assets/styles.css          浅色响应式样式，手机端可读
│   ├── assets/feedback-config.js  反馈后端地址配置（apiUrl 占位，不写密钥）
│   ├── assets/feedback.js         加重/减轻/清除、状态恢复与后端调用
│   ├── assets/table-view.js       桌面表格视图（手机继续使用原文本布局）
│   ├── reports/YYYY-MM-DD.html    每日历史网页（固定日期归档）
│   ├── reports/latest.html        最新日报稳定页（每日覆盖）
│   └── reports/index.html         /reports/ 稳定入口，自动跳到 latest.html
├── reports/YYYY-MM-DD.md          本地权威日报源文件（不进入公开仓库；当前为空）
├── tests/
│   └── fixtures/2026-11-12.md     示例日报（仅测试用，不参与站点渲染）
├── config/
│   ├── runtime.json               时区、开机延迟、22:00、remote/branch、github、评分阈值、采集/总结器配置
│   ├── sources.json               数据源列表（本地 B站、手工 JSONL、RSS 占位）
│   └── topics.json                领域配置（id/name/enabled/priority/weight/keywords/exclude_keywords）
├── backend/                       Cloudflare Worker 反馈后端（备用，无 Secret，可公开）
│   ├── src/index.js               Worker 入口（/health、/api/feedback、/api/weights）
│   ├── wrangler.toml.example      配置示例（KV binding + 领域白名单占位）
│   ├── package.json               仅 wrangler 开发/部署命令说明
│   ├── test/index.test.js         后端测试（KV mock，不连真实 Cloudflare）
│   └── README.md                  部署与密钥配置步骤
├── cloudflare-pages/              Cloudflare Pages Functions 反馈后端（主后端，无 Secret，可公开）
│   ├── functions/_shared/handler.js  共享实现（鉴权/CORS/校验/KV 写入）
│   ├── functions/health.js           GET  /health
│   ├── functions/api/feedback.js     POST /api/feedback
│   ├── functions/api/weights.js      GET  /api/weights
│   ├── functions/api/feedback-events.js  GET /api/feedback-events（逐条事件）
│   ├── public/                       Pages 输出目录（说明页 + 404 页）
│   ├── test/                         49 项测试（KV 内存替身，含 list）
│   ├── wrangler.toml                 Pages 项目 + 现有 KV 绑定 + ALLOWED_DOMAINS
│   └── README.md                     部署命令、并发边界、密钥设置
├── backend-deno/                  Deno Deploy 反馈后端（历史备份，已停止注册）
│   ├── main.ts                    Deno.serve 入口 + Deno KV 原子写
│   ├── test.ts                    34 项测试（内存 KV mock）
│   ├── deno.json                  tasks / 严格 TS / unstable kv 声明
│   └── README.md                  部署、环境变量与密钥轮换步骤
├── .github/
│   └── ISSUE_TEMPLATE/weight-feedback.yml  旧 Issue 表单（历史兼容，默认流程不用）
├── scripts/
│   ├── common.py                  时区、极简 Markdown 渲染、页面/首页生成、偏好反馈注入
│   ├── publish_state.py           公开白名单、远端发布状态核对、发布回执
│   ├── render.py                  渲染 + 首页入口更新
│   ├── startup_check.py           开机检查：本地网页 + 远端发布状态 + 补发
│   ├── prepare_publish.py         22:00 发布准备 / 受控发布
│   ├── runtime.py                 运行时配置加载 + 退出码约定
│   ├── topics.py                  领域配置加载 + 本地权重覆盖（热更新）
│   ├── scoring.py                 关键词命中 / 排除词过滤 / 权重排序 / 重要性分级
│   ├── feedback.py                逐条反馈按钮 HTML + 标记解析（含旧 Issue 解析）
│   ├── feedback_weights.py        逐条事件 → 标签/标签对权重的确定性聚类
│   ├── sync_feedback.py           拉后端权重与事件（优先后端），写本地状态
│   ├── collect_core.py            条目 schema、去重、逐条 checkpoint
│   ├── adapters.py                数据源适配器（rss / jsonl）+ 扩展点
│   ├── build_ai_summary_input.py  生成 WorkBuddy 的紧凑 AI 输入
│   ├── validate_ai_report.py      发布前校验 WorkBuddy 结构化草稿
│   ├── summarizer.py              合并 WorkBuddy AI 草稿；缺失时确定性降级
│   ├── collect.py                 采集运行器（跑所有启用的适配器）
│   ├── run_boot.py                开机入口：查昨天发布 -> 补发或采集
│   ├── run_nightly.py             22:00 入口：缺数据失败 -> 用 AI 草稿汇总 -> 渲染 -> 发布
│   ├── regression_test.py         发布链路回归测试（临时目录 + 本地 bare repo）
│   ├── regression_test_stage2.py  第二阶段采集/汇总回归测试
│   ├── regression_test_stage3.py  第三阶段领域/评分/反馈回归测试
│   ├── regression_test_stage4.py  第四阶段后端反馈/同步回归测试
│   ├── regression_test_stage5.py  第五阶段生产入口自动同步回归测试
│   ├── import_dsh_reports.py      DSH（B站/抖音）插件报告导入器（备用/历史兼容）
│   ├── bilibili_local_worker.py   插件只读桥接器（在插件 venv 下运行，4 个只读 action）
│   ├── collect_bilibili_local.py  本地 B站采集（搜索/过滤/字幕/确定性评分，不用模型）
│   ├── douyin_local_worker.mjs    抖音只读桥接器（Node，8 个只读 action + 本机 OCR）
│   ├── collect_douyin_local.py    本地抖音采集（搜索/热榜/关注/详情/截帧OCR/确定性评分）
│   ├── regression_test_stage6.py  DSH 导入回归测试
│   ├── regression_test_stage7.py  本地 B站采集回归测试（假插件，不联网）
│   ├── regression_test_stage8.py  逐条反馈/聚类/领域优先级/电源门禁回归测试
│   ├── regression_test_stage9.py  本地抖音采集回归测试（假插件，不联网/不开浏览器）
│   ├── power.py                   电源门禁（WMI BatteryStatus → Win32_Battery）
│   ├── install_tasks.ps1          Windows 定时任务安装器（生产入口）
│   └── run_task.ps1               计划任务日志包装器（显式 Git 路径、UTF-8 日志）
├── state/                         运行时状态（已被 .gitignore 排除）
│   ├── startup_last_run.json      开机检查的「今日已执行」日期标记
│   ├── published/YYYY-MM-DD.json  push 成功后的发布回执（仅供审计）
│   ├── collections/YYYY-MM-DD.<源>.jsonl  逐条采集 checkpoint（去重、续采）
│   ├── inbox/                     手工投递目录（JSONL/JSON 采集器产出）
│   ├── topics_override.json       本机领域权重覆盖（不破坏公共配置）
│   ├── feedback_weights.json      标签/标签对权重（聚类产物，供评分使用）
│   └── feedback_processed.json    旧 Issue 幂等记录（历史兼容）
├── .gitignore
└── README.md
```

## 2. 环境要求

- Python 3.9+（本机 3.13），**零第三方依赖**，不需要 `pip install`。
- 所有日期固定按 **Asia/Shanghai**（UTC+8，无夏令时）计算。Windows 没有系统时区数据库，`zoneinfo` 不可用时回退固定 `+08:00`，结果一致且不需要 `tzdata`。
- 脚本通过 `__file__` 推导项目根目录，不硬编码中文路径；Git 调用不用 shell，避免路径/引号问题。

## 3. 如何使用

```bash
# 渲染全部日报 / 只渲染某天（可反复运行；reports/ 为空时首页显示「日报将在首次采集后生成」）
python scripts/render.py
python scripts/render.py --date 2026-11-20

# 开机检查：默认检查昨天，只做本地核对，不自动推送
python scripts/startup_check.py
python scripts/startup_check.py --date 2026-11-20 --force     # 测试/手动重跑
python scripts/startup_check.py --publish                     # 允许真实补发（需自己配好远端）

# 22:00 发布准备：生成网页 + 打印白名单 git 命令，不执行
python scripts/prepare_publish.py
python scripts/prepare_publish.py --date 2026-11-20           # 指定日期（补发用）
python scripts/prepare_publish.py --publish                   # 真实白名单提交推送

# 回归测试（临时目录 + 本地 bare repo，不碰真实仓库）
python scripts/regression_test.py
```

`startup_check.py` 与 `prepare_publish.py` 都支持 `--remote`（默认 `origin`）、`--branch`（默认 `main`）。

### 退出码（定时任务据此判断成败）

| 码 | `prepare_publish.py` | `startup_check.py` |
|---|---|---|
| 0 | dry-run 或发布成功 / 已确认可开始采集 | `start_collection` 或 `skipped_already_run` |
| 2 | 缺当天 `reports/<date>.md` 或日期非法（**立即中止，不做任何 git 操作**） | `pending_remote_publish`（不能开始采集） |
| 3 | 无 Git 仓库 / 未配置 remote | 日期非法 |
| 4 | `git add` 失败 | — |
| 5 | `git commit` 失败 | — |
| 6 | `git push` 失败 | — |

**关键约束**：`git add` / `commit` / `push` 任一真实失败都返回非 0；「没有新改动可提交」不是错误，会跳过 commit 并继续 push 已有提交，因此提交成功但推送失败后能可靠续推。

## 4. 公开仓库边界（第二轮修正）

> **公开仓库里所有被 Git 跟踪的文件都能被任何人看到。**
> GitHub Pages 选择 `/docs` 只表示**站点渲染来源是 docs/**，不等于「只有 docs/ 会公开」。
> `reports/`、`scripts/`、`state/`、`.workbuddy/`、Cookie、密钥、原始对话 JSON 一旦被 `git add`，就会出现在公开仓库里。

因此本模板采用**双层约束**：

1. **发布白名单**（唯一允许进入公开仓库的路径，定义在 `scripts/publish_state.py`）：
   ```
   git add -- docs README.md .gitignore
   ```
   **禁止 `git add .`**。脚本永远只执行白名单 add；回归测试会验证两份「查找开源项目」原始对话文件、`agent-synergy/`、`.workbuddy/`、`reports/`、`secret.key` 都不会被选中。
2. **`.gitignore`** 额外排除 `agent-synergy/`、`.workbuddy/`、`state/`、两份原始对话记录文件、Cookie / 登录态、密钥、原始采集数据（`raw/`、`*.jsonl`、`*.har` 等）与临时文件。只防「误添加」，不能替代白名单。

Pages 配置（**本轮未做任何线上操作**）：仓库推送后，在 **Settings → Pages** 选 `Deploy from a branch` → **Branch `main` / 文件夹 `/docs`** → Save，访问 `https://<用户名>.github.io/<仓库名>/`。

## 5. 22:00 更新原理

```
每天 22:00（已注册）
  → prepare_publish.py
  → 硬门禁：reports/<今天>.md 不存在 ⇒ 立即返回 2，不渲染、不 git add/commit/push
  → 有源文件：render_all() 生成网页，rebuild_index() 全量重建首页（幂等）
  → 打印白名单 git 命令（git add -- docs README.md .gitignore / commit / push）
  → 默认 [DRY-RUN]，不执行任何 git 命令，不推送
  → 仅 --publish 时真实执行：
       无 .git 或 remote ⇒ 3；add 失败 ⇒ 4；commit 失败 ⇒ 5；push 失败 ⇒ 6
  → push 成功后写 state/published/<date>.json 回执（仅审计，不作为发布依据）
```

是否「已发布」由 `remote_publish_status()` 以**远端分支提交内容**判定，不看本地文件、也不看回执。

## 6. 开机检查与远端发布确认

```
开机登录后延迟 5 分钟（已注册）
  → startup_check.py
  → 日期标记：今天已成功过(start_collection) ⇒ skipped_already_run；
              今天上次未完成 ⇒ 继续重试补齐
  → 本地侧：.md + .html 都有 / 只补网页 / 只写「缺失占位」页（不伪造内容）
  → 远端侧：git ls-remote 取 <remote>/<branch> 的 HEAD，
             用 git ls-tree 核对该提交是否包含 docs/reports/<昨天>.html
  → 只有「本地网页存在 + 源文件存在 + 远端状态 verified」才输出 start_collection(0)
  → 其余一律 pending_remote_publish(2)：
       no_git / no_remote / remote_unreachable / unverified / not_published
       都会打印明确的待发布状态与补发命令；默认不自动推送
  → 带 --publish 才尝试真实补发，补发后再次核对远端，确认成功才升级为 start_collection
```

远端状态含义：`verified` 远端提交确实含昨日网页；`not_published` 远端无该网页；`no_remote` 未配置远端；`remote_unreachable` 读不到远端；`unverified` 远端提交对象本地不可见、无法核对内容。**后四种都不能开始采集**。

## 7. 定时任务安装器

`scripts/install_tasks.ps1` 默认只打印，加 `-Apply` 才会注册：

- **使用绝对路径**：Python、Git、项目目录和任务包装器都由脚本显式解析，不依赖任务计划程序的 PATH。
- **正式任务**：`DailyReport-Boot` 在登录后延迟 5 分钟运行；`DailyReport-Collect` 每天 20:30 采集并生成 WorkBuddy 输入；`DailyReport-Nightly` 每天 22:00 校验 AI 草稿、渲染并发布。WorkBuddy 自己的定时任务在 21:30 运行总结。
- **发布开关**：加 `-EnablePublish` 才会把 `--publish` 传给两个入口；默认不带该开关时只生成本地内容。
- **可诊断日志**：`run_task.ps1` 把每次运行的 stdout/stderr 写入 `state/logs/`，并在 `last-boot.json` / `last-nightly.json` 记录退出码和日志路径。

若某台机器的 `New-ScheduledTaskTrigger -AtLogOn` 不支持 `Delay`，脚本会提示在任务计划程序里手动补 5 分钟延迟。

## 8. 安全边界

- 公开内容的**仓库边界**由白名单决定；页面文字只由 `reports/` 生成后落到 `docs/`。脚本不读取或上传 `.workbuddy/` 记忆、原始对话 JSON、Cookie、API Key、原始采集数据。
- 两份「查找开源项目-大模型自动收集信息…」原始对话文件已写入 `.gitignore`，且不在发布白名单内；**未删除、未移动任何现有用户文件**。
- 示例日报已移出站点：内容保存在 `tests/fixtures/2026-11-12.md`，只被回归测试复制进临时目录使用，**不参与正式渲染**；公开站点里没有示例页，也没有「缺失占位」页。
- 所有发布回归测试都在系统临时目录的本地 bare 仓库里进行，没有连接或推送真实 GitHub。

## 9. 回归测试（第二轮新增）

```bash
python scripts/regression_test.py
```

覆盖 8 组、共 20+ 条断言：缺当天源 + `--publish` 立即中止且不产生提交；模拟 push 失败返回非 0；修好远端后续推能跳过 commit 直接 push；白名单提交树不含私有数据；无 remote / 远端未含昨日发布时不输出 `start_collection`；远端已确认发布时输出 `start_collection`；默认 dry-run 不产生提交；首页幂等；`.gitignore` 命中 5 类非公开路径。实际运行结果记录在 `.workbuddy/memory/2026-11-13-acceptance-rework.md`。

## 10. 已知限制 / 后续再做

- 真实 GitHub 仓库、`origin/main` 与 GitHub Pages 已配置；发布凭据或 remote 变更后需要重新核对。
- Windows 的 `DailyReport-Boot`、`DailyReport-Collect`、`DailyReport-Nightly` 均已注册；WorkBuddy 的 `AI日报·每日AI总结` 也已启用。
- 真实采集由本地 B站/抖音只读采集器完成；缺当天源文件时 22:00 脚本直接失败退出（非 0），不会编造内容。
- `remote_publish_status()` 依赖本地能读到远端 HEAD 对应的 commit 对象；若远端由他人推送、本地没有该对象，会返回 `unverified`（保守不开始采集），需要 `git fetch` 后再检查。
- 渲染器是零依赖简化实现，不支持表格；行内代码内不要混用粗体/链接。
- `docs/reports/` 只保留真实日报与稳定入口；测试用页面不会进入正式发布白名单。

---

## 11. 第二阶段：生产运行器 + 采集框架

### 11.1 目标流程

**开机后 5 分钟（`run_boot.py`）**：
1. 检查昨天是否已确认发布（复用 `startup_check.py` 的远端核对）。
2. 未发布 → 尝试补发/准备；补发失败则**明确失败退出，不开始采集**。
3. 已发布 → 启动当天采集（`collect.py`）。

**20:30（`DailyReport-Collect`）**：运行本地 B站/抖音采集，生成 `state/ai-input/YYYY-MM-DD.json`。

**21:30（WorkBuddy）**：读取当天 AI 输入，用 `DeepSeek-V4.1-Flash` 生成并校验 `state/ai-reports/YYYY-MM-DD.json`；禁止操作浏览器和调用 DSH 模型。

**22:00（`run_nightly.py`）**：
1. 检查当天采集结果；无数据 → 失败退出，不发布。
2. 用汇总器生成当天 Markdown 日报。
3. 渲染 `docs/reports/YYYY-MM-DD.html` 并更新首页。
4. 走现有发布护栏，默认 dry-run；显式 `--publish` 才 `git commit + push`。

### 11.2 采集接口（`collect_core.py` + `adapters.py`）

每个采集条目固定包含：`id`（内容哈希）、`title`、`url`、`published`（发布时间）、`summary`（简介/字幕/OCR 摘要）、`author`（作者）、`platform`（来源平台）、`video_url`（视频链接）、`fetched`（抓取时间）、`source_type`、`source_id`。

- **按 URL/哈希去重**：`content_hash(title, url, summary)` 生成稳定 id，重复条目跳过。
- **逐条 checkpoint**：每条处理后立即写入 `state/collections/<date>.<源>.jsonl`，中途退出后可续跑（已处理的条目不再重复）。
- **只读公开内容**：绝不点赞、评论、私信、关注、投稿。
- **遇到 401/403/429、验证码或登录要求立即停止并记录，不绕过**（`CollectionError` 直接抛出并留日志）。

### 11.3 数据源适配器

已实现两个可测试适配器（`scripts/adapters.py`）：

| 适配器 | 类型 | 说明 |
|---|---|---|
| `RSSAdapter` | `rss` | 公开 RSS/Atom 订阅源，仅用 `xml.etree` + `urllib`（零依赖），在 `config/sources.json` 配 `url` |
| `JSONLAdapter` | `jsonl` | 手工投递：读 `state/inbox/` 下的 `.jsonl` / `.json`（数组或单对象），方便接入你或其他采集器产出 |

**如何添加数据源**：编辑 `config/sources.json`，在 `sources` 数组里加一项并 `"enabled": true`。`rss` 型填 `url`；`jsonl` 型把文件放进 `state/inbox/`（条目至少含 `title`，可选 `url`/`published`/`summary`，也兼容中文键 `标题`/`链接`/`发布时间`/`摘要`）。

**如何接入新平台（抖音/B站等）**：在 `adapters.py` 里新增一个 `BaseAdapter` 子类，实现 `collect()` 返回条目列表，并把类型名注册进 `ADAPTERS` 字典。**本轮刻意不写任何抖音/B站的登录或抓取逻辑**，只保留清晰的 adapter 扩展点。

### 11.4 汇总器接口（`summarizer.py`）

- 默认 `mode = "workbuddy-json"`：使用 WorkBuddy 生成的 AI 草稿；草稿缺失或损坏时回退到明确标注「**未AI总结**」的基础清单，不假装已完成大模型总结。
- `mode = "command"`：可配置本地模型调用命令（`summarizer.command`），条目以 JSON 走 stdin，stdout 作为正文；命令失败会抛错并让夜间入口非零退出。**密钥从不写死**，命令由 `config/runtime.json` 提供。

### 11.5 两个生产入口的退出码

| 码 | `run_boot.py` | `run_nightly.py` |
|---|---|---|
| 0 | 已发布→采集完成 / 采集跳过 | 生成日报并发布准备成功（dry-run 或发布） |
| 1 | 配置错误 | 配置错误 |
| 2 | 采集无数据 | 缺当天数据（不生成、不发布） |
| 3 | 补发失败（不开始采集） | 发布准备/推送失败 |
| 4 | 采集失败 | — |

`collect.py` 自身：0 成功（含 0 条）、1 配置错误、4 采集失败。

### 11.6 定时任务（`install_tasks.ps1`）

三个 Windows 任务负责生产入口：

- `DailyReport-Boot`：登录 + 5 分钟 → `run_boot.py`
- `DailyReport-Collect`：每天 20:30 → `collect.py`，采集后生成 WorkBuddy AI 输入
- `DailyReport-Nightly`：每天 22:00 → `run_nightly.py`

WorkBuddy 自己的定时任务在每天 21:30 读取输入并生成 AI 结构化草稿。脚本解析绝对 Python/Git 路径；`-Apply` 注册任务，`-EnablePublish` 才允许真实提交推送。任务包装器会记录日志并显式使用 Git 路径，避免非交互任务环境找不到 Git。

### 11.7 机器相关配置与可选增强

- **GitHub remote / Pages / 发布凭据**：已由仓库配置提供；换机时需重新配置。
- **Windows 定时任务**：由 `install_tasks.ps1 -EnablePublish -Apply` 注册。
- **B站 / 抖音登录态**：分别来自两个 DSH 插件的独立 profile；登录过期后需本人重新扫码。
- **网络代理**：GitHub Git 访问可在项目本地配置中指定本机代理；代理端口变化时需同步更新。
- **日报 AI 总结**：默认由 WorkBuddy 使用 `DeepSeek-V4.1-Flash` 生成结构化草稿；草稿不可用时确定性模板明确标注“未 AI 总结”。
- **额外公开 RSS/Atom 源**：示例源默认关闭，需要时在 `config/sources.json` 启用。

---

## 12. 第三阶段：热更新领域 + 分级日报 + 权重反馈

### 12.1 热更新领域配置（`config/topics.json`）

领域（关注主题）完全由 `config/topics.json` 描述，**新增领域只需改 JSON，不用改代码**。每个领域至少包含：

- `id`（唯一标识，如 `ai-models`）
- `name`（显示名）
- `enabled`（是否启用）
- `weight`（基础权重）
- `keywords`（命中关键词）
- `exclude_keywords`（排除词，命中即过滤）

所有采集、评分、总结运行时都会重新读取该文件（无缓存），因此编辑后下次运行即生效。

**如何新增领域**：在 `topics` 数组里加一项即可，例如：

```json
{"id": "ml-ops", "name": "机器学习工程", "enabled": true, "weight": 2.0,
 "keywords": ["MLOps", "训练", "数据标注"], "exclude_keywords": ["招生"]}
```

**本机权重覆盖**（不破坏公共基础配置）：人工反馈写入 `state/topics_override.json`（如 `{"ai-models": {"delta": 1}}`），与 `config/topics.json` 分开。最终权重 = `clamp(base_weight + delta, -10, +10)`。

### 12.2 分级日报

- 每条内容保留：来源平台、标题、作者、发布时间、视频 URL、简介/字幕/OCR 摘要。
- 重要性分数 = `领域有效权重 × 命中关键词数`；`score >= threshold`（`config/runtime.json` 的 `scoring.threshold`，默认 1.5）判为**重要**，其余为**次要**。
- **重要条目**：详细段落，含**核心问题**（据标题）、**关键方法 / 结论**（摘自字幕/简介原文）、**适用场景**（由命中关键词推断）、来源/作者/播放量与视频链接；内容不足时如实写「无法给出方法或结论（不编造）」。
- **次要条目**：严格一行概括 + 视频链接，避免日报膨胀。
- 命中排除词的内容被过滤掉，不进日报。**合集/多P条目只按标题判定排除词**（`content_type=collection`，见 `scoring.exclusion_text`）：合集摘要是最多 200 集字幕的合并正文，讲解 XSS 危害时的「弹广告」、某一集里的「优惠券」都会误触发，导致整条被丢；标题才是卖课/带货意图的位置。单视频仍按标题 + 摘要判定。
- 页面明确标识「**AI 总结**」或「**未AI总结**」；没有模型时绝不假装已总结。

### 12.3 逐条「这条加重 / 这条减轻」反馈（专用后端，无需登录）

GitHub Pages 是纯静态站点，**不能写回仓库，也无法在浏览器里安全保存 GitHub Token**。为了手机和电脑点击都能直接提交、不跳 GitHub、不需要平台账号登录，反馈走 **Cloudflare Pages Functions + Workers KV**：

1. **每一条内容后面**（重要条目和「其他相关」里的每一条都算）紧跟一行按钮：`这条加重` / `这条减轻` / `清除标记`，并有**自己的状态提示**（提交中 / 已加重这一条 / 已减轻这一条 / 失败原因）。
2. 按钮携带 `data-item-id`（稳定内容哈希）、`data-report-date`、`data-domain`、`data-tags`（命中的领域关键词）、`data-title`。只带领域 ID 是不够的——聚类需要知道**是哪一条**被点了。
3. 点击后**直接调用后端** `POST /api/feedback`，不跳转 GitHub。
4. 首次点击弹出页面内自定义设定框（不是 `window.prompt`），输入**反馈密钥**；密钥只存在本设备 `localStorage`，可清除。
5. 用 `crypto.randomUUID()` 生成 `eventId` 保证幂等。
6. 同一内容无论点多少次，**只有最后一次选择参与权重计算**；刷新页面后会读取后端最新状态并保留「（已加重这一条）/（已减轻这一条）」小字。点击「清除标记」会提交 `delta=0`，撤销该条当前权重并移除旧小字。
7. 失败显示可读错误，**不假装成功**；旧点击仍保留在事件历史中用于审计，但会被最新状态替代，不再重复累计。
7. API 地址未配置时按钮禁用，并逐条提示先部署后端。

原来的「日报底部统一偏好调整区域」已**删除**。后端地址配置在 `docs/assets/feedback-config.js`（`apiUrl` 为空占位，**不写密钥**）。

### 12.4 本地同步（`scripts/sync_feedback.py`）

优先后端模式：先 `GET /api/weights` 拉领域累计权重写入 `state/topics_override.json`，再 `GET /api/feedback-events` 拉逐条事件做**确定性聚类**写入 `state/feedback_weights.json`（详见第 18 节）：

```bash
# 用环境变量传入后端地址和密钥（不写入仓库/配置文件）
export FEEDBACK_API_URL="https://ai-daily-report-feedback.pages.dev"
export FEEDBACK_KEY="你的反馈密钥"
python scripts/sync_feedback.py
```

- 权重范围 `[-10, +10]`。
- 旧的 GitHub Issue 解析函数保留仅作历史兼容，用户界面和默认流程**完全不用 GitHub 登录**。

**生产入口会自动同步，无需手动运行**：`run_boot.py` 在昨天确认发布后、开始采集前同步；`run_nightly.py` 在生成日报前再同步一次（保证 22:00 前的新反馈被使用）。两者都通过同一个公共函数 `sync_backend_weights_soft()` 调用，**始终走后端模式，绝不落到 GitHub Issues**。行为：

| 场景 | 行为 |
|---|---|
| 未配置 `FEEDBACK_API_URL` / `FEEDBACK_KEY` | 打印「后端尚未配置，使用本地权重」，继续，不报失败 |
| 后端网络失败 / 401 / 其他错误 | 保留已有本地权重，打印警告，继续采集/发布，不阻断 |
| 同步成功 | 写入 `state/topics_override.json`，随后的评分/分级立即使用新权重 |

### 12.5 哪些数据本地保存 / 哪些在云端

- **本地保存**（`state/`，已被 `.gitignore` 排除）：采集 checkpoint、权重覆盖 `topics_override.json`、发布回执。
- **云端公开仓库**：只发布 `docs/`、`README.md`、`.gitignore`、`.github/`、`backend/`、`backend-deno/`、`cloudflare-pages/`（白名单）。后端源码与前端配置可公开；**反馈密钥 `FEEDBACK_KEY` 永不发布**（只存在 Cloudflare Secret / Pages Secret 里）。
- 浏览器的 `localStorage` 只存该设备的反馈密钥，不作为跨设备权威数据。

### 12.6 `sync_feedback.py` 退出码

| 码 | 含义 |
|---|---|
| 0 | 同步成功（后端模式拉取权重 / 历史模式无新反馈） |
| 1 | 配置错误（缺 `FEEDBACK_API_URL`/`FEEDBACK_KEY` 等） |
| 2 | 后端/网络不可用或密钥错误（保留上次权重） |

---

## 13. 后端部署（主：Cloudflare Pages Functions）

**为什么必须有后端才能写数据**：GitHub Pages 是纯静态文件服务，前端无法把「点击加重」写回仓库，浏览器里也没有安全的地方存 GitHub Token；因此需要一个有状态的后端接收并保存权重，前端只发请求。

**为什么主后端是 Cloudflare Pages Functions**：Worker 已经部署成功，但**当前网络无法访问 `*.workers.dev`**；Deno Deploy 已停止新账号注册并宣布 2027 年关闭，不能作为长期依赖。`*.pages.dev` 在当前网络实测可访问，并且能**复用已有的 Cloudflare 账号、已有的 KV namespace 和已有的 `FEEDBACK_KEY`**，不需要新账号、新域名或 GitHub 登录。因此主后端改为 Pages Functions，Worker 与 Deno 版代码都保留作备份，不删除。

三种后端的路由、鉴权头、请求体、响应体与错误码语义一致，切换只改一处：`docs/assets/feedback-config.js` 的 `apiUrl`。前端和 `scripts/sync_feedback.py` 不需要区分后端类型。

### 13.1 代码位置

```
cloudflare-pages/
├── functions/
│   ├── _shared/handler.js    共享实现（`_` 开头的目录不会被当成路由）
│   ├── health.js             GET  /health
│   └── api/feedback.js       POST /api/feedback
│       api/weights.js        GET  /api/weights
├── public/                   Pages 输出目录（说明页 + 404 页）
├── test/                     40 项测试（KV 内存替身，不联网）
├── wrangler.toml             Pages 项目 + KV 绑定 + 非敏感变量
└── README.md                 部署、命令、并发边界说明
```

### 13.2 部署步骤（人工）

1. 复用已有 Cloudflare 账号登录：`npx --yes wrangler@latest login`（浏览器授权由你本人完成）。
2. 创建 Pages 项目（已存在可跳过）：

   ```bash
   cd cloudflare-pages
   npx --yes wrangler@latest pages project create ai-daily-report-feedback --production-branch=main
   ```

3. 确认 `wrangler.toml` 里的 KV 绑定是现有 namespace（`23beae27ecf34a63b89899f0947cd320`），`ALLOWED_DOMAINS=ai-models,ai-embedded,embedded-linux-foundation`。
4. 设置密钥（交互输入，**不写入任何文件**）：

   ```bash
   npx --yes wrangler@latest pages secret put FEEDBACK_KEY --project-name=ai-daily-report-feedback
   ```

   可以直接填 Worker 里那个 `FEEDBACK_KEY`，这样本机环境变量和各设备已输入的密钥都不用改。
5. 部署：

   ```bash
   npx --yes wrangler@latest pages deploy public --project-name=ai-daily-report-feedback
   ```

6. 得到 `https://ai-daily-report-feedback.pages.dev`，先 `curl .../health` 验证 `{"ok":true,...}`。
7. 把该域名填进 `docs/assets/feedback-config.js` 的 `apiUrl`（**不带** `/api/...` 路径），提交并推送。
8. 本机设置 `FEEDBACK_API_URL` / `FEEDBACK_KEY` 后，`run_boot.py`、`run_nightly.py` 会自动同步权重。

完整命令与排错见 `cloudflare-pages/README.md`。

### 13.3 本地开发

```bash
cd cloudflare-pages
npx --yes wrangler@latest pages dev     # http://localhost:8788，本地模拟 KV
```

`wrangler pages dev` 默认使用本地模拟 KV（`.wrangler/`，已 gitignore），不读写线上数据。`--remote` 才会连真实 KV，谨慎使用。

### 13.4 后端测试

```bash
cd cloudflare-pages
npm test        # node --test，40 passed，不联网、不需要 wrangler
```

覆盖：鉴权（缺密钥 / 错密钥 / 未配置密钥）、CORS（放行 / 拒绝 / 预检）、参数校验（领域 / delta / 日期 / eventId / JSON / 4KB）、`+1`/`-1`/条目级 `0` 清除、同一 itemId 最后一次选择覆盖、幂等、clamp `±10`、事件 TTL、`GET /weights`、405/404、写入被覆盖后的重试收敛、持续冲突返回 409 且删除回执、KV 异常 500 不泄漏栈、路由文件布局与 `onRequest` 透传。

### 13.5 并发边界（KV 没有 CAS）

Pages 用的是 Workers KV，**没有 compare-and-swap**，本轮没有引入 Durable Object / D1，所以给的是「明确边界 + 尽量收敛」：

- 先查 `event:<eventId>` 回执，命中直接返回 `idempotent`，**同一 eventId 不会重复计数**（双击、客户端重试、网络重发都走这条）。
- **先写回执再写权重**：中途失败只会少记一次，不会重复计。
- 写权重后**回读校验**，发现被旧值覆盖就基于新值重算，最多 3 次。
- 仍收敛不了返回 `409` 并删掉刚写的回执，客户端可用同一 eventId 重试——**不假装成功**。
- **无法保证**：两个不同 eventId 在同一毫秒、不同 colo 到达时仍可能丢一次增量。本站是单人日报，每天几次点击，可忽略；`GET /api/weights` 能看出实际值。

要严格线性一致，可选 Durable Object 或 D1（`INSERT OR IGNORE` + `UPDATE ... SET weight = MAX(-10, MIN(10, weight + ?))`），需要新增绑定，本轮按「复用现有 KV」的要求未实施。

---

## 14. Deno Deploy（历史备份，不再作为依赖）

`backend-deno/` 保留但不再使用：Deno Deploy 已停止新账号注册（`403 SIGNUP_UNAVAILABLE`）并宣布 2027 年 4 月关闭，不能作为长期后端。代码与 34 项测试仍在，需要时可参考其 `README.md` 重新启用。

---

## 15. Cloudflare Worker（备用后端）

备用路径：`*.workers.dev` 在当前网络不可达，但代码与 19 项测试保持可用，配置步骤留档。

### 15.1 代码位置

```
backend/
├── src/index.js           Worker 入口（/health、/api/feedback、/api/weights）
├── wrangler.toml.example  配置示例（复制为 wrangler.toml 填写）
├── package.json           仅 wrangler 开发/部署命令说明
├── test/index.test.js     后端测试（KV mock，不连真实 Cloudflare）
└── README.md              部署与密钥配置步骤
```

### 15.2 部署步骤（人工）

1. 安装 wrangler：`npm install -g wrangler`，然后 `npx wrangler login`。
2. 在 Cloudflare 控制台创建 **KV namespace**，记下 namespace id。
3. 复制 `backend/wrangler.toml.example` 为 `backend/wrangler.toml`，填入 `id` 和 `preview_id`。
4. 设置 Secret（**不写入任何文件**）：`npx wrangler secret put FEEDBACK_KEY`，输入一个随机长字符串。
5. `npx wrangler dev` 本地调试（`http://localhost:8787`）。
6. `npx wrangler deploy` 得到 Worker 地址。
7. 把 Worker 地址填入 `docs/assets/feedback-config.js` 的 `apiUrl`。
8. 各设备首次点击「加重/减轻」时输入反馈密钥（同第 4 步设置的值）。

### 15.3 轮换密钥

`npx wrangler secret put FEEDBACK_KEY` 重新输入即可覆盖。轮换后各设备下次提交会被 401 拒绝并提示重新输入。

### 15.4 后端 API 与安全（三个后端一致）

| 端点 | 鉴权 | 说明 |
|---|---|---|
| `GET /health` | 无 | 返回 `{ok, version}` |
| `POST /api/feedback` | `X-Feedback-Key` | 提交 `+1`/`-1`；条目级可提交 `0` 清除（`domain`/`delta`/`date`/`eventId`） |
| `GET /api/weights` | `X-Feedback-Key` | 返回各领域累计权重 |
| `GET /api/feedback-events` | `X-Feedback-Key` | 返回历史事件与每个 itemId 的最新 `itemStates`（含 tags/title/delta） |

- KV：`weight:<domain>` 存累计权重（`-10~+10`）+ `updatedAt`；`event:<eventId>` 幂等回执（TTL 30 天）。**不记录 IP/UA/Cookie/个人信息**。
- CORS 仅允许 `https://yth-beep.github.io` 和本地开发地址；请求体限制 4 KB。
- 密钥错误 401；参数错误 400；方法错误 405；未知路由 404；返回 JSON 不泄漏密钥或异常栈。

### 15.5 Worker 后端测试

```bash
cd backend
npm test        # node --test，内存 KV mock，不连真实 Cloudflare
```

覆盖鉴权、CORS、参数校验、+1/-1、幂等、权重 clamp 与 `GET /weights`。

### 15.6 环境变量如何由计划任务继承

`run_boot.py` / `run_nightly.py` 通过环境变量 `FEEDBACK_API_URL` 和 `FEEDBACK_KEY` 访问后端。计划任务需要让子进程继承这两个变量，推荐做法（三选一，**密钥不写入任务脚本或仓库**）：

1. **用户级环境变量**（推荐）：在 Windows「系统属性 → 环境变量 → 用户变量」里设置 `FEEDBACK_API_URL` 和 `FEEDBACK_KEY`，之后登录会话里的计划任务自动继承。
2. **计划任务属性里单独设置**：任务计划程序 → 选中任务 → 属性 → 操作，把 Python 命令包进一个不含密钥的小脚本，或在该任务「条件/设置」里通过「启动于」指定的会话继承用户变量。
3. **用 `.env` + 本地加载**：把密钥放在仓库外的 `.env`（已被 `.gitignore` 排除），由启动脚本读入——但这属于后续可选增强，当前脚本直接读环境变量。

**后端未配置 / 不可用时的行为**：见第 12.4 节表格——未配置打印「后端尚未配置，使用本地权重」继续；网络失败/401 保留上次本地权重继续，均不阻断采集与发布。

**安全**：`FEEDBACK_KEY` 只能存在于 Cloudflare Secret 和本机环境变量，**不得**写入 `install_tasks.ps1`、任何脚本、`wrangler.toml` 或提交到仓库。

---

## 16. DSH 插件报告接入（B站 / 抖音，2026-11-14）

采集由外部 DSH 插件完成（只读、不点赞/不评论/不私信/不投稿），本仓库只负责**导入**它们的 Markdown 报告。

### 16.1 报告位置与格式

```
~/.dsh/bili-duty/out/YYYY-MM-DD.md
~/.dsh/douyin-duty/out/YYYY-MM-DD.md
```

每个条目是一个 `###` 块，块内是 `- **字段**：值` 列表。支持的字段名：

| 含义 | B站标签 | 抖音标签 | 其它别名 |
|---|---|---|---|
| 标题 | 标题 | 标题 | 视频标题 / title |
| 作者 | UP | 作者 | UP主 / 上传者 / author |
| 链接 | 链接 | 链接 | 视频链接 / 地址 / url |
| 播放量 | 播放量 | 播放量 | 播放 / views |
| 档位 | 档位 | 档位 | 评级 / 推荐度 |
| 推荐理由 | 为什么值得 | 为什么值得 | 推荐理由 |
| 一句话 | 一句话 | 画面 / 画面摘要 | 摘要 / summary |

`summary` 由「为什么值得 + 一句话/画面摘要」拼成；`why`、`one_line`、`grade`、`views` 也会作为额外字段保存在 JSONL 里，供日报渲染使用。

### 16.2 用法

```bash
# 导入当天（默认读 ~/.dsh 下的两个目录）
python scripts/import_dsh_reports.py

# 指定日期 / 目录（测试或多机同步时用）
python scripts/import_dsh_reports.py --date 2026-11-14 \
  --bili-dir tests/fixtures/dsh/bili --douyin-dir tests/fixtures/dsh/douyin \
  --collection-dir /tmp/coll --dry-run
```

写入 `state/collections/YYYY-MM-DD.dsh-bilibili.jsonl` 与 `...dsh-douyin.jsonl`，每写一条立即落盘。

可用环境变量覆盖默认目录：`DSH_BILI_DIR`、`DSH_DOUYIN_DIR`（`run_nightly.py` 会自动继承）。

### 16.3 退出码

| 码 | 含义 |
|---|---|
| 0 | 至少有一份报告导入成功（0 条新增也算成功） |
| 1 | 参数/配置错误（日期格式不对等） |
| 2 | 当天没有任何报告文件（B站与抖音都没有） |
| 3 | 报告存在，但没有解析出合法条目（链接都不在白名单等） |

`run_nightly.py` 在数据检查**之前**调用导入器：有报告就导入后继续，没有报告就打印提示并沿用既有数据；导入失败会打印原因但**不阻断**夜间流程，最终仍由「有没有数据」决定是否出报。

### 16.4 安全与去重

- **只接受 `bilibili.com` / `douyin.com` 及其子域的 http(s) 链接**；`javascript:`、`data:`、第三方域名、`b23.tv` 短链一律跳过并记录原因。
- Markdown 里即使写了 HTML，也只当纯文本：标签会被剥掉，脚本不会执行。
- 去重按 `URL + 标题 + 摘要` 的哈希（`collect_core.content_hash`），同一条视频重复导入只保留一份，重复运行导入器不新增条目。
- 导入器是只读的：不登录、不点赞、不评论、不私信、不收藏、不投稿。

### 16.5 与日报的关系

WorkBuddy 草稿不可用、需要确定性降级时，日报会：

1. 明确标注「**未AI总结**」；
2. 说明「为什么值得 / 一句话」来自 DSH 插件报告原文，**本次没有再做额外的 AI 总结**；
3. 按领域关键词打分分级：命中 ≥2 个关键词的进「重要内容」（含完整推荐理由），其余进「其他相关」（标题 + 作者 + 一句话 + 视频链接）。

想提升某类内容的档位，改 `config/topics.json` 的 `keywords` 即可，不需要改代码。

---

## 17. 本地 B 站采集（不启动 DSH 模型，零 token 费用）

采集能力已经本地化：B站插件（dsh-bili-scroll）只负责**登录态 + 只读 API**，搜索、过滤、字幕抓取、评分、写 JSONL 全部由本项目自己完成。**整个过程不启动 DSH 模型、不调用插件的 `/run` 值班接口，因此不产生 DSH token 费用。**

### 17.1 两个脚本分工

```
scripts/bilibili_local_worker.py   跑在「插件 venv」里
    stdin 一行 JSON -> 只允许 4 个只读 action -> stdout 一行 JSON
    check_credential / search / video_info / subtitle   （写操作一个都没有）

scripts/collect_bilibili_local.py  跑在「系统 Python」里（零依赖）
    topics.json 取关键词 -> 调 worker 搜索/详情/字幕 -> 确定性过滤评分 -> 写 checkpoint
```

worker 的 action 白名单是硬编码的：`like`、`reply`、`upload_video`、`send_message`、`favorite` 之类一律返回退出码 2 并拒绝；代码里也没有任何写操作调用（`regression_test_stage7.py` 的 W1 会扫源码验证）。

### 17.2 用法

```bash
# 默认：读 topics.json 的关键词，日期=今天
python scripts/collect_bilibili_local.py

# 小范围试跑（推荐第一次这么用）
python scripts/collect_bilibili_local.py \
  --keyword "ESP32" --per-keyword 3 --max-candidates 3 --recent-days 7 \
  --interval 1 --dry-run

# 只保留能确认发布时间的条目（严格模式，见 17.5）
python scripts/collect_bilibili_local.py --drop-unknown-date

# 输出机器可读报告（CI / 测试用）
python scripts/collect_bilibili_local.py --json
```

写入 `state/collections/YYYY-MM-DD.bilibili-local.jsonl`，每条立即落盘，支持中断续采。

字段：`title`、`url` / `video_url`（`https://www.bilibili.com/video/<BV>`）、`author`、`published`、`summary`（字幕摘要，按 `subtitle_char_budget` 截断）、`matched`（命中关键词）、`platform=bilibili`、`source_type=bilibili-local`，外加 `relevance`（0–1 确定性评分）、`play`、`bvid`、`topic_score`、`subtitle_truncated`、`published_unknown`。

### 17.3 开关与配置

`config/runtime.json`：

```json
"collectors": {
  "bilibili_local": { "enabled": true },   // 本地 B 站采集（默认开）
  "dsh_import":     { "enabled": true }    // DSH 报告导入（备用/历史兼容）
}
```

`config/sources.json` 的 `bilibili-local` 源：

| 字段 | 默认 | 说明 |
|---|---|---|
| `plugin_home` | `~/.dsh/bili-duty` | 插件家目录；也可用环境变量 `DSH_BILI_HOME` |
| `worker_python` | `<plugin_home>/.venv/...` | 运行 worker 的解释器，留空则自动探测 |
| `per_keyword_candidates` | 6 | 每个关键词搜多少条 |
| `max_candidates` | 12 | 本轮最多处理多少条（抓详情/字幕） |
| `max_keywords` | 12 | 最多搜多少个关键词（**不影响过滤用的词表**） |
| `recent_days` | 7 | 只保留最近 N 天 |
| `request_interval_seconds` | 2.0 | 每次 API 调用之间 sleep，避免触发风控 |
| `subtitle_char_budget` | 1200 | 字幕字符预算，超出截断 |
| `require_subtitle` | true | 没字幕就跳过（`--allow-no-subtitle` 可关） |
| `unknown_date_policy` | `keep` | 发布时间未知时保留 / `drop` 丢弃 |
| `order` | `pubdate` | 搜索排序，`pubdate` 让最新的先进候选 |

**顺序**：`run_boot` → `collect.py` → 本地 B站采集；`run_nightly` 先本地采集，再导入 DSH 报告（备用），最后才做「有没有数据」的判断。所以即使完全停掉 DSH，日报仍能产出。

登录完成并确认 profile 有效后，应停用 DSH 内的 `dsh-douyin-scroll` 宿主组件。本项目只复用它的登录 profile 和只读 `lib/*.mjs`，不需要宿主继续运行；两边同时管理同一个 Edge profile 会争抢 CDP 端口并反复切换窗口。采集固定使用 `browser_mode=hidden`：窗口最小化或移出屏幕，不抢前台；实测纯 `headless` 会被抖音返回非 JSON。

### 17.4 退出码

| 码 | 含义 | 处理 |
|---|---|---|
| 0 | 成功（可能 0 条：全被过滤/无字幕） | 继续 |
| 1 | 配置错误（插件目录/venv 缺失、日期非法） | 检查 `plugin_home` / `worker_python` |
| 3 | 登录失效 | 在插件里重新扫码登录，别绕过 |
| 4 | 401/403/429/验证码/风控拦截 | 立即停止，不重试、不绕过 |
| 5 | 采集错误（全部关键词失败、worker 输出不可解析） | 看日志 |

单条视频失败（详情超时、字幕取不到）只跳过该条并计数，不丢整轮。

### 17.5 成本对比与缺失能力

**成本**：旧路径 = 插件刷一轮 → 启动 DSH 模型读候选 → 写报告，按上下文和字幕长度计 token。新路径 = 插件只出登录态和原始 JSON，筛选/评分是纯 Python，**DSH token 为 0**。日报总结由 WorkBuddy 的低价模型 `DeepSeek-V4.1-Flash` 完成，只有这一段产生少量模型费用。

**已知缺失（都是刻意留白，不是 bug）**：

1. **拿不到精确发布时间**：插件只读函数 `bili_video_info` 的返回里**没有 `pubdate`**，所以真实环境里「最近 N 天」只能靠搜索按 `pubdate` 排序 + 顶多少量候选来近似。默认 `unknown_date_policy=keep`（保留并打 `published_unknown: true` 标记），要严格就加 `--drop-unknown-date`——代价是可能把新视频也丢掉。
2. **没有字幕就跳过**：本地不跑 Whisper/ASR，只用 B站自带字幕。没字幕的视频默认丢弃（`--allow-no-subtitle` 可保留，摘要退化成简介）。
3. **抖音已本地化（第 19 节）**：搜索/热榜/关注/详情/截帧 OCR 都有本地只读通道；推荐流（feed）不在只读白名单内，仍固定关闭；插件产出的 Markdown 报告（第 16 节）继续作为备用导入。
4. **不做语义判断**："值不值得看" 仍由关键词命中和播放量决定，不理解内容；真正的摘要要等接上模型总结器。
5. **依赖插件登录态**：cookie 过期就返回 3，需要人工扫码，无法自动续期。

### 17.6 测试

```bash
python scripts/regression_test_stage7.py     # 70 项，全部用假插件，不联网
```

覆盖：worker action 白名单（含源码扫描无写操作）、坏 JSON/空 stdin/非法参数、登录失效→3、风控→4、普通异常→5、字幕截断、正常采集字段、排除词/无命中/无字幕/过旧/重复标题过滤、重复运行幂等、`--recent-days`、发布时间未知的 keep/drop 两种策略、403/429 立即停止、`run_nightly` 与 `run_boot` 调用链。

---

## 18. 逐条反馈、相似内容聚类、嵌入式 Linux 主线与电源门禁（2026-11-14）

### 18.1 逐条反馈（替代原来的底部统一区域）

每条内容（重要条目和「其他相关」里的每一条）后面都紧跟一行：

```
[这条加重] [这条减轻] [清除标记]   （已加重这一条）/（已减轻这一条）/ 失败原因
```

- 按钮自带 `data-item-id`（`collect_core.content_hash` 的稳定哈希）、`data-report-date`、`data-domain`、`data-tags`、`data-title`；页面只负责发请求，判定逻辑在后端与本地。
- 每条一行**独立状态区**（`role="status" aria-live="polite"`），不会一条成功就整页变成"已提交"。
- 浏览器已有反馈密钥时，刷新会读取 `/api/feedback-events`，按 `itemId` 还原最后一次状态；三个按钮同时用 `aria-pressed` 显示当前选中项。
- 成功提交后，浏览器还会按 `itemId + eventId + at` 保存一份本机状态；即使 Cloudflare KV 在刷新瞬间短暂返回旧值，本机较新的“清除”也不会被旧“加重”覆盖。其他设备若提交了更晚状态，服务器状态会正常接管。
- **最后一次选择覆盖旧选择**：同一 `itemId` 多次提交时，后端和本地聚类只取 `at` 最新的一条。误按不会叠加；`delta=0` 表示清除。
- 渲染器会把字幕/OCR 产生的多行内容合并回同一个列表项，并把反馈标记转换为该条自己的按钮；页面上不会泄漏 `item-feedback` 注释，也不会出现前一条没有选项而后一条独占按钮的情况。
- 移动端按钮 `min-height: 44px`，窄屏 `flex: 1 1 0` 平分宽度，不横向溢出。
- 密钥弹窗全页只有一个，密钥只进本设备 `localStorage`。
- 没有 `data-domain` 的条目（未命中任何领域）同样可以反馈：后端只记事件、不动领域权重，标签仍参与聚类。这一条很重要——**未分类但想看/不想看的内容不该被丢掉**。

### 18.2 后端：可选字段 + 事件列表

`POST /api/feedback` 的必填项仍是 `domain`/`delta`/`date`/`eventId`（旧请求完全兼容）；条目反馈的 `delta` 接受 `1`、`-1`、`0`，其中 `0` 必须同时提供 `itemId`，表示清除。新版额外接受：

| 字段 | 规则 | 缺省 |
|---|---|---|
| `itemId` | `[A-Za-z0-9_-]{6,64}` | 空 |
| `tags` | 数组，≤8 个，每个 1–32 字符，字符集 `\p{L}\p{N} _+-.#/`，不允许 `<>` | `[]` |
| `title` | 字符串，≤120 字，不允许 `<>` | 空 |
| `domain` | 若提供必须在 `ALLOWED_DOMAINS` 内 | 可省略（条目级反馈） |

违反规则一律 400，不做"部分信任"。事件同时写入 `fevent:<eventId>`（TTL 30 天，`{eventId, domain, delta, date, itemId, tags, title, at}`），供 `GET /api/feedback-events` 读取（需 `X-Feedback-Key`，最多 500 条，按 `at` 排序）；响应另带 `itemStates`，每个 `itemId` 只包含最新记录。**不记录 IP / UA / Cookie。**

`ALLOWED_DOMAINS` 当前为 `ai-models,ai-embedded,embedded-linux-foundation`（`wrangler.toml` 与 handler 默认值一致）；`ai-embedded` 只作旧日报兼容。

### 18.3 本地聚类：标签 / 标签对权重（不调用模型）

```bash
python scripts/sync_feedback.py                # 生产入口会自动调用，一般不用手跑
python scripts/sync_feedback.py --events-json events.json   # 离线/测试
```

流程（`scripts/feedback_weights.py`，纯确定性）：

1. 从 `GET /api/feedback-events` 拉事件（后端没升级时 404：保留旧权重、只警告，不阻断）。
2. 每条事件取标签，顺序是：**事件自带 `tags`** → 否则用 `itemId` 去 `state/collections/*.jsonl` 找回原条目，用 `config/topics.json` 的词表在标题+摘要里提标签。
3. 标签必须在领域词表内（关键词或领域 id），否则丢弃并计入 `invalidTags`；不认识的标签不会污染权重。
4. 先按 `itemId` 取最后一次选择，再分别统计加重组 / 减轻组的**标签计数**与**标签对（同一条里共现）计数**；`delta=0` 的条目不计入任何权重。
5. 平滑权重：`w = K × (pos − neg) / (pos + neg + 2)`，标签 `K=3`、标签对 `K=1.5`；没人点过或已清除的标签权重为 0（= 不调整）。
6. 所有事件按 `eventId` 幂等保存；旧点击记录在 `sourceEvents` 中供审计，但只有每个 `itemId` 的最新记录参与 `counts / pairs / weights`，因此重复误按不会叠加。
7. 写 `state/feedback_weights.json`：

```json
{
  "updatedAt": "2026-11-14T21:10:00+08:00",
  "totals": {"events": 6, "applied": 6, "up": 4, "down": 2, "cleared": 0, "superseded": 0},
  "counts": {"GPIO": {"pos": 4, "neg": 2}},
  "pairs":  {"GPIO||systemd": {"pos": 2, "neg": 0}},
  "weights": {"GPIO": 0.75},
  "pairWeights": {"GPIO||systemd": 0.75},
  "appliedEvents": {"<eventId>": "2026-11-14T20:59:00+08:00"},
  "sourceEvents": {"<eventId>": {"itemId": "<id>", "delta": 1, "at": "..."}}
}
```

评分侧（`scoring.py`）把标签权重与共现标签对权重相加（总调整上限 ±4），叠加到 `领域权重 × 命中关键词数` 上：

```
score = base_score + adjustment
      = 领域有效权重 × 命中关键词数 + Σ标签权重 + Σ标签对权重
```

没有 `feedback_weights.json` 时 adjustment 恒为 0，行为和以前完全一致。

### 18.4 嵌入式 Linux 基础（当前主线，优先级更高）

`config/topics.json` 中 `embedded-linux-foundation` 是独立领域；当前 AI 领域 id 为 `ai-models`。两域关键词不再共享 `ESP32/STM32/TinyML/端侧AI` 等硬件词，因此不会把硬件内容归成通用 AI，也不会把 DeepSeek/LLM 等模型新闻归成嵌入式 Linux。

关键词：嵌入式Linux、Linux基础、Linux命令、文件系统、权限、进程管理、systemd、journalctl、C语言、GCC、Makefile、GDB、I2C、GPIO、UART、SPI、MQTT、断网重连、设备树、Linux驱动、交叉编译、Buildroot、Yocto、rootfs、watchdog、OTA。

配置里还放了 `outline`（学习主线：VMware/Linux 安装与命令行 → 文件系统/权限/进程/服务/日志/网络 → C 周期采集 → systemd 自启与崩溃恢复 → 开发板 + GPIO/I2C 传感器 → MQTT 与断网重连 → 全链路手册 → 设备树/驱动/交叉编译/Buildroot/Yocto/watchdog/OTA）和 `summary_policy`（**保留学习留白，日报只给方向和场景，不直接给踩坑答案**）。这些字段只影响配置与写作口径，不参与渲染。

热更新：改 JSON 即生效，不用改代码（新增第三个领域也一样）。

### 18.5 电源门禁（只在采集前生效）

| 检测 | 说明 |
|---|---|
| 首选 | `root\wmi` → `BatteryStatus.PowerOnline` / `Charging` |
| 回退 | `Win32_Battery.BatteryStatus`（2/6/7/8/9/11 = 外接电源，其余 = 电池） |
| 无电池 | 台式机：视为允许 |
| 检测失败 / 非 Windows | `unknown`，默认放行（`power.allow_unknown`），避免 WMI 抽风就整天不采集 |

- 采集入口（`collect.py`、本地 B 站采集器）开始前检查；不允许直接返回 **退出码 6**（`paused_on_battery`），不写任何内容。
- 采集途中拔电：本地 B 站采集器在**每一条候选之前**（批次边界）再检查一次，命中就 `break`，已写入的 checkpoint 全部保留，下次从 checkpoint 续采。
- **22:00 不受限**：`run_nightly.py` 只汇总已有数据、生成、渲染、走发布护栏，电池供电也照常出报。
- 测试/临时绕过：`WB_POWER_OVERRIDE=ac|battery|no_battery|unknown`（只用于测试，生产别设）。

配置在 `config/runtime.json`：

```json
"power": { "require_ac": true, "allow_unknown": true }
```

### 18.6 测试

```bash
python scripts/regression_test_stage8.py      # 90 项
```

覆盖：电源四态 + 入口拦截（退出码 6）+ 中途拔电保留 checkpoint + 22:00 不受限；领域优先级与热更新；标签/标签对权重影响分数与排序、未点击不变；同一内容只按最后一次选择、清除标记、历史保留、聚类平滑、幂等、非法标签/非法事件、`itemId` 回查；逐条按钮渲染（数量/itemId/日期/标签/独立状态/清除按钮/状态恢复/多行列表续行/无标记泄漏/幂等）；AI/嵌入式双领域独立归属与章节；桌面表格与手机文本双布局；日报新格式（核心问题/关键方法/适用场景/一行概括/不编造）；Pages 后端 51 项（含 `feedback-events`、last-wins 与 clear）。当前 stage8 为 109 项。

---

## 19. 本地抖音采集（复用插件登录态/CDP/OCR，不启动 DSH 模型，2026-11-14）

抖音这一步和 B站同一个思路：**插件只借"登录态 + 浏览器 + 本地 OCR"这三样脏活，筛选和判断全部由本项目完成**。区别是抖音走的是 Node（插件本身就是 ESM），所以桥接器是一个 `.mjs`。

### 19.1 两段式结构

| 层 | 文件 | 干什么 |
|---|---|---|
| 只读桥接（Node） | `scripts/douyin_local_worker.mjs` | stdin 一行 JSON → 固定 8 个只读 action → stdout 一行 JSON。复用插件的 `BrowserSession`（独立 profile）、`Douyin`（页面内 fetch + 归一化）、`ocrFiles`（Windows 内置 OCR）。 |
| 采集器（Python，零依赖） | `scripts/collect_douyin_local.py` | 读 `topics.json` 关键词/排除词 → 调 worker → 去重/过滤/评分 → 写 `state/collections/YYYY-MM-DD.douyin-local.jsonl`。 |

**动作白名单（只有这 8 个，写死在代码里）**

`status` / `whoami`（同一件事的两个叫法）、`search`、`hot`、`following`、`user_posts`、`video_info`、`frames`（截帧 + 本机 OCR）。

绝对没有：点赞、评论、回复、私信、分享、收藏、投稿/发布、关注。三个层次一起兜底：

1. `ACTIONS` 是唯一入口，未知 action 直接 `exit 2`；
2. **每个动作只接受列出来的参数，多余参数一律拒绝**（`expr` / `module` / `cmd` / `path` / `js` 这类一定被拒）——所以不能借 stdin 注入 JS、命令、模块名或文件路径；
3. 插件目录只来自命令行 `--plugin-dir`，且必须含固定的 `lib/browser.mjs`、`lib/douyin.mjs`、`lib/ocr.mjs`；stdin 里没有任何字段能改变加载目标。

`vision.mjs`（视觉模型）**从不加载**；`useVision` 即使写成 `true` 也会被强制关掉并打印说明。

### 19.2 采集流程

```
status(登录检查)                       ← 不可用直接停，exit 3
  ↓
search × N 关键词 / hot(热榜词→再搜) / following
  ↓  按 作品 id → 链接 → 文案 三层去重 + 排除词 + 关键词命中 + 最近 N 天
scan_limit / max_candidates / per_day 截断
  ↓  只对进入候选集的少量视频：
video_info（补标题/作者/时间/播放）
  ↓
frames（默认 2 帧）+ 本机 OCR（字符预算 ocr_char_budget）
  ↓
确定性评分（关键词命中 + 播放量对数，无模型）→ CheckpointStore 逐条落盘
```

- **摘要 = OCR 文本**；没 OCR 出字就退化成作品文案（`summary_source: ocr|desc`），**不用视觉模型**。
- `frames_per_video=0` 可整轮不截帧（最省电）。
- 二次运行**不会重复请求、不会重复截帧**：先读当天 jsonl 里已有的 `aweme_id`，命中就跳过（省电、也降低风控风险）。
- 每轮扫描上限 `scan_limit`、每天条数 `per_day`、请求间隔 `request_interval_seconds` 都可配。

### 19.3 配置

`config/sources.json`：

```json
{
  "id": "douyin-local",
  "type": "douyin-local",
  "enabled": true,
  "plugin_dir": "C:/Users/25625/.dsh/profiles/desktop/node_modules/dsh-douyin-scroll",
  "home": "C:/Users/25625/.dsh/douyin-duty",
  "node_bin": "node",
  "browser_mode": "hidden",
  "sources": { "search": true, "hot": true, "following": true, "users": false, "feed": false },
  "per_keyword_candidates": 6, "max_keywords": 8,
  "hot_words": 15, "hot_videos": 6, "following_limit": 12,
  "scan_limit": 40, "max_candidates": 8, "per_day": 4,
  "frames_per_video": 2, "ocr_char_budget": 600, "require_ocr": false,
  "useVision": false,
  "request_interval_seconds": 2.0, "recent_days": 7, "unknown_date_policy": "keep"
}
```

| 字段 | 说明 |
|---|---|
| `plugin_dir` | 插件**代码**目录（`lib/*.mjs` 在这里）。环境变量 `DSH_DOUYIN_PLUGIN_DIR` 可覆盖 |
| `home` | 插件**数据**目录（登录态 profile、`frames/` 在这里）。环境变量 `DSH_DOUYIN_HOME` 可覆盖 |
| `sources.feed` | **固定无效**：推荐流不在只读白名单内，写 `true` 只会打印"已忽略" |
| `useVision` | 固定 `false`：只用本机 OCR |

`config/runtime.json` 增加开关（可热更新）：

```json
"collectors": { "douyin_local": { "enabled": true } }
```

### 19.4 与生产入口的关系

- `scripts/collect.py`（统一采集入口）：遇到 `type=douyin-local` 直接分派给本地采集器；B站与抖音**各自独立**，一个平台抛异常只记一笔失败，另一个平台照常落盘。
- `scripts/run_boot.py`：走 `collect.py`，自动带上；电池暂停（退出码 6）时提示接电源后重跑续采。
- `scripts/run_nightly.py`：先跑 B站本地采集，再跑抖音本地采集，然后才是 DSH 报告导入；**任何一个平台登录失效/被拦截都不阻止日报生成**（有数据就出报，没数据才 `exit 2`）。
- 电源门禁沿用第 18.5 节：开始前检查；**每条候选之前**再检查；中途拔电 `break`，已写 checkpoint 保留，退出码 6。

### 19.5 退出码

| 码 | 含义 | 怎么办 |
|---|---|---|
| 0 | 成功（可能 0 条） | — |
| 1 | 配置错误 / 插件目录或 node 缺失 / 参数非法 | 看日志修配置 |
| 3 | 登录缺失或失效 | 在插件里重新扫码（本脚本**不会**自动登录） |
| 4 | 平台拦截（403/429/验证码/风控/跳验证页） | 停下，不绕过；隔一段时间再跑 |
| 5 | 其它失败（页面异常、worker 输出不可解析） | 看日志；单条失败只跳过该条 |
| 6 | `paused_on_battery` | 接电源后重跑，从 checkpoint 续采 |

### 19.6 成本

| 环节 | 费用 |
|---|---|
| 浏览器 / CDP / 页面内接口 | 0（复用已装 Edge/Chrome + 独立 profile） |
| OCR | 0（Windows 内置 `Windows.Media.Ocr`） |
| 视觉模型 | 不启用（`useVision` 强制 false） |
| DSH 模型 / 插件 `/run` | 不启动、不调用 → **0 token** |
| 筛选/评分/写盘 | 本项目 Python，确定性代码 |

真正的成本只有本机 CPU/电量和平台风控风险（所以才有电源门禁 + 请求间隔 + 扫描上限）。

### 19.7 用法

```bash
# 默认：读 topics.json 关键词，日期=今天
python scripts/collect_douyin_local.py

# 先小范围试跑，只看不写
python scripts/collect_douyin_local.py --keyword "ESP32" --per-keyword 3 \
  --max-candidates 2 --frames 1 --interval 1 --dry-run

# 只刷搜索，不刷热榜/关注（最省电）
python scripts/collect_douyin_local.py --no-hot --no-following --frames 0

# 机器可读报告
python scripts/collect_douyin_local.py --json
```

### 19.8 测试

```bash
python scripts/regression_test_stage9.py     # 107 项
```

全部跑 `tests/fixtures/dsh_douyin_mock`（假 `BrowserSession` / `Douyin` / `ocrFiles`）：**不连真实抖音、不开真实浏览器、不读真实登录态**。样本按"相对今天"生成，所以"最近 N 天"的判定不随日期漂移。

覆盖：8 个只读动作可用 + 12 类写操作被拒 + 源码扫描无写调用/无视觉/无 `/run`；多余参数（`expr`/`module`/`cmd`/`path`）与非法 `num`/`aweme_id`/`sec_uid`/`frames`/`max_chars` 全部 `exit 2`；未登录/掉登录→3；验证码/403→4；普通异常→5；OCR 截断、无 OCR 引擎、零帧；坏记录过滤；正常采集 schema/平台/OCR 摘要/帧数/不启用视觉；排除词/无命中/过旧/重复；OCR 预算；幂等（不重复请求、不重复截帧）；登录失效与验证码立即停止且不写盘；`per_day`/`scan_limit`；无 OCR 时文案兜底与 `require_ocr`；路由开关与 `feed`/`useVision` 被忽略；电池开始前拦截（6）与中途拔电保留 checkpoint（6）；B站+抖音合并日报；平台失败隔离；`collect.py` 统一调度。

### 19.9 已知缺失（刻意留白）

1. **抖音登录已完成**：当前账号已人工扫码登录；后续若登录态失效会返回退出码 3，需要在插件设置页重新扫码。
2. **没有字幕接口**：抖音本来就只靠画面文字，所以 OCR 是主要信息来源；画面无字时只剩作品文案，摘要会很短（`summary_source=desc`）。
3. **推荐流不支持**：只读白名单不含 `feed`，配置写 `true` 也只打印"已忽略"。
4. **相关性仍是启发式**：关键词命中 + 播放量对数，不理解内容；真正的摘要要等接上模型总结器。
5. **登录态会过期**：过期就 `exit 3`，需要人工在插件里重新扫码，无法自动续期。
6. **电脑操控按需开启**：采集使用插件的隐藏浏览器通道；Codex 的电脑操控只在配置 WorkBuddy 或人工排障时开启，动作完成即停止。

---

## 20. WorkBuddy 每日 AI 总结（2026-11-14）

### 20.1 固定时间线

| 时间 | 执行者 | 动作 |
|---|---|---|
| 开机后 5 分钟 | `DailyReport-Boot` | 检查昨天是否已发布；未发布先补发，已发布则开始当天采集 |
| 每天 20:30 | `DailyReport-Collect` | B站 + 抖音只读采集；成功后生成 `state/ai-input/YYYY-MM-DD.json` |
| 每天 21:30 | WorkBuddy | 用 `DeepSeek-V4.1-Flash` 总结、分级、推荐；写入并校验 `state/ai-reports/YYYY-MM-DD.json` |
| 每天 22:00 | `DailyReport-Nightly` | 读取当天数据与 AI 草稿，生成网页，校验后 `git commit + git push`，GitHub Pages 自动更新 |

WorkBuddy 只处理已经采集到本地的公开内容。它不启动 DSH 模型，不调用插件 `/run`，不打开或操作 B站/抖音浏览器，也不执行 Git 发布。采集和发布始终由 Windows 的任务与项目脚本负责。

### 20.2 AI 输入与草稿

输入文件是项目脚本生成的紧凑 JSON，包含每个条目的可信 ID、标题、字幕/OCR/简介、平台、作者、链接、领域、命中词和反馈权重。WorkBuddy 不自行修改 ID 或链接。

草稿必须覆盖输入中的每个 `id` 恰好一次；`important` 最多 3 条，必须写明核心问题、关键方法/结论、推荐理由和适用场景；其余 `minor` 条目各写一句概括。发布前执行：

```bash
python scripts/validate_ai_report.py --date YYYY-MM-DD
```

校验失败时 WorkBuddy 只修正草稿。22:00 的本地汇总器会再次校验并合并视频元数据与逐条反馈标记；草稿缺失或损坏时退回确定性模板并明确标注「未AI总结」，不会伪造 AI 结论。

### 20.3 成本边界

| 环节 | 日常费用 |
|---|---|
| B站/抖音本地采集、OCR、筛选、评分 | 0 模型费用 |
| Windows 汇总、网页渲染、Git 发布 | 0 模型费用 |
| WorkBuddy 每日总结 | 只有 `DeepSeek-V4.1-Flash` 的少量积分/费用 |
| GitHub Pages 静态站 | 公开仓库使用 GitHub Pages，无新增托管费；自定义域名、超出平台限额或变更套餐除外 |

日常运行不依赖 DSH 模型；主要持续性成本是本机电费、平台风控概率、WorkBuddy 当前模型用量，以及 GitHub/Cloudflare 的免费额度边界。

### 20.4 发布失败重试

- Boot/Collect/Nightly 失败后每 5 分钟重试，最多 3 次。重跑只读取已生成草稿和本地数据，不会重新调用 WorkBuddy 模型。
- Clash/代理由用户自行管理，本项目的脚本和计划任务不会启动、停止或修改代理软件，也不会主动读取代理端口配置。

### 20.5 桌面表格 / 手机文本双布局

- 浏览器宽度 `>= 900px` 时显示桌面表格：级别、标题与来源、推荐、核心内容、视频、我的调整六列；长结论可展开。
- 浏览器宽度 `< 900px` 时继续显示原来的长文本日报，不改变手机保存入口和逐条反馈操作。
- 两种布局从同一份报表 DOM 生成，不增加接口请求、不复制后端逻辑；桌面提交反馈会同步更新同一内容的隐藏手机行，刷新后状态仍由后端恢复。

---

## 21. 最近 7 天滚动去重与 AI 主题配额（2026-11-16）

### 21.1 去重策略

- `config/runtime.json` 的 `dedupe.history_days` 默认是 `7`：一条内容进入过一次已发布日报后，接下来 7 个自然日内不再进入 WorkBuddy 输入或新日报；第 8 个自然日才允许重新出现。
- 使用 `state/report_history.json` 紧凑索引，不逐条读取几百期历史。索引键包含内容 ID、B站 BV 号、抖音视频 ID、规范化 URL、完整标题指纹和长标题前缀；同一视频换了摘要、标题被截断或链接带追踪参数也能识别。
- 首次升级时只回填最近 7 天的日报，不扫描全部历史；之后通过 `last_seen` 日期滚动裁剪。
- 同一天重跑不会过滤当天自己的内容；索引仅在成功发布后记录当天的页面内容。
- 如果以后觉得恢复太快，可把 `history_days` 调到 14 或 30；如果希望教程类内容更常出现，可降到 3～5。当前建议先保持 7 天，既避免日报重复，也不至于把慢更领域长期封死。

### 21.2 AI 内容偏少的原因与修复

11/15 的旧日报里出现前一天内容，主要不是模型漏掉了 AI，而是两类问题叠加：

1. 旧采集搜索把配额集中在嵌入式 Linux 词上，AI 领域只得到很少甚至零次搜索；
2. 同一批 journalctl 视频在 11/14 和 11/15 重复出现，WorkBuddy 只能在这些重复候选里做分级。

现在的搜索顺序会在每个领域之间轮询，并采用 `search_keywords` 指定的高命中词。当前前 8 个搜索词为：

```text
嵌入式Linux / 端侧AI / Linux命令 / 边缘AI /
C语言 / TinyML / 文件系统 / ESP32
```

这比按 JSON 顺序直接截取前 8 个嵌入式词更均衡，同时不会把搜索请求数翻倍。若后续仍偏少，优先调整 `config/topics.json` 的 `ai-models.search_keywords`，而不是增加全部关键词。

领域归属与排序也已拆开：负向反馈会降低某领域的排序优先级，但不会因为“嵌入式Linux”这种两边共享的词，就把普通嵌入式内容误判成 AI 内容。领域选择先看命中的具体词数量，再用领域优先级和有效权重决胜。

### 21.3 已验证

- `regression_test_stage11.py`：18/18（滚动窗口、同指纹多日期、同日重跑、旧标题兼容、URL/平台标记、AI/嵌入式独立搜索轮询、负权重不误判领域）。
- 11/14→11/15 真实数据回放：8 条中识别出 4 条前一天重复内容；升级前会全部进入日报，升级后会过滤这 4 条。
- 真实 B站只读 dry-run 使用 `端侧AI / 边缘AI / TinyML / ESP32`：8 个候选中 3 个无字幕被跳过，仍得到 1 条可总结的 ESP32 AI 语音智能体内容，证明新搜索词有效。
- B站采集回归：70/70；抖音采集回归：107/107；夜间和生产入口回归均通过。

---

## 22. AI 大模型与嵌入式 Linux 正式拆分（2026-11-17）

### 22.1 两个独立领域

| 领域 | id | 收录内容 | 不收录内容 |
|---|---|---|---|
| AI 大模型 | `ai-models` | DeepSeek/OpenAI/Claude/Gemini 等模型发布、能力、价格、生态、训练与推理、Agent、RAG、多模态、AIGC | 开发板、MCU/RTOS、Linux、驱动、外设、TinyML 实践 |
| 嵌入式 Linux | `embedded-linux-foundation` | Linux、驱动、开发板、MCU/RTOS、ESP32/STM32、I2C/GPIO/UART/SPI、NPU、TinyML、模型量化与边缘部署 | 通用大模型新闻、模型公司动态、纯 AI 算法/产品 |

`config/topics.json` 中两域各自维护 `search_keywords` 与完整 `keywords`。搜索前 8 个轮询词当前为：

```text
嵌入式Linux / DeepSeek / Linux命令 / AI大模型 /
Linux驱动 / LLM / 设备树 / AIGC
```

旧 `ai-embedded` 仅作为历史兼容 id 保留在后端白名单，新内容不再使用该 id。

### 22.2 日报结构

日报固定按 `AI 大模型`、`嵌入式 Linux`、`未分类` 三个独立章节输出；某领域当天没有新内容时明确写“本期没有新的可推荐内容”，不会用另一领域填充。桌面表格也增加独立“领域”列，手机长文本同样按章节展示。

### 22.3 真实采集验证

2026-11-17 原采集只有嵌入式内容。拆分后使用真实 B站只读接口搜索 `DeepSeek / AI大模型 / LLM / AIGC`，16 个候选中得到 2 条 AI 内容；当前 WorkBuddy 输入为 AI 2 条、嵌入式 Linux 5 条、未分类 1 条，日报和反馈按钮均按两个领域分开生成。

---

## 23. B站多P视频与 UGC 合集整体采集（2026-11-24）

采集器不再只读取搜索结果命中的第一个 CID。每个候选先调用只读 `bundle_info`：

| 详情结果 | 处理通道 |
|---|---|
| `single` | 走原单视频通道，维持原 `subtitle_char_budget` |
| `multi_page` | 展开全部 `pages[].cid`，逐P读取字幕 |
| `ugc_season` | 展开 `ugc_season.sections[].episodes[]`，逐集读取 bvid/cid 字幕 |

多P/合集会把完整分集目录、各P标题、全部可用字幕和合集简介合并成一个采集条目；日报中只出现一条，由 WorkBuddy 做整体总结，不把某一集误当成整个合集。没有字幕的分集会明确标注，至少有一个分集字幕可用时仍保留整个合集；全部无字幕时才按原规则跳过。

去重同时覆盖“同一次搜索里的不同分P”和“以前已采过的同一合集”：合集使用稳定合集 ID/URL 生成内容 ID，后续再次命中任意分P都会跳过。

配置：

```json
{
  "collection_max_episodes": 200,
  "collection_episode_subtitle_budget": 1800,
  "collection_summary_char_budget": 120000
}
```

AI 输入对普通视频仍限制 2200 字符；`content_type=collection` 单独放宽到 120000 字符，保证 WorkBuddy 能看到全部分集。

**排除词范围（2026-11-26 修正）**：合集正文是几十上百集字幕的合并，`广告`/`优惠` 这类词几乎必然出现（例如讲解 XSS「给用户弹个广告」、某一集里的课程优惠券），按全文匹配会把整条合集丢掉，连技术分集一起丢。现在 `content_type=collection` 的排除词只在标题（`title` + `collection_title`）上匹配；单视频维持标题 + 摘要。回归用例 `T2b`（`regression_test_stage3.py`）。

真实 47P 验证：`BV1gcsB6WEkh` 被识别为 `multi_page`、47 集；首P和末P的指定 CID 字幕均可正常读取。回归测试 `regression_test_stage7.py` 为 **70/70**。
