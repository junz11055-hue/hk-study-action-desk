import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MANAGED_DEMO_STORAGE_KEY_V1 } from "../features/action-center/data/managed-demo-store";
import { mockActionCardRepository } from "../features/action-center/data/mock-action-card-repository";
import { ReferenceWorkspace } from "../features/action-center/ui/reference-workspace";

describe("ReferenceWorkspace", () => {
  beforeEach(() => window.localStorage.clear());

  it("makes all four desktop and mobile destinations real links", async () => {
    render(
      <ReferenceWorkspace
        cards={await mockActionCardRepository.list()}
        view="guides"
      />,
    );

    expect(screen.getByRole("heading", { name: "香港指南" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "通知中心4" })).toHaveAttribute(
      "href",
      "/workspace",
    );
    expect(screen.getAllByRole("link", { name: "已管理" })).toHaveLength(2);
    const guideLinks = screen.getAllByRole("link", { name: /香港指南|指南/ });
    expect(guideLinks.some((link) => link.getAttribute("aria-current") === "page")).toBe(true);
    expect(screen.getAllByRole("link", { name: "设置" })).toHaveLength(2);
  });

  it("shows the stage route and keeps high-impact guides review-only", async () => {
    render(
      <ReferenceWorkspace
        cards={await mockActionCardRepository.list()}
        view="guides"
      />,
    );

    expect(screen.getByRole("heading", { name: "当前阶段：抵港初期" })).toBeInTheDocument();
    expect(screen.getByText("身份证事项只看官方要求")).toBeInTheDocument();
    expect(screen.getAllByText("仅供核对")).toHaveLength(2);
    expect(screen.getAllByText("上线前必须重新审核")).toHaveLength(4);
  });

  it("persists a local guide record and can move it back without claiming completion", async () => {
    const cards = await mockActionCardRepository.list();
    const guideView = render(<ReferenceWorkspace cards={cards} view="guides" />);
    const guideCard = screen
      .getByRole("heading", { name: "先让手机在香港能用" })
      .closest("article");
    expect(guideCard).not.toBeNull();
    if (guideCard === null) return;

    fireEvent.click(within(guideCard).getByRole("button", { name: "标记已管理" }));
    await waitFor(() =>
      expect(window.localStorage.getItem(MANAGED_DEMO_STORAGE_KEY_V1)).toContain(
        "mobile-data",
      ),
    );
    guideView.unmount();

    render(<ReferenceWorkspace cards={cards} view="managed" />);
    expect(
      await screen.findByRole("heading", { name: "先让手机在香港能用" }),
    ).toBeInTheDocument();
    expect(screen.getByText("不代表学校事项已完成")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移回待管理" }));
    expect(
      await screen.findByRole("heading", { name: "还没有已管理事项" }),
    ).toBeInTheDocument();
  });

  it("presents settings as a read-only synthetic profile", async () => {
    render(
      <ReferenceWorkspace
        cards={await mockActionCardRepository.list()}
        view="settings"
      />,
    );

    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByText("完全合成数据")).toBeInTheDocument();
    expect(screen.getAllByText("未连接")).toHaveLength(2);
    expect(screen.getByText(/没有 OAuth、账号绑定或数据同步能力/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /连接/ })).not.toBeInTheDocument();
  });
});
