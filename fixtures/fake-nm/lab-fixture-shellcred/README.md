# lab-fixture-shellcred（夹具）

假插件，**不是可加载的 DSH 插件**，只用于 `tools/lab-analyze.mjs` 的 §2 断言。

它的 row 面是干净的：`insert: lab-fixture-shellcred` 与官方行、其他已装包都不重名，
所以 row 争用应当判 `ok`。它的价值在权限四项——代码里同时有 `child_process`
起的子进程和从环境变量读 api key 的凭据面，结论必须落在最高一档
「全量（含命令或凭据）」。

凭据只读环境变量名 `DSH_API_KEY`，不打印、不落盘、不外发（夹具自己也不做这些事）。
