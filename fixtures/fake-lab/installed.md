# 假 lab · installed（夹具）

> 夹具：lab-guide A 阶段对账器（tools/lab-drift.mjs）的断言输入，**不是真实 lab**，不改真实 lab 任何文件。
> 本文件故意制造四类差异各 1 条：alpha→VERSION_DRIFT、gamma→PERMISSION_TODO、delta→MISSING、
> epsilon（本文件不写）→UNREGISTERED。语义与判定顺序见 `../../docs/RULES.md`。
> 本夹具故意**不提供** `INDEX.md`：用来验证「读不到 INDEX.md 时降级为仅用 installed.md + 告警」。

## 第三方插件（4）

| 包名 | 版本 | 类别 | 作用 | 权限（代码级） | 副作用/冲突 | 结论 |
|---|---|---|---|---|---|---|
| `lab-fixture-alpha` | 0.1.0 | dev | 版本漂移样本：lab 记 0.1.0，profile 的 node_modules 实测 0.2.0 | 文件（无）｜网络（无）｜命令（无）｜凭据（无） | 无 | 试用中 |
| `lab-fixture-beta` | 1.4.2 | dev | 一致样本（负样本）：两边都是 1.4.2，不应产生任何差异 | 文件（无）｜网络（无）｜命令（无）｜凭据（无） | 无 | 试用中 |
| `lab-fixture-gamma` | 2.0.0 | dev | 权限待补样本：版本一致，但权限栏留着未结论字样 | 文件（工作区读写）｜网络（待补）｜命令（无）｜凭据（无） | 无 | 观察 |
| `lab-fixture-delta` | 3.0.0 | dev | 空登记样本：lab 登了，profile 的 dependencies 与 node_modules 都没有它 | 文件（无）｜网络（无）｜命令（无）｜凭据（无） | 无 | 观察 |

> 说明：`lab-fixture-epsilon`（已装未登记）与 `@deepseek-ai/lab-fixture-official-bundle`（只在 bundles）
> 故意**不出现**在本表里——它们分别对应 UNREGISTERED 与 ROSTER_ONLY。

## 待办（夹具自述，无实际操作）

- [x] 四类差异各 1 条。
- [ ] 真实 lab 的核对请跑 `node lab-guide/tools/lab-drift.mjs`（不带参数，走默认 profile/lab）。
