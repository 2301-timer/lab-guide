# RULES · lab-guide 判定规则（A 阶段冻结版）

> 定位：本文是 `tools/lab-drift.mjs` 的**唯一语义权威**。代码与本文冲突时以本文为准，改规则必须先改本文。
> 基线：lab-guide v0.1.0（A 阶段）｜2026-11-14
> 上游只读源：`<LAB_DIR>`（README 的 G1–G5 与条目模板、`installed.md`、`INDEX.md`）。**本文件不改 lab，只引用。**

---

## 0. 三条红线（任何一条破了就是事故）

| 编号 | 红线 | 落地方式 |
|---|---|---|
| R-1 | **只读**：A 阶段不写 profile、不装/卸/升级插件、不写 `cordis.patch.yml`、不写 `.dsh-market`、不改 lab | 对账器默认零写入；唯一写动作是显式 `--write-report <path>`，且目标落在 profile / lab 目录、或文件名是 `cordis.patch.yml`、或路径里出现 `.dsh-market` 时**直接拒绝并 exit 1** |
| R-2 | **不猜测**：读不到的版本写 `null`，并在 `evidence` / `warnings` 写清原因，**绝不填默认值、绝不按 `package.json` 声明区间推断实际版本** | `node_modules/<pkg>/package.json` 读不到 → `version: null` + 告警；lab 版本栏读不到 → 跳过该项版本对比 + 告警 |
| R-3 | **权限栏读不到就写「待补」**：lab 条目权限四项只要有一项没有结论，就写 `待补`，不得省略、不得留空、不得用「未知」含糊过去 | `待补` 会被对账器识别为 `PERMISSION_TODO`（见 §5） |

> R-3 是**对人**的写作规则（写 lab 条目的人遵守）；R-2 是**对机器**的读取规则（对账器遵守）。
> 两者方向一致：宁可留 `待补` / `null`，也不许编一个看起来合理的值。

---

## 1. 筛选模型 G1–G5（引用 lab README §2.3，不改写）

硬门槛，**任一不满足 → 直接淘汰**（进 `rejected.md`）：

| 编号 | 门槛 | 判定方式 | 在 A 阶段对账器里的位置 |
|---|---|---|---|
| **G1** | 可安装且兼容 | 市场可搜到 / npm 可装；与当前 DSH 版本兼容（本地兼容缓存 + 实际安装验证） | 对账器只核对「装了没 / 版本对不对」，**不重复判 G1**；`MISSING` / `VERSION_DRIFT` 是 G1 的复核信号 |
| **G2** | 有说明 | README 或市场详情页含安装、配置、卸载说明（中/英均可，但要能看懂） | 人工项，不在对账器内 |
| **G3** | 有维护 | 近 12 个月有发布/提交 | 人工项（带检查日期），不在对账器内 |
| **G4** | 无安全红线 | 无安装脚本投毒、代码混淆、索要凭据/Token 迹象 | 人工项；对账器只做**权限四项是否已结论**的机械检查（`PERMISSION_TODO`） |
| **G5** | 依赖明确 | 若需自建服务 / API Key，必须在说明中写明 | 人工项；与权限四项的「网络/凭据」两格互相印证 |

> 结论档位（lab README §2.4）：加权 ≥ 4.0 → 推荐；3.0–4.0 → 观察；< 3.0 → 淘汰。A 阶段不改评分，只对账。

---

## 2. 权限四项（lab README §2.5.2，逐条必备）

每个条目必须写清四格，**缺一格就是「待补」**：

| 格 | 必须回答 | 允许的写法示例 | 不允许 |
|---|---|---|---|
| **文件** | 读写哪些路径、读还是写、范围多大 | `文件（只读包内 assets）`、`文件（工作区读写 + $DSH_HOME 状态/备份）` | 留空；写「无」但不给依据 |
| **网络** | 访问哪些域名/端口，是否外联 | `网络（api.anysearch.com）`、`网络（无）` | 写「有网络」而不给目标 |
| **命令执行** | 是否起子进程/调 shell/系统命令 | `命令（spawn：跨平台防休眠）`、`命令（无）` | 用「可能」等含糊词 |
| **凭据** | 是否读/写凭据、读哪一类（**只写类别，不写值**） | `凭据（读 ANYSEARCH_API_KEY）`、`凭据（未发现直接读写）` | 写 token / key 原文（lab 安全红线） |

- 四格用 `｜` 连接，顺序固定：`文件（…）｜网络（…）｜命令（…）｜凭据（…）`。
- 任何一格写成 `待补` / `待观察` / `待评估` / `待定` / `待确认` / `待核实` / `TBD` / `TODO` → 该条目产出 `PERMISSION_TODO`。

---

## 3. 四类差异定义（A 阶段验收核心）

一句话记法：**「装没装」看 profile，「登没登」看 lab；同一件事实在两个数据源不一致，就是差异。**

### 3.1 UNREGISTERED — 装了但 lab 没登记

- **定义**：包出现在 profile 的 `dependencies` 里，但 lab（`installed.md` 表格 + `INDEX.md` PLG 表的并集）**没有把它算进已装基线**。
- 两种子情形都算：
  1. lab 完全没有这个包的条目；
  2. lab 有条目，但它的状态/基线/结论列写着「未安装 / 已卸载 / 已移除 / 淘汰」（即 lab 自己不认为它装着）——此时**额外**给一条 warning 说明 lab 标记与实际相反。
- **evidence 必含**：`dependencies` 声明值、`node_modules` 实测版本（读不到写 null + 原因）、lab 侧的判定依据（哪一行、写的什么）。
- **为什么不是 info**：装上了却没登记 = 基线失真，`README §9.4` 的「维护核对（防漂移）」会失效，必须补登记。

### 3.2 MISSING — lab 登了但实际未装

- **定义**：lab 已装基线里有这个包，但 profile 的 `dependencies` **没有**它，且 `node_modules` 里也**没有**它。
- **evidence 必含**：lab 登记的版本 + 行号引用、`profile dependencies 无该包`、`node_modules 无该包目录`。
- **不算 MISSING 的情形**（避免误报）：
  - 包在 `node_modules` 但不在 `dependencies`（peer / 残留）→ 不判 MISSING；是否计入 `ORPHAN_IN_NM` 只看它**是否被别的已安装包引用**（见 §4.2）；
  - lab 条目的状态/基线/结论列写「未安装 / 已卸载 / 淘汰」（如 `INDEX.md` 的 PLG-009..011、PLG-012/015/016/017）→ **它不是已装基线，根本不参与 MISSING**。

> ⚠️ 这一条是踩过的坑：`INDEX.md` 里 PLG-009..011 的**状态列**写「待批 / 观察」，**基线列**才写「未安装」。
> 只看状态列会把 3 个未装条目误报成 MISSING。所以「是否在已装基线」只看**状态 / 基线 / 结论**三列（任一列含未装标记即排除）。

### 3.3 VERSION_DRIFT — 两边版本不同

- **定义**：lab 登记的版本与 profile 实际安装版本不相等。
- **比较口径（重要）**：
  - profile 侧取 **`node_modules/<pkg>/package.json` 的 `version`（实测值）**，不取 `dependencies` 的声明值；
  - lab 侧取 `installed.md` 的版本列（优先），没有则取 `INDEX.md` 的 `pkg@ver`；
  - 比较前只做归一化：去反引号/引号、去 `^ ~ = v` 前缀、去尾随注释；**不做 semver 区间求值、不做「大概兼容」判断**。
- 例：`dependencies` 写 `^0.1.0`、实际装 `0.2.0`、lab 写 `0.1.0` → **DRIFT**（lab 应记录实际装着的版本，而不是声明区间）。
- **environment 无法读取时不产出 DRIFT**：任一侧为 `null` → 跳过并告警（§0 R-2），绝不拿另一侧凑数。
- **evidence 必含**：`lab=<值>（文件:行号）`、`profile 实测=<值>`、`dependencies 声明=<值>`。
- 若 lab 内部 `installed.md` 与 `INDEX.md` 版本就不一致 → 只出 warning（`lab 内部版本不一致`），DRIFT 以 `installed.md` 为准。

### 3.4 PERMISSION_TODO — 权限栏未结论

- **定义**：处于已装基线的 lab 条目，其**权限栏**（`installed.md` 的权限列或 `INDEX.md` 的权限摘要列）含未结论字样。
- 未结论字样集合（固定，改集合要改本文）：`待补`、`待观察`、`待评估`、`待定`、`待确认`、`待核实`、`TBD`、`TODO`。
- **evidence 必含**：命中的字样 + `文件:行号`。
- **作用域**：只扫**权限栏**，不扫「副作用/冲突」列与「结论」列——`待观察` 出现在副作用列是正常的试用状态，不算权限未结论。

### 3.5 判定优先级（避免一条事实报两类）

| 事实 | 结论 |
|---|---|
| 在 deps + lab 无条目（或 lab 标记未装） | `UNREGISTERED`（不再产 `MISSING`） |
| 在 lab 基线 + deps 与 nm 都没有 | `MISSING`（**不再**产该包的 `PERMISSION_TODO`，先修安装事实） |
| 在 lab 基线 + 实际在装 + 版本不同 | `VERSION_DRIFT`（版本与权限两件事互相独立，可同时产 `PERMISSION_TODO`） |
| 在 lab 基线 + 实际在装 + 权限栏未结论 | `PERMISSION_TODO` |

- 输出顺序固定：`UNREGISTERED → MISSING → VERSION_DRIFT → PERMISSION_TODO → ROSTER_ONLY → ORPHAN_IN_NM`，同类内按包名升序（`cmp`，与 locale 无关）。
- `verdict` 只统计**四类**，info 不计入。

---

## 4. 两类 info（只记录事实，不给结论，不计入 verdict）

### 4.1 ROSTER_ONLY — 在 bundles 但不在 dependencies

- **定义**：出现在 `dsh.profile.bundles` 花名册，但 `dependencies` 没有声明它。
- 典型来源：官方 bundle（`@deepseek-ai/dsh-base` 等），随应用发布，不由 profile 依赖管理——**这不是问题**。
- 也可能是手工塞进 bundles 的包：此时它会被宿主加载，却不在依赖锁里。是否要处理由人判断，工具不表态。

### 4.2 ORPHAN_IN_NM — node_modules 顶层「真孤儿」

> A.1 修订（2026-11-14）：本条的语义从「在 node_modules 但未声明」**收紧**为「真孤儿」。
> 旧口径在真实环境实测出 **320 条**，全是 pnpm 提升上来的传递依赖——那不是差异，是噪音。

- **定义（三条件同时成立才算）**：
  1. 出现在 `node_modules` 顶层（候选集 **C**：顶层目录 + `@scope` 展开一层）；
  2. `dependencies` 与 `dsh.profile.bundles` **都没有**声明它；
  3. 它**没有被任何已安装包引用**——即不在被引用集合 **R** 里。
- **R 的采集口径（零依赖，只用 `node:fs`）**：
  - 遍历候选集 C 中**每个包**的顶层 `node_modules/<pkg>/package.json`，只取 `dependencies` / `peerDependencies` / `optionalDependencies` 三个对象的 **key**（不取值、不求值区间）；
  - **不进** `node_modules/<pkg>/node_modules`（嵌套目录里的依赖不算「被顶层引用」，也不单独做候选）；
  - 单个包读失败**不影响整体**：它引用了谁无从得知，记入 `warnings`（见 §5.4），不猜。
- **性能契约**：每个候选包的 `package.json` 在一次运行里**只读一次**（读到的版本 + 引用 key 一起缓存复用）。分类阶段与孤儿阶段共用同一份缓存，禁止重复读同一文件。333 个包串行读小 JSON 在可接受范围，故不使用异步并发池。
- **只做一层判定**：R 不区分引用者本身是否孤儿（不做可达性传播）。A 个孤儿引用 B 时 B 仍算「被引用」——这是有意的保守取向：宁可漏报，不可把别人的依赖冤枉成残留。
- **典型真孤儿来源**：卸载残留、手工拷进 profile 的 junction、装错层级。
- **典型非孤儿（以前被误报的）**：pnpm 提升的传递依赖、peer 依赖——它们被别人写在 deps 里，属于正常安装形态。
- **不给结论**的理由：本项仍是 info，只提示「这个目录没人要」，是否清理由人判断（真正要动手的清理必须走 lab 维护流程）。
- **输出限流**：md 报告默认最多列 **20** 条，表后附一行 `共 N 条（用 --json 看全量）`；`--show-all-orphans` 显式全量；`--json` **始终全量**。
- **`--explain <pkg>`**（查询模式，不输出对账报告）：打印该包为何被判为孤儿/非孤儿——是否在 nm 顶层、是否在 `dependencies`/`bundles`、被哪些包引用（按包名升序，列前 5 个 + 总数）、以及已扫描了多少个候选包。

#### 为何排除传递依赖（实测依据）

真实 profile 的 `node_modules` 顶层有 **333** 个目录，其中 **320** 个是 pnpm 提升上来的传递依赖，只有十来个是 profile 自己声明的。按旧口径「未声明即孤儿」，报告里有 320 条 info，把四类真差异淹没在表里——**报它们等于没报**：

- 传递依赖**本来就应该在顶层**（pnpm 的 node_modules 是扁平链接布局），它们的存在不说明任何基线问题；
- 只有「既没人声明、又没人引用」才是真正的悬空目录；
- 收紧后真实环境 ORPHAN_IN_NM 从 320 掉到个位数，每一条都值得看一眼。

---

## 5. 数据源与解析口径（可复现）

### 5.1 profile 侧

| 字段 | 来源 | 说明 |
|---|---|---|
| 依赖 + 声明版本 | `<profile>/package.json` → `dependencies` | 键=包名，值=声明（可能是 `^x.y.z`、`~x`、tarball URL、`file:`） |
| 花名册 | `<profile>/package.json` → `dsh.profile.bundles` | 字符串数组；若为对象则取 `name` / `package` / `id` |
| 实际版本 | `<profile>/node_modules/<pkg>/package.json` → `version` | **实测真源**；scoped 包按 `@scope/pkg` 两级目录拼 |
| 引用集合 R | 每个候选包 `package.json` 的 `dependencies` / `peerDependencies` / `optionalDependencies` → **key** | 只读顶层这一份；不进 `node_modules/<pkg>/node_modules`；每个文件整轮只读一次（版本与引用 key 同一份缓存） |
| 目录清单 | `<profile>/node_modules/` 顶层 | 跳过 `.` 开头（`.bin`/`.pnpm` 等）；`@scope` 展开一层子目录 |

- `dependencies` 里的非 semver 声明（如 tarball URL）只作 evidence，**不参与版本比较**，并给 warning。

### 5.2 lab 侧

| 来源 | 解析目标 | 规则 |
|---|---|---|
| `installed.md` | 第三方插件表 | 表头含「包名」「版本」；包名取**第一列反引号内**内容，版本取版本列 |
| `INDEX.md` | PLG 表 | 表头含「包名@版本」；第二列反引号内 `pkg@ver`，用**最后一个 `@`** 切分（兼容 `@scope/pkg@1.0.0`） |
| 两份并集 | 去重键 = 包名 | `installed.md` 优先（已装基线），`INDEX.md` 补状态/权限摘要；版本冲突只告警 |

- 表格识别：连续 `|` 行 + 紧随其后的 `|---|` 分隔行；遇到第一个非 `|` 行结束。
- 表格外的 H3 小节（如 `installed.md` 的「已卸载记录」）**不计入**已装基线。
- 反引号内读不到包名、`pkg@ver` 缺 `@`、行结构异常 → **跳过该行 + 告警**，不猜。

### 5.3 输出契约

- **md（默认，给人看）**：头部三行元信息 → 一行 `summary` → 四张分类表（空表写「（无）」）→ 两张 info 表 → 告警列表（有才出）→ **最后一行 `verdict: <N> drift(s)`**。
- **md 的 ORPHAN_IN_NM 限流**：默认最多列 20 行，表格后追加一行 `共 N 条（用 --json 看全量）`；`--show-all-orphans` 全量列出。限流只影响 md 的展示，**不改 summary 计数、不改 --json**。
- **json（`--json`，给 CI/断言）**：顶层字段序固定 `generatedAt → profile → lab → summary → differences`；`differences` 每项字段序固定 `kind → pkg → evidence`；`summary` 字段序 `total → UNREGISTERED → MISSING → VERSION_DRIFT → PERMISSION_TODO → ROSTER_ONLY → ORPHAN_IN_NM → verdict → warnings`。`differences` **始终全量**，不受限流影响。
- **`--explain <pkg>`（查询模式）**：不给对账报告，只输出该包的解释。
  - md：`# lab-drift explain: <pkg>` → 判定行 → 在 nm 顶层 / 在 dependencies / 在 bundles / 实测版本 / 被引用（前 5 个引用者 + 总数 + 已扫描候选包数）→ 口径说明 → 最后一行 `orphan: true|false`。
  - json：顶层字段序 `generatedAt → profile → lab → explain → warnings`；`explain` 字段序 `pkg → orphan → conclusion → inNodeModules → inDependencies → declaredSpec → inBundles → installedVersion → referencedByCount → referencedBy → scannedPkgs → note`。
  - 退出码恒为 0（查询动作，不参与 CI 判定，忽略 `--fail-on-drift`）。

### 5.4 读失败与告警口径

- `node_modules/<pkg>/package.json` 读不到 → `version: null` + 逐包 warning（§0 R-2），**绝不填默认值**。
- 候选包的 `package.json` 读不到时，它引用了谁无从得知 → 额外一条汇总 warning（`真孤儿判定：N 个候选包（…）的 package.json 读不到 → …可能被误判为真孤儿`），因为「真孤儿」判定依赖这份文件。这类包自身仍可能被报为孤儿，但必须人能看见这条风险提示。

---

## 6. 退出码

| 码 | 含义 |
|---|---|
| `0` | 跑通。**有差异也是 0**（默认不吓人）；`--explain` 模式恒为 0 |
| `2` | 跑通且**有差异**，且显式带了 `--fail-on-drift`（CI 用） |
| `1` | 异常：未知参数、`--json` 与 `--md` 同时给、`--explain` 缺包名、profile/lab 读不到、拒绝写入的 `--write-report` 目标 |

---

## 7. 语义裁决记录（原始任务卡里的自相矛盾，这里定死）

原始任务卡写：「expected.json 写定时期望出现：1 条 UNREGISTERED(D) + 1 条 MISSING(D 反向? …) + …」，同时规定夹具是「profile 装 A、B、C；lab 写 A、B、D、C」。

- 若 literal 照做：D 只在 lab、不在 profile → 只能得到 **MISSING(D)**，得不到 UNREGISTERED(D)（同一个包不可能既「lab 没有」又「lab 有」）。
- **裁决**：UNREGISTERED 与 MISSING 是**两条不同的真实事实**，各自需要各自的样本包：
  - `lab-fixture-delta`：lab 有、profile 没有 → **MISSING**；
  - `lab-fixture-epsilon`：profile 有、lab 没有 → **UNREGISTERED**。
- 因此夹具 profile 是「4 个已装包 + 1 个只出现在 bundles 的官方 bundle + 1 个只出现在 node_modules 的真孤儿 + 1 个只出现在 node_modules 的传递依赖」，而不是 3 个。这是**语义必需的增补**，已记入 `README-DEV.md` 的「与任务卡的差异」与回传的 Q-001。
- 同理，`ORPHAN_IN_NM` 若没有样本就等于没测：夹具加了 `lab-fixture-orphan`（info，不计入 verdict）。
- **A.1 追加**：语义收紧成「真孤儿」后，单靠 orphan 一个样本证明不了「传递依赖不再被误报」，所以夹具再加 `lab-fixture-transitive`（只在 `node_modules`，但被 `lab-fixture-alpha` 的 `dependencies` 引用）——它必须**一条都不出现在报告里**，`expected.json` 用 `expectedNotAnything` 固化这条负样本。

---

## 8. 判定自检清单（改代码前先读）

- [ ] 新增/修改任何结论，是否同时改了本文？本文与代码必须一致。
- [ ] 读不到的值是否写成 `null` 并带原因？有没有偷偷填 `"unknown"` / `"0.0.0"`？
- [ ] 是否引入了新的写文件动作？只允许 `--write-report` 一处。
- [ ] 是否把「副作用列里的待观察」误判成 `PERMISSION_TODO`？
- [ ] 是否把 `INDEX.md` 里「未安装/已卸载」的条目误判成 `MISSING`？
- [ ] 是否把 `^0.1.0` 这类声明区间当成了实际版本？
- [ ] verdict 是否只统计四类（不含 info）？
- [ ] 真孤儿判定是否**只**用顶层 `node_modules/<pkg>/package.json`？有没有误读 `node_modules/<pkg>/node_modules`（嵌套依赖）？
- [ ] 同一个 `package.json` 是否被读了两遍（版本一遍、引用一遍）？性能契约要求一次读完就缓存。
- [ ] md 限流是否只影响展示？summary 计数与 `--json` 必须仍是全量。
- [ ] `--explain` 的判定顺序是否与 `buildReport` 的 `ORPHAN_IN_NM` 分支一致？（改一处必须改另一处）

---

# B 阶段 · 生命周期状态机（lab-triage）

> 本节是 B 阶段（2026-11-14）的语义裁决与复用记录。**字段与迁移表的权威是
> [`../data/schema.md`](../data/schema.md)**；本节只裁决「为什么这么定、边界在哪」。
> 与 §0 三条红线冲突时，红线优先。

## 9.0 先纠正一处阶段定义冲突（已记 Q-001）

`docs/ROADMAP.md` 的 B 阶段原本写的是「lab 文档只读 lint（条目完备性 / 权限四项 / 编号规约 / 索引一致性）」，
而本轮任务卡把 B 定义为「**生命周期状态机**」。两者不是同一件事。

裁决：
1. **按任务卡执行**——B = 生命周期状态机（`data/lifecycle.json` + `tools/lab-triage.mjs`）；
2. ROADMAP 的 lint 内容**没有废弃**，它被顺延为「B.1 候选」：`lab-triage sync` 生成的片段已经
   复用 lab 的模板字段，lint 需要的那套表格解析（`_profile.mjs`）也已就位，接上即可；
3. 本文件 §1–§8（A 阶段判定规则）**一字未改**，仍是 `lab-drift.mjs` 的唯一语义权威。

## 9.1 数据分离原则

- 生命周期账本 `data/lifecycle.json` 是**我们自己的判断账**，与 profile / lab 的事实账**分开存**。
  事实（装了什么、登记了什么）由 A 阶段对账；判断（要不要留）由 B 阶段记账。
- 两边不一致时**不自动改任何一边**：`sync` 只产出给人复制的 Markdown 建议。

## 9.2 迁移表（与 `data/schema.md` §3.2 必须一致）

`candidate→trial`、`candidate→rejected`、`trial→adopted`、`trial→rejected`、`adopted→rejected`、
`adopted→dormant`、`dormant→rejected`、`dormant→trial`。**其余一律拒绝**并 exit 1。

三条设计意图（不接受「顺手放开」）：

| 拒绝的组合 | 为什么拒绝 |
|---|---|
| `candidate→adopted` | 跳过试用期就没有到期复核，`due` 永远看不见它——采用必须有试用证据 |
| `adopted→trial` | 降级只有 `dormant`（暂不用）和 `rejected`（否掉）两条路；回到 trial 会让 `since`/`trialUntil` 语义混乱 |
| `rejected→*` | 否掉是终结。要复活就 `add` 新 pkg，历史只增不改 |

## 9.3 不变式（违反 → exit 1 且**不写文件**）

| 不变式 | 违反码 | 为什么 |
|---|---|---|
| `rejected` 必须有 `reason` 且 ≥1 条 `evidence` | `INV_REJECTED_NO_REASON` / `INV_REJECTED_NO_EVIDENCE` | 三年后回看「为什么否掉」必须自己解释自己 |
| `trial` 必须有 `trialUntil` | `INV_TRIAL_NO_TRIAL_UNTIL` | 没有到期日 = 无限试用 = 永远不结案 |
| `adopted` 必须 `watch:true` 且 `verifiedVersion` 非空 | `INV_ADOPTED_NO_WATCH` / `INV_ADOPTED_NO_VERSION` | 采用的前提是「盯得住漂移」；版本必须是实测值 |
| `pkg` 全局唯一 | `PKG_DUPLICATE` | 同一主键两条记录 = 状态机失去唯一解释 |
| `kind` 与 `pkg` 前缀一致（`skill:`/`mcp:`/`app:`） | `KIND_PREFIX_MISMATCH` | 非插件条目没有包名可当主键，前缀就是它的身份 |

**关键取舍**：`adopted` 的 `verifiedVersion` **只取 profile 的 `node_modules/<pkg>/package.json` 实测值**。
读不到就**拒绝迁移**（`promote --to adopted`）或**保留原值**（`note` 对已 adopted 条目），
绝不填 `"unknown"` / `"0.0.0"` / `dependencies` 的声明区间。这是 §0 R-2 在 B 阶段的直接延伸：
`^0.1.0` 是意图，`0.2.0` 是事实，账本只记事实。

## 9.4 红线在 B 阶段的落地

| 红线 | B 阶段实现 |
|---|---|
| R-1 只读 profile / lab | 写路径统一过 `assertSafeLifecyclePath`：lab 目录内、profile 目录内、`cordis.patch.yml`、含 `.dsh-market` → 直接拒绝并 exit 1。B 阶段新增的写动作只有两类：`data/lifecycle.json` 与 `out/*.md` |
| R-2 不猜 | 见 §9.3 的 `verifiedVersion` 口径；`--now` 只接受 `YYYY-MM-DD` / ISO-`Z`，不接受模糊日期 |
| R-3 权限四项 | `sync` 生成的片段里权限列固定 `待补｜待补｜待补｜待补`，不写「未知」、不留空 |
| 零依赖 / ESM / `node:` 内置 | `_lifecycle.mjs`、`lab-triage.mjs`、`_profile.mjs` 全部满足 |

## 9.5 复用裁决：抽出 `tools/_profile.mjs`（不是为了好看，是为了只有一份真相）

任务卡明确要求「复用 `lab-drift.mjs` 的 profile/package.json 读取与解析函数，**不要复制** 300 行重复逻辑」。
评估过三条路：

| 方案 | 结论 |
|---|---|
| A. `lab-triage.mjs` 里 `import '../tools/lab-drift.mjs'` | ❌ 不可能：`lab-drift.mjs` 是带顶层 `run()` 的 CLI（import 即执行、即吃 `process.argv`），且没有任何 `export` |
| B. 在 `lab-triage.mjs` 里另写一份精简解析（~300 行） | ❌ 正是任务卡禁止的复制；两份解析迟早口径漂移（A 阶段的 `ORPHAN_IN_NM` 收紧、lab 内部版本不一致告警都踩过） |
| **C. 把解析内核抽成 `tools/_profile.mjs`，两个 CLI 都 import** | ✅ **采纳**。逐行搬运、零行为变更，`lab-drift.mjs` 只留「对账判定 + 渲染 + 写报告 + CLI」 |

抽出清单（`lab-drift.mjs` 与 `lab-triage.mjs` 共用，全部逐行搬运、未改一字逻辑）：

| 组 | 导出 |
|---|---|
| 常量 | `DEFAULT_PROFILE`、`DEFAULT_LAB`、`REFERENCE_FIELDS`、`PERMISSION_TODO_MARKERS`、`NOT_INSTALLED_MARKERS` |
| 通用 | `CliError`、`cmp`、`describeFsError`、`readText`、`readJson`、`normalizeVersion`、`looksLikeSemver`、`sameVersion`、`isInside`、`normalizePkgArg`、`mdCell` |
| 表格解析 | `splitRow`、`isSeparatorRow`、`parseTables`、`findCol`、`extractBacktick` |
| profile | `listNodeModules`、`readPackageMeta`、`loadProfile`、`readInstalledVersion`（新增：单包实测版本，给 `note` / `promote --to adopted` 用） |
| lab | `ensureEntry`、`noteSource`、`noteCite`、`ingestLabTables`、`primaryVersionOf`、`findNotInstalledReason`、`permissionMarkersOf`、`loadLab` |

不变的部分：`lab-drift.mjs` 的四类判定、evidence 文案、md/json 输出契约、`--explain`、
`--write-report` 守卫、退出码**全部留在原文件**，语义未动（§1–§8 仍然完全适用）。

> 代价与风险（如实记录）：这次重构发生在 A 阶段已实跑通过之后，本会话 `pwsh` 不可用，**没能重跑
> A 阶段回归**。补偿手段：搬运是纯移动（新增的只有 `export` 关键字与一处 import 列表），
> 并逐行核对「谁还在用哪个符号」（见 §9.7 最后一项）。恢复终端后第一件事是跑 A.1 回归（README §5.1/§5.2）。

## 9.6 `due` 与 `sync` 的口径（不许含糊）

- **`due`**：`trial` 看 `trialUntil <= now`（含当天）；`adopted` 看「最近活动」距今 `>= 30` 天，
  最近活动 = `lastVerified`、最后一条 `evidence.at`、`since` 三者取最大。三者都没有 → 记「从未核对」。
  `due` **不改任何状态**：到期只是提示，结案永远要人跑 `promote`。
- **`sync`**：只有 `trial` / `adopted` / `dormant` 进建议片段。
  `candidate` 还在评估，写进 lab 已装基线就是污染；`rejected` 归 `out/rejected-<date>.md`，不进已装表。
- 两个动作的产物都只落 `out/`，**永不写 lab**（§0 R-1）。

## 9.7 B 阶段自检清单（改代码前先读）

- [ ] 改了迁移表？`data/schema.md` §3.2 与本文件 §9.2 是否同时改了？代码 `TRANSITIONS` 是否一致？
- [ ] 新增状态或字段？`SCHEMA_VERSION` 必须升版，且 `data/schema.md` 同步；
      旧账本要么能读、要么明确报 `SCHEMA_VERSION` 违反（不许静默猜测）。
- [ ] `adopted` 的 `verifiedVersion` 是否还能追溯到「profile 实测」？有没有偷偷用 `dependencies` 的声明区间？
- [ ] 有没有新增写动作？允许的只有 `data/lifecycle.json`、`out/*.md`；写 lab / profile 必须被守卫拒绝。
- [ ] 写盘是否仍是「先校验、再 tmp→rename」？失败时旧文件是否**逐字未动**？
- [ ] `sync` 是否只给建议、不自动改 lab？片段里权限四项是否写 `待补` 而不是「未知」？
- [ ] `--now` 是否仍要求确定日期（不接受 `now`/`today`/相对时间）？测试断言是否因此可复现？
- [ ] 改了解析逻辑？那必须改 `_profile.mjs`（一份实现），**不许**在 `lab-triage.mjs` / `lab-drift.mjs` 各写一份。
- [ ] 重构后是否核过每个被移走的符号还有谁在用（`describeFsError` / `readText` / `normalizeVersion` 等在
      `lab-drift.mjs` 已不再引用）？漏删会报重复声明，漏 import 会在运行时才炸。

---

# C.1 阶段 · 本地静态分析器（lab-analyze）

> 本节是 C.1（2026-11-15）的语义裁决。**§0 三条红线全部继承，一字未放宽。**
> 目标：A/B 阶段只会「对账」，答不了「这是干什么的 / 要什么权限 / 会不会抢别人的行 / 同轨有没有重复」。
> C.1 只回答这四个问题，仍然是**只读 + 不联网 + 零依赖**。

## 10.0 定位与边界

| 项 | 规定 |
|---|---|
| 输出 | 五段：①它是什么 ②权限四项（代码级）③row 争用 ④同轨重复 ⑤建议分类 + 结论草稿 |
| 只读 | 默认零写入；唯一写动作 `--write-report <path>`，守卫**复用** `_lifecycle.assertSafeLifecyclePath`（拒绝 profile / lab 目录内、`cordis.patch.yml`、含 `.dsh-market` 的路径） |
| 不联网 | 不查 npm registry、不读远程 README/仓库。本地没有这个包 → `localData: false` + 明写「本地无此包，本工具不联网」+ 提示 `--from-dir` |
| 不猜 | 读不到写 `null` / `unknown` / `unclassified`，并进 `warnings`；**绝不**填默认值、绝不按包名/README 反推 |
| 零依赖 | ESM，只用 `node:` 内置；**不引入 js-yaml**（见 §10.2） |

## 10.1 复用清单（拒绝第二份真相）

| 能力 | 来源 | 为什么不能重写 |
|---|---|---|
| profile / `package.json` / node_modules 顶层 / lab 表格解析 | `tools/_profile.mjs`（`loadProfile` / `parseTables` / `findCol` / `extractBacktick` / `readJson` / `readText` / `cmp` / `mdCell` / `normalizePkgArg` / `describeFsError`） | A 阶段已实跑验证的分类与降级口径（真孤儿、INDEX 优先、读不到写 null）全在里面 |
| 写目标守卫 / 原子写 / 账本读取 | `tools/_lifecycle.mjs`（`assertSafeLifecyclePath` / `writeAtomic` / `loadLifecycle`） | §0 R-1 与 B 阶段 §9.4 的红线是同一套，复制一份必然漂移 |
| 分类关键词 | `docs/LABELS.md` 的 `LABELS:JSON` 标记块 | 词表只应有一份；代码内置副本 = 两套分类。本文缺失/坏掉 → `unclassified` + 告警 |

**例外（新增而非复制）**：`cordis.patch.yml` 的行式解析器（§10.2）与权限四项扫描器（§10.3）在 A/B 阶段不存在，
C.1 首次实现，放在 `lab-analyze.mjs` 内。**不给 lab 类别列另写一套表格解析**——用 `_profile.mjs` 的 `parseTables`。

## 10.2 `cordis.patch.yml` 子集解析（读不懂就报告，不猜）

不引入 YAML 库。行式解析只认两种写法：

| 认的写法 | 含义 |
|---|---|
| `- insert:`（块写法，无值） | 进入 insert 块；块缩进 = 该行缩进 |
| 块内 `- id: <id>` | 一条行声明（`id` 必填） |
| 块内 `name: <module>` | 上一条 `id` 对应的模块名 |
| **顶层** `- id: <id>` | 覆盖（override）已有行，**不自插**——与 insert 分开记录，不许混为一谈 |

**读不懂就报告、绝不猜**（进 `unsupported`，再汇总成一条 warning，并原样进入 `--json` 的 `rowContention.unparsed`）：

- `groups:` / `group:` / `alias:` / `aliases:` / `when:` / `if:` / `extends:` 键；
- `!!js` 标签（DSH 的条件 disabled 表达式）与 `${…}` 模板；
- 流式写法：`- insert: [...]`、以 `[` / `{` 开头的值；
- insert 块里没有对应 `- id:` 的 `name:`、`id` 取值为空。

**本工具读不懂的代价要说清**：这些位置可能藏着行声明 → 所以它们会出现在告警里；
但本工具**不会**因此把某个 id 判成「不存在」以外的结论（不猜）。

`config:` / `disabled:` 等值型键属于「不进子集但不影响 id 判定」，只计数（`ignoredKeys`），不进告警。
patch 文件路径取 `package.json` 的 `dsh.bundle.patch`（字符串或字符串数组），没有则回退 `cordis.patch.yml`；
两者都读不到 → 该包「无 insert 行」+ 告警。

## 10.3 权限四项（代码级，不看 README）

四类正则（与任务卡逐字一致，大小写规则照原样）：

| 格子 | 正则 |
|---|---|
| 文件写 | `writeFile｜appendFile｜createWriteStream｜mkdir｜rename｜rmSync｜unlink｜copyFile｜writeFileSync` |
| 命令执行 | `child_process｜execSync｜execFile｜spawn` |
| 网络 | `fetch\(｜https?\.request｜undici｜WebSocket｜require\('net'\)｜from 'node:net'` |
| 凭据 | `credential｜api[_-]?key｜API_KEY｜\.credentials｜secret｜token`（`i`） |

**扫描范围**：该包目录下所有 `.js` / `.mjs`，逐行匹配。

- **跳过**：`node_modules/`（依赖代码不属本包）、隐藏目录（`.` 开头）、符号链接、>2 MiB 的单文件（记 warning）；
- **默认跳过测试**：`test/` `tests/` `__tests__/` `__test__/` `spec/` `specs/` 与 `*.test.js` `*.spec.js`
  （测试里的假写盘/假凭据会把结论顶到「全量」，属噪音）；要包含就显式 `--include-tests`；
- **不跳过 `dist/` / `lib/`**：发布代码就在那里，跳过 dist 等于不扫；
- 其它代码扩展名（`.cjs` `.ts` `.tsx` `.jsx` `.mts` `.cts`）**不扫**——单独计数并告警，写进已知限制。

**每类给**：命中总数 + 涉及文件数 + 前 3 处 `文件:行`。
**结论四档（取最高一档，只看原始计数，不推断意图）**：

1. `全量（含命令或凭据）` = 命令 > 0 **或** 凭据 > 0
2. `写入` = 上一条不成立且 文件写 > 0
3. `只读` = 上两条不成立且 网络 > 0
4. `无` = 四类全 0

**命中即报**：字符串常量里的模块名也会命中（例：`@txc…/dsh-plugin-manager` 的 `lib/index.js` 里有目录文本
`@deepseek-ai/dsh-subagent-spawn-in-process` → 命令执行 +1）。这是**刻意**的：权限扫描不做语义推断，
只要它「出现」，人就应该知道可能发生什么。

## 10.4 row 争用（本工具最重要的功能）

**数据源（全部本地）**：

| 侧 | 来源 | 说明 |
|---|---|---|
| 已装包 | profile `dependencies` ∪ `dsh.profile.bundles` 里**目录可读**的包各自的 patch | 逐包解析 insert / override |
| 官方包 | profile bundles 里 `@deepseek-ai/*` 开头的包名 = 官方（任务卡口径） | 官方 bundle 随应用发布、**不在 profile 内**（在 `app.asar` 里），纯 node 读不到目录 |
| 官方行 | `data/host-rows.json`（本地快照）或 `--host-rows <path>` | 见 §10.7；读不到 → `officialRowIds: null` + 告警 |

**三类结论**：

| 结论 | 判定 | 严重度 |
|---|---|---|
| `SELF_ID` | 本包 insert 的 id 列表（另列「本包覆盖的 id」） | — |
| `COLLIDES_WITH_HOST` | 本包 insert 的 id 命中官方行集合 | **danger**（官方那一行会被后声明的层顶掉） |
| `COLLIDES_WITH_PLUGIN` | 同一 id 被本包与**另一个第三方已装包**各自 insert（给双方包名） | **warn** |
| 覆盖（info，附加输出） | 本包顶层 `- id:` 改写了官方行/他人行的配置，但**没有**自插该 id | info（不进 danger/warn 判定） |
| 无冲突 | 以上皆不成立 | **ok** |

- **官方判定与证据强度**：`hostRows.confidence` = `confirmed`（`--host-rows` 显式给的）或 `likely`（内置本地快照）。
  两者都给 `danger`，但报告里必须写出 confidence 与数据来源——「不确定就标 likely」。
- **官方 row 数据读不到时不猜**：`collidesWithHost` 记空、`officialRowIds: null`，结论**最高只能到「观察」**
  （见 §10.6 的 verdict 阶梯），并写一条「官方 row 数据读不到→无法排除抢宿主行」的告警。
- **悬空覆盖**（顶层 `- id:` 指向没有任何 insert 声明者的 id）→ warning，且 `--scan-all` 里标 `dangling`。
- **`--scan-all` 矩阵**：行 = 至少有一个第三方包 insert 或覆盖的 row id；列 = `row id ｜ 声明它的包（可多个，含官方/第三方 + insert/仅覆盖 + 文件:行）｜ 是否官方 ｜ 严重度`。
  只被官方声明、无第三方介入的行不列出（只给计数 `officialOnlyRows`）。
  **一组争用都没有时不许伪造**：报告写「未发现 row 争用」并同时打印「官方 row N 条 / 第三方 insert M 条 / 矩阵 K 行」——
  M 为 0 就说明 patch 没解析进来，让人能自己判断，而不是把空表当成「真无冲突」。

## 10.5 同轨重复与建议分类

- **同轨 label 从哪来**：`suggestedLabel`（本文 §10.5 的 classify）作为轨；比较对象是 lab 的**类别列**
  （`installed.md` + `INDEX.md`）与 `data/lifecycle.json` 的 `label`，两者都先经 `docs/LABELS.md` 的 `alias` 归一化
  （例：`工具/市场`→`base`、`productivity（任务看板）`→`productivity`；不在 9 轨的 `embedded`/`toolchain` 原样保留）。
- **列出内容**：同 label 的 lab 条目（含类别、状态列原文、行号引用；另标 `inProfile` 用于区分「profile 实测已装」
  与「lab 登记但未在 profile」）、`adopted`（since / verifiedVersion / reason）、`rejected`（reason + 首条 evidence.ref）。
- **一条都没有** → 正文写「同轨无记录」（固定措辞，便于断言）。
- **`unclassified` 时不硬套**：按「无 label」处理，不给同 label 对比，并写一条告警。
- **classify 口径**（词表在 `docs/LABELS.md`，代码不留副本）：语料只取 `keywords + 包名 + description`；
  纯 ASCII 词按字母数字下划线边界匹配（`dev` 不命中 `device`），中文/带空格词按子串；命中数即分数，
  分高者胜，平手按 key 升序；0 命中 = `unclassified`。

## 10.6 输出契约与退出码

- **md（默认）**：标题 → 4 行元信息（generatedAt / profile / lab / 官方 row 数据来源与 confidence）→ 五段
  （`## 1.` … `## 5.`，字段与任务卡逐条对应）→ 告警（有才出）→ **最后一行固定**
  `verdict: <装|观察|不装> ｜ severity=<danger|warn|ok> ｜ permissions=<四档或 unknown> ｜ localData=<true|false> ｜ officialSource=<snapshot|explicit|...>`。
- **`--json`**：与 md 同构，顶层字段序固定
  `generatedAt → mode → profile → lab → labels → hostRows → identity → permissions → rowContention → sameTrack → suggestion → verdict → warnings`；
  `--scan-all` 为 `generatedAt → mode → profile → hostRows → scanAll → warnings`。
  md 里最后一行 `scan-all: … ｜ officialSource=…` 是给人看的镜像，字段断言请用 json。
- **verdict 阶梯（顺序固定，先命中先返回）**：

  | # | 条件 | 结论 |
  |---|---|---|
  | 1 | `localData: false`（本地无此包） | `观察`（无证据） |
  | 2 | `COLLIDES_WITH_HOST` 非空 | `不装`（抢宿主行） |
  | 3 | `COLLIDES_WITH_PLUGIN` 非空 | `观察`（互相抢行） |
  | 4 | 官方 row 数据读不到 | `观察`（抢宿主行无法排除） |
  | 5 | 权限档 = `全量（含命令或凭据）` | `观察` |
  | 6 | 权限档 = `写入` | `观察` |
  | 7 | 同轨已有 `adopted`（排除本包自己） | `观察` |
  | 8 | 其余 | `装` |

  `reason` ≤ 80 字（超出截断加 `…`），**每条 verdict 必须带**「本结论仅基于本地静态证据，未联网、未安装实测」。
- **退出码**：`0` 跑通（含「本地无此包」、含发现 danger —— 发现冲突不是失败）；`1` 参数 / 读取 / 拒绝写入异常。

## 10.7 官方 row 数据（`data/host-rows.json`）的出处与刷新

- **为什么要有这个文件**：官方 bundle 的 patch 在 `resources/app.asar` 里，**纯 node 读不了 asar 目录**
  （必须 Electron-as-node 或解包）。不联网又必须回答「这个 id 是不是官方的」，所以把**本机实读结果**存成快照。
- **当前快照的来源**（可复现）：`tmp/analyze.js` 在 Electron-as-node 下读
  `resources/app.asar/dsh/node_modules/@deepseek-ai/*/cordis.patch.yml` 生成 `tmp/analysis.json`；
  本文件只取其中 `bundles[]` 里包名以 `@deepseek-ai/` 开头者的 `rows[].rowId`（第三方包的行一律不进）。
  `hostVersion` 取自同一份 dump（`0.2.2-rc.1`）。
- **它会过期**：宿主升级后官方行会变。因此工具把 source 标成 `snapshot`、`confidence=likely`，并打在报告头；
  刷新方式二选一：重跑 dump 重新生成该文件，或运行期 `--host-rows <新 dump>` 覆盖（此时 confidence=`confirmed`）。
- **不含猜测**：快照里没有的 id 不会被推断成官方；`rowsWithoutPatchInDump` 记录「随附包里没有 patch 行」的包，
  它们贡献 0 个官方行，照实记录。

## 10.8 C.1 自检清单（改代码前先读）

- [ ] 新增写动作了吗？只允许 `--write-report`，且必须走 `assertSafeLifecyclePath`。
- [ ] 是否引入了第三方依赖（尤其 js-yaml）？零依赖是硬约束。
- [ ] patch 里遇到 `groups/alias/!!js/流式写法` 时，是**报告**还是**猜**？必须进 `unsupported`。
- [ ] 顶层 `- id:`（覆盖）有没有被误当成 insert？两者在 `SELF_ID`/`rowTable` 里必须分开。
- [ ] 官方 row 读不到时，verdict 是否被限制在「观察」？有没有偷偷给「装」？
- [ ] 权限扫描是否把 `dist/` 也扫了？测试目录是否默认跳过并计数？
- [ ] `--scan-all` 无争用时，是否同时打印官方 row 数与第三方 insert 数（否则无法区分「真无冲突」与「没读到」）？
- [ ] 分类词表是否仍只有 `docs/LABELS.md` 一份？代码里有没有偷偷留副本？
- [ ] md 最后一行是否仍是 §10.6 的固定格式？json 字段序是否没变？
- [ ] 新增字段有没有同步写进 README §5.5 的验收期望与 `fixtures/analyze-expected.json`？

---

# C.2 阶段 · 离线目录 + 三个模式修补（lab-analyze / _catalog）

> 本节是 C.2（2026-11-15）的语义裁决。**§0 三条红线全部继承，一字未放宽。**
> C.1 交付后用户实测暴出三个问题，C.2 只修这三件事，不扩功能面：
>
> | 用户原话（问题） | 根因 | C.2 的修法 |
> |---|---|---|
> | 「它干什么」抓到的是题头/多语言导航 | C.1 的 README 提取先把全文拼成一句再切，题头（`> **Every plugin finally speaks for itself**`）、徽章带、`Overview · Compatibility · …` 都被当成首段 | **§11.2** 先按行过滤，再从「第一句 ≥20 字」起取 1–3 句；并**不再只靠 README**（§11.1 三级优先） |
> | 没有「反向筛选」入口：我装了但不知道它们是干什么的 | C.1 只有「给包名 → 分析它」这一条路 | **§11.3** `--unknown [--only-installed]` |
> | 没有离线搜索：评估未装的包直接 `localData:false` 就完了 | C.1 不联网 = 没有目录可搜 | **§11.4** `--search <关键词>` + `data/catalog.json`（§11.5） |

## 11.0 离线目录从哪来（为什么不是「编一个词表」）

本机 `@txc2768651338/dsh-plugin-manager` 的 `lib/index.js` 里**内置**一份
`const CATALOG = { ["<模块名>"]: { name, desc, category }, … }`（本机 195 条，含中文名 + 一句话描述 + 分类），
末尾 `export { CATALOG, CATEGORY_LABELS, … }`。这是**本机已存在的真实数据**，不是我们编的：

- 抽取器 `tools/_catalog.mjs` **行式正则**解析它，**绝不 `import()`**——源文件 `import` 了
  `@deepseek-ai/dsh-typert-protocol` 等 peer 依赖，纯 node 下 `import()` 会直接炸；
- 解析不到任何条目 → **报错退出**（exit 1），**不输出空目录冒充成功**；部分条目解析失败 → 进 `unparsed` 统计（仍然照实打印）；
- 快照落 `data/catalog.json`，**只有显式 `--write` 才写**；`lab-analyze` 只读它。

`data/catalog.json` 的字段（`schemaVersion: 1`）：

| 字段 | 含义 |
|---|---|
| `source.package` / `source.version` | 源包名与**实测**版本（读源包 `package.json`，读不到写 `null`，不猜） |
| `source.path` | 源文件绝对路径（可复现） |
| `source.extractedAt` | 抽取时刻（ISO） |
| `source.hostVersion` | 宿主版本：取自 `data/host-rows.json` 的 `hostVersion`（同一份宿主快照，不另编一份） |
| `count` / `entries` | 条目数与 `{ "<pkg>": { name, desc, category } }` |
| `categories` | `CATEGORY_LABELS`（分类键 → 中文分类名）。**这是 C.2 对任务卡 schema 的扩展**，理由：`--search` 要能按「界面/沙箱与安全」这类中文分类名搜，而分类中文名只应有一份来源，工具里不留第二份词表（§10.1 同一条纪律） |
| `unparsed` | `[{ line, key, reason }]`：解析失败/重复键的条目（照实记录，不静默丢） |

刷新：`node tools/_catalog.mjs --write`；校验快照与源是否一致：`--check`（不一致 exit 1）。

## 11.1 数据源优先级（「它干什么」的答案从哪来）

**固定三级 + 一个兜底**，顺序不可调，报告里**必须写出 `identity.source`**：

| 级 | `identity.source` | 用什么 | 为什么排这个位置 |
|---|---|---|---|
| 1 | `catalog` | CATALOG 的 `name` + `desc` + `category` | 它是**中文人话**、一行讲清用途，正是用户要的答案；README 的题头/导航不再污染这一格 |
| 2 | `package-json` | `package.json` 的 `description` 原文 | CATALOG 未命中（多为新包/目录外）时，作者自己写的一句话最可靠 |
| 3 | `readme` | 修好的 README 正文提取（§11.2） | 前两者都空时才兜底；此时才需要从 README 里挖 |
| 4 | `unknown` | 无 | **明写「本机无任何可信描述」**，不猜、不拼凑 |

字段与语义（`--json` 里也能读到）：

| 字段 | 含义 |
|---|---|
| `identity.source` | `catalog` / `package-json` / `readme` / `unknown`（四选一，必填） |
| `identity.summaryText` | 首选「一句人话」：catalog 命中时是 `中文名：描述`；`unknown` 时为 `null` |
| `identity.displayName` | 中文名（仅 catalog 命中时非空） |
| `identity.catalog` | `{ available, origin, snapshotPath, count, hit, match, key, name, desc, category, categoryLabel, candidates, reason }` |
| `identity.summaryNote` | 需要人注意的一句话（`basename` 命中的含义提示 / unknown 的原因） |

**`identity.name` 仍是 `package.json` 的 `name`（包名）**，不改语义——中文名放 `identity.displayName`。
理由：C.1 的验收基线（`fixtures/analyze-expected.json`）与 §4.1 的评估卡字段对照都按「name = 包名」写；
把 name 换成中文名会让「这个包叫什么」在人机两侧含义漂移（Q-007）。

### 命中方式：`exact` 与 `basename`（不许混为一谈）

| `match` | 条件 | 报告里的写法 |
|---|---|---|
| `exact` | 包名 === 目录键 | `match=exact` |
| `basename` | 去掉 scope 的短名**唯一**命中（例：第三方 fork `@txc2768651338/dsh-plugin-manager` → 官方模块 `@deepseek-ai/dsh-plugin-manager`） | 必须写 `match=basename` + 命中的目录键；§1 还会打一行提示「中文名/描述取自该目录项，含义以上游实际行为为准」 |
| 未命中 | 短名命中 0 个 | `无（目录 N 条里没有它；无同名候选）` |
| 不猜 | 短名命中 ≥2 个 | 记未命中，并把候选列出来（`候选：…`），**不挑一个** |

`basename` 不是「同名」，是同名不同 scope：本机那支插件管家确实是官方 `dsh-plugin-manager` 的替代实现
（它的 CATALOG 里就写着「与本插件的行同 id 时由本插件替换」）。所以 `basename` 命中**可用**，但必须标注。

## 11.2 README 正文提取（修 C.1 的题头问题）

**先按行过滤，再取句。** 跳过的行（顺序无关，满足任一即整行丢弃）：

| # | 跳过 | 判据 |
|---|---|---|
| ① | 空行、`>` 引用行 | `trim()` 为空 / 以 `>` 开头（题头金句多为 `> **…**`） |
| ② | 徽章 / 图片行 | 含 `![` 或 `<img` 或 `shields.io` |
| ③ | 多语言导航 / 纯链接行 | 同一行按 `·` 切出 **≥3 段**且每段（去 markdown 后）≤ 28 字；或整行去掉 `[x](y)` 后只剩分隔符 |
| ④ | 纯标题行、目录行 | 以 `#` 开头；`- [` / `* [` / 有序列表 / 任意列表项 |
| ⑤ | HTML 标签行 | 以 `<!--` 开头，或整行是 `<div …>` / `</p>` / `<br>` / `<img …>` 这类标签 |
| 附加 | 表格 / 分隔线 / 元信息行 | `|` 开头、`---`、`Key: value`（< 40 字）——沿用 C.1 口径 |

**取句规则**：

1. 空行是段落分隔；段内多行用空格拼起来再切句；
2. 句切：中文 `。！？!?` 后切；英文只在「句点 + 空格 + 大写/数字」处切（`0.2.0` 不会被切开）；
3. 丢弃 < 12 字的碎片（`Problem.` / `MIT` 这种强调片段）；
4. 取**第一句句长 ≥ 20 字**作为起点，向后连续取 1–3 句；一句合格的都没有 → `readme.sentences = []` +
   `reason: no-body-sentence`（不拿短句凑数）。

**实测对照（本机两份真实 README，逐行推演过）**：

| 包 | C.1 抓到的（错） | C.2 抓到的（对） |
|---|---|---|
| `@txc2768651338/dsh-plugin-manager` | `Every plugin finally speaks for itself…` + `Overview · Compatibility · Install / Uninstall · …` + 多语言链接行 | `Settings → Plugins → Plugin Manager · 165 plugins cataloged, one click to toggle, notes edited in place.` 起（题头 `>`、徽章带、两条导航行全部被过滤） |
| `@michengai/dsh-skills-manager` | `# DSH Skills Manager` 标题 + `简体中文 · English · 日本語…` | `统一管理本机与项目技能，从 GitHub 安装、预览更新并备份回退` 起 |

**已知限制**：README 若把正文写在 `<div>` 中心化版式里，版式内的短句仍可能先命中；这类包的
`identity.source` 通常已经是 `catalog` / `package-json`，README 只作补充展示。工具不会为此「猜段落语义」。

## 11.3 `--unknown`：反向筛选（我装了但不知道它们是干什么的）

**扫描范围**

- `--only-installed`（**默认就是这个行为**）：`profile` 的 `dependencies ∪ dsh.profile.bundles`，
  去掉官方 scope（`@deepseek-ai/*`）。**不掺 `node_modules` 顶层的传递依赖**——那是 pnpm 提升上来的噪音（§4.2 同一条教训）。
- `--with-catalog`：在上一档之外，再对**离线目录全量**做一次覆盖比对（目录项自带 `name`/`desc`，
  缺的才是问题），输出 `catalogCoverage`（`total / described / missingName / missingDesc / notInstalled`）。

> **任务卡自相矛盾处的裁决（Q-008）**：任务卡写「`--only-installed`（默认）……；不加则连同 catalog 全量比对」。
> 两句互斥。C.2 按「`--only-installed` = 默认行为」实现（与验收命令 `--unknown --only-installed` 的期望一致），
> 全量比对改用显式 `--with-catalog` 表达；`--only-installed` 显式写上不报错（幂等）。

**「不可信」判定（P1，计入末行计数）**

```
CATALOG 未命中  AND  ( description 缺失  OR  description < 15 字  OR  description 含营销词 )
```

营销词表（固定，改表要改本节）：`a plugin`、`awesome`、`powerful`、`plugin for`（大小写不敏感子串）。

**分档（按严重度排序输出，同一档内按包名升序）**

| 档 | 条件 | 含义 | 计入末行 `unknown: N` |
|---|---|---|---|
| **P1** | 目录未命中 **且** 描述不可信（上一条判定） | 本机**真的说不清**它是干什么的 | **是** |
| **P2** | 目录未命中，描述够长且无营销词，但**没有中文** | 目录外的新包：能读英文就懂，但不算「中文人话」 | 否 |
| **P3** | 目录未命中，描述够长且含中文 | 目录外但有可用中文描述 | 否 |
| — | 目录命中 | 有中文名/描述，不用管 | 否 |

> 为什么把 P2/P3 也列出来：用户的真实问题是「我装了这些，但不知道它们是干什么的」。
> 只列 P1 会让本机 **13 个「目录外」的包**（7 个只有英文描述、6 个有中文描述）**整张名单隐身**——那正是他想看的清单。
> 而**末行计数只数 P1**，避免把「有描述但没中文」冒充成「说不清」。

**输出表格列（固定）**：`严重度 ｜ pkg ｜ 版本 ｜ catalog 有无 ｜ description 有无 ｜ 权限档 ｜ 建议动作`
（「权限档」复用 §10.3 的四档结论；包不在本机 → `未扫描（无本地代码）`）

**末行固定**：`unknown: <P1 数> 个包本机说不清它是干什么的`

**目录不可用时不猜**：`data/catalog.json` 与源文件都读不到 → **exit 1**（`无法判定 catalog 有无，不输出空结果`），
不把「目录读不到」当成「全部都没收录」。

## 11.4 `--search <关键词>`：离线搜索（评估未装的包）

- **搜什么**：离线目录条目的 模块名 / 中文名 / 描述 / 分类键 / **中文分类名**；
  另外并上「已装但目录外」的 `package.json` description（`source=installed`，单列一张表，不混进目录命中数）。
- **怎么匹配**：大小写不敏感；关键词按空白分词，**全部命中（AND）**才算匹配。
- **输出**：命中表格（`模块名 ｜ 中文名 ｜ 分类 ｜ 描述`）+ 末行 `匹配 N 条 / 目录共 M 条`；
  无命中时正文写 **`目录中无匹配`**，并在末行给 `匹配 0 条 / 目录共 M 条`。
- **不造假**：搜不到就说搜不到。不会因为「用户想找嵌入式」而编几个看起来相关的候选。
- **目录不可用 → exit 1**（同 §11.3）：没有目录就没有搜索，不返回空数组假装搜过了。
- **`profile` 不可用时**：目录搜索照跑，只在报告头写「已装包 description: 未读（profile 不可用）」。

## 11.5 写动作与只读边界（C.2 增补）

| 动作 | 允许？ | 说明 |
|---|---|---|
| `lab-analyze --write-report <path>` | ✅ | 唯一写动作，仍走 `assertSafeLifecyclePath`（拒绝 profile / lab 内、`cordis.patch.yml`、`.dsh-market`） |
| `_catalog.mjs --write` | ✅ | 只写 `data/catalog.json`（或 `--out` 指定路径）；不是 `lab-analyze` 的动作 |
| 写 profile / lab / asar / 源文件 | ❌ | 源文件只读；`_catalog.mjs` 也绝不改它 |
| 联网 | ❌ | 全部本地：目录来自本机构建产物，宿主版本来自 `data/host-rows.json` |

## 11.6 C.2 自检清单（改代码前先读）

- [ ] `_catalog.mjs` 有没有偷偷 `import()` 源文件？必须是行式正则（peer 依赖会炸）。
- [ ] 解析不到条目时是**报错**还是「返回空目录」？必须报错 exit 1。
- [ ] `data/catalog.json` 有没有被 `lab-analyze` 写过？那个文件只由 `_catalog.mjs --write` 写。
- [ ] `identity.source` 是否四级之一且必填？`unknown` 时是否明写「本机无任何可信描述」？
- [ ] `basename` 命中是否在报告里标了 `match=basename` + 命中的目录键？有没有当成 `exact`？
- [ ] README 提取是否**先过滤行**再取句？题头 `>`、徽章、`·` 导航行还会不会被当成描述？
- [ ] `--unknown` 的末行计数是否只数 P1？P2/P3 有没有被算进「说不清」？
- [ ] `--unknown` / `--search` 在目录不可用时是否 exit 1（而不是输出空结果）？
- [ ] `--search` 无命中时是否写「目录中无匹配」而不是编候选？
- [ ] 新增的 `categories` 字段是否写进本节 §11.0 与快照？`--write` 是否与 `--check` 口径一致？

---

# C.3 阶段 · 池子（三源）+ 目标入口（--goal）

> 本节是 C.3（2026-11-16）的语义裁决。**§0 三条红线全部继承，一字未放宽。**
> 用户原话：①目录只覆盖官方模块，第三方 **0 命中**；②没有「目标」入口——「我想学 X，市场上哪个插件合适」答不了。
> C.3 只补这两件事，并把「池子」的定义、边界、打分口径全部写死在这里。
>
> **本节取代 §11.4 的一处输出契约**：`--search` 的末行不再是 `匹配 N 条 / 目录共 M 条`，而是
> `匹配 N 条 / 池 M（registry A ｜ catalog B ｜ 已装 C）`（理由见 §12.2）。§11 的其它口径（README 提取、
> 数据源三级优先、`--unknown` 的 P1 分档）一字未改。

## 12.0 边界（比 C.2 多一条：loopback）

| 项 | 规定 |
|---|---|
| 谁联网 | **只有 `tools/_registry.mjs`，而且只连 loopback**。`lab-analyze` 本体永不联网（它只读快照） |
| loopback 白名单 | 只允许 `127.0.0.1` / `localhost` / `[::1]`；协议只允许 `http:`；端口必须显式；不带用户名口令 |
| 拒绝即报错 | 其它 host → `error: 仅允许 loopback` + **exit 1**。这条是安全边界：本工具**不是**通用 HTTP 客户端 |
| 不跟随重定向 | 3xx 直接拒绝（重定向可能把请求带出本机）；`https` 同理拒绝 |
| 响应上限 | 默认 **64 MiB**（`DEFAULT_MAX_BYTES`，C.3.1 从 8 MiB 提升）；`--max-bytes <n>` 可显式覆盖；**超限立即中止、不写半截快照**。响应体流式累加（分块 push → 一次 `Buffer.concat`） |
| 只读 | `lab-analyze` 对 registry **只读**；写 registry 的唯一动作是 `_registry.mjs --write` → `data/registry.json` |
| 不装不卸 | 两个工具都不装/不卸/不改 profile、不写外部 lab |
| 不伪造 | 拿不到 registry 就写「registry 不可用」；目标无匹配就写「池中无匹配」并给池子总数 |
| 零依赖 | ESM，只用 `node:` 内置（HTTP 用 `node:http`，不依赖全局 `fetch` 是否存在） |

## 12.1 registry 快照（第三方市场）—— 谁抓、抓什么、怎么校验

### 12.1.1 为什么抓取是一次性显式动作

用户真实需要的「第三方市场」数据在本机 `dsh-market` 服务的 `/dsh-market/registry` 后面。
但交互式分析器**绝不能变成联网工具**（那会立刻破掉 §0 R-2 与「不联网」承诺）。所以：

1. 用户**显式**跑一次 `_registry.mjs --url http://127.0.0.1:<port>/dsh-market/registry --write`（端口自己填，工具不猜）；
2. 结果落成 `data/registry.json`（快照，带 `source.fetchedAt` 与 `httpStatus`）；
3. `lab-analyze` 只读这份快照 —— 它连 loopback 都不连。

好消息：可复现、可 diff、可离线验收（夹具 `fixtures/registry-sample.json` 就是同一个 schema）。

> **C.3.1 实测修正**：本机市场返回的 registry 会带完整 README，响应**超过旧的 8 MiB 上限**，
> 于是「端口对、路由对」的正常抓取被误判成 `error: 响应超过 8388608 字节上限 → 中止`。
> 现在的口径：上限 64 MiB、流式累加、`--max-bytes` 可覆盖；超过 8 MiB 时额外打印
> `大响应: <bytes> 字节 ｜ 解析出 count <N> 条`，并在快照 `source.bytes` / `source.maxBytes` 里留证。

> **C.3.2 实测修正（本轮，按 dump 出来的真实响应重写）**：用户把市场原始响应存成
> `out/registry-raw.json`（**13,837,168 字节**，HTTP 200）。真实形状是**两层**：
>
> ```json
> { "registry": { "name":"awesome-dsh-plugin", "url":"…", "source":"…", "updated":"2026-11-13",
>                 "count":10974, "categories": { "<键>": {"en":"…","zh":"…"} × 23 },
>                 "plugins": [ … 10,974 条 … ] },
>   "hostVersion": "…" }
> ```
>
> 由此推翻 C.3.1 的三处假设（**都是假设错，不是市场错**）：
> ① **数组不在顶层**，而在 `registry` 容器里；② 数组键是 **`plugins`**（探测脚本 `r.plugins ?? …` 命中的就是它，
> 但代码**不写死**：运行时依次试 `plugins/entries/items/list/…`，再退化为容器里任意第一个数组值）；
> ③ **`description` 是对象 `{en, zh}`**，不是字符串 —— 旧归一化把对象当字符串处理，真实中文描述会被整段丢掉。
> 规模也从「预期 200–400 条」修正为 **10,974 条**（全量保留，不截断、不抽样）。

### 12.1.2 响应形状（运行时探测数组键，其余报错不猜）

| 形状 | 例子 | 判定 |
|---|---|---|
| `registry>plugins` | `{"registry":{"plugins":[ … ]},"hostVersion":"…"}` | **真实市场形状**：取容器里的数组；`shape` 记为 `registry>plugins` |
| `plugins-array` | `{"plugins":[ … ]}` | 顶层数组键（历史形状，仍支持） |
| `bare-array` | `[ … ]` | 数组本身 |
| `entries-array` | `{"entries":[ … ]}` | 顶层数组键（历史形状，仍支持） |
| 其它 | `{"rows":{…}}`、字符串、null、容器里也没有数组 | **报错**并列顶层键与容器键，exit 1 |

**数组键探测顺序**（`ARRAY_KEY_CANDIDATES`）：`plugins` → `entries` → `items` → `list` → `packages` → `results` →
**容器对象里任意第一个数组值**。实际命中的键写进快照 `source.arrayKey`，容器键写进 `source.containerKey`
（真实数据是 `registry`），`shape` 写成 `容器键>数组键`。这三项是**形状自证**，报告里必须能读到。

### 12.1.3 归一化字段（v2，按真实字段）

| 规范字段 | 认的源键（按顺序取第一个非空） | 说明 |
|---|---|---|
| `key` | （由工具计算）| 条目唯一键：`npm` > `owner/name` > `name`；用于去重与报告定位 |
| `name`（显示名） | `name` / `displayName` / `title` / `label` | 抽样校验前 20 条必须有它 |
| `owner` | `owner` / `author` / `publisher` / `maintainer` | 对象形态（`{name}`）取其中的名字 |
| `npm`（包名） | `npm` / `package` / `packageName` / `pkg` / `module` | 没有它 → 无法判定是否已装（不猜） |
| `version` | `version` | |
| `category[]` | `category` / `categories` / `group` / `kind` | **数组**（真实数据是数组，如 `["agi"]`） |
| `descriptionZh` | `description.zh` / `desc` / `summary` / `intro`（字符串含中文时落这里） | 中文描述原文 |
| `descriptionEn` | `description.en` / 同上（字符串无中文时落这里） | 英文描述原文 |
| `description` | （派生）| `descriptionZh ?? descriptionEn`，给只读一个字段的老调用点 |
| `capabilities[]` | `capabilities` / `capability` / `features` | 能力清单（参与打分 ×1.5） |
| `capabilityRedLines[]` | `capabilityRedLines` / `redLines` / `capabilityRisks` | **红线**：只展示，**不参与打分** |
| `capabilityCheckedAt` | `capabilityCheckedAt` | 上游核查时刻（原样保留） |
| `stars` / `downloads` | `stars` / `downloads` / `downloadCount` … | 数字；字符串数字转成数字；没有就 `null` |
| `install` | `install` / `installCmd` / `installCommand` | **原样保留**（可能是字符串命令，也可能是对象） |
| `page` | `page` / `details` / `homepage` / `link` / `site` | 市场详情页 |
| `url` | `url` / `repo` / `repository` | 仓库地址 |
| `added` | `added` / `addedAt` / `createdAt` / `publishedAt` | |

**取不到就是 `null`，不编造**。别名以外的一切键：

- 原样进该条目的 `extra`（值不变、键不变）；
- 键名列进该条目的 `unknownFields`，也并列进快照顶层的 `unknownFields`（并集，已排序）。

> **真实数据里的「非规范但有价值」字段**：`starsCheckedAt / downloadsStart / downloadsEnd /
> downloadsCheckedAt / icon / screenshots` 不在本表内 → 进 `extra` 并出现在 `unknownFields`
> （真实快照的 `unknownFields` 通常是 5–6 个，属正常，不是异常）。
> 它们**不参与搜索/打分**（不认识的字段不拿来算分，见 §9「已知限制」）。

**幂等**：对已经是 v2 规范形态的条目再归一化一次，`extra` / `unknownFields` 原样带过去（不会套娃成
`extra.extra`）。`loadRegistry` 用一条**快路径**实现这一点：条目已是规范形态就直接复制（10974 条时不能每次重跑别名表），
但只要出现一个规范外的键就退回慢路径（保证不静默丢字段）。

**malformed**：该条根本不是 JSON 对象，或 `key/name/npm/owner/url/page/description` **全缺** →
进 `malformed`（附 `index` / `reason` / `raw` 原文），不塞进 `entries`、也不改写成一个空条目。

### 12.1.4 快照 schema（`schemaVersion: 2`）

| 字段 | 含义 |
|---|---|
| `schemaVersion` | 固定 `2`；**读 v1 快照 → 报版本不符**（v1 把 `description` 当字符串理解，用它会静默丢字段） |
| `source.kind` | `http`（抓取）或 `file`（`--from-file` 导入） |
| `source.url` | 抓取地址（`file` 时为 `null`）——**报告里必须写出来** |
| `source.fetchedAt` | 抓取/导入时刻（ISO）。**不是**数据的 `updated`（市场不给我们就不编） |
| `source.httpStatus` | HTTP 状态码（`file` 时为 `null`：导入不知道抓取时的状态码） |
| `source.bytes` | 响应体字节数（`file` 时为文件字节数） |
| `source.hostVersion` | **C.3.2 起**：响应顶层（或容器）给的 `hostVersion`；没有就 `null`（真实数据有） |
| `source.shape` / `source.arrayKey` / `source.containerKey` | 形状自证：`registry>plugins` / `plugins` / `registry` |
| `source.registry` | 容器自带的元信息：`{name,url,source,updated,declaredCount,categoryCount}`（`count` 是市场自报条数，与实读条数对照） |
| `source.maxBytes` | 本次抓取用的响应上限（默认 `67108864`）；`file` 来源为 `null` |
| `count` | `entries` 条数（**malformed 不计**） |
| `entries` | 归一化条目数组（§12.1.3），**全量保留**（真实数据 10,974 条，不截断、不抽样） |
| `malformed` | `[{index, reason, raw}]` |
| `unknownFields` | 未知字段名并集（排序） |

**条目 > `PRETTY_MAX_ENTRIES`（500）时以紧凑 JSON 落盘**：10974 条 × 2 空格缩进是几十 MB，
既没人读得动也浪费仓库；快照是机器读的，格式不参与语义（`--check` 只校验结构）。
少条目（夹具、手写）仍是缩进好看的两空格 JSON。

**解析出 0 条 → 抛错 exit 1，绝不写空快照**。满分的判据是「`--check` 通过 + `count > 0`」，不是「命令没报错」。

### 12.1.5 `--check` 校验什么（v2）

`node tools/_registry.mjs --check [--snapshot <path>]`（只读、不联网）逐项校验：

1. `schemaVersion === 2`（**v1 快照一律失败**：旧夹具 `fixtures/registry-sample.json` 就是这条负例）；
2. `source` 是对象：`url / fetchedAt / httpStatus / bytes / hostVersion` **五个键必须存在**（值可为 `null`）；
   `kind ∈ {http,file}`、`fetchedAt` 非空字符串；`maxBytes` 存在时必须是数字或 null；`arrayKey` 存在时必须是字符串或 null；
3. `entries` / `malformed` / `unknownFields` 都是数组；
4. **`count === entries.length`** 且 `entries.length > 0`；
5. **抽样**：前 `CHECK_NAME_SAMPLE`（20）条必须有非空 `name`；
6. 每条 `entries[i]`：键只能是 v2 规范字段 + `unknownFields` + `extra`；`category / capabilities /
   capabilityRedLines / unknownFields` 是数组、`extra` 是对象、`stars / downloads` 是数字或 null；
   至少有一个可用字段。

任何一项不满足 → 打印前 20 处问题并 exit 1（不静默通过）。`--snapshot` 只影响 `--check`，
**不改变 `--write` 的目标**（写目标永远是 `data/registry.json`）。

### 12.1.6 刷新与降级

- 刷新：重跑 `--url … --write`（或 `--from-file <raw.json> --write`）；市场升级后快照**不会自动更新**
  （报告头永远写 `origin` + `source.fetchedAt` + `source.hostVersion`）。
- `lab-analyze` 读不到快照 / 快照为空 / schemaVersion 不符 → `registry.available:false` + 原因：
  - `--goal` / `--search`：**降级**（该源计 0 条 + 告警「这不代表市场里没有该插件」），继续用 catalog/已装；
  - `--unknown`：同样降级（仍按 CATALOG + description 判定），但告警写明「本次只按 CATALOG + description 判定」。
- 与 `catalog` 的区别（刻意不对称）：**没有目录就没有搜索**（§11.4 → `--search`/`--unknown` exit 1），
  但**没有市场快照仍能搜**（registry 只是三源之一，缺它不该让整个入口瘫掉）。

### 12.1.7 数据源优先级（C.3.2 升一级：`registry` 变成第 1 级）

起因：真实市场里 `description.zh` 是**完整中文描述**，还带 `capabilities` 与 `capabilityRedLines`
（例：`milancat-bot` 的 redLine 写着「HTTP 路由没有 DSH 的访问检查，可创建智能体并派发任务」）。
这些信息**比官方目录的中文名 + 一句话更贴近「它到底是什么、会不会越界」**，所以优先级整体抬一级：

```
1) registry        第三方市场快照命中且有描述（第 1 级｜新增）
2) catalog         官方模块目录命中（原第 1 级）
3) package-json    已装包 package.json 的 description（原第 2 级）
4) readme          README 正文兜底（原第 3 级）
5) unknown         都没有 → 明写「本机无任何可信描述」（原第 4 级）
```

| 级别 | 命中条件 | `identity.source` | 报告里给什么 |
|---|---|---|---|
| 1 | registry 命中 **且** `descriptionZh` 或 `descriptionEn` 非空 | `registry` | `descriptionZh` **原文**（无 zh 则给 en 并标 `lang:en`，**不做机器翻译**）+ `capabilities` + `capabilityRedLines` + `capabilityCheckedAt` + `stars/downloads` + `category` |
| 2 | catalog 命中 | `catalog` | 中文名 + 一句话描述 + 分类（含 `match=basename` 的说明） |
| 3 | 已装包 `description` 非空 | `package-json` | 原文 |
| 4 | README 提得出正文句 | `readme` | 修好的正文前 3 句（§11.2） |
| 5 | 都不成立 | `unknown` | 「本机无任何可信描述」+ 告警 |

**边界（与 §12.2.3 同一口径）**：`registry 有条目但没有描述` ≠ `registry 有描述`。
命中但 `descriptionZh/descriptionEn` 皆空 → **不算第 1 级**，继续往下落，并在告警里写明
「registry 有该条目但 description 皆空」。

强制要求：报告 §1 必须能同时看到 `source` 与 `描述语言`（`zh`/`en`/`unknown`），
以及 `registry 命中` 一行（命中键 / `match` / 描述语言 / capability 条数 / redLines 条数）。


## 12.2 三源池：`--search` 与 `--unknown` 的新口径

> **范围说明**：registry 只参与 `--search` / `--unknown` / `--goal` 三个入口。
> 单包静态分析（给包名 或 `--from-dir`）的 `identity.source` 仍是 §11.1 的三级优先
> （`catalog` → `package-json` → `readme` → `unknown`）——那一段的语义 C.3 一字未改。

### 12.2.1 池子与优先级（固定，不可调）

```
registry（第三方市场快照）  >  catalog（官方模块目录）  >  已装包 description
```

- 同一个包名出现在多源 → **保留高优先源**，低优先源记进该结果的 `alsoIn`（信息不丢、也不重复计分）；
- 已装状态以 profile 实测为准（`dependencies ∪ dsh.profile.bundles` **且** 目录存在）——
  registry/目录条目只要同名就算 `installed:true`；
- **池子总数** `M = A + B + C`（A=registry 条数、B=catalog 条数、C=已装第三方包个数）。
  去重后的条数单独给 `pool.mergedUnique`（两者不等是正常的：一个包可能同时出现在两源）。

### 12.2.2 `--search` 的输出契约

- 匹配：大小写不敏感；关键词按空白分词，**全部命中（AND）**；
  匹配面 = 显示名 ∪ 包名 ∪ `descriptionZh` ∪ `descriptionEn` ∪ `capabilities` ∪ `keywords` ∪ 分类（含中文分类名）。
- 打分：命中字段加权求和（§12.3.2 同一套权重，**中文描述 / capabilities ×1.5 向上取整**）；
  `--search` **不套** §12.3.6 的三条门槛（单关键词查询本来就只有一个词，套门槛会永远 0 命中）。
- 排序：先按来源优先级，再按得分降序，最后按包名升序。
- 表格列（C.3.2 增列）：`包名 ｜ 名称 ｜ 来源 ｜ stars ｜ downloads ｜ redLines(有/无) ｜ 得分 ｜ 描述 ｜ 已装`
  （`已装` 对「registry 条目没有 npm」的情况写 `unknown（registry 条目没有包名）`）。
- 报告头固定给：数据源优先级一行、registry 的 `count / shape / arrayKey / hostVersion`、`elapsedMs`。
- 末行固定：`匹配 N 条 / 池 M（registry A ｜ catalog B ｜ 已装 C）`。
- **无命中**：正文写 `池中无匹配`，并给「最接近的 3 条」（**按 2 字片段重合度**，标题里明写「不是匹配」）；
  一条都没有片段重合 → 写「不硬凑候选」。末行仍是上面那句（N=0）。
- `catalog` 不可用 → exit 1（§11.4 不变）；`registry` 不可用 → 降级 + 告警。
- JSON 字段：`results[]`（带 `source` / `installed` / `alsoIn` / `descriptionZh` / `descriptionEn` /
  `capabilities` / `capabilityRedLines` / `stars` / `downloads` / `score` / `matched[]` 词级明细）、
  `matchBySource`、`pool`、`closest`、`weights`、`rule`、`elapsedMs`、`performance`；
  为兼容 C.2 断言保留 `catalogMatchCount` / `catalogTotal` / `registryMatchCount` / `installedMatchCount`。
- `stars / downloads` **只展示、不参与打分**（不联网核实，也不假装它们是质量证据）。


### 12.2.3 `--unknown` 的判定（加一档 registry）

```
「说不清」= registry 没有描述（未命中，或命中但 description 为空）
           AND CATALOG 未命中
           AND ( description 缺失 OR < 15 字 OR 含营销词 )
```

分档（顺序固定，同档按包名升序）：

| 档 | 条件 | 计入末行 |
|---|---|---|
| `—` | registry 有描述 / CATALOG 命中 | 否 |
| **P1** | 上面那条「说不清」 | **是** |
| P2 | 池外，描述够长且无营销词，但**没有中文** | 否 |
| P3 | 池外，描述够长且含中文 | 否 |

- **`registry 有条目但没有描述` ≠ `registry 有描述`**：这种条目照旧往 P1/P2/P3 走（差一个字都不算覆盖）。
- **`descMismatch`**：registry 描述与本地 `description` **都非空**且「去空白后字面不同」→ 标 `true`。
  报告里把两段并排列出（`registry（名称/描述）` 列 + `description 有无` 列），**不做语义判断**
  （「意思不同」不是本工具能断的）。
- 末行不变：`unknown: <P1 数> 个包本机说不清它是干什么的`。

## 12.3 `--goal <text>`：分词 / 打分 / 输出 / 无匹配

> **本入口是「池内降噪」，不是语义搜索**：它不具备世界知识，只能匹配字面；召回候选请配合模型搜索/市场目录，把候选名交给本工具做取证与打分。
>
> 这句话是 C.3.1 的口径声明，**三处同文**：本节首行、`--goal` 报告头部（md 引用块 / json `notice` 字段）、
> `tools/lab-analyze.mjs --help` 的 `--goal` 段。改口径就三处一起改，别只改一处。

### 12.3.1 分词（可复算，不黑盒）

1. 小写化；按字符分成「中文段 / 英文段 / 分隔符」，分隔符切断；
2. **中文段**：长度 2–4 的**滑窗**（任务卡口径）；窗口里**含任意停用字**就丢弃；此外整段（若不含停用字）也作为「原有词」保留；
3. **英文段**：按空白/连字符/下划线切（`dsh-market` → `dsh` + `market`）；命中去停用词表就丢弃；
4. **噪声词丢弃（C.3.1，见 §12.3.6 规则 D）**：滑窗词在**整个池子**的 `name+description+keywords` 里出现 0 次
   **且**长度 < 4 → 从分词表里丢弃（例：「接抖音直播做预管理」产出的 `接抖`、`接抖音`）；
   长度 ≥4 的词即使池里没有也**保留**（`接抖音直` 这类词本身就是「池里没有这个概念」的证据）；
5. 去重（保序），上限 64 个词。被丢弃的原词照旧出现在报告的「丢弃的噪声词」与 json `tokensDropped` 里，
   **不静默消失**；若过滤后一个词都不剩 → `error: --goal 分词后没有可用词…` + exit 1（不返回假的「0 候选」）。

中文停用字（单字，落在窗口里就丢）：
`的了着过是我你您他她它们想需要能会可怎吗呢吧啊和与及或把被给对从向到在就都也还很太多个一请帮找没有这那些其之于为以而且但如所谁啥哪做让使得`

英文停用词：`the a an to for of and or with without i me my we you want need learn learning how do does is are be by on in at it this that from into about some something please help`。

> **取舍（宁严不宽）**：宁可少一个词，也不让「我想/一个/怎么/能做」这类壳词参与打分。
> 代价：真词里含停用字时会被一起丢掉（例：`目的`、`标的`）——这是可解释的损失，不是隐藏偏差。

### 12.3.2 打分公式（C.3.2 定版，可解释，不是推荐算法）

对池子里每条候选，逐词判断是否出现在**六个**字段（**子串命中，大小写不敏感**）：

```
score = 3 × |词 ∩ 名称（显示名 ∪ 包名）|
      + 3 × |词 ∩ descriptionZh|      ← ⌈2 × 1.5⌉（中文描述权重 ×1.5 向上取整）
      + 2 × |词 ∩ descriptionEn|      ← ×1
      + 3 × |词 ∩ capabilities|       ← ⌈2 × 1.5⌉（能力清单权重 ×1.5 向上取整）
      + 2 × |词 ∩ keywords|
      + 1 × |词 ∩ category|
```

| 字段 | 基数 | 系数 | 生效权重 |
|---|---|---|---|
| `name`（显示名 ∪ 包名） | 3 | ×1 | **3** |
| `descriptionZh` | 2 | **×1.5 向上取整** | **3** |
| `descriptionEn` | 2 | ×1 | **2** |
| `capabilities` | 2 | **×1.5 向上取整** | **3** |
| `keywords` | 2 | ×1 | **2** |
| `category` | 1 | ×1 | **1** |

- 同一个词在同一个字段里**只计一次**；命中几个字段就累加几个权重；
- **为什么只给中文描述与 capabilities 加 ×1.5**：真实市场里 `description.zh` 是完整中文描述、
  `capabilities` 是能力清单，两栏信息量最大；英文描述保持 ×1 是为了**同一段中英双语描述不被算两遍高分**；
- **通用词降权（C.3.1 不变）**：词的原始权重若属于 `GENERIC_TERMS`（§12.3.6），则实际权重 = `⌊原始权重 × 0.5⌋`；
  运算顺序是「**先加字段权重（含 ×1.5 取整），再对整个词的权重 ×0.5 向下取整**」；
- 排序：`score` 降序 → 包名升序（同分可复现）；
- 表里给每个词标出它自己的权重**和命中字段**（`嵌入+5（名称/中文描述）`、通用词写 `管理+1（通用）`），
  末尾给 `Σ总分` —— 用户能一眼看出分数是怎么来的、`×1.5` 体现在哪。


### 12.3.3 输出契约

表头固定**十一列**（C.3.2 增列 `stars / downloads / redLines`）：
`包名 ｜ 名称 ｜ 来源 ｜ 命中词 ｜ stars ｜ downloads ｜ redLines ｜ 已装 ｜ 同轨已有 ｜ 权限 ｜ 下一步`

| 列 | 取值 |
|---|---|
| 来源 | `registry` / `catalog` / `installed`，低优先源记作 `（catalog 亦有）` |
| 命中词 | `嵌入+5（名称/中文描述）、入式+3（能力）｜ Σ15`（最多列 6 个词，多出来的写「另 N 个」；通用词标（通用）） |
| stars / downloads | 市场快照里的数字；`null` 就写 `null`（**不参与打分**，不联网核实） |
| redLines | `有（N）` / `无`（来自 `capabilityRedLines`；有的话装前必须逐条读） |
| 已装 | `true` / `false`；registry 条目没有 npm → `unknown（registry 条目没有包名）` |
| 同轨已有 | 用 §10.5 的 classify 得到轨，再列 lab 类别列 + lifecycle 里同轨的其它条目（最多 3 条）；没有就 `无（轨=…）` |
| 权限 | **已装 → §10.3 的四档结论**；**未装 → 固定 `unknown（未安装，本地无代码）`** |
| 下一步 | 已装 → `用 lab-drift/--explain 复核`；未装 → `装前请人工确认权限，本工具不联网` |

末行固定：
`goal: N 候选 / 池 M（registry A ｜ catalog B ｜ 已装 C）`
（`N` = **过门禁的候选总数**；表只列 top 10，标题写 `候选（top 10 / 命中 N）`）

报告头固定多写四行（C.3.2）：**匹配面**（六个字段）、**权重表**（基数 × 系数 = 生效权重）、
**通用词**、**`elapsedMs`**（含索引条数 / 建索引耗时 / 单遍扫描耗时 / 预判剪枝条数）。


**C.3.1 增补两栏/两行（同一份 md：候选表之后）**：

- `### 未过门槛（有命中但**不是匹配**）— 共 K 条，列前 3 条`：列 `包名 ｜ 名称 ｜ 来源 ｜ 得分 ｜ 命中词 ｜ 未过门槛原因 ｜ 已装`；
  这是「有分但没过 §12.3.6 门禁」的条目，**不进候选表**，但也不让它们无声消失；
- 报告头部多一行「丢弃的噪声词」、两行「通用词 …」「相关性门禁 …」，以及口径声明引用块（本节首行同文）。

### 12.3.4 无匹配怎么写

- 正文第一行写 `池中无匹配`，紧接一句池子构成（`池 M 条：registry A ｜ catalog B ｜ 已装 C`）；
- C.3.1：若目标里有长词而候选一条都没命中长词 → 明写 `未命中目标核心词（长词：…）`（不装作匹配上了）；
- 再列「最接近的 3 条」：**优先**用「有词命中但没过门禁」的条目（给 `得分 / 命中词 / 为何不算匹配`，
  标题明写「**不是匹配**」）；一条有词命中的都没有 → 退回按**目标词 2 字片段**在候选文本里的重合数排序；
- 一条都没有片段重合 → 写「无 —— 池里没有任何条目与目标词有 2 字片段重合，不硬凑候选」；
- 末行仍给 `goal: 0 候选 / 池 M（…）`。**「无匹配」永远不是黑箱**：要么给候选的命中词，要么明说不凑。

### 12.3.5 为什么这不是语义检索（已知限制，写在这里而不是事后解释）

- 没有中文分词词典、没有词向量、没有 embedding；滑窗 + 子串就是全部「语义」；
- 通用词（`管理`、`同步`、`日志`）曾把一堆官方模块带进候选表 —— C.3.1 起改为「×0.5 降权 + 单独命中不成候选」
  （§12.3.6），但**噪音不会因此归零**：短词的偶然重合仍在，命中词列会继续把它暴露出来；
- 术语不一致时搜不到（`嵌入式` vs `嵌入`、`预管理` vs `预审`）：本工具不猜同义词表（那需要词表，而词表会腐烂）。
  **正确用法**：先用模型搜索/市场目录召回候选名，再把候选名交给本工具做取证与打分。

### 12.3.6 C.3.1 相关性门禁 / 通用词 / 噪声词（三条规则的唯一出处）

> 起因（用户实测）：`--goal "接抖音直播做预管理"` 返回 8 条候选，命中词**全是「管理」**，
> 根本词「直播 / 抖音」零命中；`--goal "我想学嵌入式，从连板子到画 PCB"` 里 `dsh-library`
> 只是撞了「本地**嵌入**零模型下载」的字面巧合。**没有相关性下限**就是缺陷，不是「可解释的噪音」。

**规则 B：三条门槛（缺一即不入候选表）**

| 门槛 | 条件 |
|---|---|
| ① 长词 | 命中至少 1 个**长词**：中文 ≥3 字，或英文单词长度 ≥5 |
| ② 词数 | 命中 ≥2 个**不同**词 |
| ③ 总分 | `score ≥ 6` |

三条全不满足 → **不进候选表**（`matchedTotal` 不计它），但仍进「最接近」栏，并写明未过门槛的原因。

**规则 C：通用词降权 + 停用**

`GENERIC_TERMS` = `管理 / 设置 / 任务 / 服务 / 系统 / 配置 / 面板 / 工具 / 助手 / 插件 / 功能 / 支持 / 自定 / 接口 / 数据`（15 个）

- 命中权重 `⌊原始权重 × 0.5⌋`（向下取整）：名称+desc = 5 → 2；仅 desc = 2 → 1；仅 category = 1 → 0；
- **单独命中不足以成候选**：即使总分过了 6 也不算，**除非同时命中一个长词**；
- 实现上不会自相矛盾：本表 15 个词全是 2 字 → 按规则 B① 永远算不上长词。

**规则 D：噪声词丢弃**

- 判定语料 = 整个池子的 `显示名 + descriptionZh + descriptionEn + capabilities + keywords`
  （**不含**包名与 category：包名里的 `dsh`/`plugin` 会让任何碎片词看起来都「出现过」；
  C.3.2 起 `capabilities` 也算语料 —— 能力清单是真实市场里的大段文本）；
- 丢弃条件 = **命中条目数 0** **且** 长度 **< 4**；长度 ≥4 的词保留（哪怕池里没有）；
- 判定只看「0 与非 0」（走索引的 `noiseHay.includes`，命中一条就 break）；
  报告里 `tokensDropped[].entries` 记的是**命中条目数**（不是出现次数），别读错；
- **代价（写在明处，不事后解释）**：3 字词若只出现在**包名**里、没出现在 name/描述/capabilities/keywords，
  会被当成碎片丢掉（例：池里没有 registry 快照时，`嵌入式` 在 catalog 的 `name+desc+keywords` 里 0 条
  → 被丢，只剩 `嵌入`）。取舍理由：噪声碎片（`接抖`）与真词（`嵌入式`）在长度上无法可靠区分，
  而「宁可少一个词」比「拿 2 字碎片凑分」更不容易骗人；
- 被丢弃的词写进报告「丢弃的噪声词」与 json `tokensDropped`（含 entries / length / reason）；
- 过滤后词表为空 → `error:` + exit 1。

### 12.3.7 性能（C.3.2 硬要求：10974 条 × 多次匹配）

真实快照是 **10,974 条**（不是 C.3 预期的 200–400 条），所以「每次匹配都重拼语料」不能再接受。

| 项 | 规定 |
|---|---|
| 索引 | **启动时一次性**建好：每条拼成一个小写串 `hay` + 预存 `tokens` 集合 + 六个字段各自的小写串 + `noiseHay` |
| 扫描 | `--search` 与 `--goal` 都**单遍扫描**索引；噪声词过滤 / 打分 / 「最接近 3 条」全部复用同一份索引 |
| 剪枝 | 词按**长度降序**排（`orderedTokens`）；`--search` 首个词不中即 `break`；`--goal` 先做「有没有任意一个词命中」预判，未命中直接跳过（不计入 `scoreCandidate`） |
| 计时 | 报告里必打 `elapsedMs`（md 头部一行 + json 字段），并分开给 `indexBuildMs` / `scanMs` / `prunedByPrecheck` |
| 预算 | **目标 < 2000 ms**；若实测 > 4000 ms → 必须继续优化（更短的词提前剪枝、按长度分组扫描），并在回传里如实报数 |
| 禁止 | 为了「快」而抽样（只扫前 N 条）、截断 entries、或跳过 registry 源 —— 那是改语义，不是优化 |

> 口径：数字只能来自**实测**。没有终端时写「未实测」并给测算依据（操作数量级），
> **不许**编一个毫秒数当结果（与 §0 R-2「不伪造」同源）。


**规则 E：文档口径**（本节首行 + 报告头部 + `--help`，三处同文，见本节开头引用块）。

**夹具口径的同步修正（旧期望与新门槛冲突处，照实记一笔）**：

| 夹具用例 | C.3 旧期望 | C.3.1 新期望 | 为什么冲突 |
|---|---|---|---|
| `fixture-goal-embedded` | 3 候选；`candidates[2]` = `@deepseek-ai/dsh-library` Σ2；末行 `goal: 3 候选` | **2 候选**；`dsh-library` 落进 `belowThreshold`（Σ2，仅「嵌入」命中 desc）；末行 `goal: 2 候选` | ①只命中 1 个短词、②词数 1<2、③Σ2<6 → 三条全不满足 |
| `fixture-goal-embedded` 的 `tokens` | 10 个（含 `学嵌`/`连板`/`板子`/`连板子`） | **5 个**（`嵌入`/`入式`/`嵌入式`/`学嵌入式`/`pcb`），另 5 个进 `tokensDropped` | 规则 D：池内出现 0 次且长度<4 |
| `fixture-goal-live` | 6 候选；top1 Σ32；末行 `goal: 6 候选` | **1 候选**（`lab-fixture-live-guard` Σ30）；另 5 条只撞「管理」→ `belowThreshold`；末行 `goal: 1 候选` | 通用词 ×0.5（管理 3→1、5→2）让「管理-only」条目连 Σ6 都够不着，且规则 C 硬否决 |
| `real-goal-live`（真实环境） | `matchedTotal >= 5`（全是「管理」） | 候选 **0–2 条**；`管理`-only 条目全部落进「最接近（不是匹配）」；正文可能写「池中无匹配」+「未命中目标核心词」 | 同上 —— 这正是用户要的效果 |
| `real-goal-embedded`（真实环境）的 `tokens` | 10 个 | 约 **3 个**（`嵌入`/`学嵌入式`/`pcb`）：没有 registry 快照时 `嵌入式`/`入式` 在 catalog 的 name+desc+keywords 里 0 次 → 规则 D 丢弃（若本机已装包描述里含这些词则保留，以实际输出为准） | 同上；「池内降噪」的含义就是「同一个目标，池子不同，词表不同」 |
| `real-goal-live`（真实环境）的 `tokens` | 12 个 | 约 **3 个**（`管理`/`接抖音直`/`抖音直播`）：其余 9 个 <4 字碎片在 catalog 里 0 次 → 丢弃，**于是本机这一问几乎必定 0 候选** | 规则 C + 规则 D 叠加 —— 用户实测的「8 条噪声」在这一步就被拆掉了 |

> 夹具文件：`fixtures/goal-expected.json`（C.3.1 段已按上表改写）。

### 12.3.8 C.3.3 命中分层 / 词表诊断 / idf（取代规则 B，保留规则 C）

> 起因（用户实测）：`--search` 已能在 **10,974 条**真实池子里捞出内容，但 `--goal` 结果过小。
> 根因**不是门槛太严，是词表对不齐**：`"我想学嵌入式，从连板子到画 PCB"` 的有效词只有
> `嵌入/入式/嵌入式/连板/板子/pcb`（其中只有 `嵌入式` 算长词），而市场里同类条目写的是
> `PCB / EDA / 单片机 / STM32 / 固件` —— 一个都不重。**不造同义词词典**（词表会腐烂）。

**规则 B′：分层（取代 §12.3.6 规则 B 的三条硬门槛）**

| 层 | 判定 | 展示 |
|---|---|---|
| 强匹配 `strong` | `覆盖率 ≥ 0.5` | 全部（md 表内 ≤ 20 行） |
| 弱匹配 `weak` | `0.2 ≤ 覆盖率 < 0.5` | 全部（md 表内 ≤ 20 行） |
| 仅字面命中 `literal` | `覆盖率 < 0.2` **或** 只命中通用词 | md 折叠段，**≤ 10 条** |

- **覆盖率 = 命中有效词数 / 有效词总数**；分母 = 噪声过滤后的 `tokens.length`（报告头「分词（N 个）」）。
- **取消**规则 B 的三条（长词 / ≥2 词 / Σ≥6）：不再参与任何判定，只保留在
  `rule.legacyGate`（报告）与 `judgeRelevance()`（代码）里作历史对照。
- **保留**规则 C 的否决：`genericOnly = 全部命中词都是通用词` → **强制** `literal` 层，与覆盖率无关。
- 条数：`tiers.counts` 为全量真实条数；md/json 只物化每层前 20 / 10 行，差额写 `tiers.notListed`
  与表尾「本层共 N 条，表内列前 M 条」——**不许静默截断**。
- 候选 `candidates` = **强 + 弱**的前 10（`GOAL_TOP_N`）；`literal` 永不进候选表。
  `belowThreshold` 字段保留，内容 = `literal` 前 3 条（`isMatch: false`，兼容 C.3.1 起的断言）。

**规则 F：词表诊断（`## 词表诊断`）**

- 逐词 `{token, hits, idf, missing}`；`hits` = **命中条目数**（一次遍历索引算完，不逐词全扫）；
- `missing`（`hits === 0`）在 md 标 `**未命中**（池中 0 条）`；
- 存在未命中词时给固定句式：
  `这些词在本地的 <pool.total> 条目录里没有出现；试换同义词再搜（如 嵌入式 → PCB / 单片机 / EDA / 固件）`；
- 同义词提示 = **4 组硬编码示例**（`SYNONYM_HINTS`），**不建表、不参与匹配、不参与打分**；
  沾边的那组在行尾标「← 与本次未命中词相关」。

> 读法：**强匹配为 0 时先读本节**（报告里的 `## 词表诊断`）——它逐词给「池中命中条目数 + idf」，
> 0 命中词标 `未命中` 并给换词提示。0 不是故障（README §9「强匹配 0」同口径）。

**规则 G：idf 加权**

```
idf = clamp( ln(池总数 / (1 + 该词命中条目数)), 0.5, 3.0 )   // 两位小数
weight = round2(Σ命中字段权重 × idf)；通用词再 round2(×0.5)；Σ = round2(Σ weight)
```

- 池总数 = `diagnostics.poolTotal`（registry + catalog + 已装 三源条数之和）；
- 报告里每个命中词写成 `词+权重（idf x.xx）（字段）`，可复算；
- 预计算**一次**（单遍），不逐条重扫；性能分项新增 `tokenStatsMs`；
- **口径冲突（照实写）**：任务卡例子「800 条 → ~0.5」与公式不符（按公式是 **2.62**；下界 0.5 要 ≈6655 条）。
  代码按公式实现；「管理变轻」由「idf < 3.0」+「通用词 ×0.5」+「通用词否决」三者共同保证。

**规则 H：`--search` 行为不变（硬约束）**

`scoreCandidate(entry, tokens)` 的第 3 个参数 `idfMap` **只在 `--goal` 传**：
不传 → 权重仍是整数、通用词仍 `⌊×0.5⌋`、排序（来源 → 得分 → 包名）与末行一字未改，
matched 行里**不出现 `idf` 键**（连 `null` 都不加：字段集合也不许变），且不产出 `diagnostics` 段。

## 12.4 未装包的权限口径（硬约束，不许放宽）

| 情况 | 报告里的写法 |
|---|---|
| 已装、目录可读 | §10.3 四档之一（`无` / `只读` / `写入` / `全量（含命令或凭据）`） |
| 已装、目录读不到 | `unknown（已装但读不到包目录，本地无代码）` |
| **未装** | **`unknown（未安装，本地无代码）`** ——不得写成「应该只要只读」「大概要写盘」这类推断 |
| registry 条目没有 npm（无法判定是否已装） | `unknown（registry 条目没有包名，无法判定是否已装）` |

理由：权限四项是**代码级扫描**结果（§10.3）。没代码就没有证据；
「同类包大概要什么权限」是推断，不是证据 —— 那正是 §0 R-2 禁止的东西。

## 12.5 写动作与只读边界（C.3 增补）

| 动作 | 允许？ | 说明 |
|---|---|---|
| `_registry.mjs --write` | ✅ | **只写** `data/registry.json`；写目标过 `assertSafeLifecyclePath` |
| `_registry.mjs --check [--snapshot]` | ✅ | 只读校验（可校验夹具） |
| `lab-analyze --write-report <path>` | ✅ | 唯一写动作（C.1 起的规则不变） |
| `lab-analyze` 写 `data/registry.json` | ❌ | registry 只由 `_registry.mjs --write` 写 |
| 写 profile / lab / `cordis.patch.yml` / `.dsh-market` | ❌ | 一律守卫拒绝 |
| 联网（非 loopback） | ❌ | 只有 `_registry.mjs --url` 且必须是 loopback |

## 12.6 C.3 自检清单（改代码前先读）

- [ ] `_registry.mjs` 是否还只连 loopback 三主机？有没有偷偷接受任意 host / 跟随 3xx / 支持 https？
- [ ] 端口是否仍要求显式（没有偷偷默认 8080）？
- [ ] 响应形状只认三种吗？不认识时是**报错**还是「返回空列表」？
- [ ] 解析出 0 条时是否 exit 1 且**不写文件**？
- [ ] 不认识的字段是否原样进 `extra` 并列出 `unknownFields`？归一化是否幂等（不套娃）？
- [ ] `--search` 的优先级是否仍是 registry > catalog > installed？每条结果是否都带 `source` 与 `installed`？
- [ ] `--unknown` 是否把「registry 有条目但无描述」误算成「registry 有描述」？
- [ ] `descMismatch` 是否只比「字面」而不做语义判断？
- [ ] `--goal` 的分数是否能按 §12.3.2 手工复算？表里是否给了词级权重？
- [ ] **未装包的权限是否一律 `unknown（未安装，本地无代码）`**？有没有出现「推断」？
- [ ] 无匹配时是否写了「池中无匹配」+ 池子总数 + 最接近 3 条（或明说「不硬凑」）？
- [ ] 新增的 registry 选项是否只读？有没有把 `data/registry.json` 写进 `lab-analyze` 的写路径？
- [ ] 本轮改动是否同步进 `README-DEV.md §5.7` 与 `fixtures/goal-expected.json`？
- [ ] **C.3.1**：`--goal` 的候选是否**全部**过了 §12.3.6 的三条门槛？有没有「只命中通用词」的条目混进候选表？
- [ ] **C.3.1**：通用词命中权重是否 `⌊×0.5⌋`（名称+desc 从 5 变 2，不是 2.5/3）？命中词列是否标（通用）？
- [ ] **C.3.1**：噪声词（池内 0 次且长度<4）是否真的被丢、并且**列在**报告的「丢弃的噪声词」里？
- [ ] **C.3.1**：`--goal` 报告头部是否有「本入口是『池内降噪』，不是语义搜索」这句话？与本节首行、`--help` 是否同文？
- [ ] **C.3.1**：`_registry.mjs` 的响应上限是否仍是**显式**常量 + 超限即中止（不能改成「截断后继续解析」）？

### 12.6.1 C.3.2 自检清单（按真实响应重写后新增）

- [ ] 数组键是否**运行时探测**（`plugins/entries/items/list/…` → 容器里任意第一个数组值），没有写死？
- [ ] 真实形状 `{registry:{plugins:[…]}, hostVersion}` 是否被识别为 `registry>plugins`，并把
      `source.arrayKey` / `source.containerKey` / `source.hostVersion` 写进快照？
- [ ] `description` 是**对象** `{en,zh}` 时，是否分别落进 `descriptionZh` / `descriptionEn`（不再当字符串）？
- [ ] 10974 条是否**全量**进 `entries`（没有截断/抽样）？`count === entries.length`？
- [ ] 规范字段是否齐全（key/name/owner/npm/version/category[]/descriptionZh/descriptionEn/capabilities[]/
      capabilityRedLines[]/capabilityCheckedAt/stars/downloads/install/page/url/added）？
- [ ] 规范外的真实字段（`starsCheckedAt`/`downloadsStart`/`downloadsEnd`/`downloadsCheckedAt`/`icon`/`screenshots`）
      是否原样留在 `extra` 并出现在 `unknownFields`（没丢）？
- [ ] `--check` 是否校验 `count === entries.length` **且抽样前 20 条有 `name`**？v1 快照是否**失败**（负例）？
- [ ] 数据源优先级是否已是 `registry > catalog > package-json > readme`（§12.1.7），且 registry 命中时
      给 `descriptionZh` 原文（无 zh 标 `lang:en`）+ `capabilities` + `capabilityRedLines` + `capabilityCheckedAt`？
- [ ] `--search` / `--goal` 的匹配面是否含 `descriptionZh / descriptionEn / name(包名) / category[] / capabilities[]`？
- [ ] `descriptionZh` / `capabilities` 命中是否 ×1.5 **向上取整**（2 → 3），`descriptionEn` 是否 ×1（2）？
- [ ] C.3.1 的三条门槛 / 通用词 ×0.5 / 噪声词丢弃是否**原样保留**（没被 C.3.2 顺手改掉）？
- [ ] 输出表是否增列 `stars / downloads / redLines(有/无)`？`--search` 与 `--goal` 两处都要有。
- [ ] 是否**一次建索引**、单遍扫描、长词优先剪枝，并在报告里打 `elapsedMs`？
      > 4000 ms 是否按 §12.3.7 继续优化（而不是抽样/截断）？
- [ ] `data/registry.json` 是否进了 `.gitignore`（13–14MB 级可重抓产物）？
- [ ] 旧夹具 `fixtures/registry-sample.json` 是否**保留为负例**（v1 → `--check` 红），
      而验收基准换成 `out/registry-raw.json`？

### 12.6.2 C.3.3 自检清单（分层 / 词表诊断 / idf）

- [ ] 三层是否**都出现**在 md（强 / 弱 / 仅字面），阈值是否 0.5 / 0.2 / 10 且与 `tiers.thresholds` 一致？
- [ ] 覆盖率的分母是否 = **噪声过滤后**的 `tokens.length`（不是分词原始数、不是命中数）？
- [ ] C.3.1 的三条硬门槛是否**真的停了**（`rule.gate` 不存在、`rule.legacyGate` 写明取消）？
- [ ] 「只命中通用词」是否**仍然**进不了强/弱匹配（`genericOnly → literal` 强制归层）？
- [ ] `tiers.counts` 是否全量、`notListed` 是否等于 `counts − 物化数`（没有静默截断）？
- [ ] `## 词表诊断` 是否逐词给了 `hits` 与 `idf`，0 命中是否标 `未命中` 并给固定句式？
- [ ] 同义词提示是否只有 4 组硬编码、且**没有**进任何匹配/打分路径（`SYNONYM_HINTS` 只被渲染读）？
- [ ] idf 是否 `clamp(..., 0.5, 3.0)` + 两位小数，且**预计算一次**（`computeTokenStats` 只调用一次）？
- [ ] 命中词是否都显示 `（idf x.xx）`？`weight === round2(字段权重和 × idf)` 能否手工复算？
- [ ] `--search` 的 matched 行里是否**没有** `idf` 键、权重是否仍是整数、末行是否一字未改、是否无 `diagnostics` 段？
- [ ] `fixtures/goal-expected.json` 是否新增 `c33` 段、`c32` 是否标了 `supersededBy`（**保留**不删）？



