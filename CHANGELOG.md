# Changelog

## 0.3.0

**模型启用/停用**：设置里新增「模型管理」页，逐条勾选决定哪些方舟模型出现在模型选择器里，
保存即时生效、无需重启。

- 新增 `settings.section` 页面（`id: ark-plans-models`），列出两条车道的完整清单，
  取消勾选即隐藏；「全选」恢复完整清单。
- 选择持久化在插件自己的 settings 段 `dsh-ark-plans.enabledModelIds`，并应用为
  `llm-pi-ai.providers.<route>.models`（pi-ai 的用户层覆盖，因此是活的）。
- 新增 host 路由 `GET/POST /plugins/dsh-ark-plans/models`，与额度路由同样是
  `kind: 'exact'` + loopback 限定；失败一律以 200 + 说明性 body 返回，供页面直接渲染。
- 不变量：**空清单 = 全开**（配置缺失、列表为空、id 全部不认识，都退回完整清单），
  且**「全开」写的是完整清单而非空清单** —— pi-ai 对内置目录不认识的 route 拒绝空
  `models`（`provider "…" resolves no models…`）。已由 `scripts/test-selection.mjs` 钉住。
- 新增 `scripts/`：`check-catalog.mjs`（组合清单与代码清单必须一致）、
  `test-selection.mjs`（选择逻辑 22 项断言）、`test-client-bundle.mjs`（按浏览器方式加载
  client 半，断言两个 Slot 的注册与失败containment）。`npm run check` 跑全部。

## 0.2.0

**额度显示**：会话标题栏右侧一个 pill，每条车道显示进度条 + 已用百分比，点开是各周期
（5 小时 / 本周 / 本月）的「已用 / 总额」与刷新时间。额度走控制面 OpenTOP
（`GetAFPUsage` / `GetCodingPlanUsage`），复用 `arkcli` 已在本机建立的身份签名；
拿不到时不编造数字，按 `expired` / `no-identity` / `not-subscribed` / `error` 四态
把原因与处置建议显示在面板里。

- 新增 client 半（`lib/client.js`）与额度路由 `GET /plugins/dsh-ark-plans/quota`。
- 源码首次入库（此前只有 tarball），并从 `dsh-plugin-collection` 迁到本仓库。

## 0.1.0

首个版本：用 `cordis.patch.yml` 给官方 dormant 挂载的 `llm-pi-ai` 补两条 provider
profile（Agent Plan / Coding Plan），把方舟两条套餐车道接进 harness；host 半做凭据
就绪诊断。模型清单为逐 id 真实探测所得（62 个候选 → 13 个 200）。
