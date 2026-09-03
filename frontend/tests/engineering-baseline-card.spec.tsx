import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { syntheticActionCardFixture } from "../features/action-center/data/synthetic-action-card.fixture";
import {
  actionCardViewModelSchema,
  type ActionCardViewModelInput,
} from "../features/action-center/model/action-card-view-model";
import { EngineeringBaselineCard } from "../features/action-center/ui/engineering-baseline-card";

describe("EngineeringBaselineCard", () => {
  it("discloses the mock boundary and keeps AI advice separate", () => {
    const card = actionCardViewModelSchema.parse(syntheticActionCardFixture);
    render(<EngineeringBaselineCard card={card} />);

    expect(screen.getByText("完全合成 / 工程 Mock")).toBeInTheDocument();
    expect(screen.getByText("未调用模型")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "无需操作，仅需知晓" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "模拟 AI 管理建议（非模型输出）",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("优先阅读")).toBeInTheDocument();
    expect(screen.getByText("为什么放在这里")).toBeInTheDocument();
    expect(screen.getByText("来源未验证")).toBeInTheDocument();
    expect(screen.getByText("无需外部行动渠道")).toBeInTheDocument();
  });

  it("surfaces suspicious source and risk facts as a safety alert", () => {
    const payload: ActionCardViewModelInput = structuredClone(
      syntheticActionCardFixture,
    );
    payload.sourceTrust = {
      sourceStatus: "suspicious",
      actionChannelStatus: "suspicious",
      reason: "发件身份和行动渠道均未通过安全校验。",
    };
    payload.claims.push({
      id: "claim-risk-phishing-ui-001",
      kind: "risk",
      text: "邮件要求通过可疑页面输入账号凭证。",
      highImpact: true,
      factState: "confirmed",
      evidenceIds: ["evidence-body-audience-001"],
    });
    payload.risks.push({
      id: "risk-phishing-ui-001",
      type: "phishing",
      severity: "high",
      message: "不要点击邮件中的链接或输入账号凭证。",
      claimRefs: ["claim-risk-phishing-ui-001"],
    });
    const card = actionCardViewModelSchema.parse(payload);

    render(<EngineeringBaselineCard card={card} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("来源与安全");
    expect(alert).toHaveTextContent("可疑来源");
    expect(alert).toHaveTextContent("行动渠道可疑");
    expect(alert).toHaveTextContent("不要点击邮件中的链接或输入账号凭证。");
  });

  it("does not tell the user to act when a mandatory statement has not passed the gates", () => {
    const payload: ActionCardViewModelInput = structuredClone(
      syntheticActionCardFixture,
    );
    payload.claims.push({
      id: "claim-action-unverified-001",
      kind: "action",
      text: "邮件要求学生回复。",
      highImpact: true,
      factState: "confirmed",
      evidenceIds: ["evidence-body-audience-001"],
    });
    payload.mailActions.push({
      id: "action-unverified-001",
      origin: "mail",
      actor: "学生",
      action: "回复",
      object: "课程办公室",
      displayText: "回复课程办公室。",
      obligation: "mandatory",
      factState: "confirmed",
      condition: null,
      claimRefs: ["claim-action-unverified-001"],
    });
    const card = actionCardViewModelSchema.parse(payload);

    render(<EngineeringBaselineCard card={card} />);

    expect(
      screen.getByRole("heading", { name: "尚不能确认你是否需要行动" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "你需要做什么" }),
    ).not.toBeInTheDocument();
  });

  it("does not claim no action when action extraction remains unknown", () => {
    const payload: ActionCardViewModelInput = structuredClone(
      syntheticActionCardFixture,
    );
    payload.unknowns.push({
      field: "action",
      message: "附件尚未解析，无法确认是否还有邮件行动。",
      blockedCapabilities: [],
    });
    const card = actionCardViewModelSchema.parse(payload);

    render(<EngineeringBaselineCard card={card} />);

    expect(
      screen.getByRole("heading", { name: "尚不能确认是否需要操作" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "无需操作，仅需知晓" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/不能据此判断“无需操作”/),
    ).toBeInTheDocument();
  });

  it("does not claim no action while a relevant attachment remains unparsed", () => {
    const payload: ActionCardViewModelInput = structuredClone(
      syntheticActionCardFixture,
    );
    payload.informationCompleteness = {
      status: "incomplete",
      gaps: ["attachment_unparsed"],
    };
    payload.unknowns.push({
      field: "attachment",
      message: "相关附件尚未解析。",
      blockedCapabilities: [],
    });
    const card = actionCardViewModelSchema.parse(payload);

    render(<EngineeringBaselineCard card={card} />);

    expect(
      screen.getByRole("heading", { name: "尚不能确认是否需要操作" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "无需操作，仅需知晓" }),
    ).not.toBeInTheDocument();
  });

  it("labels recommended mail actions separately from AI management advice", () => {
    const payload: ActionCardViewModelInput = structuredClone(
      syntheticActionCardFixture,
    );
    payload.claims.push({
      id: "claim-action-recommended-001",
      kind: "action",
      text: "课程办公室建议学生查看学习资料。",
      highImpact: false,
      factState: "confirmed",
      evidenceIds: ["evidence-body-audience-001"],
    });
    payload.mailActions.push({
      id: "action-recommended-001",
      origin: "mail",
      actor: "学生",
      action: "查看",
      object: "学习资料",
      displayText: "课程办公室建议查看学习资料。",
      obligation: "recommended",
      factState: "confirmed",
      condition: null,
      claimRefs: ["claim-action-recommended-001"],
    });
    const card = actionCardViewModelSchema.parse(payload);

    render(<EngineeringBaselineCard card={card} />);

    expect(
      screen.getByRole("heading", { name: "没有学校强制行动" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "邮件建议/可选行动" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "模拟 AI 管理建议（非模型输出）",
      }),
    ).toBeInTheDocument();
  });

  it("shows uncertain advisory actions with uncertainty and hides inapplicable ones", () => {
    const payload: ActionCardViewModelInput = structuredClone(
      syntheticActionCardFixture,
    );
    payload.claims.push(
      {
        id: "claim-action-possible-001",
        kind: "action",
        text: "邮件可能建议查看学习资料。",
        highImpact: false,
        factState: "possible",
        evidenceIds: ["evidence-body-audience-001"],
      },
      {
        id: "claim-action-unconfirmed-001",
        kind: "action",
        text: "是否需要参加讨论尚未确认。",
        highImpact: false,
        factState: "unconfirmed",
        evidenceIds: ["evidence-body-audience-001"],
      },
      {
        id: "claim-action-not-applicable-001",
        kind: "action",
        text: "这项可选行动已确认不适用。",
        highImpact: false,
        factState: "not_applicable",
        evidenceIds: [],
      },
    );
    payload.mailActions.push(
      {
        id: "action-possible-001",
        origin: "mail",
        actor: "学生",
        action: "查看",
        object: "学习资料",
        displayText: "查看学习资料。",
        obligation: "recommended",
        factState: "possible",
        condition: null,
        claimRefs: ["claim-action-possible-001"],
      },
      {
        id: "action-unconfirmed-001",
        origin: "mail",
        actor: "学生",
        action: "参加",
        object: "课程讨论",
        displayText: "参加课程讨论。",
        obligation: "optional",
        factState: "unconfirmed",
        condition: null,
        claimRefs: ["claim-action-unconfirmed-001"],
      },
      {
        id: "action-not-applicable-001",
        origin: "mail",
        actor: "学生",
        action: "填写",
        object: "不适用表单",
        displayText: "填写不适用表单。",
        obligation: "optional",
        factState: "not_applicable",
        condition: null,
        claimRefs: ["claim-action-not-applicable-001"],
      },
    );
    const card = actionCardViewModelSchema.parse(payload);

    render(<EngineeringBaselineCard card={card} />);

    expect(
      screen.getByRole("heading", {
        name: "尚未确认的邮件建议/可选行动",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("可能：")).toBeInTheDocument();
    expect(screen.getByText("尚未确认：")).toBeInTheDocument();
    expect(screen.queryByText("填写不适用表单。")).not.toBeInTheDocument();
  });

  it("limits the unmet-condition heading to that action group", () => {
    const payload: ActionCardViewModelInput = structuredClone(
      syntheticActionCardFixture,
    );
    payload.claims.push(
      {
        id: "claim-action-required-001",
        kind: "action",
        text: "学生必须阅读课程变更。",
        highImpact: true,
        factState: "confirmed",
        evidenceIds: ["evidence-body-change-001"],
      },
      {
        id: "claim-action-conditional-unmet-001",
        kind: "action",
        text: "只有指定学生需要回复。",
        highImpact: true,
        factState: "confirmed",
        evidenceIds: ["evidence-body-audience-001"],
      },
    );
    payload.mailActions.push(
      {
        id: "action-required-001",
        origin: "mail",
        actor: "学生",
        action: "阅读",
        object: "课程变更",
        displayText: "阅读课程变更。",
        obligation: "mandatory",
        factState: "confirmed",
        condition: null,
        claimRefs: ["claim-action-required-001"],
      },
      {
        id: "action-conditional-unmet-001",
        origin: "mail",
        actor: "指定学生",
        action: "回复",
        object: "课程办公室",
        displayText: "回复课程办公室。",
        obligation: "conditional_mandatory",
        factState: "confirmed",
        condition: {
          text: "仅适用于指定学生",
          status: "unmet",
          claimRefs: ["claim-action-conditional-unmet-001"],
          conditionBasisRefs: ["basis-profile-course-001"],
        },
        claimRefs: ["claim-action-conditional-unmet-001"],
      },
    );
    payload.homeSection = "action_required";
    payload.sourceTrust.sourceStatus = "official_verified";
    const card = actionCardViewModelSchema.parse(payload);

    render(<EngineeringBaselineCard card={card} />);

    expect(
      screen.getByRole("heading", { name: "你需要做什么" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "以下条件强制行动目前不适用于你",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "目前没有适用于你的强制行动",
      }),
    ).not.toBeInTheDocument();
  });
});
