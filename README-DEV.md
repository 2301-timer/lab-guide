# lab-guide（插件实验室·向导）

> 基线：v0.1.0（A 阶段）｜2026-11-14｜A.1 修补：`ORPHAN_IN_NM` 语义收紧为「真孤儿」｜B 阶段：生命周期状态机（`lab-triage`）｜C.1：本地静态分析器（`lab-analyze`，见 §3.2 / §5.5）｜C.2：离线目录 + `--search` / `--unknown`（见 §3.2 / §5.6）
> 上游只读源：`<LAB_DIR>`（lab-v0.8.0）

**它能替你做什么**

| 能 | 怎么用 |
|---|---|
| 从 **11183** 条池子（registry 10974 ｜ catalog 195 ｜ 已装 14）按词 / 按句捞候选 | `--search <词>` 召回；`--goal "<一句人话>"` 做池内诊断 |
| 给候选的权限四档（文件 / 网络 / 命令 / 凭据）与 row 争用（`danger` / `warn`） | `lab-analyze <pkg>`、`--from-dir <dir>`、`--scan-all` |
| 把「已装」与「lab 登记」对一遍账（四类差异 + 两类 info） | `lab-drift` |
| 用五态生命周期记住试用与淘汰（`candidate → trial → adopted / rejected / dormant`） | `lab-triage list / promote / due / note / sync` |

**它不能替你做什么**

| 不能 | 原因 |
|---|---|
| 判断这个方向该不该学 | 它只回答「池子里有没有字面命中」，不回答「值不值得学」 |
| 保证候选适合你 | 未装包本地无代码，权限固定 `unknown（未安装，本地无代码）` |
| 替你点安装 | 安装永远走 `设置 → 插件` 或 `dshmarket`；本工具不写 profile、不装不卸不升级 |
| 替你想出你的词在市场里叫什么 | 只做**字面**匹配；换词靠人（`## 词表诊断` 只告诉你哪个词 0 命中，不替你改写目标） |

## 1. 定位

一句话：**把「profile 里实际装了什么」和「lab 里登记了什么」对一遍，只报告，不动手。**

B 阶段再加一句：**把「这个包要不要留下」变成一本可审计的账**（`candidate → trial → adopted / rejected / dormant`），
到期自动提醒、与 lab 的登记差异只生成建议，仍然不动手。

为什么需要它：一次内部项目的事故：把浏览器插件以 junction 装进 profile 后 boot fail，应用自愈又把补丁层从 1014 行重写成 4 行（事故记录不进仓）——说明两件事：

1. 动 profile 的代价极高（一次连接式安装就能把 web boot 打挂，自愈还会把 `cordis.patch.yml` 从 60217 B 重写成 801 B）；
2. 基线漂移是**日常的、静默的**：装了没登记、登记了没装、版本对不上、权限栏永远「待补」。这些不会炸，但会让「已装基线」变成一本假账。

所以本项目的 A 阶段只做一件事：**只读对账**。它永不写 profile、永不装插件、永不碰 `cordis.patch.yml`。

## 2. 四阶段

| 阶段 | 名字 | 一句话 | 状态 |
|---|---|---|---|
| **A** | 只读对账器 | profile 实际 vs lab 登记，输出四类差异 + 两类 info | **已交付并实跑通过** |
| **B** | 生命周期状态机 | `candidate → trial → adopted / rejected / dormant`；到期复核 + lab 登记建议（只建议） | **本次交付**（运行验收未执行，见 §6） |
| B.1 | lab 文档只读 lint | 条目完备性、权限四项、编号规约、索引一致性（ROADMAP 原 B 的内容，顺延） | 未开始 |
| **C.1** | 本地静态分析器 | 回答「这是干什么的 / 要什么权限 / 会不会抢别人的行 / 同轨有没有重复」：身份 + 权限四扫 + row 争用 + 同轨 + 建议分类 | **已交付**（运行验收未执行，见 §6） |
| **C.2** | 离线目录 + 反向筛选 | 修 C.1 实测的三个问题：①「它干什么」改走三级数据源（离线目录优先）；②`--unknown` 反向筛选；③`--search` 离线搜索 | **本次交付**（运行验收未执行，见 §6） |
| C | 维护卡草稿生成 | 把差异转成可交主对话核验的卡（人保留安装权） | 未开始 |
| D | 回归巡检与冻结检测 | 盯事故特征（patch 体积骤降、bundles 减少、junction 安装） | 未开始 |

细则见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。**注意**：ROADMAP 里的 B 写的是「lab 文档 lint」，
本轮任务卡把 B 定为「生命周期状态机」——按任务卡执行，lint 顺延为 B.1（裁决见 `docs/RULES.md` §9.0，Q-001）。

## 3. 怎么跑

零依赖，只要能跑 node（ESM，`node:` 内置）。**在仓库根目录执行**（发布仓的根目录就是 `lab-guide/`）：

```bash
# 1) 看帮助（含退出码与只读承诺）
node tools/lab-drift.mjs --help

# 2) 夹具自检（不碰真实 profile / 真实 lab）
node tools/lab-drift.mjs \
  --profile fixtures/fake-profile \
  --lab     fixtures/fake-lab

# 3) 真实环境（走默认 profile 与 lab，只读）
node tools/lab-drift.mjs

# 4) 机读
node tools/lab-drift.mjs --json

# 5) CI：有差异就红
node tools/lab-drift.mjs --fail-on-drift

# 6) 需要留档时才写（唯一写动作）
node tools/lab-drift.mjs --write-report out/drift.md

# 7) ORPHAN_IN_NM 全量列出（默认 md 只列前 20 条）
node tools/lab-drift.mjs --show-all-orphans

# 8) 解释某个包为什么算/不算孤儿（查询模式，不输出对账报告）
node tools/lab-drift.mjs \
  --profile fixtures/fake-profile \
  --lab     fixtures/fake-lab \
  --explain lab-fixture-transitive
```

参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--profile <dir>` | `DSH_PROFILE_DIR` > `DSH_HOME/profiles/<profile>` > `~/.dsh/profiles/desktop` | profile 目录 |
| `--lab <dir>` | `<LAB_DIR>`（未设则必须显式给，否则 exit 1） | lab 目录 |
| `--md` / `--json` | `--md` | 输出格式（两者互斥，同时给 → exit 1） |
| `--write-report <path>` | 无 | 额外写一份报告；指到 profile/lab 内、`cordis.patch.yml`、`.dsh-market` → exit 1 |
| `--show-all-orphans` | 关 | md 里全量列出 `ORPHAN_IN_NM`（默认只列前 20 条；`--json` 始终全量） |
| `--explain <pkg>` | 无 | 查询模式：只解释该包为何被判为孤儿/非孤儿（列出引用者），不输出对账报告；退出码恒 0 |
| `--fail-on-drift` | 关 | 有差异时 exit 2 |
| `--help` / `-h` | — | 帮助 |

退出码：`0` 跑通（有差异也是 0）｜`2` 有差异 + `--fail-on-drift`｜`1` 参数/读取/拒绝写入等异常。

### 3.1 B 阶段：生命周期状态机怎么跑

```bash
# 帮助（含迁移表、不变式、退出码）
node tools/lab-triage.mjs --help

# 看账（按 state 分组一屏表）
node tools/lab-triage.mjs list
node tools/lab-triage.mjs list --state trial --json

# 新增候选（只能是 candidate）
node tools/lab-triage.mjs add \
  --pkg dsh-purge-community --kind plugin --label toolchain \
  --reason "疑似无人维护，先记候选待评估"

# 状态迁移（非法迁移 exit 1；rejected 会额外生成归档建议）
node tools/lab-triage.mjs promote dsh-purge-community --to trial --reason "符合清理需求" --trial-days 14
node tools/lab-triage.mjs promote dsh-purge-community --to adopted --reason "试用稳定" --profile "<DSH_HOME>/profiles/<profile>"
node tools/lab-triage.mjs promote dsh-purge-community --to rejected --reason "权限过高（读写凭据）" --evidence "installed.md:20"

# 到期复核（trial 到期 + adopted 30 天没核对）
node tools/lab-triage.mjs due

# 追加证据（顺带把 lastVerified / verifiedVersion 刷成 profile 实测）
node tools/lab-triage.mjs note dsh-purge-community --text "今天核对过，行为与描述一致" --type usage

# 与 lab 的登记差异 → 只生成建议（不写 lab）
node tools/lab-triage.mjs sync

# 跑 schema + 不变式（有违反 exit 1）
node tools/lab-triage.mjs check
```

全局参数：`--lifecycle <path>`（默认 `data/lifecycle.json`）、`--profile <dir>`、
`--lab <dir>`、`--now <YYYY-MM-DD|ISO>`（测试时间旅行）、`--json`。

> 上面是**用法示例**（`dsh-purge-community` 是 A 阶段真实环境里那条未登记的包，仅作示范）。
> 真跑之前先 `list` 看账本里有没有这条；`promote` 的顺序必须是 candidate → trial → adopted/rejected，跳级会被拒绝。

**B 阶段的三个写动作**：`data/lifecycle.json`（账本）、`out/rejected-<date>.md`（归档建议）、
`out/sync-suggestions.md`（登记建议）。**不写 profile、不写 lab、不碰 `cordis.patch.yml`。**

### 3.2 C.1：本地静态分析器怎么跑

> 五个入口：**给包名**（profile 里已装的）、**`--from-dir`**（已解包目录，离线包）、**`--scan-all`**（全量 row 争用矩阵）、
> **`--unknown`**（C.2 反向筛选：我装了但说不清它们干什么）、**`--search <kw>`**（C.2 离线目录搜索：没装也能先找）。
> 全部只读、不联网、零依赖；唯一写动作是 `--write-report <path>`（`data/catalog.json` 只由 `_catalog.mjs --write` 写）。

```bash
# 帮助（含五段字段说明、不联网/只读承诺、退出码）
node tools/lab-analyze.mjs --help

# ① 已装包：五段输出（它是干什么的 / 权限四项 / row 争用 / 同轨重复 / 建议分类+结论）
node tools/lab-analyze.mjs @txc2768651338/dsh-plugin-manager
node tools/lab-analyze.mjs @txc2768651338/dsh-plugin-manager --json

# ② 离线包：先解包再分析（不联网、不安装）
node tools/lab-analyze.mjs --from-dir <已解包目录> --host-rows fixtures/fake-host-rows.json

# ③ 谁抢了谁的行：全量矩阵（row id ｜ 声明它的包 ｜ 是否官方 ｜ 严重度）
node tools/lab-analyze.mjs --scan-all
node tools/lab-analyze.mjs --scan-all --json

# ④ 夹具自检（不碰真实 profile 的 patch 结论，只读 profile 的 bundled 名称与 lab 类别）
node tools/lab-analyze.mjs --from-dir fixtures/fake-nm/lab-fixture-rowhog \
  --host-rows fixtures/fake-host-rows.json
node tools/lab-analyze.mjs --from-dir fixtures/fake-nm/lab-fixture-shellcred \
  --host-rows fixtures/fake-host-rows.json

# ⑤ 需要留档时才写（唯一写动作；指到 profile/lab 内、cordis.patch.yml、.dsh-market → 拒绝并 exit 1）
node tools/lab-analyze.mjs @michengai/dsh-skills-manager --write-report out/analyze-skills-manager.md

# ⑥ C.2：离线目录（唯一写 data/catalog.json 的动作；不带 --write 只打印统计）
node tools/_catalog.mjs
node tools/_catalog.mjs --write
node tools/_catalog.mjs --check

# ⑦ C.2：反向筛选——「我装了但不知道它们是干什么的」
node tools/lab-analyze.mjs --unknown --only-installed
node tools/lab-analyze.mjs --unknown --with-catalog --json

# ⑧ C.2：离线搜索——评估没装的包也能先找
node tools/lab-analyze.mjs --search 嵌入式
node tools/lab-analyze.mjs --search "沙箱 权限" --json
```

参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `<pkg>`（位置参数） | — | 包名；从 `<profile>/node_modules/<pkg>` 读 |
| `--from-dir <dir>` | — | 从该目录读包（目录里必须有 `package.json`）；与包名互斥 |
| `--scan-all` | 关 | 输出 row 争用矩阵；与包名 / `--from-dir` 互斥 |
| `--search <kw>` | — | C.2：离线目录搜索（中文名/描述/分类），大小写不敏感、空格分词 AND；与其它模式互斥 |
| `--unknown` | 关 | C.2：反向筛选「描述不可信」的包；与其它模式互斥 |
| `--only-installed` | **开** | C.2：`--unknown` 只扫 profile 已装第三方包（默认行为，显式写幂等） |
| `--with-catalog` | 关 | C.2：`--unknown` 连同离线目录全量比对（`catalogCoverage`） |
| `--catalog <path>` | `data/catalog.json` | C.2：离线目录快照；缺失时现场解析源（并告警） |
| `--catalog-source <path>` | `<profile>/node_modules/@txc2768651338/dsh-plugin-manager/lib/index.js` | C.2：离线目录源（现场解析用） |
| `--profile <dir>` | `DSH_PROFILE_DIR` > `DSH_HOME/profiles/<profile>` > `~/.dsh/profiles/desktop` | profile 目录（只读） |
| `--lab <dir>` | `<LAB_DIR>`（未设则必须显式给，否则 exit 1） | lab 目录（只读，取类别列与状态列） |
| `--host-rows <path>` | `data/host-rows.json` | 官方 row id 数据；显式给时 confidence=`confirmed`，用默认快照时 `likely` |
| `--labels <path>` | `docs/LABELS.md` | 分类关键词表（唯一词表来源） |
| `--lifecycle <path>` | `data/lifecycle.json` | 生命周期账本（只读，取 label 做同轨） |
| `--include-tests` | 关 | 权限扫描包含 `test/` 与 `*.test.js`（默认跳过，见 RULES §10.3） |
| `--json` / `--md` | `--md` | 输出格式（互斥，同时给 → exit 1） |
| `--write-report <path>` | — | 额外写一份报告（唯一写动作） |
| `--help` / `-h` | — | 帮助 |

退出码：`0` 跑通（**发现 danger 也是 0**；「本地无此包」也是 0）｜`1` 参数 / 读取 / 拒绝写入异常。
md 最后一行固定：`verdict: <装|观察|不装> ｜ severity=<danger|warn|ok> ｜ permissions=<四档> ｜ localData=<true|false> ｜ officialSource=<…>`。

## 4. 输出长什么样

md（默认，一屏摘要 + 四张分类表 + 最后一行 verdict）：

```
summary: **4 drift(s)** ｜ UNREGISTERED 1 ｜ MISSING 1 ｜ VERSION_DRIFT 1 ｜ PERMISSION_TODO 1 ｜ info: ROSTER_ONLY 1 / ORPHAN_IN_NM 1
## 1. UNREGISTERED · 装了但 lab 没登记（结论：需要登记） — 1 条
| pkg | evidence |
|---|---|
| `lab-fixture-epsilon` | dependencies 声明 0.3.1；node_modules 实测 0.3.1；installed.md / INDEX.md 均无该包条目 |
...
verdict: 4 drift(s)
```

四类差异定义、判定优先级、解析口径全部固定在 [`docs/RULES.md`](docs/RULES.md)（§3 语义、§5 口径）。这里只留一句话版本：

- **UNREGISTERED**：`dependencies` 里有，lab 没把它算进已装基线 → 基线失真，要补登记。
- **MISSING**：lab 已装基线里有，`dependencies` 与 `node_modules` 都没有 → 基线虚高，要清理。
- **VERSION_DRIFT**：lab 登记版本 ≠ `node_modules` 实测版本（取实测值，不取 `^x.y.z` 区间，不按区间推断）。
- **PERMISSION_TODO**：权限栏含 `待补/待观察/待评估/待定/待确认/待核实/TBD/TODO`。
- info：**ROSTER_ONLY**（只在 bundles，如官方 bundle）、**ORPHAN_IN_NM**（node_modules 顶层真孤儿：未声明**且**没有任何已安装包引用它）——只记录，不给结论，不计入 verdict。

> **A.1 语义修订**：`ORPHAN_IN_NM` 不再等于「在 node_modules 但未声明」。真实 profile 顶层 333 个目录里 320 个是 pnpm 提升的传递依赖，旧口径会把报告淹没。现在只报**真孤儿**（未被任何已安装包的 `dependencies`/`peerDependencies`/`optionalDependencies` 引用），真实环境从 320 收到个位数。口径见 [`docs/RULES.md`](docs/RULES.md) §4.2。

### 4.1 C.1 五段输出 → `SKILL.md` 评估卡字段对照

`lab-analyze` 的 md 就是**评估卡的证据层**：五段顺序与 `SKILL.md`「入口 1 · 评估卡模板」一一对得上，抄过去即可。

| 评估卡字段 | 取自 lab-analyze 的哪一段（json 路径） |
|---|---|
| **结论**：装 / 观察 / 不装 + 一句话理由 | `verdict.verdict` + `verdict.reason`（≤80 字）+ `verdict.disclaimer` 原文照抄进「未验证」 |
| **用途（一句话）** | §1 第一行「用途（source = …）」= `identity.summaryText`；`identity.source` 只能是 `catalog` / `package-json` / `readme` / `unknown`（RULES §11.1），`unknown` 就要在评估卡里写「本机无任何可信描述」 |
| **三轨**：plugin / skill / mcp | 不在 C.1 判定内（`--from-dir` 的 kind 由人看主键形态决定；`skill:`/`mcp:`/`app:` 前缀规则见 `data/schema.md` §2.1） |
| **权限四项**：`文件（…）｜网络（…）｜命令（…）｜凭据（…）` | §2 的四类计数与前 3 处位置；结论落 `permissions.conclusion` 四档。**四格都要写结论**，读不到写 `待补`（RULES §2） |
| **兼容性**：声明兼容 / 未知 / 不兼容 | §1 的 `identity.engines.dsh` 只算「声明」；没真装过 → **未知**（C.1 不做安装实测） |
| **硬门槛 G1–G5** | G2 看 §1 的 README 正文前 3 句是否有安装/配置说明；G4 看 §2 权限档 + §3 争用；G5 看 §1 的依赖数与 `identity.description`。G1/G3 是人工项，C.1 不判 |
| **同轨去重** | §4：同 label 的已装条目（含状态）、`adopted`、`rejected`（带 reason） |
| **账本现状** | 用 `lab-triage list`（C.1 不写账本；§4 只读 `data/lifecycle.json` 的 label） |
| **证据** | 报告头的 `generatedAt` / `profile` / `hostRows.source` + 各段的 `文件:行` |
| **未验证** | 固定抄两条：`verdict.disclaimer` + §1 的 `localData` / §2 的「只扫 .js/.mjs」限制 |

`--scan-all` 的矩阵不进评估卡，它是**装机名单体检**用的一屏视图（谁抢了谁的行）。

## 5. 验收

### 5.1 A.1 验收（`ORPHAN_IN_NM` = 真孤儿）

```bash
# ① 夹具：真孤儿 1 条，传递依赖 0 条
node tools/lab-drift.mjs --profile fixtures/fake-profile --lab fixtures/fake-lab
#   → ORPHAN_IN_NM 1，且是 lab-fixture-orphan
#   → lab-fixture-transitive 不得出现在任何一类（它在 node_modules 顶层、未声明，但被 lab-fixture-alpha 引用）
#   → verdict: 4 drift(s)

# ② 真实环境：噪音必须收干净
node tools/lab-drift.mjs
#   → ORPHAN_IN_NM 应从 320 降到个位数（≤10）
#   → UNREGISTERED 仍为 2（@txc2768651338/dsh-plugin-manager、dsh-purge-community）
#   → verdict 仍为 2 drift(s)
```

> A.1 之前真实环境跑出 `ORPHAN_IN_NM 320`：333 个顶层目录里 320 个是 pnpm 提升的传递依赖，属噪音，会把后续阶段（B/C/D）淹没。收紧口径的推导见 [`docs/RULES.md`](docs/RULES.md) §4.2「为何排除传递依赖」。

### 5.2 A 阶段回归验收（四类差异各 1 条）

```bash
# ① 夹具：四类差异各必须命中一条
node tools/lab-drift.mjs --profile fixtures/fake-profile --lab fixtures/fake-lab
#   期望 summary: 4 drift(s) ｜ UNREGISTERED 1 ｜ MISSING 1 ｜ VERSION_DRIFT 1 ｜ PERMISSION_TODO 1
#   期望 UNREGISTERED=lab-fixture-epsilon / MISSING=lab-fixture-delta
#        VERSION_DRIFT=lab-fixture-alpha / PERMISSION_TODO=lab-fixture-gamma
#   期望 info: ROSTER_ONLY 1（@deepseek-ai/lab-fixture-official-bundle）/ ORPHAN_IN_NM 1（lab-fixture-orphan）
#   期望最后一行：verdict: 4 drift(s)

# ② 真实环境：必须报出两条 UNREGISTERED
node tools/lab-drift.mjs
#   期望 UNREGISTERED 命中：@txc2768651338/dsh-plugin-manager、dsh-purge-community
#   期望 MISSING 0 条（lab 11 条已装基线在 profile 里都有）

# ③ 解释模式（查询，不输出报告）
node tools/lab-drift.mjs --profile fixtures/fake-profile --lab fixtures/fake-lab --explain lab-fixture-transitive
#   期望：判定「非孤儿」、被引用 1 个包（lab-fixture-alpha@0.2.0）、最后一行 orphan: false；退出码 0
```

机器可断言的期望写在 [`fixtures/expected.json`](fixtures/expected.json)（`kind + pkg + 计数 + verdict`；不断言 `generatedAt`、绝对路径、evidence 文案）。

### 5.3 B 阶段验收（生命周期状态机）

**先看两条禁令再动手**：

1. `fixtures/lifecycle-b.json` 是**只读种子**。`promote` / `note` 会改文件，所以验收**一律在副本上跑**；
2. 真实 lab 只读，`sync` 的输入用 `fixtures/fake-lab-b`（故意只登记 `lab-fixture-delta`），不拿真实 lab 当夹具。

```powershell
# 0) 准备副本（key step：不 copy 就会把夹具改脏）
New-Item -ItemType Directory -Force -Path out | Out-Null
Copy-Item fixtures/lifecycle-b.json out/lifecycle-b.tmp.json -Force

# 1) 看账：3 条覆盖 candidate / adopted
node tools/lab-triage.mjs --lifecycle out/lifecycle-b.tmp.json list --now 2026-11-14

# 2) candidate → trial（trialUntil = 2026-11-14 + 14 天 = 2026-11-28）
node tools/lab-triage.mjs --lifecycle out/lifecycle-b.tmp.json promote lab-fixture-alpha --to trial --reason "符合嵌入式入门需求" --now 2026-11-14

# 3) due：alpha 逾期 3 天；gamma（adopted）静默 42 天
node tools/lab-triage.mjs --lifecycle out/lifecycle-b.tmp.json due --now 2026-12-01

# 4) trial → adopted（verifiedVersion 取 fake-profile 实测 0.2.0，watch 自动 true）
node tools/lab-triage.mjs --lifecycle out/lifecycle-b.tmp.json promote lab-fixture-alpha --to adopted --reason "试用两周稳定，采用" --profile fixtures/fake-profile --now 2026-12-01

# 5) candidate → rejected（带 evidence + 生成 out/rejected-2026-12-01.md）
node tools/lab-triage.mjs --lifecycle out/lifecycle-b.tmp.json promote lab-fixture-beta --to rejected --reason "权限过高（读写凭据）" --evidence "installed.md:20" --now 2026-12-01

# 6) adopted → dormant（watch 保持 true）
node tools/lab-triage.mjs --lifecycle out/lifecycle-b.tmp.json promote lab-fixture-gamma --to dormant --reason "暂不用，保留观察" --now 2026-12-01

# 7) 不变式 + schema：全生命周期跑完仍然 OK
node tools/lab-triage.mjs --lifecycle out/lifecycle-b.tmp.json check --now 2026-12-01

# 8) sync：建议 alpha + gamma；反向 info 一条 delta；产物 out/sync-suggestions.md
node tools/lab-triage.mjs --lifecycle out/lifecycle-b.tmp.json sync --lab fixtures/fake-lab-b --now 2026-12-01

# 9) 复原（二选一）：把副本重置回种子，或者直接删掉副本
Copy-Item fixtures/lifecycle-b.json out/lifecycle-b.tmp.json -Force
# Remove-Item out/lifecycle-b.tmp.json
```

期望（逐条可断言，机器版在 [`fixtures/lifecycle-expected.json`](fixtures/lifecycle-expected.json)）：

| 步骤 | 期望 |
|---|---|
| 1 | `candidate 2 ｜ adopted 1`，三条 pkg 都在表里；exit 0 |
| 2 | alpha：`state=trial`、`since=2026-11-14`、`trialUntil=2026-11-28`、`evidence` 1 条；exit 0 |
| 3 | trials = [`lab-fixture-alpha`，逾期 **3** 天]；adopted = [`lab-fixture-gamma`，静默 **42** 天]（2026-10-20 → 2026-12-01）；exit 0 |
| 4 | alpha：`state=adopted`、`watch=true`、`verifiedVersion=0.2.0`、`trialUntil=null`；exit 0 |
| 5 | beta：`state=rejected`、`evidence` 3 条（种子 1 + 迁移 1 + `--evidence` 1）、`watch=false`；生成 `out/rejected-2026-12-01.md`；exit 0 |
| 6 | gamma：`state=dormant`、`watch` 仍为 `true`、`verifiedVersion` 仍为 `2.0.0`；exit 0 |
| 7 | `candidate 0 ｜ adopted 1 ｜ rejected 1 ｜ dormant 1`，最后一行 `check: OK`；exit 0 |
| 8 | 建议恰好 alpha + gamma（beta 是 rejected，不进已装表）；反向 info 恰好 delta；片段里权限四项为 `待补｜待补｜待补｜待补`；exit 0 |

### 5.4 B 阶段负例（每条都必须 exit 1 且**不改文件**）

负例的状态前提不都一样，所以**每条前面单独 copy 一次**（种子 or 步骤 8 之后的最终态），别复用同一份副本：

```bash
# ① 非法迁移：adopted → adopted（种子里 gamma 就是 adopted）
Copy-Item fixtures/lifecycle-b.json out/lifecycle-b.neg.json -Force
node tools/lab-triage.mjs --lifecycle out/lifecycle-b.neg.json promote lab-fixture-gamma --to adopted --reason "再采用一次" --now 2026-12-01
#   → stderr: 非法迁移 adopted → adopted（拒绝执行，文件未改动）；exit 1

# ② rejected 是终结态（要先把 beta 变成 rejected：用步骤 8 之后的最终态）
Copy-Item out/lifecycle-b.tmp.json out/lifecycle-b.neg.json -Force
node tools/lab-triage.mjs --lifecycle out/lifecycle-b.neg.json promote lab-fixture-beta --to trial --reason "想再来一次" --now 2026-12-02
#   → 非法迁移 rejected → trial；exit 1

# ③ adopted 读不到 profile 实测版本 → 拒绝，不填默认值（最终态里 gamma 是 dormant，先合法地回到 trial）
Copy-Item out/lifecycle-b.tmp.json out/lifecycle-b.neg.json -Force
node tools/lab-triage.mjs --lifecycle out/lifecycle-b.neg.json promote lab-fixture-gamma --to trial --reason "重试" --now 2026-12-01
node tools/lab-triage.mjs --lifecycle out/lifecycle-b.neg.json promote lab-fixture-gamma --to adopted --reason "再采用" --profile fixtures/fake-lab-b --now 2026-12-01
#   → 第一条 exit 0（dormant→trial 合法）；第二条 exit 1：adopted 需要 profile 实测版本…；verifiedVersion 仍是 2.0.0

# ④ pkg 唯一 / ⑤ add 只建 candidate / ⑥ kind 前缀不一致（都从种子起）
Copy-Item fixtures/lifecycle-b.json out/lifecycle-b.neg.json -Force
node tools/lab-triage.mjs --lifecycle out/lifecycle-b.neg.json add --pkg lab-fixture-alpha --kind plugin --label embedded --reason "重复登记"
node tools/lab-triage.mjs --lifecycle out/lifecycle-b.neg.json add --pkg lab-fixture-new --kind plugin --label embedded --reason "跳过试用" --state adopted
node tools/lab-triage.mjs --lifecycle out/lifecycle-b.neg.json add --pkg lab-fixture-new --kind skill --label toolchain --reason "前缀不一致"
#   → 分别 exit 1：pkg 已存在 / add 只建 candidate / 必须以「skill:」开头

# ⑦ 手工把某条 trial 的 trialUntil 改成 null → check 抓不变式
Copy-Item fixtures/lifecycle-b.json out/lifecycle-b.neg.json -Force
#   （手工把 gamma 的 state 改成 trial、trialUntil 保持 null）
node tools/lab-triage.mjs --lifecycle out/lifecycle-b.neg.json check
#   → INV_TRIAL_NO_TRIAL_UNTIL + check: 1 violation(s)；exit 1

# ⑧ 写目标守卫：--lifecycle 指到真实 lab 目录 → 拒绝（lab 只读）
node tools/lab-triage.mjs --lifecycle "<LAB_DIR>/lifecycle.json" add --pkg lab-fixture-guard --kind plugin --label embedded --reason "守卫测试"
#   → 拒绝写入 … 路径在 lab 目录内…；exit 1

# ⑨ 子命令参数白名单：list 不接受 --reason
node tools/lab-triage.mjs --lifecycle fixtures/lifecycle-b.json list --reason "无关参数"
#   → 子命令 list 不支持参数 --reason；exit 1

# 清理
Remove-Item out/lifecycle-b.neg.json
```

> 负例的期望同样写进了 `fixtures/lifecycle-expected.json` 的 `negativeCases`（含每条命令、退出码、stderr 片段与 copy 来源）。

### 5.5 C.1 验收（本地静态分析器）

**前置**：`data/host-rows.json` 存在（官方 row 本地快照，出处见 `docs/RULES.md` §10.7）。
它读不到也不会崩——只是 `COLLIDES_WITH_HOST` 记 unknown、verdict 最多到「观察」，并出告警。

```bash
# ① 验收主角：它就是「抢行」事故当事人（官方 @deepseek-ai/dsh-base 的 plugin-manager 行被它顶掉）
node tools/lab-analyze.mjs @txc2768651338/dsh-plugin-manager
#   → §3 必须报 row 争用：selfIds 含 plugin-manager
#   → COLLIDES_WITH_HOST 1 条：id=plugin-manager、官方声明者=@deepseek-ai/dsh-base、severity=danger
#   → §2 权限四扫必须命中「命令」或「凭据」类 → 结论「全量（含命令或凭据）」
#     （它写 catalog.json / 做备份导入导出 → writeFileSync 命中；目录文本与 JWT 校验里也有 token/credential 字样）
#   → 最后一行：verdict: 不装 ｜ severity=danger ｜ permissions=全量（含命令或凭据） ｜ localData=true

# ② 一眼看出谁抢了谁的行
node tools/lab-analyze.mjs --scan-all
#   → 矩阵里必须能看出至少一组争用：行 id = plugin-manager
#       声明者含 @deepseek-ai/dsh-base(官方/insert) 与 @txc2768651338/dsh-plugin-manager(第三方/insert)
#       「是否官方」= 是，严重度 = danger
#   → 另有两条 info（只覆盖、不自插）：web（@anysearch/anysearch-dsh）、system-prompt（dsh-purge-community）
#   → summary 里同时打印「第三方 insert N 条 / 官方 row M 条」，用来区分「真无冲突」与「patch 没读进来」
#   ⚠️ 若跑完一条危险/警告都没有：**不许伪造**。报告会写「未发现 row 争用」并打印上面两个数；
#      M（第三方 insert）为 0 就是解析没读到，不是没有冲突。

# ③ 任务卡点名的第三个包：description / 权限四档 / 建议 label 都要给出来
node tools/lab-analyze.mjs @michengai/dsh-skills-manager
#   → §1 有 description 原文（DSH Skills Manager — …）与 README 前 3 句
#   → §2 四类计数齐全，结论落在四档之一（实测值以输出为准，本文不预先编造）
#   → §5 suggestedLabel = base（matchedTerms 含 skills manager）

# ④ 夹具：两个假包（只读夹具目录，不碰真实 profile 的插入结论）
node tools/lab-analyze.mjs --from-dir fixtures/fake-nm/lab-fixture-rowhog \
  --host-rows fixtures/fake-host-rows.json
#   → COLLIDES_WITH_HOST(danger, plugin-manager)；权限档「写入」（只有文件写）；verdict 不装

node tools/lab-analyze.mjs --from-dir fixtures/fake-nm/lab-fixture-shellcred \
  --host-rows fixtures/fake-host-rows.json
#   → 权限档「全量（含命令或凭据）」（child_process+spawn、API_KEY/credentialRef）；row 争用 ok；verdict 观察

# ⑤ 不联网契约：本地没有这个包
node tools/lab-analyze.mjs @nope/definitely-not-installed
#   → localData: false + 「本地无此包，本工具不联网；先用 dshmarket 安装或用 --from-dir 分析」
#   → exit 0（这不是失败）
```

机器可断言的期望写在 [`fixtures/analyze-expected.json`](fixtures/analyze-expected.json)
（6 个正例 + 9 条负例 + 2 条**未覆盖分支**的显式声明：`COLLIDES_WITH_PLUGIN` 在本机真实数据里没有样本）。

夹具清单：

| 夹具 | 造什么 | 断言什么 |
|---|---|---|
| `fixtures/fake-nm/lab-fixture-rowhog/` | `insert: plugin-manager`（与官方宿主行同名）+ 只写本地文件 | `COLLIDES_WITH_HOST=danger`、权限档「写入」、verdict 不装 |
| `fixtures/fake-nm/lab-fixture-shellcred/` | `child_process`/`spawn` + 读 `DSH_API_KEY` + `credentialRef` | 权限档「全量」、row 争用 ok、verdict 观察 |
| `fixtures/fake-host-rows.json` | 只含 `plugin-manager` / `web` / `system-prompt` 三个官方 id | 让夹具与真实宿主版本解耦（不读 asar、不联网） |
| `fixtures/analyze-expected.json` | 期望输出（不是运行时输入） | 结构字段 + 结论 + 负例退出码，不写死官方 row 条数 |

**为什么不写死「官方 row 多少条」**：它等于 `data/host-rows.json` 去重后的 id 数，宿主升级/刷新快照就会变。
工具会把实际值打在报告头，验收人对着它判断 M 是否为 0，比写死一个会过期的数字更可靠。

### 5.6 C.2 验收（离线目录 + 修好的三个问题）

**前置**：`data/catalog.json` 存在（本会话已落快照，见 §7；刷新/校验见 §3.2 ⑥）。
快照读不到时 `lab-analyze` 会现场解析源文件并告警；源也读不到 → `--search` / `--unknown` **exit 1**
（`无法判定 catalog 有无，不输出空结果`），不会返回空列表冒充「搜索完成」。

```bash
# ① 抽取器：count 落在 150–220，unparsed 报数
node tools/_catalog.mjs
#   期望：entries: 195 条 ｜ unparsed: 0 条 ｜ 分类标签 12 个 ｜ 宿主版本 0.2.2-rc.1
#   依据：lib/index.js 第 29–1003 行 = 195 个键 × 每项严格 4 行（键行/name/desc/category），
#        块内没有 \" 转义，所以「行式正则 + 引号解析」应当 0 条进 unparsed
node tools/_catalog.mjs --check
#   期望：check: OK —— 快照与源逐条一致（195 条）；不一致会打印前 20 处差异并 exit 1

# ② 离线搜索（问题 3）：没结果也必须说清，不造假候选
node tools/lab-analyze.mjs --search 嵌入式
#   期望：正文写「目录中无匹配（目录共 195 条）」，末行「匹配 0 条 / 目录共 195 条」
#   依据：目录里含「嵌入」的只有 1 处（dsh-library 的「本地嵌入零模型下载」），**不含「嵌入式」**；
#        已装 14 个包的 description 里也没有「嵌入式」→ 目录命中 0、已装命中 0
node tools/lab-analyze.mjs --search 定时器
#   正例（证明搜索本身不是坏的）：命中 @deepseek-ai/cordis-plugin-timer「定时器服务」，
#   末行「匹配 1 条 / 目录共 195 条」
#
#   ⚠️ C.3 起这条命令的输出契约变了（三源合并）：正文写「池中无匹配」+「最接近的 3 条」，
#      末行是「匹配 0 条 / 池 209（registry 0 ｜ catalog 195 ｜ 已装 14）」。本段保留 C.2 的历史期望，
#      现行口径见 §5.7 与 docs/RULES.md §12.2；`fixtures/analyze-expected.json` 的 c2 断言已同步更新。

# ③ 反向筛选（问题 2）：已装 14 个第三方包，末行只数 P1
node tools/lab-analyze.mjs --unknown --only-installed
#   期望（14 行表，按严重度排序）：
#     - 1 条 catalog 命中（`match=basename`，即 §5.5 ① 的主角包）→ 严重度「—」（目录已覆盖）
#     - P1 = 0：13 个目录外包的 description 都 ≥15 字且无营销词（判定见 RULES §11.3）
#     - P2（目录外·仅外文描述，7 个）：示例：本机实测 7 个包（名称隐去）
#       （原来逐个列出这 7 个包名；「这一组同时装在哪台机器上」属环境指纹，发布版只留条数与分档结论）
#     - P3（目录外·中文描述可用，6 个）：示例：本机实测 6 个包（名称隐去）
#       （同上：隐去 6 个包名；档位判定口径不变，仍按 RULES §11.3）
#       （下文出现的那一个包名只作单例示例，不是清单；清单本身已全部隐去）
#     - 末行：unknown: 0 个包本机说不清它是干什么的
#   ⚠️ 读法很重要：末行 0 只代表「没有既没描述又没目录的包」，**不代表没有账要补**。
#      你要的那张名单是目录外这 13 行——其中 7 个只有英文描述。
#      @michengai/dsh-skills-manager 在目录里没有（新包），一定会被列出来（P3：中英混排描述）。

# ④ P1 这档必须有样本，否则等于没测 → 夹具 profile（4 个假包，专门覆盖三档）
node tools/lab-analyze.mjs --unknown --only-installed --profile fixtures/catalog-profile
#   期望：P1 三条 = lab-fixture-vague（无 description）/ lab-fixture-marketing（含 a plugin/awesome/powerful）/
#        lab-fixture-short（3 字）；P3 一条 = lab-fixture-ok
#   末行：unknown: 3 个包本机说不清它是干什么的

# ⑤ 数据源优先级 + README 不再抓题头（问题 1）
node tools/lab-analyze.mjs @txc2768651338/dsh-plugin-manager
#   期望 §1：第一行「用途（source = **catalog**）」；中文名 = 官方插件管理服务
#            （basename 命中 @deepseek-ai/dsh-plugin-manager，报告里写明 match=basename 与命中的目录键）
#            README 正文前 3 句从「Settings → Plugins → Plugin Manager · 165 plugins cataloged…」起
#            **不再出现**：Every plugin finally speaks for itself / Overview · Compatibility · Install / Uninstall · … /
#                          【中文】· Español · 日本語… 这一整行
node tools/lab-analyze.mjs @michengai/dsh-skills-manager
#   期望 §1：source = package-json（不在目录里，但有 description）
#            README 第 1 句 =「统一管理本机与项目技能，从 GitHub 安装、预览更新并备份回退」
#            **不再出现**：「# DSH Skills Manager」标题行与「简体中文 · English · 日本語…」导航行

# ⑥ 目录不可用时不猜（exit 1，而不是空结果）
node tools/lab-analyze.mjs --search 定时器 --catalog fixtures/no-such-catalog.json --catalog-source fixtures/no-such-source.js
#   期望：stderr「离线目录不可用：…」；exit 1
```

**README 提取：修之前 / 修之后（本机真实 README，逐行推演）**

| 包 | C.1 抓到（错） | C.2 抓到（对） |
|---|---|---|
| `@txc2768651338/dsh-plugin-manager` | `Every plugin finally speaks for itself…` ／ `Overview · Compatibility · Install / Uninstall · …` ／ `[**中文**](…) · [**Español**](…) · [**日本語**](…) …` | `Settings → Plugins → Plugin Manager · 165 plugins cataloged, one click to toggle, notes edited in place.`（题头 `>`、14 行徽章带、两条 `·` 导航行全部被过滤） |
| `@michengai/dsh-skills-manager` | `# DSH Skills Manager`（标题）／ `[简体中文](…) · [English](…) · [日本語](…) …` | `统一管理本机与项目技能，从 GitHub 安装、预览更新并备份回退`（`<div>` 版式行、徽章、导航行被过滤） |

规则全文（①空行/`>` ②徽章图片 ③`·` 导航与纯链接行 ④标题/目录 ⑤HTML 标签 + 句长阈值）见
[`docs/RULES.md`](docs/RULES.md) §11.2。

### 5.7 C.3 验收（池子三源 + 目标入口）

**前置**：`data/registry.json` 由**用户自己**跑一次抓取生成（本工具永不联网，也**不猜端口**）：

```bash
# ⓪ 抓一次市场快照（唯一联网动作，且只连 loopback）
node tools/_registry.mjs --url http://127.0.0.1:<你当前端口>/dsh-market/registry --write
#   → 打印 count（预期 200–400）、malformed、未知字段；写入 data/registry.json
#   → 端口必须自己填：--url 的默认形态是 http://127.0.0.1:<port>/dsh-market/registry，工具不猜
#   → 响应会带完整 README，**实测超过 8 MiB**；上限已提到 64 MiB 并改为流式累加（C.3.1）
#     超过 8 MiB 时会多打一行：大响应: <bytes> 字节（> 8388608 字节 = 8 MiB 阈值；本次上限 67108864 字节）｜ 解析出 count <N> 条
#     快照里保留 source.bytes 与 source.maxBytes（本次用的上限）
#   → 真的更大时显式放开：--max-bytes 134217728 / --max-bytes 128MiB
node tools/_registry.mjs --check
#   → check: OK —— 快照结构完整（count 条 ｜ malformed N ｜ 未知字段 K 个）
```

**loopback 边界的负例（每条都必须 exit 1，且不产生任何文件）**：

```bash
node tools/_registry.mjs --url http://192.168.1.10:8080/dsh-market/registry
#   → error: 仅允许 loopback：收到主机「192.168.1.10」…；exit 1
node tools/_registry.mjs --url https://127.0.0.1:8080/dsh-market/registry
#   → error: 仅允许 loopback：协议必须是 http: …；exit 1
node tools/_registry.mjs --url http://127.0.0.1/dsh-market/registry
#   → error: 仅允许 loopback 且端口必须显式给出…；exit 1
```

**离线也能验收（不需要市场、不需要联网）**：`--from-file` / `--registry` 指到夹具。

```bash
# ① registry 层：导入夹具 → 统计 → 校验（7 条可用 + 1 条 malformed）
#   ⚠️ **C.3.2 起这一段已作废**：旧夹具是 schemaVersion 1 + 字符串 description 的旧形态，
#      现在它是**负例**（--check 必须红、--registry 会被判「不可用」）。验收基准换成
#      out/registry-raw.json，见 §5.7.2。下面保留 C.3 的历史期望，只为对照。
node tools/_registry.mjs --from-file fixtures/registry-sample.json --json
#   → C.3.2 之后：error: 快照 schemaVersion=1，本工具只认 2（…）→ 重新抓一次 --write；exit 1
#   → C.3 历史期望：count 7 ｜ malformedCount 1 ｜ unknownFields ["installCmd","publisher","stars"]
node tools/_registry.mjs --check --snapshot fixtures/registry-sample.json
#   → C.3.2 之后：check: 快照结构有 N 处问题（schemaVersion =1 应为 2、entries 不是数组、count 不一致 …）；exit 1（**负例，预期失败**）

# ② --search 三源合并（registry 命中，带 source/installed）
node tools/lab-analyze.mjs --registry fixtures/registry-sample.json \
  --search 直播 --profile fixtures/catalog-profile
#   → 命中 1 条：lab-fixture-live-guard ｜ 来源 registry ｜ 已装 否
#   → 末行：匹配 1 条 / 池 206（registry 7 ｜ catalog 195 ｜ 已装 4）
node tools/lab-analyze.mjs --search 直播
#   → 本机没有 registry 快照时：正文「池中无匹配」+ 最接近 3 条 + 明写 registry 缺位
#   → 末行：匹配 0 条 / 池 209（registry 0 ｜ catalog 195 ｜ 已装 14）
#     （若本机某个已装包的 description 里恰好出现「直播」，会多一条 source=installed 的命中 —— 也带来源）

# ③ 本轮核心：目标入口（夹具，可复算分数）
node tools/lab-analyze.mjs --registry fixtures/registry-sample.json \
  --goal "我想学嵌入式，从连板子到画 PCB" --profile fixtures/catalog-profile
#   → 报告头部先给口径声明（引用块）：
#     「本入口是『池内降噪』，不是语义搜索：它不具备世界知识，只能匹配字面；
#       召回候选请配合模型搜索/市场目录，把候选名交给本工具做取证与打分。」
#   → 分词 5 个（嵌入 / 入式 / 嵌入式 / 学嵌入式 / pcb）；丢弃的噪声词 5 个（学嵌 / 学嵌入 / 连板 / 板子 / 连板子）
#   → 候选表（8 列：包名 ｜ 名称 ｜ 来源 ｜ 命中词 ｜ 已装 ｜ 同轨已有 ｜ 权限 ｜ 下一步）
#     top1 lab-fixture-embed-blink（registry，嵌入+5、入式+5、嵌入式+5 ｜ Σ15）
#     top2 lab-fixture-pcb-draw（registry，pcb+7 —— pcb 只有 3 字母不算长词，靠「Σ7 ≥ 6」过门禁）
#   → 「未过门槛（有命中但不是匹配）」栏：@deepseek-ai/dsh-library Σ2，仅「嵌入」命中描述
#     （未命中长词 / 不同词 1<2 / 总分 2<6 → 三条全不满足）—— C.3.1 就是把它从候选降到这里
#   → 未装包权限一律：unknown（未安装，本地无代码）
#   → 下一步：装前请人工确认权限，本工具不联网
#   → 末行：goal: 2 候选 / 池 206（registry 7 ｜ catalog 195 ｜ 已装 4）
node tools/lab-analyze.mjs --registry fixtures/registry-sample.json \
  --goal "接抖音直播做预管理" --profile fixtures/catalog-profile
#   → 分词 10 个（接抖/接抖音 被噪声词过滤丢弃）
#   → 候选只有 1 条：lab-fixture-live-guard Σ30（抖音+4、音直+2、直播+7、预管+5、管理+1（通用）…）
#   → 另 5 条 catalog 模块只撞「管理」（通用词 ×0.5 后 Σ2/Σ1）→ 全部落进「未过门槛（不是匹配）」栏
#   → 末行：goal: 1 候选 / 池 206（registry 7 ｜ catalog 195 ｜ 已装 4）
node tools/lab-analyze.mjs --registry fixtures/registry-sample.json \
  --goal 夹具 --profile fixtures/catalog-profile
#   → 反例对照：lab-fixture-ok 同时出现在 registry 与已装池 → 已装 true、来源 registry（installed 亦有）、
#     权限给四档结论「无」、下一步「用 lab-drift/--explain 复核」
#   → 这就是「已装给结论 / 未装必须 unknown」两条口径的分界证据

# ④ 真实环境：没有 registry 快照时也不许编候选
node tools/lab-analyze.mjs --goal "我想学嵌入式，从连板子到画 PCB"
#   → 报告头 registry: **不可用** + 告警「先跑 _registry.mjs --url … --write」
#   → 末行：goal: N 候选 / 池 209（registry 0 ｜ catalog 195 ｜ 已装 14）
#   → N 取决于本机 14 个已装包的 description；唯一确定的是「池子总数照给」
#   → @deepseek-ai/dsh-library（只撞「嵌入」）必须**不在**候选表里，而在「未过门槛 / 最接近」（C.3.1 门槛）
node tools/lab-analyze.mjs --goal "接抖音直播做预管理"
#   → C.3.1 之前：8 条候选、命中词全是「管理」← 这是缺陷，不是特性
#   → 现在：候选 0–2 条；「管理-only」条目全部落进「未过门槛（不是匹配）」栏，并写明
#     「只命中通用词（已 ×0.5 降权：管理）→ 单独命中不足以成候选」
#   → 若 0 候选：正文「池中无匹配」+「未命中目标核心词（长词：…）」+ 最接近 3 条（列得分/命中词/原因）
#   → 无论有没有候选，末尾都给池子总数，不伪造候选
node tools/lab-analyze.mjs --goal zzzqqq
#   → 确定性无匹配用例：候选 0、最近 3 条为空（连 2 字片段都没有）→ 正文「池中无匹配」+「不硬凑候选」
#   → 末行：goal: 0 候选 / 池 209（registry 0 ｜ catalog 195 ｜ 已装 14）

# ⑤ --unknown 加 registry（夹具）：registry 有描述就不算 unknown，且两段描述并列
node tools/lab-analyze.mjs --registry fixtures/registry-sample.json \
  --unknown --profile fixtures/catalog-profile
#   → lab-fixture-ok：严重度「—」（registry 已覆盖）+ **descMismatch**（本地描述与 registry 描述字面不同）
#   → 另 3 条（vague 无描述 / marketing 营销词 / short 3 字）仍 P1 —— registry 里没有它们
#   → 末行：unknown: 3 个包本机说不清它是干什么的
```

> 为什么 `lab-fixture-null-desc`（只有名字、无描述）留在夹具里：它用来钉死一条容易走偏的口径——
> **「registry 有条目」不等于「registry 说得清它是什么」**。判定只看「有没有描述」。

> ⚠️ **C.3.2 起 ②–⑤ 的夹具用例全部失效（这是预期的负例，不是回归）**：`fixtures/registry-sample.json`
> 是 `schemaVersion: 1` 的旧快照，`--registry` 指过去会被判「不可用」（降级为 catalog + 已装），
> `--from-file` / `--check` 直接 exit 1。**现行验收入口见 §5.7.2（`out/registry-raw.json`）**；
> 夹具那 7 条手造数据只作为「v1 必须被拒」的负例保留。`fixtures/goal-expected.json` 里对应的
> 夹具期望也已标注为「C.3.1 历史口径」。

机器可断言的期望写在 [`fixtures/goal-expected.json`](fixtures/goal-expected.json)
（registry 5 正例 + 10 负例；goal 6 正例 + 4 真实环境用例 + 5 负例；C.3.1 增补了 `--max-bytes` 与门禁/噪声词的断言；
**C.3.2 把 registry 夹具用例整体标为 v1 负例，新增真实数据的验收基准见 §5.7.2**）。
规则全文（loopback 白名单、快照 schema v2、四源优先级、goal 分词与打分、相关性门禁、未装包权限口径、性能预算）见
[`docs/RULES.md`](docs/RULES.md) §12。C.3.1 的三条门禁 / 通用词表 / 噪声词规则见 §12.3.6，C.3.2 的性能规则见 §12.3.7，
**C.3.3 的分层 / 词表诊断 / idf 见 §12.3.8**（门禁已在该节标注取消）。

| 夹具 | 造什么 | 断言什么 |
|---|---|---|
| `fixtures/registry-sample.json` | 7 条假 registry 条目（含中文描述）+ 1 条 malformed；其中 1 条带 3 个未知字段、1 条只有名字、1 条与夹具已装包同名 | **C.3.2 起 = 负例**：`schemaVersion 1` 必须被 `--check` / `--from-file` 拒绝（exit 1），`--registry` 判「不可用」；旧快照不得冒充市场 |
| `fixtures/goal-expected.json` | 期望输出（不是运行时输入） | 词表（含被丢弃的噪声词）、分数、top 顺序、门禁结论、末行池子构成、负例退出码；C.3.2 起 registry 夹具用例标为 v1 负例；**C.3.3 起现行基准是 `c33` 段**（分层阈值 / 词表诊断字段 / idf 公式与复算 / `--search` 不变） |

**为什么分数写得这么细**：打分是**可复算**的（C.3.2：名称×3 / 中文描述×3 / 英文描述×2 / 能力×3 / keywords×2 / 分类×1，
通用词再 ×0.5 向下取整），所以验收不看「像不像推荐」，而是看「按公式算出来是不是这个数」。
`Σ15 / Σ7 / Σ30` 是 C.3.1 夹具口径的旧数（夹具已降级为负例）；真实数据的分数见 §5.7.2。

> **本机数字的口径**：上面真实环境末行里的「已装 14 / 池 209」是**本机当前**的数
> （= catalog 195 + 已装 14；registry 未落快照时为 0）。装/卸一个包就会变，所以夹具与脚本里的断言
> 一律用「池 206 / 已装 4」这种**夹具内恒定**的数，真实环境只断言「末行必须给池子总数」。

#### 5.7.1 C.3.1 补遗（用户实测暴露的两个问题：响应 >8 MiB 被中止 / `--goal` 没有相关性下限）

**A. 快照抓取：上限 8 MiB → 64 MiB + 流式累加 + `--max-bytes`**

```bash
node tools/_registry.mjs --url http://127.0.0.1:<当前端口>/dsh-market/registry --write
#   ✅ 应成功写盘；输出里能读到 bytes 与 count（count 预期 200–400）
#   ✅ 若 bytes > 8388608，会多一行：
#      大响应: <bytes> 字节（> 8388608 字节 = 8 MiB 阈值；本次上限 67108864 字节）｜ 解析出 count <N> 条 ｜ 快照已保留 source.bytes
#   ✅ data/registry.json 的 source 里有 bytes 与 maxBytes（本次上限）
#   ✅ 仍保留硬约束：超限立即中止、不写半截快照（不会「截断后继续解析」）
node tools/_registry.mjs --url http://127.0.0.1:<当前端口>/dsh-market/registry --max-bytes 128MiB --write
#   ✅ 显式放大到 128 MiB（也可写 134217728）；非法值直接 exit 1：参数 --max-bytes 取值不合法：「abc」
```

**B. 目标入口：相关性门禁 + 通用词降权 + 噪声词丢弃（规则全文 RULES §12.3.6）**

```bash
node tools/lab-analyze.mjs --search 直播
#   → 有则列（带 source / installed）；无则「池中无匹配」+ 最接近 3 条 + 池子总数（末行照给）

node tools/lab-analyze.mjs --goal "接抖音直播做预管理"
#   → ❌ 不再出现「只因命中『管理』」的 8 条噪声
#   → ✅ 必要时返回 0–2 条，并注明「未命中目标核心词」；「管理-only」条目一律进
#        「未过门槛（有命中但**不是匹配**）」栏，写明「只命中通用词（已 ×0.5 降权：管理）→ 单独命中不足以成候选」

node tools/lab-analyze.mjs --goal "我想学嵌入式，从连板子到画 PCB"
#   → ✅ dsh-library 那类字面巧合被门槛拦下（Σ2：未命中长词 / 词数 1<2 / Σ2<6）→ 只出现在「未过门槛 / 最接近」栏
#   → ✅ 每条候选都标清命中词（含通用词标「（通用）」），并给 Σ分
#   → 注意（池内降噪的代价）：真实环境没有 registry 快照时，「嵌入式 / 入式」在 catalog 的 name+desc+keywords 里 0 次
#     → 按规则 D 被丢（列在「丢弃的噪声词」），只留「嵌入 / 学嵌入式 / pcb」；有 registry 夹具时它们会被保留
```

**三条门槛（缺一即不入候选表）**：① 命中 ≥1 个**长词**（中文 ≥3 字 / 英文单词 ≥5）；
② 命中 ≥2 个**不同**词；③ 总分 **≥6**。三条全不满足 → 只在「最接近」/「未过门槛」里出现。

**通用词（15 个）**：`管理 / 设置 / 任务 / 服务 / 系统 / 配置 / 面板 / 工具 / 助手 / 插件 / 功能 / 支持 / 自定 / 接口 / 数据`
→ 命中权重 `⌊×0.5⌋`，且**单独命中不足以成候选**（除非同时命中长词）。

**噪声词丢弃**：滑窗词在整个池子的 `name+description+keywords` 里出现 **0 次**且长度 **<4** → 丢弃
（例：`接抖`、`接抖音`），原词仍列在报告「丢弃的噪声词」里；≥4 字的词即使池里没有也保留。

**口径声明（报告头部 + RULES §12.3 首行 + `--help` 三处同文）**：

> **本入口是「池内降噪」，不是语义搜索**：它不具备世界知识，只能匹配字面；召回候选请配合模型搜索/市场目录，
> 把候选名交给本工具做取证与打分。

**夹具口径同步修正（旧期望与新门槛冲突处，均在 `fixtures/goal-expected.json` 改掉）**：

| 用例 | C.3 旧期望 | C.3.1 新期望 |
|---|---|---|
| `--goal "我想学嵌入式…"`（夹具） | 3 候选，`dsh-library` 当 top3（Σ2） | **2 候选**，`dsh-library` 落「未过门槛」；`tokens` 10 → 5（5 个噪声词被丢） |
| `--goal "接抖音直播做预管理"`（夹具） | 6 候选（5 条只撞「管理」），top1 Σ32 | **1 候选**（live-guard Σ30），另 5 条进「未过门槛」 |
| `--goal "接抖音直播做预管理"`（真实环境） | `matchedTotal >= 5`，全是「管理」 | **0–2 条**，`管理-only` 全部不进候选 |

#### 5.7.2 C.3.2 按真实响应重写（验收基准 = `out/registry-raw.json`，不是夹具）

**真实数据（已 dump，严禁再猜）**：`out/registry-raw.json` = **13,837,168 字节**（HTTP 200）。
本文件实读确认的真实形状与字段：

```jsonc
{ "registry": { "name": "awesome-dsh-plugin", "url": "https://awesome-dsh-plugin.com",
                "source": "https://github.com/awesome-dsh-plugin/awesome-dsh-plugin",
                "updated": "2026-11-13", "count": 10974,
                "categories": { "agi": {"en":"AGI Architecture Exploration","zh":"AGI 架构探索"}, /* … 23 个 */ },
                "plugins": [ /* … 10,974 条 … */ ] },
  "hostVersion": "…" }
```

- **真实数组键名 = `plugins`**（在 `registry` 容器对象里，**不在顶层**）。代码仍**运行时探测**
  （`plugins → entries → items → list → packages → results` → 容器里任意第一个数组值），命中的键写进
  `source.arrayKey`，容器键写进 `source.containerKey`（本次是 `registry`），`shape` 记作 `registry>plugins`。
- 单条真实字段：`name, owner, url, page, category[]（数组）, description{en,zh}（**对象**）, npm, version,
  stars, starsCheckedAt, downloads, downloadsStart, downloadsEnd, downloadsCheckedAt, capabilities,
  capabilityRedLines, capabilityCheckedAt, install, added, icon, screenshots`。
- **10974 条全量保留**（不截断、不抽样）；规范外的 6 个字段（`starsCheckedAt` 等）原样进 `extra` +
  `unknownFields`（不丢、也不参与打分）。
- 快照 schema 升到 **v2**：`{schemaVersion:2, source:{url,fetchedAt,httpStatus,bytes,hostVersion,…},
  count, entries:[…], malformed, unknownFields}`。

**验收命令与期望（4 条，均为实跑口径；本会话未执行，见 §6）**：

```bash
# ① 导入真实 dump → 写快照 → 自证「多大 / 几条 / 数组键 / hostVersion」
node tools/_registry.mjs --from-file out/registry-raw.json --write
#   → registry 源: 本地文件 …\out\registry-raw.json（13837168 字节）
#   → 响应: HTTP null（--from-file 导入，抓取时的状态码不可知）｜ 形状 registry>plugins ｜
#            数组键 plugins ｜ hostVersion <响应里的值>
#   → market 自报: source.registry.count=10974 ｜ 本工具实读 entries 10974 条 → 一致
#   → 归一化: count 10974 条 ｜ malformed 0 条 ｜ 未知字段 5–6 个（…已原样保留在条目 extra 里）
#   → 大响应: 13837168 字节（> 8388608 字节 = 8 MiB 阈值；本次上限 67108864 字节）｜ 解析出 count 10974 条
#   → 已写快照: data/registry.json（schemaVersion 2）
#   → 末行: registry: 10974 条 ｜ malformed 0 ｜ 未知字段 N ｜ source=file

# ② 结构校验（v2：count 与 entries.length 一致 + 抽样前 20 条必须有 name）
node tools/_registry.mjs --check
#   → check: OK —— 快照结构完整（10974 条 ｜ malformed 0 ｜ 未知字段 N 个）

# ③ 真实市场里搜中文（10974 条里大概率有命中）
node tools/lab-analyze.mjs --search 直播
#   → 表头: 包名 ｜ 名称 ｜ 来源 ｜ stars ｜ downloads ｜ redLines(有/无) ｜ 得分 ｜ 描述 ｜ 已装
#   → 每条都带真实 stars/downloads 与 redLines 标记；命中的是 descriptionZh / capabilities 里的「直播」
#   → 报告头有 elapsedMs（目标 < 2000 ms）与 registry 的 count / shape / arrayKey / hostVersion
#   → 末行: 匹配 N 条 / 池 M（registry 10974 ｜ catalog 195 ｜ 已装 C）

# ④ 目标入口（嵌入式 → PCB）
node tools/lab-analyze.mjs --goal "我想学嵌入式，从连板子到画 PCB"
#   → top 10 候选，命中词列形如: 嵌入+3（中文描述）、pcb+2（名称）｜ Σ…（**带权重与命中字段**）
#   → 未装包权限一律 unknown（未安装，本地无代码）
#   → 报告头 elapsedMs;末行 goal: N 候选 / 池 M（registry 10974 ｜ catalog 195 ｜ 已装 C）

# ⑤ 反噪声回归（C.3.1 门槛必须仍在）
#   ⚠️ C.3.3 起门槛**已取消**，但「管理-only 不进候选」这条结论不变（改由「通用词否决 + 分层」实现）：
#      §5.7.3 的 ② 是它的现行版本；本条只保留 C.3.2 的历史期望。
node tools/lab-analyze.mjs --goal "接抖音直播做预管理"
#   → **不允许**出现「只命中『管理』」的候选；管理-only 条目全部落进
#     「未过门槛（有命中但**不是匹配**）」栏，写明「只命中通用词（已 ×0.5 降权：管理）→ 单独不足以成候选」
#   → 若池里确有「抖音/直播」条目，候选的命中词必须含「抖音」或「直播」（长词）而不是「管理」
```

**打分权重表（可手工复算，RULES §12.3.2）**：

| 字段 | 基数 | 系数 | 生效 |
|---|---|---|---|
| 名称（显示名 ∪ 包名） | 3 | ×1 | **3** |
| `descriptionZh` | 2 | **×1.5 向上取整** | **3** |
| `descriptionEn` | 2 | ×1 | **2** |
| `capabilities` | 2 | **×1.5 向上取整** | **3** |
| `keywords` | 2 | ×1 | **2** |
| `category` | 1 | ×1 | **1** |

通用词（15 个）命中再 `⌊×0.5⌋`；三条门槛（长词 / ≥2 词 / Σ≥6）与噪声词丢弃**一字未改**。
> ⚠️ **C.3.3 起**：上表权重仍有效，但**每个命中词还要再乘 idf**，且三条门槛已取消（改为分层）。
> 现行口径与复算示例见 §5.7.3 与 RULES §12.3.8；本段保留 C.3.2 的历史表述。

**性能（RULES §12.3.7）**：启动时一次建**小写索引**（每条一个 `hay` 串 + `tokens` 集 + 六个字段的小写串 +
`noiseHay`），之后 `--search` / `--goal` **单遍扫描**、词按长度降序、未命中即剪枝；报告里必打
`elapsedMs`（另给 `indexBuildMs` / `scanMs` / `prunedByPrecheck`）。**目标 < 2000 ms；> 4000 ms 必须继续优化**，
且**不许**靠抽样/截断 entries 达标。

**负例（旧夹具降级为负例）**：`fixtures/registry-sample.json` 是 `schemaVersion: 1`、`description` 为字符串的
旧形态。C.3.2 起它是**负例**——用它验收会（也应当）失败：

```bash
node tools/_registry.mjs --check --snapshot fixtures/registry-sample.json
#   → check: 快照结构有 N 处问题（至少含：schemaVersion =1，应为 2（v1 会把对象形态的 description 静默丢字段）；
#     entries 不是数组（v1 用的是 plugins）；count 与 entries.length 不一致）→ exit 1
node tools/lab-analyze.mjs --registry fixtures/registry-sample.json --search 直播
#   → registry: **不可用**（schemaVersion=1，本工具只认 2）→ 降级为 catalog + 已装；不拿旧数据冒充市场
```

### 5.7.3 C.3.3 `--goal` 分层 + 词表诊断 + idf（本项目最后一轮）

**起因（用户实测，不是猜的）**：`--search` 已能在 **10,974 条**真实池子里捞出内容，但 `--goal` 结果过小。
根因**不是门槛太严，是词表对不齐**：`"我想学嵌入式，从连板子到画 PCB"` 切出的有效词只有
`嵌入/入式/嵌入式/连板/板子/pcb`，其中只有 `嵌入式`（3 字）算长词；而市场里同类条目写的是
`PCB / EDA / 单片机 / STM32 / 固件`，**一个都不重** → 只剩 1–2 条甚至 0 条。
**本轮不造同义词词典**（那是无底洞：词表会腐烂），改三件事。

#### A. 门槛改分层（不砍候选，三层全部展示）

| 层 | 判定（覆盖率 = **命中有效词数 / 有效词总数**） | 展示 |
|---|---|---|
| **强匹配** | 覆盖率 **≥ 0.5** | 全部（md 表内最多 20 行，差额明写） |
| **弱匹配** | **0.2 ≤ 覆盖率 < 0.5** | 全部（md 表内最多 20 行，差额明写） |
| **仅字面命中** | 覆盖率 **< 0.2**，**或**只命中通用词 | 折叠段 `<details>`，**最多 10 条** |

- **取消**：C.3.1 的「①命中长词 ②≥2 个不同词 ③Σ≥6」三条硬门槛（它是召回过窄的**直接原因**）。
  旧口径不再参与判定，只在 `--json` 的 `rule.legacyGate` 里留作历史对照。
- **保留**：`只命中通用词 = 不算匹配` 的否决（否则「管理」会回来）。这类条目**强制**归入「仅字面命中」，
  命中词列标 `（通用）`、归层理由写「只命中通用词（C.3.1 否决仍然生效）」。
- 覆盖率分母 = **噪声过滤后的有效词数**（报告头「分词（N 个）」那个 N）；`--json` 每行都带
  `coverage` 与 `coverageBasis`（形如 `3/9`），可手工复算。
- 条数不砍：`tiers.counts` 是**全量算出来**的条数；md/json 只物化每层前若干行，
  差额写在 `tiers.notListed` 与表尾「本层共 N 条，表内列前 M 条」里（**不静默截断**）。
- 「候选 top 10」仍是 **强 + 弱** 的前 10（`candidates`），「仅字面命中」永不进候选表。

> **强匹配为 0 时，先读报告里的 `## 词表诊断`**：它给出每个词在池中的命中条目数，0 命中词已标「未命中」。

#### B. 未命中核心词诊断（本轮重点）

报告新增一段 **`## 词表诊断`**：

- 逐个列出本次有效词 + **它在池中的命中条目数**（用同一次索引遍历算完，**不逐词全扫**）；
- 命中数 0 的词标 `未命中`，并在末尾给一句：
  `这些词在本地的 <池总数> 条目录里没有出现；试换同义词再搜（如 嵌入式 → PCB / 单片机 / EDA / 固件）`；
- **同义词提示只给 4 组硬编码示例**（`SYNONYM_HINTS`：嵌入式类 / 直播推流类 / 翻译类 / 定时调度类），
  **不建表、不参与打分、不参与匹配** —— 它只回答「为什么 0 命中」，不改变任何候选。
  与本次未命中词沾边的那一组会在行尾标 `← 与本次未命中词相关`。

`--json` 对应字段：`diagnostics.{tokens[], missing[], missingNote, poolTotal, synonymHints[], hintRelated[]}`。

#### C. 稀有词加权（idf）

```
idf(词) = clamp( ln( 池总数 / (1 + 该词命中条目数) ), 0.5, 3.0 )     ← 保留两位小数
weight  = round2( Σ命中字段权重 × idf )                             ← 字段权重：name×3 ｜ zh×3 ｜ en×2 ｜ capabilities×3 ｜ keywords×2 ｜ category×1
weight' = round2( weight × 0.5 )                                   ← 仅通用词（C.3.1 的 ×0.5 仍然生效）
Σ       = round2( Σ weight' )
```

- 「池总数」= 报告里的 `diagnostics.poolTotal`（= registry + catalog + 已装，三源条数之和）；
- 「命中条目数」= `diagnostics.tokens[].hits`（**条目数**，不是出现次数）；
- 报告里每个命中词都写成 `嵌入+7.86（idf 2.62）（名称/关键词）`，**可复算**；
- idf **预计算一次**（单遍遍历索引统计词频），不逐条重扫。

**复算示例（池总数 10974）**：

| 命中条目数 | 算式 | idf |
|---|---|---|
| 12（稀有，如「推流」） | `ln(10974/13) = 6.7385` → 夹取上界 | **3.00** |
| 800（较普遍） | `ln(10974/801) = 2.6174` | **2.62** |
| 2000 | `ln(10974/2001) = 1.7019` | **1.70** |
| 6655（下界边界） | `ln(10974/6656) = 0.5001` → 夹取下界 | **0.50** |
| 0（未命中词） | `ln(10974/1) = 9.3033` → 夹取上界 | 3.00（仅表格完整，不参与 Σ） |

> ⚠️ **口径冲突（照实写，不偷偷改公式）**：任务卡给的例子是「出现 800 次的『管理』→ 权重降到 ~0.5」，
> 但按同一条公式，800 条算出来是 **2.62**；夹取下界 0.5 只在命中 ≈**6655 条**以上才触底。
> 代码按**公式**实现（可复算优先，且「稀有词更重」这个方向是对的：12 条 → 3.00 已符合例子）；
> 「管理变轻」这件事由**两条**共同保证：①idf（2.62 < 3.00）②通用词 ×0.5 + 通用词否决。
> 差异见回传里的 Q-001（若要严格做到 800 → 0.5，需要改成归一化写法，会改动 RULES §12.3.8 的口径）。

#### 验收命令（真数据：`data/registry.json` = 10,974 条）

```bash
# ① 用户实测的主用例：三段都要可能出现；词表诊断把「嵌入式的词市场里不叫这个」点出来
node tools/lab-analyze.mjs --goal "我想学嵌入式，从连板子到画 PCB"
#   → 报告头：分层阈值 + idf 公式 + 已取消的门槛（rule.legacyGate）+ elapsedMs（目标 <2000ms）
#   → ## 强匹配（覆盖率 ≥ 0.5）— N 条   ← 可能为 0
#   → ## 弱匹配（0.2 ≤ 覆盖率 < 0.5）— N 条
#   → ## 仅字面命中（覆盖率 < 0.2 或只命中通用词；不是匹配）— 折叠，最多 10 条
#   → ## 候选（top 10）：每行带 层 / 覆盖率（形如 3/9）/ 命中词（词+权重（idf x.xx）（字段））/ 权限
#   → ## 词表诊断：| 有效词 | 池中命中条目数 | idf | 状态 |
#         `嵌入式` 若在 10,974 条里 0 命中 → 状态列必须是 **未命中**（池中 0 条）
#         末尾：这些词在本地的 <池总数> 条目录里没有出现；试换同义词再搜（如 嵌入式 → PCB / 单片机 / EDA / 固件）
#   → 末行：goal: N 候选 / 池 M（registry 10974 ｜ catalog 195 ｜ 已装 C）｜ 分层：强 a ｜ 弱 b ｜ 仅字面 c

# ② 反噪声回归：「管理」不得进强/弱匹配
node tools/lab-analyze.mjs --goal "接抖音直播做预管理"
#   → 只命中「管理」的条目：genericOnly=true → 一律进「## 仅字面命中」；
#     命中词形如「管理+权重（idf x.xx）（通用）（名称）」（例：名称命中 + idf 2.62 → 3×2.62×0.5 = 3.93）
#   → 强匹配 / 弱匹配里不得出现 genericOnly=true 的行
#   → 若候选非空，命中词必须含「抖音」或「直播」这类非通用词

# ③ --search 行为不变（硬约束）
node tools/lab-analyze.mjs --search 直播
#   → 表头/字段/排序/末行与 §5.7.2 完全一致；`--json` 的 matched 行里**没有 `idf` 键**（不是 null，是不出现）
#   → 不产出 diagnostics 段
```

**性能影响（本会话未实测，不编数字）**：idf 那一遍是**一次**额外的索引遍历
（`O(条目 × 词数)` 的 `hay.includes` —— 用 `hay` 一次扫描替代六次字段扫描），
之后仍是「单遍扫描 + 长词优先预判剪枝」。报告头额外多一个 `tokenStatsMs` 分项。
10974 条 × 2 遍扫描仍在 2000 ms 预算内（**需实跑确认**，见 §6）。

**夹具**：[`fixtures/goal-expected.json`](fixtures/goal-expected.json) 新增 `c33` 段
（分层阈值、idf 公式与夹取、复算示例、3 条正例 + 4 条负例 + `verify` 三步复算法）；
`c32` 段保留并标 `supersededBy`，`goalCases` 段加注「C.3.1 门禁已取消，现行基准看 c33」。
规则全文见 [`docs/RULES.md`](docs/RULES.md) §12.3.8。

## 6. 本次未执行项（如实记录，不编造输出）
| 项 | 状态 | 原因 |
|---|---|---|
| `node tools/lab-drift.mjs …` 夹具与真实环境实跑（含 A.1 的两条验收命令） | **未执行** | 本会话 `pwsh` 整体不可用：第一次调用即 `Error: SetNamedSecurityInfoW failed (Win32 5): grantWrite(<WORKSPACE>)`，无终端可用；文件工具只能读写，不能执行 node |
| 退出码 0 / 2 / 1 实测 | **未执行** | 同上 |
| `--write-report` 拒绝写入的实测 | **未执行** | 同上 |
| `--show-all-orphans` / `--explain` 实跑 | **未执行** | 同上 |
| 真实环境 `ORPHAN_IN_NM` 从 320 降到 ≤10 的实测 | **未执行** | 同上（只有上一轮 320 的实跑记录，A.1 之后的新数字必须实跑才能写） |
| **B**：`lab-triage.mjs` 全部 7 个子命令实跑（list / add / promote / due / note / sync / check） | **未执行** | 同上：`pwsh` 不可用，无法执行 node；B 阶段代码只能逐行自核 |
| **B**：`fixtures/lifecycle-b.json` 全生命周期验收（§5.3 步骤 0–9） | **未执行** | 同上 |
| **B**：§5.4 的 9 条负例（非法迁移 / 终结态 / 版本读不到 / 重量 / 前缀 / 不变式 / 路径守卫 / 参数白名单） | **未执行** | 同上 |
| **B**：`out/rejected-2026-12-01.md`、`out/sync-suggestions.md` 的实际产物内容 | **未执行** | 同上（只有渲染函数的手工推演） |
| **A 阶段回归**（`_profile.mjs` 抽取之后重跑 §5.1/§5.2） | **未执行** | 同上；抽取是逐行搬运，但**必须在恢复终端后重跑**，不能只靠自核 |
| **C.1**：`lab-analyze.mjs` 单包分析（`@txc2768651338/dsh-plugin-manager`、`@michengai/dsh-skills-manager`） | **未执行** | 同上：`pwsh` 不可用（`SetNamedSecurityInfoW failed (Win32 5)`），无法执行 node；代码只能逐行自核 |
| **C.1**：`--scan-all` 矩阵实跑（含「至少一组 row 争用」的断言） | **未执行** | 同上 |
| **C.1**：`--from-dir` 两个夹具包的实跑 | **未执行** | 同上 |
| **C.1**：`--write-report` 守卫（profile / lab / `cordis.patch.yml` 三处拒绝） | **未执行** | 同上 |
| **C.1**：`COLLIDES_WITH_PLUGIN`（两第三方抢同一 id）分支 | **未执行且无样本** | 本机 18 条第三方 insert 里没有两条同名；该分支只有代码自核，已写进 `fixtures/analyze-expected.json` 的 `untestedBranches` |
| **C.1**：`data/host-rows.json` 快照的**逐包复核** | **未执行（只做了机械抽取）** | 快照由工作区里已有的 `tmp/analysis.json`（Electron-as-node 读 `app.asar` 生成）机械抽取，未再与 asar 原文逐条比对 |
| **C.2**：`_catalog.mjs` 实跑（统计 / `--write` / `--check`） | **未执行** | 同一个 `pwsh` 故障（`SetNamedSecurityInfoW failed (Win32 5)`）。`data/catalog.json` 是**用文件工具逐条转写**源文件 195 条生成的（不是脚本产物），已用 grep 核对「键行 195 条 / 12 个分类 / 结构闭合」，但 `--check` 没跑过——**恢复终端后第一件事就是跑 `--check`** |
| **C.2**：`--search` / `--unknown` 实跑（含 ①–⑥ 全部命令与退出码） | **未执行** | 同上：无法执行 node；§5.6 的期望值全部来自「源码 + 真实 profile/README 逐行推演」 |
| **C.2**：README 提取修正后的实际句子 | **未执行（逐行推演）** | 两份真实 README 已通读并逐行套 §11.2 规则（对照表见 §5.6）；规则本身没有经过程序验证 |
| **C.2**：`basename` 命中的实际输出 | **未执行（逐行推演）** | `@txc2768651338/dsh-plugin-manager` → 唯一候选 `@deepseek-ai/dsh-plugin-manager`（目录里没有第二个 `dsh-plugin-manager`） |
| **C.3**：`_registry.mjs --url http://127.0.0.1:<port>/dsh-market/registry --write`（真实抓取） | **未执行（本会话无法做）** | 同一个 `pwsh` 故障（`SetNamedSecurityInfoW failed (Win32 5)`），既跑不了 node 也连不上本机市场；**`data/registry.json` 没有生成，也没有伪造一份**——它必须由用户跑一次上面这条命令产生。缺它时工具照实写「registry 不可用」 |
| **C.3**：`_registry.mjs` 的全部实跑（`--from-file` / `--write` / `--check` / 三种形状 / loopback 负例） | **未执行** | 同上：无法执行 node；§5.7 的期望来自「源码 + 夹具逐条推演」 |
| **C.3**：`--goal` 实跑（夹具 3 例 + 真实环境 3 例 + 4 条负例） | **未执行（逐行推演）** | 分词与打分按 RULES §12.3 的公式**手工复算**：`Σ15 / Σ7 / Σ2 / Σ32` 都已逐词对齐并写进 `fixtures/goal-expected.json` 的 `why`（**C.3.1 起 Σ2/Σ32 已作废**：dsh-library 被门禁拦下、管理降权后 live-guard 变 Σ30 → 见下一行） |
| **C.3.1**：`_registry.mjs --url … --max-bytes 128MiB --write`（真实大响应抓取） | **未执行** | 同一个 `pwsh` 故障（`SetNamedSecurityInfoW failed (Win32 5)`）：本会话**无法执行 node**，也不能替用户连本机市场。§5.7.1 的期望（64 MiB 上限、流式累加、大响应打印 bytes+count、`source.maxBytes`）来自源码逐行自核 |
| **C.3.1**：`--goal` 门禁 / 通用词 / 噪声词实跑（夹具 2 例 + 真实环境 2 例 + 2 条负例） | **未执行（逐行推演）** | 分数与词表按 RULES §12.3.2 + §12.3.6 **手工复算**：`Σ15 / Σ7 / Σ30`、`tokens 5/10`、`tokensDropped 5/2`、`belowThreshold` 的 3 条排序都已写进 `fixtures/goal-expected.json` 的 `why`。**恢复终端后必须重跑**——尤其是 `belowThreshold` 的排序与真实环境候选条数，只有实跑能确认 |
| **C.3.1**：`_registry.mjs` 超限路径（`--max-bytes 1`）实跑 | **未执行** | 同上；这条需要本机市场在跑（否则先报「请求 loopback 失败」，验的不是超限路径） |
| **C.3**：`--search` 三源合并 / `--unknown` 加 registry 的实跑 | **未执行（逐行推演）** | 推演依据：`data/catalog.json` 里含「嵌入」的仅 `dsh-library` 1 条、含「管理」的 5 条、不含「直播/抖音/pcb/板子」 |
| **C.3.2**：`_registry.mjs --from-file out/registry-raw.json --write` 实跑（真实 13,837,168 字节 / 10,974 条） | **未执行** | 同上 `pwsh` 故障（`SetNamedSecurityInfoW failed (Win32 5)`）：本会话**无法执行 node**。§5.7.2 的期望来自「实读 raw 文件的顶层形状 + 源码逐行自核」，**不是实跑输出** |
| **C.3.2**：`--check`（v2：count/entries 一致 + 抽样 20 条 name）实跑 | **未执行** | 同上；负例（旧夹具 v1 → exit 1）同样只能自核 |
| **C.3.2**：`--search 直播` / `--goal "我想学嵌入式…"` 在 10974 条池子上的**真实命中与 elapsedMs 实测** | **未执行（无法测）** | 硬要求是 < 2000 ms，但本会话没有任何可执行终端 → **不编毫秒数**。测算依据写在 §5.7.2「性能」：索引 10974 条 × 6 个小写串 + 单遍扫描 + 长词优先剪枝；恢复终端后**第一件事**是跑这四条命令把 elapsedMs 贴回主控（若 > 4000 ms 必须按 RULES §12.3.7 继续优化） |
| **C.3.2**：`data/registry.json` 的实际落盘体积 / `unknownFields` 的真实个数 | **未执行** | 只能给出结构推算（真实字段 + 6 个规范外字段进 extra），实际值必须以实跑为准 |
| **C.3.3**：三条验收命令在 10,974 条池子上的实跑（`--goal "我想学嵌入式，从连板子到画 PCB"` / `--goal "接抖音直播做预管理"` / `--search 直播`） | **未执行** | 同一个 `pwsh` 故障（`SetNamedSecurityInfoW failed (Win32 5): grantWrite(<WORKSPACE>)`）：本会话**无法执行 node**，文件工具只能读写。§5.7.3 的期望来自「源码逐行自核 + 公式手工复算」，**不是实跑输出** |
| **C.3.3**：分层条数（强/弱/仅字面各多少条）、`tiers.counts` 与 `notListed` 的真实值 | **未执行** | 同上。**不编条数**：真实值取决于 10,974 条池子里到底有多少条命中这些词，只有实跑能给 |
| **C.3.3**：idf 的真实取值（`嵌入式`/`pcb`/`管理` 等词在池里的 `hits`）与 `tokenStatsMs` / `elapsedMs` | **未执行** | 同上。公式与夹取已在 §5.7.3 复算示例里逐条给出（12→3.00、800→2.62、6655→0.50、0→3.00），但**池内真实 hits 必须实跑**；`elapsedMs < 2000ms` 这条目标同样未测 |
| **C.3.3**：`fixtures/goal-expected.json` 的 `c33` 段（3 正例 + 4 负例） | **未执行（逐行推演）** | 同上：无法执行 node。`c33.verify` 的三步复算法是给验收人恢复终端后用的（从报告反算 idf / weight / coverage） |

替代的确定性手段（已做）：1. 逐行自核（人工通读全文件，含括号/模板字符串/正则/循环闭包/函数提升顺序）；
2. 真实数据源全部**实读**过：profile `package.json`（13 依赖 / 19 bundles）、lab `installed.md`（11 行表格）、lab `INDEX.md`（18 行 PLG 表），并逐个核对了 13 个依赖在 `node_modules` 的实测版本；
3. 用真实数据手工推演输出（见 §5 ② 的期望值），与夹具推演分别在 `fixtures/expected.json` 固化；
4. A.1 的新判定在夹具上**手工推演**过：6 个候选包（alpha/beta/gamma/epsilon/orphan/transitive）→ R = {`lab-fixture-transitive`}（唯一引用者 = alpha）→ 真孤儿只剩 `lab-fixture-orphan`；
5. B 阶段的状态机在夹具上**手工推演**过：种子 3 条 → 8 步迁移 → 最终 `adopted 1 / rejected 1 / dormant 1`，
   日期推演（`2026-11-14 + 14 天 = 2026-11-28`、`2026-11-28 → 2026-12-01 = 逾期 3 天`、
   `2026-10-20 → 2026-12-01 = 静默 42 天`）逐条写进 `fixtures/lifecycle-expected.json`；
6. 抽取重构后逐符号核对了「谁还在用谁」：`lab-drift.mjs` 现在只 import 它真正还用的 10 个符号
   （`DEFAULT_LAB / DEFAULT_PROFILE / CliError / cmp / isInside / loadLab / loadProfile / mdCell / normalizePkgArg / sameVersion`），
   其余（`readText / readJson / normalizeVersion / parseTables / …`）全部只留在 `_profile.mjs`；
7. **C.1** 的真实数据全部**实读**过，结论按真实内容手工推演：
   - 13 个第三方包各自的 `cordis.patch.yml` 逐行读过 → 第三方 insert id 17+1 条（含 `skills-manager`）、
     覆盖项 8 条（`web` / `system-prompt` / 5 个 `redteam-*` 等），据此断言 `--scan-all` 的分组；
   - `@txc2768651338/dsh-plugin-manager@0.7.0` 的 `lib/index.js` 实扫过：`writeFileSync`/`mkdirSync`、
     目录文本里的 `…/dsh-subagent-spawn-in-process`、JWT 校验里的 `token`、`credentials` 字样 → 权限档必为「全量」；
   - `@michengai/dsh-skills-manager@1.4.8` 的 `package.json` / README 前 30 行实读 → description、Apache-2.0、
     `engines.dsh`、peer 11 项、建议 label = base（`skills manager`）；
   - 官方 row 快照的每一条都对应 `tmp/analysis.json` 里的一个 `rowId`，按 bundle 名分段抽取（第三方包的行已剔除）；
8. C.1 的 patch 解析器用 4 个真实 patch 形态手工走过一遍：单行 `insert` 块（plugin-manager / skills-manager）、
   顶层覆盖 + `insert` 混合（dsh-purge-community）、顶层覆盖在前（anysearch 的 `- id: web`）、
   带行尾注释与引号（全部 13 个包）。
9. **C.2 的离线目录**：源文件 `lib/index.js` 的 CATALOG 块（第 28–1004 行）**逐行读过**，
   并用 grep 核对了「键行 195 条、块内无 `\"` 转义、每项严格 4 行」；`data/catalog.json` 按这 195 条转写，
   转写后再用 grep 复核「entries 里正好 195 条 / 12 个分类 / 文件结构闭合」。
   解析器的正则（键行 / 字段行 / 块起止）对着**真实行样本**逐个跑过心算：
   `\t["@deepseek-ai/cordis-plugin-timer"]: {`、`\t\tname: "定时器服务",`、`\t\tcategory: "core"`、`\t},`。
10. **C.2 的 `--unknown` 判定**：14 个已装第三方包逐个读了 `package.json` 的 `description`（分档结论记在 §5.6 ③；包名清单已按发布脱敏隐去，只留条数），
   按 RULES §11.3 手工判档；`@michengai/dsh-skills-manager` 的描述 ≥15 字且无营销词 → 判 P2 而非 P1，已如实写进 §5.6 与 Q-009。
11. **C.2 的 README 提取**：两份真实 README 逐行套 §11.2 的 ①–⑤，并用夹具 `lab-fixture-rowhog` 的 README
   复核「新规则仍取到 3 句」（`fixtures/analyze-expected.json` 的 `identity.readme.sentences.length: 3` 不会被打破）。
12. **C.3 的真实数据全部实读过**：`data/catalog.json` 195 条按关键词逐个核过（`嵌入` 1 条、`管理` 5 条、
   `直播/抖音/pcb/板子/连板` 0 条）——goal/`--search` 的「无匹配」结论建立在这个事实上，不是「感觉搜不到」；
   fixture 里 7 条 registry 条目是**手造的**（`lab-fixture-*` / `@lab-fixture/*`，域名用保留的 `example.com`），
   `source.kind=file`、`url=null`、`bytes=null` 都写明了它是离线导入而不是抓取结果。

> 恢复可用终端后的第一件事：跑 §5.1 与 §5.2（A 阶段回归，验证抽取无副作用）、§5.3/§5.4（B 阶段验收）与
> §5.5（C.1 验收），把实际输出贴回主控；若与期望不符，按 `docs/RULES.md §8`（A）、`§9.7`（B）、`§10.8`（C.1）的自检清单定位。

## 7. 目录结构

```
lab-guide/                                        # 仓库根
├─ README.md                                  # 本文件
├─ docs/
│  ├─ RULES.md                                # 判定规则（唯一语义权威）：A §1–§8 / B §9 / C.1 §10
│  ├─ LABELS.md                               # C.1：9 轨分类表 + 关键词 JSON 块（classify 的唯一词表）+ 判定口径
│  └─ ROADMAP.md                              # A/B/C/D 四阶段与各自验收
├─ data/
│  ├─ lifecycle.json                          # 生命周期账本（空种子：{schemaVersion:1, updatedAt, items:[]}）
│  ├─ schema.md                               # 条目字段含义 + 状态迁移表 + 不变式（B 阶段字段权威）
│  ├─ host-rows.json                          # C.1：官方 row id 本地快照（出处/刷新见 RULES §10.7）
│  ├─ catalog.json                            # C.2：离线目录快照（195 条：模块名→中文名/描述/分类 + categories + source 元信息；只由 `_catalog.mjs --write` 写）
│  └─ registry.json                           # C.3.2：第三方市场快照 v2（**本会话未生成**——由 `_registry.mjs --from-file out/registry-raw.json --write` 或 `--url … --write` 产生；10974 条，已进 .gitignore；schema 见 RULES §12.1.4）
├─ tools/
│  ├─ _profile.mjs                            # A 阶段解析内核（profile / package.json / lab 表格）—— 三个 CLI 共用
│  ├─ _lifecycle.mjs                          # 生命周期账本读写 + 原子写 + 路径守卫（C.1 复用其守卫与原子写）
│  ├─ _catalog.mjs                            # C.2：离线目录抽取器/查询内核（行式解析 CATALOG，快照读写，命中与搜索）
│  ├─ _registry.mjs                           # C.3：第三方市场快照（loopback-only 抓取 / 导入 / 校验 / 命中 / 搜索）
│  ├─ lab-drift.mjs                           # A 阶段：只读对账器（判定 + 渲染 + CLI）
│  ├─ lab-triage.mjs                          # B 阶段：生命周期状态机 CLI（list/add/promote/due/note/sync/check）
│  └─ lab-analyze.mjs                         # C.1/C.2/C.3：本地静态分析器（身份三级优先/权限四扫/row 争用/同轨/建议分类 + --scan-all + --unknown + --search（三源）+ --goal）
├─ out/                                       # 唯一允许的产物目录（rejected-*.md / sync-suggestions.md / analyze-*.md / registry-raw.json）
└─ fixtures/
   ├─ fake-profile/package.json               # 伪造 profile：4 依赖 + 5 bundles
   ├─ fake-profile/node_modules/lab-fixture-alpha/package.json    # 0.2.0（lab 记 0.1.0 → DRIFT；deps 引用 transitive）
   ├─ fake-profile/node_modules/lab-fixture-beta/package.json     # 1.4.2（一致，负样本）
   ├─ fake-profile/node_modules/lab-fixture-gamma/package.json    # 2.0.0（lab 权限栏待补 → TODO）
   ├─ fake-profile/node_modules/lab-fixture-epsilon/package.json  # 0.3.1（lab 无条目 → UNREGISTERED）
   ├─ fake-profile/node_modules/lab-fixture-orphan/package.json   # 9.9.9（未声明且无人引用 → 真孤儿 info）
   ├─ fake-profile/node_modules/lab-fixture-transitive/package.json # 0.1.0（被 alpha 引用 → 传递依赖，不报）
   ├─ fake-lab/installed.md                   # A 阶段伪造 lab：alpha/beta/gamma/delta 四行
   ├─ fake-lab-b/installed.md                 # B 阶段伪造 lab：只登记 delta（给 sync 用）
   ├─ expected.json                           # A 阶段期望输出（断言基线，对账器不读它）
   ├─ lifecycle-b.json                        # B 阶段种子：3 条（candidate×2 + adopted×1），跑完 §5.3 即覆盖全部 5 态
   ├─ lifecycle-expected.json                 # B 阶段期望（8 步正向 + 9 条负例 + 最终 items）
   ├─ fake-nm/lab-fixture-rowhog/             # C.1 夹具 1：insert 官方同名行 plugin-manager + 只写本地文件
   │  ├─ package.json / cordis.patch.yml / README.md / lib/index.js
   ├─ fake-nm/lab-fixture-shellcred/          # C.1 夹具 2：child_process + spawn + API_KEY/credentialRef
   │  ├─ package.json / cordis.patch.yml / README.md / lib/index.js
   ├─ fake-host-rows.json                     # C.1 夹具用官方 row 最小集（plugin-manager / web / system-prompt）
   ├─ catalog-profile/                        # C.2 夹具 profile：专供 --unknown 的三档判定
   │  ├─ package.json                         # 4 个假依赖
   │  └─ node_modules/lab-fixture-vague|marketing|short|ok/package.json
   │                                          # vague 无 description / marketing 全是营销词 / short 只有 3 字 → P1×3；ok 中文描述 → P3
   ├─ analyze-expected.json                   # C.1 期望输出（6 正例 + 9 负例 + 2 条未覆盖分支声明；C.2 追加 c2Cases）
   ├─ registry-sample.json                    # C.3 夹具：手造 7 条假 registry 条目（中文描述）+ 1 条 malformed；1 条带未知字段、1 条只有名字
   └─ goal-expected.json                      # C.3 期望：registry 5 正例 + 10 负例；goal 6 正例 + 4 真实环境 + 5 负例（C.3.1 追加门禁/噪声词/--max-bytes；C.3.3 追加 c33：分层阈值 + idf 复算 + 3 正例 / 4 负例 + verify 三步）
```

## 8. 与原始任务卡的差异（都属语义必需，已记 Q-001 / Q-002 / Q-003）

1. **夹具多了一个已装包 `lab-fixture-epsilon`**。任务卡要求「profile 装 A、B、C；lab 写 A、B、D、C」，又要求四类差异各 1 条。可 A/B/C 全被 lab 登记、D 只存在 lab —— 这种组合在数学上只能产出 `MISSING(D)`，产不出 `UNREGISTERED`。要让 UNREGISTERED 成立，profile 必须有一个「装了但 lab 没登记」的包；真实环境里这个角色就是 `dsh-purge-community`，夹具用一个 epsilon 承担。
2. **夹具多了一个 `lab-fixture-orphan`**（只在 `node_modules`，9.9.9）。否则 `ORPHAN_IN_NM` 这条分支等于没测；它是 info，不进 verdict，不影响「四类各一条」的断言。
3. **`fake-lab` 只有一个 `installed.md`**（按任务卡的文件清单）。这是刻意的：顺带验证「读不到 `INDEX.md` 时降级 + 告警」，`expected.json` 里断言了这条 warning。
4. **A.1：`ORPHAN_IN_NM` 语义收紧为「真孤儿」**，并为此加了 `lab-fixture-transitive`（被 `lab-fixture-alpha` 引用）作为负样本。理由：真实环境 333 个顶层目录里 320 个是 pnpm 提升的传递依赖，旧口径把 320 条噪音当差异报，会让后续阶段淹没。详见 `docs/RULES.md` §4.2。
5. **B 阶段定义与 ROADMAP 不一致**：`docs/ROADMAP.md` 的 B 写的是「lab 文档只读 lint」，任务卡把 B 定为「生命周期状态机」。按任务卡执行，lint 顺延为 B.1；ROADMAP 未改（`docs/` 只读），裁决写在 `docs/RULES.md` §9.0（Q-001）。
6. **新增输入夹具 `fixtures/fake-lab-b/installed.md`**：`sync` 需要一个「只登记了 delta」的 lab 才能同时验证两个方向（lifecycle 有 lab 没有 = 建议；lab 有 lifecycle 没记 = info）。用真实 lab 会污染真实基线，用 `fake-lab`（A 阶段那份登记了 alpha/beta/gamma）则一条建议都产不出来（Q-002）。
7. **`_profile.mjs` 抽取**：为满足「不复制 300 行」的要求，把 A 阶段解析内核从 `lab-drift.mjs` 搬到共享模块，`lab-drift.mjs` 改为 import。这是**结构变更**，A 阶段语义未动；风险与补偿见 `docs/RULES.md` §9.5 与 §6 的「未执行」记录。
8. **`since` 语义自定一处**：`since` 定为「进入当前状态的日期」，不是「首次发现日期」。理由与替代方案见 `data/schema.md` §2.2（发现历史靠 `evidence` 追）。
9. **`docs/RULES.md` 追加了 §9（B 阶段）**：任务卡要求「若不可复用则在 RULES 里写清为何」，所以本节写进了 RULES 而非另建文件；§1–§8（A 阶段）**一字未改**。若主控认为 `docs/` 必须绝对只读，可把 §9 整段搬到 `data/schema.md`，两者内容已互相对齐（Q-003）。
10. **C.1 新增 `data/host-rows.json`（官方 row id 本地快照）**：任务卡要求判「抢宿主行」，而官方 bundle 的 patch 在 `resources/app.asar` 里——**纯 node 读不了 asar 目录**，不联网又必须能答，所以把本机实读结果存成快照（出处/刷新见 `docs/RULES.md` §10.7）。工具把它标成 `source=snapshot / confidence=likely`，并不假装是实时读取（Q-004）。
11. **C.1 权限扫描默认跳过测试目录**：任务卡写「跳过 `node_modules/`、`dist/` 以外的测试目录不必特别处理」，两种读法都成立。C.1 的选择是**照扫 `dist/`/`lib/`（发布代码在那里），默认跳过 `test/` `tests/` `__tests__/` `spec/` 与 `*.test.js`/`*.spec.js`**，并给 `--include-tests` 显式打开、把跳过数量打进报告。理由：测试里的假写盘/假凭据会把结论顶到「全量」，属噪音（Q-005）。
12. **C.1 新增 `docs/LABELS.md`（9 轨分类表 + 关键词 JSON 块）**：任务卡要求「用 LABELS.md 的关键词表做匹配」，因此词表**只放在文档里**、由工具运行时解析，代码不留副本；文档缺失/坏掉 → `unclassified` + 告警（不猜）。
13. **C.1 的 `--scan-all` 与 `--from-dir` 是任务卡外的增补**：任务卡点名 `--from-dir` 必须支持；`--scan-all` 在末尾「另加一个模式（必做）」里点名。为此新增 `--labels` / `--host-rows` / `--lifecycle` / `--include-tests` 四个参数，均只读。
14. **`COLLIDES_WITH_PLUGIN` 在本机无样本**：本机 18 条第三方 insert 里没有两条同名（唯一重名的是 `plugin-manager`，对手是官方 `dsh-base`）。该分支只有代码自核，已显式写进 `fixtures/analyze-expected.json` 的 `untestedBranches`，**没有伪造一个样本**（Q-006）。
15. **C.2 新增 `data/catalog.json` + `tools/_catalog.mjs`**：任务卡要求「离线目录」。目录本体是
    `@txc2768651338/dsh-plugin-manager/lib/index.js` 里内置的 `CATALOG`（195 条），我们**不 `import()`** 它
    （peer 依赖会炸），改用行式正则抽成快照。快照是**缓存**：读不到就现场解析源，两者都不行才报错（Q-010）。
16. **C.2 给快照加了 `categories` 字段**：任务卡给的 schema 是
    `{schemaVersion, source, count, entries, unparsed}`。C.2 多存一份 `CATEGORY_LABELS`（分类键 → 中文分类名），
    因为 `--search` 要能按「界面 / 沙箱与安全」这类中文分类名搜，而分类中文名只应有一份来源（RULES §10.1 同一条纪律）。
17. **C.2 `identity.name` 语义不变**：任务卡验收写「name 为中文名」，但 C.1 的机器基线
    （`fixtures/analyze-expected.json`）与 §4.1 的评估卡对照都把 `identity.name` 当**包名**。
    裁决：`identity.name` 仍是 `package.json` 的 name，中文名放 `identity.displayName`，
    并在 §1 表格第一行给「用途（source=…）」（Q-007）。
18. **C.2 `--unknown` 分了 P1/P2/P3 三档**：任务卡只要求一张「描述不可信」表 + 末行计数。
    但本机 14 个已装第三方包里 **P1 = 0**（13 个目录外包的 description 都达标：7 个只有英文、6 个有中文），
    只列 P1 会让「我装了但这些不知道是干什么的」这张名单**整张消失**。所以：末行仍只数 P1（严格照任务卡），
    同时把目录外的包按「只有外文描述(P2) / 中文可用(P3)」列出来（Q-009）。
19. **C.2 `--only-installed` 的默认值裁决**：任务卡写「（默认）……不加则连同 catalog 全量比对」，两句互斥。
    按「`--only-installed` = 默认」实现，全量比对改用显式 `--with-catalog`（RULES §11.3，Q-008）。
20. **C.2 新增夹具 `fixtures/catalog-profile/`**：P1 这一档在本机真实数据里没有样本（所有包都有 description），
    不造样本就等于「说不清」这条判定没测过。夹具 4 个假包分别覆盖 无描述 / 营销词 / 过短 / 中文可用。
21. **C.3 把「抓市场」拆成独立工具 `_registry.mjs`**：任务卡要求「除 loopback 外不联网」，同时又要求
    `lab-analyze` 能搜第三方。若让分析器自己去连，它就从「只读静态分析器」变成了联网客户端。裁决：
    抓取=一次性显式动作（`--url <loopback> --write`），分析=只读快照。附带好处：快照可 diff、可离线验收。
22. **C.3 改了 `--search` 的末行契约**（`匹配 N 条 / 目录共 M 条` → `匹配 N 条 / 池 M（registry A ｜ catalog B ｜ 已装 C）`），
    并把结果字段 `matches[]` 换成 `results[]`（每条带 `source` / `installed` / `alsoIn`）。这是三源合并的必要代价：
    「匹配 3 条 / 目录共 195 条」在 registry 命中时会自相矛盾（命中根本不在目录里）。
    `fixtures/analyze-expected.json` 的 c2 `search-miss` / `search-hit` 断言已同步改（旧字段 `catalogMatchCount` 仍保留，兼容）。RULES §11.4 的其余口径未动。
23. **C.3 `--goal` 的分词与打分是自定的**（任务卡只给权重，没给分词表）：中文 2–4 字滑窗 + 英文空白/连字符切，
    停用词表写在代码常量里（`ZH_STOPCHARS` / `EN_STOPWORDS`）并抄进 RULES §12.3.1，方便复算。
    **不引入任何分词库**（零依赖是硬约束），也**不做同义词归一**（词表会腐烂，见 §9）。
24. **C.3「最接近的 3 条」定义为「2 字片段重合度」**，不是编辑距离/向量相似度：池子里 200+ 条要能秒出，
    且结论必须能一句话解释（「它们只是和你给的词共享了『管理』两个字」）。替代方案（词向量/BM25）都得引依赖或建索引，与本轮「零依赖 + 可解释」冲突。
25. **C.3 `--goal` 在 registry 缺失时不 exit 1**（与 `--search`/`--unknown` 依赖 catalog 时必须 exit 1 不对称）：
    registry 只是三源之一，缺它仍有 catalog + 已装可搜；但 `catalog` + `已装` 也都没有时 → exit 1（没有池子就没有搜索）。
    这条不对称是刻意的，写在 RULES §12.1.6。
26. **C.3.2 推翻 C.3 的三处形状假设**（真实 dump 实读得出，不是「顺手改」）：①数组不在顶层而在
    `registry` 容器里；②数组键是 `plugins`；③`description` 是 `{en,zh}` **对象**。
    旧代码把对象当字符串 → 真实中文描述整段丢失；旧规模假设是 200–400 条，实际 **10,974 条**。
    因此快照 schema 升到 v2（`entries` 取代 `plugins`），**旧夹具降级为负例**（Q-011）。
27. **C.3.2 把 `registry` 抬成 identity 的第 1 级数据源**（RULES §12.1.7）：真实市场的 `description.zh` +
    `capabilities` + `capabilityRedLines` 比官方目录的「中文名 + 一句话」信息量大得多。
    代价是「同一个包在不同环境给的用途说明可能不一致」——所以报告里必须并列 `source` 与 `lang`，
    不合并、不改写（Q-012）。
28. **C.3.2 的 ×1.5 只给中文描述与 capabilities**，英文描述保持 ×1：同一段中英双语描述若两栏都 ×1.5，
    等于给「双语条目」额外加分，而那不是相关性。运算顺序定为「先字段加权（含 ×1.5 取整）→ 再对词整体 ×0.5（通用词）」，
    保证能手工复算（RULES §12.3.2）。
29. **C.3.2 新增 `--from-file` 的 v2 快照走「快路径」**：条目已是规范形态直接复制，出现规范外键才退回慢路径。
    理由：`loadRegistry` 每次运行都要处理 10,974 条，慢路径的别名表不该重复跑（RULES §12.1.3）。
30. **`data/registry.json` 进了 `.gitignore`**：13–14MB 级、可由 `out/registry-raw.json` 重抓生成，
    不该进仓库（任务卡硬要求）。`out/` 本来就被忽略，所以 raw dump 也不会入库（Q-013）。
31. **C.3.3 用「分层」而不是「再加一条门槛」**：任务卡要求「三层全部展示 + 去掉长词/≥2词/Σ≥6 的硬门槛」。
    照做之后**唯一保留的否决**是「只命中通用词」（否则用户实测的 8 条「管理」会复活），
    并把它实现成「**强制归入仅字面命中**」而不是「重算一个分数」——这样规则只有一句，不需要第二套阈值。
    另外任务卡给的 idf 例子（800 条 → ~0.5）与公式算出来（2.62）不一致，代码**按公式**实现，
    差异与备选方案写在 §5.7.3 与 Q-001；这条不自行改公式，因为「可复算」优先于「例子好看」。
32. **C.3.3 的分层只物化前 N 行，但条数全量**：10974 条池子里「弱匹配」可能上千条，
    全量物化成 md 表格/JSON 行会让报告失去可用性（也拖慢）。所以 `counts` 全量、`notListed` 给差额、
    表尾明写「本层共 N 条，表内列前 M 条」——**明写截断，不是静默截断**。
33. **C.3.3 的同义词提示不进匹配**：任务卡要求「只给 3–5 组硬编码示例，不建表、不参与打分」。
    实现成 `SYNONYM_HINTS` 常量，只被 md 渲染读取；`grep SYNONYM_HINTS` 只能命中常量定义与渲染两处
    （不走 `scoreCandidate` / `classifyTier` / 词表诊断的 counting 路径）。

## 9. 已知限制

- **「强匹配 0」是正常输出，不是故障**：`--goal` 只做**字面**匹配，而市场用词常与用户说法不对齐
  （用户写 `嵌入式`，市场写 `PCB` / `EDA` / `固件` / `单片机`），词不重合就进不了强/弱匹配。
  **实测**：`--goal "我想学嵌入式，从连板子到画 PCB"` → **强 0 ｜ 弱 9 ｜ 仅字面 45**（池 **11183**）。
  **正确用法**：先看报告里的 **`## 词表诊断`** 段——它逐词告诉你「池中命中条目数 + idf」，
  0 命中的词会标 **未命中** 并给换词提示；换成命中的词再搜。
  一句话：**`--goal` 是诊断器，`--search` 才是召回器**；不要因为强 0 就以为工具坏了。
- **不判区间**：`dependencies` 写 `^1.2.3`、实际装 `1.2.4` 时，工具只看实测 `1.2.4`。这是刻意的——lab 应记录实际装着的版本。
- **真孤儿判定依赖各包 `package.json` 可读**：判「有没有人引用」要读每个候选包的 `dependencies`/`peerDependencies`/`optionalDependencies`；读失败记入 `warnings`（该包引用了谁无从得知，可能把真依赖误报成孤儿），不猜、不填默认值。
- **只认表格结构**：lab 的 md 若把插件表改成列表/代码块，解析会退化（跳过 + 告警），不会瞎猜。
- **不联机**：不查 npm registry、不查市场缓存，只看本地文件；「有没有新版本」不在 A 阶段范围。
- **不写 lab**：发现差异也不改 lab —— 改 lab 是主对话的事（lab README §9.1/§9.2 单一写入者 + 安装唯一来源）。
- **B 阶段不加锁**：`data/lifecycle.json` 的写入是「tmp → rename」，只保证不出现半截文件；并发写会后写覆盖先写。单人使用够用，要并发必须外部串行化。
- **B 阶段不判活跃度**：`due` 只看日期（trial 到期 / 30 天没核对），不判断上游是否还维护（那是 lab G3 的人工项）。
- **B 阶段 `rejected` 终结**：否掉的条目不能复活，要重来就 `add` 新 pkg；历史只增不改，靠 `evidence` 追溯。
- **C.1 只扫 `.js` / `.mjs`**：`.cjs` `.ts` `.tsx` `.jsx` `.mts` `.cts` 里的能力不在统计内（会单独计数并告警）。要补就得扩扫描口径，而不是猜。
- **C.1 权限扫描是正则计数，不是数据流分析**：命中即报，字符串常量里的模块名也会命中（例：`dsh-plugin-manager` 的目录文本里出现 `…/dsh-subagent-spawn-in-process` → 命令执行 +1）。它回答「代码里出现过这类能力」，不回答「会不会真的这么干」。
- **C.1 官方 row 来源是快照**：`data/host-rows.json` 与本机宿主版本绑定（本快照 `0.2.2-rc.1`）。宿主升级后官方行会变，快照不会自动更新——所以报告头永远写 `source` 与 `confidence`，读不到时 `COLLIDES_WITH_HOST` 记 unknown、verdict 封顶「观察」。
- **C.1 patch 解析只认子集**：`groups/alias/!!js/流式写法` 读不懂就报告，且这些位置可能藏着行声明；本工具不会因此推断出「没有冲突」以外的结论，但也不会假装读懂。
- **C.1 的 verdict 不是推荐算法**：只有 8 条固定阶梯（`docs/RULES.md` §10.6），输入只有本地静态证据（row 争用 / 权限四档 / 同轨重复）。没有星数、下载量、更新时间，也不联网。
- **C.1 不判「行为是否正确」**：它读代码文本与声明文件，不运行目标包（`--from-dir` 也不执行里面的代码）。
- **C.2 离线目录会过期**：`data/catalog.json` 是**本机某个版本的构建产物快照**（来源包 `0.7.0`，宿主 `0.2.2-rc.1`）。
  `dsh-plugin-manager` 升级后 CATALOG 可能变，快照**不会自动更新**——刷 `_catalog.mjs --write`，
  用 `_catalog.mjs --check` 看有没有漂；报告头永远写 `origin=catalog 快照/现场解析` + 来源包版本。
- **C.2 的 `basename` 命中是启发式**：去掉 scope 的短名唯一命中才算（`@x/dsh-plugin-manager` → `@deepseek-ai/dsh-plugin-manager`），
  命中≥2 个就**不命中**并列出候选。它是「同名不同 scope」，不是「同一个包」，报告里必须标 `match=basename`。
- **C.2 的「不可信」只看字数与营销词**：不判语义、不判语言质量；≥15 字且不含营销词的英文描述会被判「可信」，
  只是排在 P2（目录外·仅外文）。要更严就得改 RULES §11.3 的词表，而不是让代码偷偷加权。
- **C.2 的 `--search` 是子串 AND，不是语义检索**：搜「嵌入式」不会命中「嵌入」（`dsh-library` 的描述里就有「本地嵌入」）；
  中文分词也没有做，多词就是多子串。它回答「目录里有没有这几个字」，不回答「哪个最像我想找的」。
- **C.2 的 README 提取不判段落语义**：只按行过滤 + 句长阈值。README 若把正文写在居中的 `<div>` 版式里，
  版式内的短句仍可能先命中；这类包的 `identity.source` 通常已经是 `catalog` / `package-json`，README 只作补充展示。
- **C.2 的 `--unknown` 不扫传递依赖**：只看 `dependencies ∪ bundles` 的第三方包（官方 scope 已排除）。
  `node_modules` 顶层那 300+ 个 pnpm 提升包不进这张表——理由与 `ORPHAN_IN_NM` 收紧同源（RULES §4.2）。
- **C.3 的 registry 只覆盖「市场服务愿意给的字段」**：别名表之外的键原样留在 `extra` 里，但**不参与搜索/打分**
  （不认识的字段我们不知道语义，拿它算分就是猜）。要让某个字段参与，必须先把它写进 RULES §12.1.3 的别名表。
- **C.3 的 registry 快照会过期**：`data/registry.json` 是某个时刻的市场镜像，市场增删插件后**不会自动更新**；
  报告头永远写 `origin` + `source.fetchedAt` + `httpStatus`，让人自己判断新不新。
- **C.3 的 loopback 边界不支持代理/证书/重定向**：只认 `http://` + 三主机 + 显式端口，3xx 直接拒绝。
  这是刻意的（它不是通用 HTTP 客户端）；市场若把 registry 挂在 https 或需要跳转，第一步得先改市场而不是改这个工具。
- **C.3 的 `--goal` 是「词面命中」不是语义理解**：滑窗 + 子串 + 固定权重；通用词（`管理`/`同步`/`日志`）
  会把一批官方模块带上榜，术语不一致（`嵌入式` vs `嵌入`、`预管理` vs `预审`）会漏。命中词列就是让人自己降权的。
- **C.3 的 `--goal` 只看三源给的文本**：不读 star 数、下载量、更新时间、作者可信度，也不联网核实仓库是否还活着。
  它回答「池子里哪几个的描述最像你要的」，不回答「这个插件好不好」。
- **C.3 未装包的权限永远是 `unknown`**：没有本地代码就没有四档结论。想要结论就先 `dshmarket` 装/解包再用
  `--from-dir` 分析——本工具不会用「同类包大概要什么权限」来填空（RULES §12.4）。
- **C.3.2 只认规范字段，规范外的真实字段只「保存」不「使用」**：`starsCheckedAt / downloadsStart /
  downloadsEnd / downloadsCheckedAt / icon / screenshots` 原样进 `extra` 并列出，但**不参与搜索/打分/结论**。
  要用它们必须先写进 RULES §12.1.3 的表（否则就是拿不认识的字段算分 = 猜）。
- **C.3.2 的 `stars / downloads` 只展示**：它们会随时间变、也可能是刷的；本工具不联网核实，
  也不把它们混进 `score`（分数只由词面命中构成，才可能手工复算）。
- **C.3.2 的分母变大 30 倍，噪音也会变多**：池子从 209 → 约 11,100（catalog 195 + registry 10974 + 已装）。
  三条门槛（长词 / ≥2 词 / Σ≥6）与通用词降权仍在，但**短词偶然命中**的数量必然上升；
  命中词列 + 命中字段就是让人自己复核的地方，不是「推荐结果」。
- **C.3.2 的 `capabilityRedLines` 只是「上游这么写」**：本工具不核实红线是否成立、也不联网跑它；
  `redLines=有` 的含义是「**装之前你必须逐条读一遍**」，不是「已验证安全」。
- **C.3.2 的快照体积**：10974 条 + 每条的 `extra`（含真实字段）会落成十几 MB 的 `data/registry.json`；
  条目 > 500 时用紧凑 JSON（省体积、机器读），所以快照**不适合人眼 diff**——要看形状就用 `--json` 统计。
- **C.3.2 首次导入会短时吃内存**：`--from-file out/registry-raw.json` 要「原始字符串 + 解析后的对象树 + 归一化后的条目」
  同时在内存里（原始 13.8 MB，对象树通常是它的 10–20 倍）。Node 默认堆够用，但别把它塞进内存更小的容器；
  落盘后 `lab-analyze` 每次只解析快照本身。
- **C.3.3 的分层仍然只匹配字面**：分层解决了「门槛把弱命中砍掉」，但**没解决「同义词」**——
  `嵌入式` 不会命中 `单片机/PCB/EDA`。这正是 `## 词表诊断` 存在的理由：它把「你这个词在池里 0 条」
  明确说出来，并给 4 组硬编码提示。**想要真同义词匹配就得建词表**，而词表会腐烂（RULES §12.3.5），本轮不做。
- **C.3.3 的覆盖率分母是「有效词数」**：同一个包，换一句更长（更多有效词）的目标，覆盖率就会变低、
  掉到「仅字面命中」。这是设计的代价（覆盖率必须可解释），**不要**把不同目标之间的层别拿来横比。
- **C.3.3 的 idf 池总数含 catalog + 已装**：`pool.total` = 10974 + 195 + C，所以 idf 的数值会随着
  「本机装了几个包」轻微变化（`已装` 只占千分之几）。要完全稳定的 idf，就得固定分母——那又变成
  「不看真实池子」，所以宁可让它跟着池子走，并在报告里打印 `diagnostics.poolTotal`。
- **C.3.3 的 idf 端点是夹取不是归一**：`clamp(..., 0.5, 3.0)` 只截断不重标定 —— 所以「命中 ≈800 条的常见词」
  idf 是 **2.62** 而不是 0.5（0.5 只在命中 ≈6655 条以上触底）。「常见词变轻」靠 idf 相对差 + 通用词 ×0.5 +
  通用词否决三者共同实现（Q-001）。
