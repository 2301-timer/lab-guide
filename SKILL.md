---
name: lab-guide
description: "当用户问「市场里有没有做 X 的插件 / skill」「要不要装 X」「这包要什么权限、会不会抢别人的行」「我装了 X」「到期了还在用吗」「有新版本了」时，先用 lab-analyze 在本地三源池（真实市场快照 10,974 条 > 离线目录 > 已装包）`--search` 召回或 `--goal` 池内诊断（不做语义理解，只做字面匹配），再按权限四档（文件/命令/网络/凭据）与 row 争用（抢宿主行 danger / 抢插件行 warn）取证，然后用 lab-drift 把 profile 实际安装与 dsh-plugin-lab 登记对账、用 lab-triage 把去留记成可审计的生命周期账；只读、不装不卸不升级、不写 profile 与外部 lab，只写 out 与 data/lifecycle.json。"
---

# lab-guide

> 版本 v1.1（C.3.3 收尾）｜参数逐字对照 `tools/lab-drift.mjs`、`tools/lab-triage.mjs`、`tools/lab-analyze.mjs` 源码（校对表见文末「命令校对表」，按三个文件分列三张表）
> 语义权威：[`docs/RULES.md`](docs/RULES.md)（A 阶段 §1–§8 / B 阶段 §9）、[`data/schema.md`](data/schema.md)（状态机）
> 触发细则：[`docs/TRIGGERS.md`](docs/TRIGGERS.md)

一句话：**市场里有什么（`--search` / `--goal`）→ 它能不能用、安不安全（`lab-analyze` 取证：权限四档 + row 争用）→ 我要不要留着（`lab-triage` 生命周期）；只报告，不动手。**

它解决的是「静默漂移」：装了没登记、登记了没装、版本对不上、权限栏永远「待补」。这些不会把 DSH 打挂，但会让「已装基线」变成一本假账（事故背景：patch 层被应用自愈重写，见仓库 issue 记录）。

---

## 何时使用

命中下面任一情形就用，**不要等用户主动说「帮我查一下 lab」**：

1. 用户要**装/试**一个新插件、skill 或 MCP，问「怎么样」「能不能用」「会不会有风险」；
2. 用户说**已经装了**、刚装完、或者装完就出问题了；
3. 用户问**「这些装着的还有用吗」「该清一清了」「上次那个还在吗」**，或者距上次核对已经很久；
4. 用户提到**新版本 / 升级 / 版本对不上 / 漂移**；
5. 你自己发现**要动 profile、要改 lab、要建议卸载**——先过本流程取证，再谈动作；
6. 用户问**「市场里有没有做 X 的插件 / skill」「有没有现成的能…」**——先召回再取证：`node tools/lab-analyze.mjs --search <关键词>`（三源池：registry 快照 > 离线目录 > 已装；大小写不敏感、空格分词 AND；无命中写「池中无匹配」+ 最接近 3 条，不造候选），命中候选再 `node tools/lab-analyze.mjs <pkg>` 看权限与 row 争用；一句话目标也可以先 `--goal "<一句人话目标>"` 做**池内诊断**（只匹配字面、按 idf 加权打分并分强/弱/仅字面三层展示，**不做语义理解、只做字面匹配**）；
7. 用户问**「这个包要什么权限 / 会不会抢别人的行 / 会不会跟已装的打架」**——`node tools/lab-analyze.mjs <pkg>` 出权限四项（文件/命令/网络/凭据）四档结论 + row 争用（`COLLIDES_WITH_HOST` danger / `COLLIDES_WITH_PLUGIN` warn / 覆盖官方行 info / `SELF_ID`）；要全景就对已装全量跑 `node tools/lab-analyze.mjs --scan-all` 出 row 争用矩阵；**未装的包权限固定写 `unknown（未安装，本地无代码）`，不推断**。

真实例句（都该触发）：

- 「我想装 dsh-purge-community，帮我看下值不值得装」
- 「刚把 @txc2768651338/dsh-plugin-manager 装上了，需要登记吗」
- 「lab 里那 11 个已装插件，是不是该复核一遍了」
- 「这个包上游发新版了，我账上还记着旧版本，怎么处理」
- 「profile 里装的和 lab 里写的对不上，你核一下」

不该触发：闲聊、与本机 profile / lab 无关的问题、用户明确说「先不用管这些」。

不适用：安装/卸载/升级、写 profile、写 lab 的 `installed.md` / `INDEX.md` / `rejected.md`、联网查 npm registry 或远程 README（市场数据只读本地快照 `data/registry.json`，抓取由 `_registry.mjs --url` 单独执行）、按星数/下载量做推荐排序（`--goal` 只是池内可解释打分，不是推荐算法，星数仅作生态旁证）。

---

## 四个入口

**统一约定**：在仓库根目录（即 `lab-guide/`）执行；`<pkg>` 是包名（插件直接写包名，非插件写 `skill:xxx` / `mcp:xxx` / `app:xxx`）；`<label>` 是 lab 的分类轨（如 `embedded`、`toolchain`）。所有写动作只落 `data/lifecycle.json` 与 `out/*.md`。

### 入口 1 · 评估（要不要装 X）

**触发**：用户提出一个**还没装**的东西，问值不值得 / 有没有坑 / 跟现有的是否重复。

1. **先看账，防重复**（关键：别把「候选」当「已装」，也别给已 adopted 的东西再开一张新卡）

   ```bash
   node tools/lab-triage.mjs list --json
   ```

2. **看它在本机的真实状态**（评估阶段通常 `inNodeModules: false`，那就是没装；已经装了就别走评估，转入口 2）

   ```bash
   node tools/lab-drift.mjs --explain <pkg>
   ```

3. **同轨去重与淘汰理由**（本阶段唯一允许的"推荐"依据，只看本地账本，不联网）

   ```bash
   node tools/lab-triage.mjs list --state adopted
   node tools/lab-triage.mjs list --state rejected
   ```

   同 `<label>` 下已有 `adopted` → 先说明「同轨已有谁、它多做什么」；同轨 `rejected` → 直接引用那条 `reason` 与 `evidence` 作为淘汰理由，不要重新评估一遍。

4. **落账（只在用户认可"先记下来"时）**

   ```bash
   node tools/lab-triage.mjs add --pkg <pkg> --kind plugin --label <label> --reason "一句话：为什么值得记这一条"
   ```

   `add` 只能建 `candidate`；`--kind` 取 `plugin|skill|mcp|app`。

**输出**：评估卡（模板见下）。
**落到哪里**：卡直接给用户；只有用户点头才 `add` → `data/lifecycle.json` 多一条 `candidate`。**不装任何东西。**

### 入口 2 · 登记（我装了 X）

**触发**：用户说"装了 / 刚装好 / 装完有点问题"。

1. **先对账，确认它真的在装且真的没登记**

   ```bash
   node tools/lab-drift.mjs
   ```

   看 `UNREGISTERED`（装了但 lab 没登记）与 `VERSION_DRIFT`（lab 记的版本 ≠ `node_modules` 实测）。要机读就 `--json`。

2. **建条目（账本里没有它时）**

   ```bash
   node tools/lab-triage.mjs add --pkg <pkg> --kind plugin --label <label> --reason "已装入 profile，待补 lab 登记"
   ```

3. **按"试没试过"分流**

   ```bash
   # 刚装、还没验证行为 → 试用期（默认 14 天）
   node tools/lab-triage.mjs promote <pkg> --to trial --reason "已装入 profile，开始试用" --trial-days 14

   # 行为已核对、确定长期留 → adopted（必须能读到 profile 实测版本）
   node tools/lab-triage.mjs promote <pkg> --to adopted --reason "核对过行为与描述一致" --profile "<profile 目录>"
   ```

   `--to adopted` 读不到 `node_modules/<pkg>/package.json` 会**拒绝迁移**（不填默认值、不猜）——这时停在 `trial`，先把版本读清楚。
   若条目还是 `candidate`，必须先 `--to trial`（`candidate → adopted` 是非法迁移），不许跳级。

4. **生成登记建议（给主对话去写 lab，本工具不写）**

   ```bash
   node tools/lab-triage.mjs sync
   ```

**输出**：登记卡。
**落到哪里**：`out/sync-suggestions.md`（可复制进 lab 的 Markdown 片段，权限四项固定 `待补｜待补｜待补｜待补`）+ 账本状态变化。**不写 lab。**

### 入口 3 · 复核（到期了，还在用吗）

**触发**：`trial` 到期、`adopted` 很久没核对、用户主动问"还有用吗 / 该清吗"。

1. **看谁到期了**

   ```bash
   node tools/lab-triage.mjs due
   ```

   口径：`trial` 看 `trialUntil <= now`（含当天）；`adopted` 看最近活动（`lastVerified` / 最后一条 `evidence.at` / `since` 取最大）距今 `>= 30` 天。

2. **看事实有没有漂**（版本、权限栏、基线）

   ```bash
   node tools/lab-drift.mjs
   ```

3. **结案三选一**

   ```bash
   # 还在用：留证据 + 刷新 lastVerified / verifiedVersion
   node tools/lab-triage.mjs note <pkg> --text "本周仍在用：<用途与判断依据>" --type usage

   # 暂时不用、但要留着观察（只有 adopted 能进 dormant）
   node tools/lab-triage.mjs promote <pkg> --to dormant --reason "暂不用，保留观察"

   # 确定不要了（终态，不可复活）
   node tools/lab-triage.mjs promote <pkg> --to rejected --reason "淘汰原因一句话" --evidence "installed.md:20"
   ```

4. **收尾校验**

   ```bash
   node tools/lab-triage.mjs check
   ```

**输出**：复核卡。
**落到哪里**：账本更新；`rejected` 额外生成 `out/rejected-<YYYY-MM-DD>.md`（归档**建议**，编号由主对话分配）。`dormant` 想再试 → `promote <pkg> --to trial --reason "..."`。

### 入口 4 · 更新（有新版本）

**触发**：用户告知上游发了新版、lab 记的版本与实测不一致、`lab-drift` 报 `VERSION_DRIFT`。

> **本阶段不联网**：不查 registry、不判"新不新"。"有新版本"这个事实只能来自**用户告知**或**本地文件差异**（lab 登记版本 vs `node_modules/<pkg>/package.json` 实测版本）。

1. **确认差异在不在、差多少**

   ```bash
   node tools/lab-drift.mjs --json
   ```

   只看 `VERSION_DRIFT` 那几条：`lab=<值>`、`profile 实测=<值>`、`dependencies 声明=<值>`（声明区间不参与比较）。

2. **记下这次核对（刷新实测版本）**

   ```bash
   node tools/lab-triage.mjs note <pkg> --text "上游 0.3.0 已发布；本机实测 <实测版本>，与 lab 登记不一致" --type update
   ```

   `note` 会把 `verifiedVersion` 刷成 profile 实测；读不到写 `null`（已 `adopted` 的保留原值，不破不变式）。

3. **版本对上了、决定长期留**（还在 `trial` 的才需要）

   ```bash
   node tools/lab-triage.mjs promote <pkg> --to adopted --reason "新版本行为核对通过，采用" --profile "<profile 目录>"
   ```

4. **刷新 lab 登记建议**

   ```bash
   node tools/lab-triage.mjs sync
   ```

**输出**：更新卡。
**落到哪里**：账本 `verifiedVersion` / `evidence`（`type: update`）；新版本号进 `out/sync-suggestions.md`。**不升级、不装、不写 profile。**

### 四入口 × 五状态覆盖表

每个状态都有人管，每条合法迁移都有明确入口（迁移表见 `data/schema.md` §3.2，本文不重复定义）：

| 状态 | 谁创建它 | 谁把它挪走 | 对应入口 |
|---|---|---|---|
| `candidate` | `add` | `→ trial`、`→ rejected` | 入口 1（评估）、入口 3（复核：评估后不要了） |
| `trial` | `promote --to trial` | `→ adopted`、`→ rejected` | 入口 2（登记）、入口 3（复核）、入口 4（更新后转 adopted） |
| `adopted` | `promote --to adopted`（需 profile 实测版本） | `→ dormant`、`→ rejected`；`note` 刷新版本不动状态 | 入口 3（复核）、入口 4（更新：`note --type update`） |
| `rejected` | `promote --to rejected`（终态） | 无（不可复活；要重来只能 `add` 新条目） | 入口 3（复核结案）、入口 1（重来时新建候选） |
| `dormant` | `promote --to dormant`（仅 adopted 可进） | `→ trial`、`→ rejected` | 入口 3（复核：想再试 / 彻底不要） |

---

## 输出卡模板

所有卡都是**给人做决定用的**：结论在前，证据在后，未验证项必须显式写出来。

### 评估卡（入口 1）

```markdown
### 评估卡 · <pkg>

**结论**：装 / 观察 / 不装 —— <一句话理由>
**三轨**：plugin / skill / mcp（kind=…；非插件主键写 skill:|mcp:|app: 前缀）
**权限四项**：文件（…）｜网络（…）｜命令（…）｜凭据（…）   ← 任一格读不到写「待补」，不写「未知」、不留空
**兼容性**：声明兼容 / 未知 / 不兼容        ← 三档之一；没有真实装过就只能是「未知」
**硬门槛**：G1 可安装且兼容 <命中/未命中/未验证>｜G2 有说明 <…>｜G3 有维护 <…>｜G4 无安全红线 <…>｜G5 依赖明确 <…>
**同轨去重**：同 label 已有 adopted=<pkg 列表>｜rejected=<pkg + 淘汰理由引用>
**账本现状**：list 结果 = 无记录 / candidate（since …）/ 已 adopted
**证据**：来源=<lab 条目 / README / 用户描述>｜版本=<值或「待补」>｜检查日期=<YYYY-MM-DD>
**未验证**：<逐条列出，如「未读源码」「未联网核对上游（只读本地 `data/registry.json` 快照；抓取由 `_registry.mjs --url` 单独执行）」>
```

判定口径：
- **硬门槛 G1–G5** 来自 lab README §2.3（`docs/RULES.md` §1 引用）：任一不满足 → 直接 `不装`；
- **结论三选一**：硬门槛全过且与同轨已有 adopted 不重复 → `装`；有未命中或证据不足 → `观察`；硬门槛失败或与 rejected 理由重合 → `不装`；
- **兼容性三档**只写「声明兼容 / 未知 / 不兼容」——本机没装过就**必须**是「未知」。

### 登记卡（入口 2）

```markdown
### 登记卡 · <pkg>

**事实**：dependencies 声明=<值>｜node_modules 实测=<值或 null>｜lab 登记=<值 / 无条目 / 行号>
**差异类型**：UNREGISTERED / VERSION_DRIFT / PERMISSION_TODO / 无差异
**账本动作**：add→candidate / promote→trial(trialUntil=…) / promote→adopted(verifiedVersion=…)
**登记建议**：out/sync-suggestions.md（权限四项：待补｜待补｜待补｜待补）
**需人做**：把片段复制进 lab（本工具不写 lab）；权限四项由人补结论
```

### 复核卡（入口 3）

```markdown
### 复核卡 · <pkg>

**到期原因**：trial 逾期 N 天（trialUntil=…）/ adopted 静默 N 天（最近活动=…）/ 用户主动询问
**当前状态**：state=…｜since=…｜watch=…｜verifiedVersion=…
**事实核对**：lab-drift 结论 = 无差异 / <差异类型 + 证据>｜lab 权限栏 = 已结论 / 待补
**结论**：继续留（note usage 已记）/ 转休眠（dormant）/ 淘汰（rejected + 理由 + 证据）
**已写产物**：data/lifecycle.json；若 rejected → out/rejected-<date>.md
**不变式**：check = OK / <违反码>
```

### 更新卡（入口 4）

```markdown
### 更新卡 · <pkg>

**版本事实**：lab 登记=<值>｜profile 实测=<值>｜dependencies 声明=<值>（区间不参与比较）
**来源**：用户告知 / 本地文件差异（不查 registry）
**账本动作**：note --type update（verifiedVersion → <值或 null>）/ promote → adopted（若仍在 trial）
**登记建议**：out/sync-suggestions.md 已刷新（新版本号）
**留给人**：是否升级由人决定；本工具不装、不升、不写 profile
```

---

## 禁止项（红线）

1. **不代装、不代卸、不代升级**——包括"顺手帮你装上"、`npm i`、改 `package.json`；
2. **不写 profile**：不写 `cordis.patch.yml`、不写 `.dsh-market`、不改 `dsh.profile.bundles`；
3. **不写外部 lab**（`<LAB_DIR>`）：只读；建议只落 `out/`；
4. **不猜权限**：四项里读不到写「待补」，不写「未知」、不写「无」、不留空；
5. **不宣称安装动作、兼容性或运行结果已被验证**：没在本机跑过的行为，只能写「未验证」；
6. **不凭星数 / 下载量排序**：星数只作生态旁证，不作门槛，也不作排序键；
7. **不把「候选」当「已装」**：`candidate` 不进 lab 已装基线，也不出现在 `sync` 建议里；
8. **不跳级迁移**：`candidate` 不能直接 `adopted`；`rejected` 是终态，要重来只能 `add` 新条目；
9. **不静默改账**：每次状态变化都要有 `--reason`，`rejected` 还要 `--evidence`；
10. **不越权联网**：registry 查询与推荐排序是 C.1，需用户单独授权；本技能只读本地文件。

---

## 工具命令表

两个 CLI 都是零依赖 ESM（只用 `node:` 内置），在仓库根目录下执行。参数名**必须逐字**使用。

### lab-drift（A 阶段：只读对账）

| 命令 / 参数 | 作用 | 备注 |
|---|---|---|
| `node tools/lab-drift.mjs --help`（`-h`） | 打印用法、退出码、只读承诺 | 默认 `--profile` 由环境变量推导；`--lab` 需显式给 |
| `--profile <dir>` | profile 目录 | 默认取 `DSH_PROFILE_DIR` / `DSH_HOME` / `~/.dsh`（优先级由高到低，无需显式传参） |
| `--lab <dir>` | lab 目录（只读） | 默认：未设置（需 `--lab` 或设 `LAB_DIR`） |
| `--md` / `--json` | 输出格式，默认 `--md` | 同时给 → exit 1 |
| `--write-report <path>` | 额外写一份报告（**唯一**写文件动作） | 指向 profile / lab 内、`cordis.patch.yml`、`.dsh-market` → 拒绝并 exit 1 |
| `--show-all-orphans` | md 里全量列 `ORPHAN_IN_NM` | 默认只列前 20 条；`--json` 始终全量 |
| `--explain <pkg>` | 查询模式：解释某包为何算/不算孤儿 | **不输出对账报告**；退出码恒 0 |
| `--fail-on-drift` | 有差异时 exit 2（CI 用） | 默认有差异也是 exit 0 |

无子命令。退出码：`0` 跑通（有差异也是 0）｜`2` 有差异 + `--fail-on-drift`｜`1` 参数/读取/拒绝写入异常。
输出契约：md 最后一行固定 `verdict: <N> drift(s)`；`--json` 顶层字段序 `generatedAt → profile → lab → summary → differences`。

### lab-triage（B 阶段：生命周期状态机）

全局参数（可放在子命令前或后）：`--lifecycle <path>`（默认 `data/lifecycle.json`）、`--profile <dir>`、`--lab <dir>`、`--now <YYYY-MM-DD|YYYY-MM-DDTHH:mm:ssZ>`（时间旅行，测试用；不接受 `now`/`today`/相对时间）、`--json`、`--help`（`-h`）。

| 子命令 | 完整用法 | 关键约束 |
|---|---|---|
| `list` | `node tools/lab-triage.mjs list [--state <candidate\|trial\|adopted\|rejected\|dormant>] [--json]` | 按 state 分组；`--state` 只接受 5 个枚举值 |
| `add` | `node tools/lab-triage.mjs add --pkg <p> --kind <plugin\|skill\|mcp\|app> --label <l> --reason <r> [--state candidate]` | `--state` 只能是 `candidate`；`pkg` 重复 → exit 1；`kind` 与 pkg 前缀必须一致 |
| `promote` | `node tools/lab-triage.mjs promote <pkg> --to <trial\|adopted\|rejected\|dormant> --reason <r> [--trial-days <1..365>] [--evidence <text>]` | 非法迁移 exit 1 且不改文件；`--to adopted` 需 `--profile` 实测版本 |
| `due` | `node tools/lab-triage.mjs due [--now <date>]` | 只提示，不改状态 |
| `note` | `node tools/lab-triage.mjs note <pkg> --text <t> [--type <drift\|conflict\|usage\|note\|update>]` | 追加 evidence + 刷 `lastVerified`/`verifiedVersion` |
| `sync` | `node tools/lab-triage.mjs sync` | 只写 `out/sync-suggestions.md`，**不写 lab** |
| `check` | `node tools/lab-triage.mjs check [--json]` | 违反 → exit 1，不写任何文件 |

子命令参数白名单（多给一个就报错）：`list: --state`｜`add: --pkg --kind --label --reason --state`｜`promote: --to --reason --trial-days --evidence`｜`due: （无）`｜`note: --text --type`｜`sync: （无）`｜`check: （无）`。

写动作只有三类：`data/lifecycle.json`、`out/rejected-<date>.md`、`out/sync-suggestions.md`。退出码：`0` 跑通（有到期项/有建议也是 0）｜`1` 参数、读取、非法迁移、不变式、拒绝写入。

---

## 降级路径（node 跑不了 / 用户不在终端）

适用：本会话无法执行命令（终端不可用、用户只贴了一段文本、你在纯文本环境里）。**结论仍然能给，但必须自证来源。**

**可读的三处文本**（都在本机，不联网）：

1. `<profile>/package.json` → `dependencies`（声明值）、`dsh.profile.bundles`（花名册）；
2. `<profile>/node_modules/<pkg>/package.json` → `version`（**唯一实测版本源**）；
3. lab 的 `installed.md`（包名 / 版本 / 权限列）与 `INDEX.md`（`pkg@ver` / 状态 / 权限摘要）。

**手工判定顺序**（与 `docs/RULES.md` §3.5 一致，避免一条事实报两类）：

1. 在 `dependencies` + lab 无条目（或 lab 标记未安装）→ `UNREGISTERED`；
2. 在 lab 已装基线 + `dependencies` 与 `node_modules` 都没有 → `MISSING`；
3. 在 lab 基线 + 实际在装 + 版本不等（只比实测值，不求值 `^`/`~`）→ `VERSION_DRIFT`；
4. 在 lab 基线 + 权限栏含 `待补/待观察/待评估/待定/待确认/待核实/TBD/TODO` → `PERMISSION_TODO`；
5. 只在 `bundles`、不在 `dependencies` → `ROSTER_ONLY`（info）；
6. 在 `node_modules` 顶层、`dependencies` 与 `bundles` 都没声明、且没有任何已装包的 `dependencies`/`peerDependencies`/`optionalDependencies` 引用它 → `ORPHAN_IN_NM`（info）。

**降级时的硬性标注**（每条结论都必须带）：

```markdown
⚠️ 未经脚本校验：本结论由人工读取 <文件路径:行号> 推得，未运行 lab-drift / lab-triage。
- 已读：<逐项列出实际读到的文件与字段>
- 未读/读不到：<逐项列出> → 相关结论记为「待补」
- 复跑命令：node tools/lab-drift.mjs（或对应 lab-triage 子命令）
```

三条不许：不许把「按规则推出来的」说成「跑出来的」；不许在读不到版本时填一个看起来合理的值；不许在降级状态下执行 `add` / `promote` / `note` 的**写入**（这些必须真跑，写坏了账本没有回滚）。

---

## 与其他文件的关系（单一源）

| 问题 | 看哪里 |
|---|---|
| 什么叫 UNREGISTERED / MISSING / VERSION_DRIFT / PERMISSION_TODO、判定优先级、解析口径 | [`docs/RULES.md`](docs/RULES.md) §3–§5 |
| 状态机、字段、迁移表、不变式 | [`data/schema.md`](data/schema.md) §2–§3 |
| 什么时候该触发、什么时候闭嘴 | [`docs/TRIGGERS.md`](docs/TRIGGERS.md) |
| 怎么跑、验收期望、未执行项 | [`README-DEV.md`](README-DEV.md) §3、§5、§6 |
| 阶段计划 | [`docs/ROADMAP.md`](docs/ROADMAP.md) |

本文件只写"什么时候用、先跑什么、出什么卡、不许做什么"；判定语义一律引用，不复述、不改写。

---

## 自检

- [ ] 命令里的每个参数名与 `tools/*.mjs` 的 `USAGE` / 参数解析器逐字一致（见下表）；
- [ ] 四个入口覆盖 `candidate / trial / adopted / rejected / dormant` 的全部合法迁移路径；
- [ ] 每张卡都写清"未验证项"与"需人做"；
- [ ] 没有夸大能力的表述（不宣称安装动作、兼容性、运行结果已验证）；
- [ ] 评估阶段只做同轨去重与淘汰理由复用，没有 registry 查询、没有排序算法。

### 命令校对表（命令 → 源文件:行号）

行号是**源码实读值**，不是估计：USAGE 行号指 `const USAGE` 模板串在文件里的物理行（与源码行号一一对应）。三张表**按文件分列**，不合成一张：`USAGE:76` 这类行号在三个文件里都存在，混排必须先读「文件」列才不会指错文件；三份 CLI 的参数面本就不同（drift 无子命令、triage 七个子命令 + 白名单、analyze 六种互斥模式 + 位置参数），合表会把「同名参数在另一工具里不是一回事」压平。**行号校对基准：`lab-analyze.mjs` 4483 行（C.4 三源解耦后）；`lab-drift.mjs` 771 行 ／ `lab-triage.mjs` 903 行本轮未改。**

#### lab-drift.mjs（A 阶段：只读对账）

| 命令 / 参数 | 出处（`tools/lab-drift.mjs`） |
|---|---|
| `--profile <dir>` | USAGE:76 ／ 解析 `case '--profile'`:152–154 |
| `--lab <dir>` | USAGE:77 ／ 解析:155–157 |
| `--json` | USAGE:78 ／ 解析:158–162 ／ 互斥检查:187 |
| `--md` | USAGE:79 ／ 解析:163–167 |
| `--write-report <path>` | USAGE:80 ／ 解析:168–170 ／ 守卫 `assertSafeWriteTarget`:621–629 |
| `--show-all-orphans` | USAGE:81 ／ 解析:175–178 ／ 限流常量 `MD_ORPHAN_LIMIT`:56、使用:441 |
| `--explain <pkg>` | USAGE:82 ／ 解析:179–181 ／ 缺包名报错:189–191 ／ 退出码恒 0:669–672 |
| `--fail-on-drift` | USAGE:83 ／ 解析:171–174 ／ 退出码 2:673 |
| `--help` / `-h` | USAGE:84 ／ 解析:147–151 ／ 分发:643–646 |
| 退出码 0 / 2 / 1 | USAGE:91–94 ／ 实现:673、681 |

#### lab-triage.mjs（B 阶段：生命周期状态机）

| 命令 / 参数 | 出处（`tools/lab-triage.mjs`） |
|---|---|
| 子命令集合 `list/add/promote/due/note/sync/check` | `COMMANDS`:79 ／ 校验:238–240 |
| 全局 `--lifecycle <path>` | USAGE:141 ／ 解析:208–210 |
| 全局 `--profile <dir>` | USAGE:142 ／ 解析:211–213 |
| 全局 `--lab <dir>` | USAGE:143 ／ 解析:214–216 |
| 全局 `--now <date>` | USAGE:144 ／ 解析:217–219 ／ 使用 `resolveNow`:820 |
| 全局 `--json` | USAGE:145 ／ 解析:220–223 |
| 全局 `--help` / `-h` | USAGE:146 ／ 解析:203–207 |
| `list --state <s>` | USAGE:114–115 ／ 白名单:83 ／ 枚举校验 `stateFilter`:275–279 |
| `add --pkg --kind --label --reason [--state candidate]` | USAGE:117–118 ／ 白名单:84 ／ 实现:340–363（`--state` 只许 candidate:341–346） |
| `promote <pkg> --to --reason [--trial-days] [--evidence]` | USAGE:120–123 ／ 白名单:85 ／ 实现:430–450（`--trial-days` 1..365:441–448） |
| `due [--now]` | USAGE:125–126 ／ 白名单:86 ／ 实现:527–581 |
| `note <pkg> --text [--type]` | USAGE:128–130 ／ 白名单:87 ／ 实现:585–592 |
| `sync` | USAGE:132–134 ／ 白名单:88 ／ 实现:703–748 ／ 产物路径:719 |
| `check` | USAGE:136–138 ／ 白名单:89 ／ 实现:752–789 |
| `--type` 五个枚举 | USAGE:128（`EVIDENCE_TYPES.join`）／ `_lifecycle.mjs`:40 ／ 校验:589–592 |
| 默认试用天数 14 | USAGE:120（`TRIAL_DEFAULT_DAYS`）／ `_lifecycle.mjs`:46 |
| adopted 失活阈值 30 天 | USAGE:126（`ADOPTED_STALE_DAYS`）／ `_lifecycle.mjs`:49 |
| 退出码 0 / 1 | USAGE:148–150 ／ 实现:832–837 |
| 子命令参数白名单机制 | `COMMAND_OPTIONS`:82–90 ／ 校验:242–249 |

#### lab-analyze.mjs（C 阶段：三源池召回 + 权限 / row 取证）

| 命令 / 参数 | 出处（`tools/lab-analyze.mjs`） |
|---|---|
| 位置参数 `<pkg>` | USAGE:348 ／ 收位置参数（`default` 分支）:578–582 ／ 多于一个包报错:591 ／ `normalizePkgArg`:592–596 ／ 与 `--from-dir` 二选一:597 ／ 模式判定:600–606 |
| `--scan-all` | USAGE:350、359 ／ 解析:520–523 ／ 不与包名 / `--from-dir` 同用:598 ／ 实现 `buildScanAllReport`:2171、`buildScanAll`:1607 |
| `--search <kw>`（三源搜索） | USAGE:351、360 ／ 解析:524–526 ／ 空关键词报错:586 ／ 实现 `buildSearchReport`:3029（分词:3044–3048）／ 三源全不可用 → exit 1:3055–3062 |
| `--unknown` | USAGE:352、361 ／ 解析:527–530 ／ 实现 `buildUnknownReport`:2853（装载点 `loadCatalog`:2863 —— C.4 起不再走 `requireCatalog`、末行计数:3622）／ 三源全不可用 → exit 1:2877–2884 |
| `--goal <text>`（**池内诊断：不做语义理解，只做字面匹配**） | USAGE:353、362、405–406（`GOAL_NOTICE` 定义:342–343）／ 解析:531–533 ／ 空目标报错:587 ／ 实现 `buildGoalReport`:3188（分词:3213、噪声词全丢:3223–3227、三源全不可用:3204–3211） |
| `--only-installed` | USAGE:363 ／ 解析:534–537（默认值即 `true`:457，显式写不报错） |
| `--with-catalog` | USAGE:364 ／ 解析:538–541 ／ 只能与 `--unknown` 同用:615 |
| `--from-dir <dir>` | USAGE:349、358 ／ 解析:517–519 ／ 目录 / `package.json` 报错:2012–2016 |
| `--catalog <path>` | USAGE:368 ／ 解析:542–544 ／ 装载点 `loadCatalog`:2096、2244、2863、3033、3191 |
| `--catalog-source <path>` | USAGE:369 ／ 解析:545–547 ／ 装载点同上（`loadCatalog` 的 `sourcePath` 入参）:2244 |
| `--registry <path>` | USAGE:370 ／ 解析:548–550 ／ 装载点 `loadRegistry`:2102、2868、3038、3195 |
| `--host-rows <path>` | USAGE:365 ／ 解析:551–554 ／ 显式给 → `confidence: 'confirmed'`:1379（默认快照标 `likely`） |
| `--labels <path>` | USAGE:366 ／ 解析:555–557 ／ 默认值:145（`docs/LABELS.md`） |
| `--lifecycle <path>` | USAGE:367 ／ 解析:558–560 ／ 默认值:147（只读） |
| `--include-tests` | USAGE:371 ／ 解析:561–564 ／ 使用:1230、1244 |
| `--json` / `--md` | USAGE:372–373 ／ 解析:565–574 ／ 同时给 → exit 1:585 |
| `--write-report <path>` | USAGE:374 ／ 解析:575–577 ／ 写与 stderr 提示:4408–4414 ／ 守卫 `assertSafeLifecyclePath`:4410（定义 `_lifecycle.mjs`:364；拒绝 profile / lab / `cordis.patch.yml` / `.dsh-market`） |
| `--help` / `-h` | USAGE:375 ／ 解析:506–510 ／ 分发:4381–4384（打印 USAGE 后 exit 0） |
| 模式互斥 / 缺目标 | `parseArgs` 收尾:585–615（`--json`+`--md`:585、一次只用一种:600–609、缺目标:610–614） |
| 参数写法 `--k=v` / 缺值 / 布尔带值 | 解析:480–486（`=` 内联）、488–499（`takeValue`：下一个参数缺失或以 `--` 开头即报错）、501–503（`rejectInline`：布尔参数收到取值即报错） |
| 退出码 0 / 1 | USAGE:441–443 ／ 实现:4416（跑通，含无匹配 / 有冲突）、4424（异常：参数 / 读取 / 拒绝写入 / 目录或三源不可用） |
