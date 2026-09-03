# Contributing

感谢你帮助改进留港行动台。

## 开始之前

1. 使用 Node.js 22.x。
2. Fork 仓库并从 `main` 创建分支。
3. 运行 `npm run demo:setup` 安装前端锁定依赖。
4. 使用 `npm run demo` 查看公开合成演示。

## 提交要求

- 只使用合成数据；不要提交真实学生、学校账户、邮件、Token 或 API Key。
- 不要弱化 Claim → Evidence、高影响判断、来源可信度和办理渠道的安全边界。
- 合同变更必须新建版本并增加测试，不能原地改变已冻结语义。
- UI 变更同时检查桌面与手机布局、键盘焦点及可读文本。
- PR 应说明问题、方案、边界与验证结果；尽量保持单一目的。

## 本地检查

```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run test
DEMO_MODE=hosted npm --prefix frontend run build
```

核心层变更还应运行 README “验证”章节中的离线回归门。任何真实模型运行都需要单独、明确、一次性的批准；普通贡献不应触发它。
