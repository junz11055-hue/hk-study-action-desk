# PRD v0.2 夹具字段契约

## 1. 基础案例最小结构

每个基础案例必须同时具有以下顶层字段：

- `case_id`、`dataset_split`、`primary_scenario`、可空 `matrix_row_id`；
- `semantic_difficult`、`source_message_id`、`thread_id`、`profile_id`、`language`；
- `input.profile`、`input.message`；
- `harness_context`；
- `expected`。

`input.profile` 至少记录学校、项目/专业、届别、学期、香港时区和课程；学校、项目/专业、届别、学期、香港时区及其他可判断适用性的画像字段统一为 `{profile_field_id,value,source,confirmation_status,valid_until}` 对象。`input.profile.timezone.value` 固定为 `Asia/Hong_Kong`；`harness_context.timezone` 仍为解释测试时刻所用的字符串。每门课程必须区分 `confirmed / candidate / removed / expired`。

`input.message` 至少记录真实发件地址字段、主题、`sent_at`、`received_at`、正文、附件解析状态，以及发件人、供应商、用户星标三种彼此独立的原生重要信号。`input.message.from` 精确包含 `display_name / address / provider_raw` 三个键；提供商原始认证、租户和映射字段只保存在 `provider_raw`，不得在 `from` 中重复归一判断。

`input.message.security_facts` 精确包含：

- `connector_authentication`；
- `sender_mapping`、`tenant_mapping`；
- 可空布尔值 `reviewed_service_provider_scope_match`；
- `action_channels[]`，每项精确包含 `type / domain / status`；
- 布尔值 `security_conflict`、字符串数组 `risk_reasons[]`；
- 可空布尔值 `recipient_account_match`。

`harness_context` 冻结测试时刻、`first_seen`、当前星标、已有用户纠错、已批准长期规则、默认通知偏好和免打扰状态。`default_notification_preferences` 精确包含 `instant_enabled / daily_digest_enabled / daily_digest_time / other_mode`；`dnd` 精确包含设置值 `enabled` 与当前测试时刻状态 `active`。当前夹具统一以香港时区解释日期。

`harness_context.historical_items[]` 的阅读、管理、事项和版本状态以 `read_status / management_status / item_status / version_status` 四个平铺字段记录；`dates[]` 每项精确为 `{role,normalized}`；`calendar_relation` 只允许 `{status,event_reference}` 或 `null`。

## 2. 预期结果最小结构

`expected` 至少覆盖：

- `incoming_disposition` 与命中的 `relation_truth_id`；
- `source_truth_id`、`source_status`、`action_channel_status`；
- 原生重要保护结果、主题、适用性、画像引用与具体缺口；
- `claims[]` 和 `evidence[]`；
- 邮件行动 `actions[]` 与独立的 `management_suggestions[]`；
- 日期角色、归一结果、冲突和日历资格；
- 后果四态、`unknown_with_high_consequence_clue` 与 `consequence_sort_bucket`；
- 每个候选字段的 `fact_states`；
- `resulting_item.home_section` 及阅读、管理、事项事实、版本、可见性和逾期状态；
- 独立通知渠道、`north_star_eligible`、适用时的 `north_star_maturity_status`；
- 被阻止能力和 `source_mode`。

字段不适用时统一写 `not_applicable` 或 `null`，不得使用含义不明的空字符串。

`fact_states` 固定包含 `topics / applicability / actions / obligation / dates / consequence / source / action_channel / key_change / relation / native_importance / attachment_content` 十二个键；当前案例未涉及的字段写 `not_applicable`，不能删键或改用单复数近义名。

`topics[]` 每项精确为 `{label,evidence_ids[]}`，且至少引用一个语义支持该主题的当前案例证据。`uncertainties[]` 每项精确为 `{uncertainty_id,missing_or_conflict,blocked_capabilities[]}`。

`dates[].normalized` 只允许 RFC 3339 字符串或 `null`。一个时间窗必须按角色拆成开始、结束两条日期，不得把 `{start,end}` 对象塞进单个 `normalized`。`resulting_item.due_status` 与日期事实分开记录。

## 3. 冻结枚举

| 字段 | 允许值 |
|---|---|
| `dataset_split` | `development / locked` |
| `language` | `en / zh-Hant / mixed / zh-Hans` |
| `incoming_disposition` | `new_item / exact_duplicate_suppressed / update_existing` |
| `source_status` | `official_verified / unverified / suspicious` |
| `action_channel_status` | `verified / unverified / suspicious / not_required` |
| `connector_authentication` | `passed / failed / not_available` |
| `sender_mapping`、`tenant_mapping` | `matched / not_matched / not_available` |
| `attachment_overall_status` | `none / parsed / unparsed` |
| `attachments[].parse_status` | `parsed / encrypted_unparsed / unsupported / failed` |
| `links[].risk_status` | `clear / suspicious / unknown` |
| 行动义务 | `mandatory / conditional_mandatory / recommended / optional` |
| `condition_status` | `met / unmet / unknown / not_applicable` |
| 字段事实 | `confirmed / possible / unconfirmed / not_applicable` |
| `home_section` | `要处理 / 优先阅读 / 其他通知 / null`；精确重复的 `null` 必须配 `visibility_status=merged` |
| `read_status` | `unread / read` |
| `management_status` | `active / snoozed / arranged / completed / irrelevant` |
| `item_status` | `active / cancelled / invalidated` |
| `version_status` | `current / superseded` |
| `visibility_status` | `active / read_folded / user_hidden / merged` |
| `due_status` | `upcoming / overdue / unknown / no_due_date / not_applicable` |
| `notification_channel` | `instant / instant_security_alert / daily_digest / notification_center_only / suppressed` |
| `consequence` | `high / medium / low / unknown` |
| `consequence_sort_bucket` | `confirmed_high / unknown_high_clue / confirmed_medium / unknown_other / confirmed_low` |
| `north_star_maturity_status` | `pending / mature_included / excluded_cancelled_before_due / not_applicable` |

## 4. 证据纪律

- 每个高影响 claim 必须有自己的 `claim_id`，并引用一个或多个 `evidence_id`。
- `evidence[].quote` 必须逐字存在于当前正文或当前合成附件文本；主题、旧消息或另一案例中的片段不能代替。
- 引用存在还不够，片段必须语义支持主体、动作、条件、金额、日期、义务或后果。
- `conditional_mandatory` 必须同时给出邮件条件证据和带来源/状态的 `condition_basis_refs[]`；只有条件文本、没有已确认用户依据时为 `unknown`。
- AI 个人管理建议只能进入 `management_suggestions[]`，不得进入邮件 `actions[]`、触发“要处理”或取得日历资格。

## 5. 切片与分组纪律

- 基础案例总数固定为 48：32 个开发、16 个锁定。
- 16 个锁定案例的 `matrix_row_id` 必须恰为 `M01–M16`，不重不漏。
- 8 个源邮件各搭配两个画像形成 16 个基础案例；同源、同线程与画像变体不能跨开发/锁定集。
- 全局语言切片固定为英文 20、繁体 14、混合 10、简体 4。
- 全局结果固定为要处理 16、优先阅读 18、其他通知 10、精确重复合并 4。
- 至少 12 个原生重要信号，且发件人、供应商、用户星标各至少 4 个；至少 24 个业务日期。
- 安全/可疑切片的唯一计数谓词为：`source_status != official_verified OR action_channel_status in {unverified,suspicious}`；按此谓词至少 8 个案例。

## 6. 变异路径与操作契约

- `root_changed_input.path` 与每个 `expected_dependency_deltas[].path` 使用点号字段路径和零起点数组下标，例如 `input.profile.courses[0].status`；禁止 JSON Pointer、负数下标、通配符和含义不明的自然语言路径。
- 根变化精确包含 `path / from / to`。普通替换 delta 同样精确包含 `path / from / to`，并在执行前校验当前值等于 `from`。
- delta 按数组顺序执行；每一步的 `from` 或删除守卫均针对上一步完成后的当前状态。
- `append`：向目标数组末尾追加 `value`；`clear`：把目标数组置为 `[]`；`remove_at`：按 `index` 删除，并用 `expected_removed_id` 或 `expected_removed_value` 校验目标；`remove_value`：删除目标数组中唯一一个与 `value` 全等的元素；`add`：只在路径尚不存在时创建该字段并写入 `value`。
- 向 `expected.uncertainties` 追加的对象也必须遵守 `{uncertainty_id,missing_or_conflict,blocked_capabilities[]}`；附件解析根变化使用 `parse_status=failed`，其派生总体状态为 `attachment_overall_status=unparsed`。

## 7. 运行纪律

本批文件只允许静态生成和只读结构校验。不得在当前授权下把它们送入产品、规则基线、DeepSeek 或任何其他模型。`runtime_status=not_run` 是授权边界，不是测试结论。
