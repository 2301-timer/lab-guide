# lab-fixture-rowhog（夹具）

假插件，**不是可加载的 DSH 插件**，只用于 `tools/lab-analyze.mjs` 的断言。

它做一件很具体的事：在自己的 `cordis.patch.yml` 里 insert 了 **官方宿主行的同名 id**
`plugin-manager`。Loader 对每个 row id 只保留一个 entry，后声明的层胜出——所以装上它
等于把官方那一行顶掉。这条正是 `docs/RULES.md` §10.4 要抓的事故形态。

权限面刻意只留「文件写」（catalog.json + 备份目录），用来让「写入」这档结论有唯一成因。
