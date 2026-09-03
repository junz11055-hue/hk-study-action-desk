import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { InviteAccessScreen } from "../features/invite-access/ui/invite-access-screen";
import { PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1 } from "../features/action-center/data/pending-synthetic-analysis-submit";

describe("InviteAccessScreen", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("clears a stale pending analysis identity on a new invite entry", () => {
    window.sessionStorage.setItem(
      PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1,
      "55555555-5555-4555-8555-555555555555",
    );

    render(<InviteAccessScreen />);

    expect(window.sessionStorage.getItem(
      PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1,
    )).toBeNull();
  });

  it("states the local synthetic boundary without claiming production authentication", () => {
    render(<InviteAccessScreen />);

    expect(
      screen.getByRole("heading", {
        name: "先把学校邮件，变成今天的下一步。",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "输入邀请码，进入合成演示",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/不创建账户、不验证身份/)).toBeInTheDocument();
    expect(screen.getByText(/未接 Outlook、Gmail/)).toBeInTheDocument();
    expect(screen.getByText(/未调用模型、未部署/)).toBeInTheDocument();
    expect(screen.queryByText(/安全登录|账户已认证|正式用户/)).not.toBeInTheDocument();
    const currentStep = screen
      .getByRole("list", { name: "本地演示流程" })
      .querySelector('[aria-current="step"]');
    expect(currentStep).toHaveTextContent("邀请码");
  });

  it("uses a password field, visible label and same-origin POST form", () => {
    const { container } = render(<InviteAccessScreen />);
    const input = screen.getByLabelText("邀请码");
    const form = container.querySelector("form");

    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("name", "inviteCode");
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/demo-access/session");
    expect(
      screen.getByRole("button", { name: "进入合成演示" }),
    ).toBeInTheDocument();
  });

  it("keeps the invite code successful in native form data while submitting", () => {
    const { container } = render(<InviteAccessScreen />);
    const input = screen.getByLabelText("邀请码");
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    if (form === null) return;

    fireEvent.change(input, { target: { value: "synthetic-demo-code" } });
    fireEvent.submit(form);

    expect(input).toHaveAttribute("readonly");
    expect(input).not.toBeDisabled();
    expect(new FormData(form).get("inviteCode")).toBe("synthetic-demo-code");
  });

  it("validates an empty invite next to the field and returns focus", () => {
    const { container } = render(<InviteAccessScreen />);
    const input = screen.getByLabelText("邀请码");
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    if (form === null) return;

    fireEvent.submit(form);

    expect(screen.getByRole("alert")).toHaveTextContent("请输入邀请码");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(input);
  });

  it("can reveal the invite without changing or submitting it", () => {
    render(<InviteAccessScreen />);
    const input = screen.getByLabelText("邀请码");
    const toggle = screen.getByRole("button", { name: "显示邀请码" });
    fireEvent.change(input, { target: { value: "local-demo-value" } });

    fireEvent.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("local-demo-value");
    expect(
      screen.getByRole("button", { name: "隐藏邀请码" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("shows one unified server error and focuses the invite field", () => {
    render(
      <InviteAccessScreen error="邀请码无效或暂不可用，请检查后重试。" />,
    );

    const input = screen.getByLabelText("邀请码");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "邀请码无效或暂不可用",
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(input);
  });

  it("renders logout confirmation as status rather than an error", () => {
    render(<InviteAccessScreen notice="已退出本地合成演示。" />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "已退出本地合成演示",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
