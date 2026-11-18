# CHANGELOG · lab-guide

> 版本 v1.1.2｜最后核实：commit 未取（发布前补）｜状态：有效
>
> 口径：发布版本从 **v1.0** 起算；`A` / `B` / `C` 是开发段（不单独发版，按段留档，供考古与验收对照）。
> 每条一句话；数字只写实测值或文档固定常量（池 **11,183** = registry **10,974** + catalog **195** + 已装 **14**）。
> 未实测的写「未实测」，不写「已通过测试」。

---

## v1.1.2 · 文档去内部引用（公开版清理）

- **README-DEV** 去掉内部项目名（保留「junction 安装 → boot fail → 自愈重写补丁层 1014 行 → 4 行」的技术信息，并注明事故记录不进仓）；**ROADMAP** 的 D 阶段验收不再引用仓外封冻文件，改为「趋势记录 + 命中信号清单 + 自身变更与 CHANGELOG 逐条对得上」；三个 `fixtures/*.json` 的 note 把用例执行目录措辞统一改为「仓库根」；`PUBLISH-CHECKLIST` 不再随包发布。

## v1.1.1 · C.4 三源解耦（任一源可用即继续；全不可用才 exit 1）+ 布局自适应（REPO_ROOT）+ 合成样例池

- **C.4 三源解耦**：`--search` / `--unknown` / `--goal` 的 registry 快照 ／ 离线目录 ／ 已装包 三源不再互为硬前置——任一源可用即继续（缺的那一源计 0 条 + 告警写进报告头），**三源全不可用才 `exit 1`**；「catalog 缺失 → 直接 exit 1」的旧前置作废。
- **布局自适应（REPO_ROOT）**：仓库根改由 `REPO_ROOT`（按模块自身位置推导）决定，不再依赖 cwd；`DEFAULT_LABELS` / `DEFAULT_HOST_ROWS` / `DEFAULT_LIFECYCLE` 随之走仓库根（开发仓与发布仓同一份代码，不靠相对路径猜）。
- **合成样例池**：回归取样用合成样例（不对应真实市场条目），不依赖本机 profile 与真快照。
- `tools/lab-analyze.mjs` **4483 行**（解耦前 4436，+47）；`SKILL.md` 末尾「命令校对表」的 `lab-analyze.mjs` 一张已按新文件**逐处重定位**（含 `--unknown` 行把旧 `requireCatalog:2855` 改成 `loadCatalog:2863`），`SKILL.md` 总行数不变（455）。

## v1.0.1 · 发布补丁

- **修复 GitHub-only 条目查不到**：`lab-analyze <pkg>` 原先只按条目的 `npm` 字段匹配，而快照里相当一部分条目没有 npm 名
  （主键是 `owner/name`）→ 表现为「`--search` 搜得到，`analyze` 说没有」；现改为 `key` 全等命中 + npm 短名 0 命中时用 `key`
  短名兜底，仍只认唯一命中、多候选不猜，报告标 `match=key（GitHub-only 条目，npm 名为空）`。

## v1.0 · 首个发布版

- 交付三件只读 CLI（`lab-drift` 对账 / `lab-triage` 生命周期 / `lab-analyze` 取证与召回）+ 一个显式抓取器 `_registry.mjs`
  （唯一联网点，只连 loopback）；零依赖 ESM，只用 node 内置模块。
- 真实池 **11,183** 条可用：`--search 直播` 命中 **15** 条。
- `--goal "我想学嵌入式，从连板子到画 PCB"` → 强 **0** ｜ 弱 **9** ｜ 仅字面 **45**，同一次运行同时给 `## 词表诊断` 与池子构成。
- 技能消融实验：无 skill **0/4** 分 ｜ 只给文档 **1–2/5** 分 ｜ 有 skill **5/5** 分。

---

## 段 1 · A / A.1 — 只读对账（与账本基线）

- **A**：`lab-drift` 把 profile 实际安装与 lab 登记对账，输出 **4 类差异**（`UNREGISTERED` / `MISSING` / `VERSION_DRIFT` /
  `PERMISSION_TODO`）+ **2 类 info**（`ROSTER_ONLY` / `ORPHAN_IN_NM`），差异不进退出码，唯一写动作是 `--write-report`。
- **A**：版本只比 `node_modules/<pkg>/package.json` 的**实测值**，不求值 `^1.2.3` 这类区间；读不到写 `null` + 原因，不填默认值。
- **A.1**：`ORPHAN_IN_NM` 从「在 `node_modules` 顶层且未声明」收紧为「**真孤儿**」（未被任何已装包的
  `dependencies` / `peerDependencies` / `optionalDependencies` 引用），把 pnpm 提升上来的传递依赖从报告里剔掉；
  收紧后的连跑复测**未实测**。
- **A.1**：解析内核抽成 `tools/_profile.mjs`，`lab-drift` / `lab-triage` / `lab-analyze` 共用一份真相（行为未改）。
- **B（账本侧）**：新增 `data/schema.md` 作为字段与状态机权威，`data/lifecycle.json` 为空种子（账本本身不进仓库）。

## 段 2 · B — 生命周期状态机

- 五态：`candidate → trial → adopted / rejected / dormant`；`rejected` 是终态，要重来只能 `add` 新条目。
- 一个 CLI、**7 个子命令**：`list` / `add` / `promote` / `due` / `note` / `sync` / `check`，子命令各有参数白名单（多给一个就报错）。
- 默认试用 **14** 天；`adopted` 最近活动距今 **≥ 30** 天进 `due`；`adopted` 必须能读到 profile 实测版本，读不到就**拒绝迁移**、不填默认值。
- 写动作只有 3 处：`data/lifecycle.json`、`out/rejected-<YYYY-MM-DD>.md`、`out/sync-suggestions.md`；lab 只读，
  与 lab 的差异只生成**建议**（权限四项固定 `待补｜待补｜待补｜待补`）。
- 非法迁移 / 不变式违反 / 写目标指到 profile 或 lab → `exit 1` 且**不改文件**。
- 端到端实跑（正向 8 步 + 负例 9 条）在开发期**未实测**，只有逐行自核与手工日期推演。

## 段 3 · C.1–C.3.3 — 分析器与真实市场池

- **C.1** 本地静态分析器：五段输出（用途 / 权限四档 / row 争用 / 同轨重复 / 建议分类 + `verdict`）；权限四档
  「全量（含命令或凭据）> 写入 > 只读 > 无」；row 争用三类结论 `COLLIDES_WITH_HOST`（danger）/
  `COLLIDES_WITH_PLUGIN`（warn）/ 覆盖（info），另有 `--scan-all` 全量矩阵与 `--from-dir` 离线目录分析。
- **C.1**：官方 row 数据存成本地快照 `data/host-rows.json`（纯 node 读不了 `app.asar`），标 `source=snapshot` / `confidence=likely`；
  读不到时 `verdict` 封顶「观察」，不假装读过。
- **C.2** 离线目录：从插件管理器的构建产物里按行抽成 `data/catalog.json`，**195** 条（中文名 / 描述 / 分类）+
  分类中文名；`--search` 走目录，`--unknown` 走反向筛选（P1 / P2 / P3 三档，末行**只数 P1**）。
- **C.2**：修「它干什么」的三级数据源（目录 > `package.json` > README 兜底），README 提取改「先过滤行再取句」，
  题头 `>`、徽章带、`·` 导航行不再被当成描述。
- **C.3** 三源池 + 目标入口：池 = registry 快照 > 离线目录 > 已装包；`--search` 末行改为
  `匹配 N 条 / 池 M（registry A ｜ catalog B ｜ 已装 C）`；`--goal` 做池内打分（名称 ×3 / 中文描述 ×3 / 英文描述 ×2 /
  capabilities ×3 / keywords ×2 / category ×1，通用词再 ×0.5），**未装的包权限固定 `unknown`**。
- **C.3.1**：registry 抓取上限 **8 MiB → 64 MiB** + 流式累加 + `--max-bytes` 可覆盖（超限立即中止、不写半截快照）；
  `--goal` 加相关性门禁、15 个通用词降权与噪声词丢弃，把「只命中『管理』」的噪声挡在候选之外。
- **C.3.2**：按真实响应重写形状——数组在 `registry` 容器里、键名 `plugins`、`description` 是 `{en, zh}` 对象、
  规模 **10,974** 条（不是原来假设的 200–400）；快照 schema 升 **v2**（`entries`），旧 `schemaVersion:1` 夹具降级为**负例**。
- **C.3.3**：取消「长词 / ≥2 词 / Σ≥6」三条硬门槛，改**分层**（强 覆盖率 ≥0.5 ｜ 弱 0.2–0.5 ｜ 仅字面 <0.2 或只命中通用词），
  新增 `## 词表诊断`（逐词给池中命中条目数与 idf，0 命中标「未命中」+ 4 组换词提示）与 idf 加权
  （`clamp(ln(池总数/(1+命中条目数)), 0.5, 3.0)`）；各层条数**全量算**、表内明写截断行数。
- **C.3.3**：分层条数、idf 真实取值、`elapsedMs` 在开发期**未实测**（公式与复算示例已写进 `docs/RULES.md` §12.3.8）。

---

## 版本号与文档对应

| 版本 | 文档基线 | 说明 |
|---|---|---|
| v1.1.1 | `SKILL.md` v1.1（C.4 收尾） | C.4 三源解耦 + `REPO_ROOT` 布局自适应 + 合成样例池；`SKILL.md` 校对表按 `lab-analyze.mjs` 4483 行重算 |
| v1.0.1 | `SKILL.md` v1.1（C.3.3 收尾） | 发布补丁：GitHub-only 条目单包查找 |
| v1.0 | `README.md` 基线 v0.1.0 + C.1–C.3.3 各段 | 首个发布版，池 11,183 |
