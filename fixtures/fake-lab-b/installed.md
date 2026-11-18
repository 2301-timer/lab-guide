# 假 lab-b · installed（B 阶段 sync 夹具）

> 夹具：`tools/lab-triage.mjs sync` 的**只读输入**，用来验证「lifecycle 有、lab 没登记」与
> 「lab 有、lifecycle 没记」两个方向。**不是真实 lab**，不改真实 lab 任何文件。
>
> 与 `../fake-lab/installed.md` 的区别：那份给 A 阶段对账用（故意四类差异各 1 条）；
> 这份只给 B 阶段 sync 用——**故意只登记 `lab-fixture-delta`**，这样 lifecycle 夹具里的
> alpha / gamma 都落在「lab 未登记」一侧，delta 落在「lifecycle 没记」一侧。

## 第三方插件（1）

| 包名 | 版本 | 类别 | 作用 | 权限（代码级） | 副作用/冲突 | 结论 |
|---|---|---|---|---|---|---|
| `lab-fixture-delta` | 3.0.0 | dev | 反向样本：lab 有、lifecycle 没记（sync 只作 info 提示） | 文件（无）｜网络（无）｜命令（无）｜凭据（无） | 无 | 观察 |

> 本夹具故意**不提供** `INDEX.md`：与 A 阶段夹具一致，顺带验证「读不到 INDEX.md 时降级 + 告警」。
