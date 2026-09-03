import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockActionCardRepository } from "../features/action-center/data/mock-action-card-repository";
import { syntheticActionCardFixture } from "../features/action-center/data/synthetic-action-card.fixture";
import {
  actionCardViewModelSchema,
  type ActionCardViewModelInput,
} from "../features/action-center/model/action-card-view-model";
import { ActionCenterScreen } from "../features/action-center/ui/action-center-screen";
import { FocusTarget } from "../features/action-center/ui/focus-target";

async function cards() {
  return mockActionCardRepository.list();
}

function cardVariant(
  mutate: (payload: ActionCardViewModelInput) => void,
) {
  const payload: ActionCardViewModelInput = structuredClone(
    syntheticActionCardFixture,
  );
  mutate(payload);
  return actionCardViewModelSchema.parse(payload);
}

describe("ActionCenterScreen", () => {
  it("renders four synthetic notifications once in the fixed three-section order", async () => {
    const fixtureCards = await cards();
    const { container } = render(<ActionCenterScreen cards={fixtureCards} />);

    expect(
      screen.getByRole("heading", { name: "今天先看 3 件事" }),
    ).toBeInTheDocument();
    const groupHeadings = Array.from(
      container.querySelectorAll(".notification-group h2"),
      (heading) => heading.textContent,
    );
    expect(groupHeadings).toEqual(["要处理", "优先阅读", "其他通知"]);

    for (const card of fixtureCards) {
      const matchingLinks = container.querySelectorAll(
        `a[href="/workspace?notification=${card.notification.id}"]`,
      );
      expect(matchingLinks).toHaveLength(1);
    }

    expect(screen.getAllByText("完全合成数据").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/未接邮箱/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/未接日历/).length).toBeGreaterThan(0);
  });

  it("puts relevance, action and time in the selected payment card's first decision block", async () => {
    render(<ActionCenterScreen cards={await cards()} />);

    expect(
      screen.getByRole("heading", { name: "9 月 4 日前缴纳第一学期学费" }),
    ).toBeInTheDocument();
    expect(screen.getByText("是否要做")).toBeInTheDocument();
    expect(screen.getByText("为什么与你相关")).toBeInTheDocument();
    expect(screen.getAllByText("缴费截止").length).toBeGreaterThan(0);
    expect(screen.getByText("已确认 · 与你本人相关")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "你需要做什么" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "行动轨" }),
    ).toBeInTheDocument();
    expect(screen.getByText("工程 Mock")).toBeInTheDocument();
  });

  it("allows only a local calendar preview and explicitly denies a real write", async () => {
    render(<ActionCenterScreen cards={await cards()} />);

    const summary = screen.getByText("预览日历事件");
    fireEvent.click(summary);

    expect(
      screen.getByText("只在本页预览，未写入任何真实日历。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /同步到日历/ })).not.toBeInTheDocument();
  });

  it("treats the important suspicious account mail as a safety alert, not an executable instruction", async () => {
    render(
      <ActionCenterScreen
        cards={await cards()}
        selectedNotificationId="synthetic-notification-security-001"
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("先停一下：不要按邮件中的方式操作");
    expect(alert).toHaveTextContent("不要点击邮件中的链接");
    expect(screen.getAllByText("发件人标记重要").length).toBeGreaterThan(0);
    expect(screen.getAllByText("可疑来源").length).toBeGreaterThan(0);
    expect(screen.getByText("先不要按邮件操作")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "你需要做什么" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a voluntary campus event in other notifications and labels its date as an event start", async () => {
    render(
      <ActionCenterScreen
        cards={await cards()}
        selectedNotificationId="synthetic-notification-campus-001"
      />,
    );

    expect(screen.getAllByText("其他通知").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: "无需操作，仅需知晓" }),
    ).toBeInTheDocument();
    expect(screen.getByText("开始时间")).toBeInTheDocument();
    expect(screen.queryByText("缴费截止")).not.toBeInTheDocument();
  });

  it("uses server-selected mobile list/detail states without creating a fake client task state", async () => {
    const fixtureCards = await cards();
    const listView = render(<ActionCenterScreen cards={fixtureCards} />);

    expect(listView.container.querySelector(".notification-panel")).not.toHaveClass(
      "notification-panel--mobile-hidden",
    );
    expect(listView.container.querySelector(".detail-panel")).not.toHaveClass(
      "detail-panel--mobile-open",
    );

    listView.unmount();
    const detailView = render(
      <ActionCenterScreen
        cards={fixtureCards}
        selectedNotificationId="synthetic-notification-001"
      />,
    );
    expect(detailView.container.querySelector(".notification-panel")).toHaveClass(
      "notification-panel--mobile-hidden",
    );
    expect(detailView.container.querySelector(".detail-panel")).toHaveClass(
      "detail-panel--mobile-open",
    );
    expect(
      screen.getByRole("link", { name: "返回通知列表" }),
    ).toHaveAttribute(
      "href",
      "/workspace?focus=synthetic-notification-001#notification-synthetic-notification-001",
    );
  });

  it("exposes named landmarks, a skip link and evidence as a native disclosure", async () => {
    render(<ActionCenterScreen cards={await cards()} />);

    expect(screen.getByRole("link", { name: "跳到主要内容" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("navigation", { name: "主要导航" })).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "手机端主要导航" }),
    ).toBeInTheDocument();
    const logoutButtons = screen.getAllByRole("button", {
      name: "退出演示",
    });
    expect(logoutButtons).toHaveLength(2);
    for (const button of logoutButtons) {
      expect(button.closest("form")).toHaveAttribute(
        "action",
        "/api/demo-access/session/logout",
      );
      expect(button.closest("form")).toHaveAttribute("method", "post");
    }

    const evidenceShortcut = screen.getByRole("link", { name: "查看证据" });
    const evidenceSummary = screen.getByText("查看原文证据").closest("summary");
    expect(evidenceSummary).not.toBeNull();
    if (evidenceSummary !== null) {
      const evidenceDetails = evidenceSummary.closest("details");
      expect(evidenceDetails).not.toBeNull();
      expect(evidenceDetails).not.toHaveAttribute("open");

      evidenceShortcut.focus();
      fireEvent.keyDown(evidenceShortcut, { key: "Enter" });
      expect(evidenceDetails).toHaveAttribute("open");
      expect(document.activeElement).toBe(evidenceSummary);

      fireEvent.click(evidenceSummary);
      expect(evidenceDetails).not.toHaveAttribute("open");
      fireEvent.click(evidenceShortcut);
      expect(evidenceDetails).toHaveAttribute("open");
      expect(document.activeElement).toBe(evidenceSummary);

      const evidenceRegion = screen.getByRole("heading", {
        name: "查看原文证据",
      }).closest("section");
      expect(evidenceRegion).not.toBeNull();
      if (evidenceRegion !== null) {
        expect(within(evidenceRegion).getByText(/不是完整邮件原文/)).toBeInTheDocument();
      }
    }
  });

  it("fails closed instead of claiming no action when action extraction is unknown", () => {
    const card = cardVariant((payload) => {
      payload.unknowns.push({
        field: "action",
        message: "尚未确认邮件是否还包含其他行动。",
        blockedCapabilities: [],
      });
    });

    render(
      <ActionCenterScreen
        cards={[card]}
        selectedNotificationId={card.notification.id}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "尚不能确认是否需要操作" }),
    ).toBeInTheDocument();
    expect(screen.getByText("是否要做仍待确认")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "无需操作，仅需知晓" }),
    ).not.toBeInTheDocument();
  });

  it("fails closed while a relevant attachment remains unparsed", () => {
    const card = cardVariant((payload) => {
      payload.informationCompleteness = {
        status: "incomplete",
        gaps: ["attachment_unparsed"],
      };
      payload.unknowns.push({
        field: "attachment",
        message: "相关附件尚未解析。",
        blockedCapabilities: [],
      });
    });

    render(
      <ActionCenterScreen
        cards={[card]}
        selectedNotificationId={card.notification.id}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "尚不能确认是否需要操作" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "无需操作，仅需知晓" }),
    ).not.toBeInTheDocument();
  });

  it("shows confirmed required and unmet conditional actions as separate groups", () => {
    const card = cardVariant((payload) => {
      payload.claims.push(
        {
          id: "claim-action-required-phase1b-001",
          kind: "action",
          text: "学生必须阅读课程变更。",
          highImpact: true,
          factState: "confirmed",
          evidenceIds: ["evidence-body-change-001"],
        },
        {
          id: "claim-action-conditional-unmet-phase1b-001",
          kind: "action",
          text: "只有指定学生需要回复。",
          highImpact: true,
          factState: "confirmed",
          evidenceIds: ["evidence-body-audience-001"],
        },
      );
      payload.mailActions.push(
        {
          id: "action-required-phase1b-001",
          origin: "mail",
          actor: "学生",
          action: "阅读",
          object: "课程变更",
          displayText: "阅读课程变更。",
          obligation: "mandatory",
          factState: "confirmed",
          condition: null,
          claimRefs: ["claim-action-required-phase1b-001"],
        },
        {
          id: "action-conditional-unmet-phase1b-001",
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
            claimRefs: ["claim-action-conditional-unmet-phase1b-001"],
            conditionBasisRefs: ["basis-profile-course-001"],
          },
          claimRefs: ["claim-action-conditional-unmet-phase1b-001"],
        },
      );
      payload.homeSection = "action_required";
      payload.sourceTrust.sourceStatus = "official_verified";
    });

    render(
      <ActionCenterScreen
        cards={[card]}
        selectedNotificationId={card.notification.id}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "你需要做什么" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "以下条件强制行动目前不适用于你",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "尚不能确认你是否需要行动" }),
    ).not.toBeInTheDocument();
  });

  it("does not render evidence when the ViewModel capability blocks it", () => {
    const card = cardVariant((payload) => {
      payload.capabilities.viewEvidence = {
        state: "blocked",
        decisionSource: "harness_policy",
        reasonCodes: ["evidence_unconfirmed"],
        message: "当前证据没有通过展示门。",
      };
    });

    const { container } = render(
      <ActionCenterScreen
        cards={[card]}
        selectedNotificationId={card.notification.id}
      />,
    );

    expect(screen.getByText("证据暂不可用")).toBeInTheDocument();
    expect(container.querySelector(".evidence-details")).toBeNull();
    expect(
      screen.queryByText("This notice is for students enrolled in DATA6102."),
    ).not.toBeInTheDocument();
  });

  it("blocks suspicious sources without requiring a risk row, but keeps info risks non-blocking", () => {
    const suspiciousCard = cardVariant((payload) => {
      payload.sourceTrust = {
        sourceStatus: "suspicious",
        actionChannelStatus: "suspicious",
        reason: "发件身份与行动渠道均可疑。",
      };
    });
    const suspiciousRender = render(
      <ActionCenterScreen
        cards={[suspiciousCard]}
        selectedNotificationId={suspiciousCard.notification.id}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "发件身份与行动渠道均可疑。",
    );
    expect(screen.getByText("先不要按邮件操作")).toBeInTheDocument();

    suspiciousRender.unmount();
    const infoRiskCard = cardVariant((payload) => {
      payload.claims.push({
        id: "claim-info-risk-phase1b-001",
        kind: "risk",
        text: "邮件排版可能影响阅读。",
        highImpact: false,
        factState: "confirmed",
        evidenceIds: ["evidence-body-change-001"],
      });
      payload.risks.push({
        id: "risk-info-phase1b-001",
        type: "other",
        severity: "info",
        message: "排版提示不阻止阅读或行动判断。",
        claimRefs: ["claim-info-risk-phase1b-001"],
      });
    });
    render(
      <ActionCenterScreen
        cards={[infoRiskCard]}
        selectedNotificationId={infoRiskCard.notification.id}
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "其他风险提示（不等于禁止行动）" }),
    ).toBeInTheDocument();
    expect(screen.getByText("排版提示不阻止阅读或行动判断。")).toBeInTheDocument();
  });

  it("keeps uncertain importance, relevance and consequence visibly uncertain", () => {
    const card = cardVariant((payload) => {
      payload.nativeImportanceSignals[0] = {
        kind: "sender_importance",
        state: "unknown",
        protection: "unknown",
      };
      payload.relevance.factState = "possible";
      payload.consequence.factState = "possible";
    });

    render(
      <ActionCenterScreen
        cards={[card]}
        selectedNotificationId={card.notification.id}
      />,
    );

    expect(
      screen.getAllByText("发件人标记重要状态未知").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("可能 · 与你的已确认课程相关"),
    ).toBeInTheDocument();
    expect(screen.getByText(/可能 · 中等后果/)).toBeInTheDocument();
  });

  it("uses explicit current state and restores focus through the isolated focus bridge", async () => {
    const fixtureCards = await cards();
    const listRender = render(<ActionCenterScreen cards={fixtureCards} />);
    const firstNotificationLink = listRender.container.querySelector(
      'a[href="/workspace?notification=synthetic-notification-payment-001"]',
    );
    expect(firstNotificationLink).toHaveAttribute("data-selected", "true");
    expect(firstNotificationLink).not.toHaveAttribute("aria-current");

    listRender.unmount();
    const detailRender = render(
      <ActionCenterScreen
        cards={fixtureCards}
        selectedNotificationId="synthetic-notification-security-001"
      />,
    );
    const selectedHeading = screen.getByRole("heading", {
      name: "重要标记邮件要求验证账号，但来源可疑",
    });
    const selectedNotificationLink = detailRender.container.querySelector(
      'a[href="/workspace?notification=synthetic-notification-security-001"]',
    );
    expect(selectedNotificationLink).toHaveAttribute("aria-current", "page");
    expect(document.activeElement).toBe(selectedHeading);

    detailRender.unmount();
    const restoredRender = render(
      <ActionCenterScreen
        cards={fixtureCards}
        focusNotificationId="synthetic-notification-security-001"
      />,
    );
    const restoredNotificationLink = restoredRender.container.querySelector(
      'a[href="/workspace?notification=synthetic-notification-security-001"]',
    );
    expect(restoredNotificationLink).toHaveAttribute(
      "id",
      "notification-synthetic-notification-security-001",
    );
    expect(document.activeElement).toBe(restoredNotificationLink);
  });

  it("focuses the visible copy when a Next.js transition temporarily duplicates an id", () => {
    const hiddenTarget = document.createElement("h2");
    const visibleTarget = document.createElement("h2");
    hiddenTarget.id = "transition-focus-target";
    hiddenTarget.style.display = "none";
    hiddenTarget.tabIndex = -1;
    visibleTarget.id = "transition-focus-target";
    visibleTarget.tabIndex = -1;
    Object.defineProperty(hiddenTarget, "getClientRects", {
      value: () => [],
    });
    Object.defineProperty(visibleTarget, "getClientRects", {
      value: () => [{}],
    });
    document.body.append(hiddenTarget, visibleTarget);

    try {
      render(<FocusTarget targetId="transition-focus-target" />);
      expect(document.activeElement).toBe(visibleTarget);
    } finally {
      hiddenTarget.remove();
      visibleTarget.remove();
    }
  });
});
