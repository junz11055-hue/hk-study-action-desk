# PRD v0.2 合成产品验收夹具

> 状态：静态验收资产已生成；Phase 2A 已通过；Phase 2B 失败关闭；Phase 2R-A 离线修订已通过
> 授权日期：2026-08-30  
> 数据等级：完全虚构，不含真实学生、学校邮箱或真实附件  
> 产品口径：`../../05-product-requirements-document-v0.2.md`

## 1. 本目录证明什么

这些文件把 PRD v0.2 的产品行为合同变成可审阅、可版本化的静态输入与预期结果。它们只用于确认“测试题是否覆盖产品规则”，不能证明模型准确、真实用户需要该产品、邮箱 OAuth 可用或系统能够上线。

本目录中的“锁定”表示后续不得用答案调 Prompt、规则或产品实现；它不是加密或权限隔离。任何人一旦用锁定答案调优，对应案例就必须转入开发集，并补充从未见过答案的新锁定案例。

## 2. 文件清单

| 文件 | 实际数量 | 用途 |
|---|---:|---|
| `base-development.json` | 32 | 可见开发与回归基础案例 |
| `base-locked.json` | 16 | `M01–M16` 一一对应的锁定基础案例 |
| `mutations.locked.json` | 16 | 3 个画像状态、`DEP01–DEP10`、更新/延期/取消的单变量变异 |
| `followups.json` | 12 | 三个固定追问各 4 个，开发/锁定各半 |
| `state-transitions.locked.json` | 12 | `ST01–ST12` 确定性状态迁移 |
| `deterministic-truth-tables.json` | 20 | `SRC01–SRC07`、`REL01–REL07`、`CON01–CON06` 确定性裁决 |
| `phase2-development-inputs-v1.json` | 16 | Phase 2A/2B 使用的 answer-free、顺序与 Hash 冻结的 development Model Input 快照 |
| `phase2r-source-context-v1.json` | 16 | Phase 2R-A 使用的 answer-free 发件学校上下文；由合成认证、allowlist、service scope 与 mapping version 投影 |
| `fixture-contract.md` | 1 | 字段、枚举、证据和锁定集纪律 |
| `manifest.json` | 1 | 版本、数量、切片和未运行状态 |

48 个基础案例之外的变异、追问、状态序列和真值表都不增加基础邮件总数。

完整生成边界与静态检查记录见 `../../06-synthetic-fixture-generation-record.md`。

## 3. 冻结边界

- 所有发件地址必须使用 `.invalid`；学校、学生、课程、项目、金额、链接和附件内容均为虚构。
- 原始夹具生成阶段只生成 JSON 和 Markdown；后续获批的 Phase 2A 已新增独立 Input 快照、评测代码和离线测试，但没有改变 locked 资产。
- Phase 2A 只运行 `offline_reference`，没有调用模型。Phase 2B 固定 16 案真实 DeepSeek development 批次已执行，结果为 10/16 合法 Candidate、2/16 自动全通过，状态 `technical_failed`。
- Phase 2R-A 只做离线修订与 mock 回归；没有读取 Key 或调用模型。新来源上下文不能由模型正文或答案生成，任一合成信任信号失败时学校映射为 `null`。
- `manifest.json` 的 `runtime_status=not_run` 保留为原始完整产品验收套件状态；Phase 2A 的 reference test double 不等于产品 Harness 或真实模型运行。Phase 2B 执行证据另存于 Git 忽略的运行目录，不回写此 manifest。
- 单人编写与确认的夹具只能称“产品验收夹具”，不能称独立金标或 AI 优势证据。

## 4. 后续允许的顺序

```text
人工审阅静态夹具
→ 已完成 Phase 2A 离线评测尺子
→ 已执行一次固定 16 案 Phase 2B DeepSeek development 批次
→ 不可变 capture 与自动 evaluation：technical_failed
→ 已完成 Phase 2R-A 离线修订
→ 如另获批，Phase 2R-B 小样本真实 smoke
→ 更晚才可能申请真实数据影子
```

Phase 2B 的一次性授权已经消费。Phase 2R-A 没有真实模型授权或 smoke 入口；它不覆盖 Phase 2R-B、locked、补跑、产品 Harness、真实数据或后续阶段。任何新模型请求都不会因为本目录生成完成而自动获准。
