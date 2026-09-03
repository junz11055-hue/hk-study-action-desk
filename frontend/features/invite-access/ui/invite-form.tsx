"use client";

import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { clearPendingSyntheticAnalysisSubmit } from "../../action-center/data/pending-synthetic-analysis-submit";
import styles from "./invite-access.module.css";

type InviteFormProps = Readonly<{
  initialError?: string;
}>;

const emptyInviteMessage = "请输入邀请码。";
const invalidInviteMessage = "邀请码无效或暂不可用，请检查后重试。";

export function InviteForm({ initialError }: InviteFormProps) {
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState(initialError ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    clearPendingSyntheticAnalysisSubmit();
    if (initialError !== undefined) {
      inputRef.current?.focus();
    }
  }, [initialError]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    const value = inputRef.current?.value.trim() ?? "";
    if (value.length === 0) {
      event.preventDefault();
      setError(emptyInviteMessage);
      inputRef.current?.focus();
      return;
    }
    if (value.length > 128) {
      event.preventDefault();
      setError(invalidInviteMessage);
      inputRef.current?.focus();
      return;
    }

    setError("");
    setIsSubmitting(true);
  };

  const handleInput = () => {
    if (error.length > 0) {
      setError("");
    }
  };

  return (
    <form
      action="/api/demo-access/session"
      aria-busy={isSubmitting}
      className={styles.form}
      method="post"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className={styles.fieldGroup}>
        <label htmlFor={inputId}>邀请码</label>
        <div className={styles.inputShell}>
          <KeyRound aria-hidden="true" size={19} />
          <input
            ref={inputRef}
            aria-describedby={`${helpId}${error.length > 0 ? ` ${errorId}` : ""}`}
            aria-invalid={error.length > 0}
            autoCapitalize="none"
            autoComplete="one-time-code"
            id={inputId}
            maxLength={128}
            name="inviteCode"
            onInput={handleInput}
            placeholder="粘贴邀请人提供的体验码"
            readOnly={isSubmitting}
            required
            spellCheck={false}
            type={isVisible ? "text" : "password"}
          />
          <button
            aria-label={isVisible ? "隐藏邀请码" : "显示邀请码"}
            aria-pressed={isVisible}
            className={styles.visibilityButton}
            disabled={isSubmitting}
            onClick={() => setIsVisible((current) => !current)}
            type="button"
          >
            {isVisible ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
            <span>{isVisible ? "隐藏" : "显示"}</span>
          </button>
        </div>
        <p className={styles.help} id={helpId}>
          邀请码只用于当前本机合成演示，不会创建真实账户。
        </p>
        {error.length > 0 ? (
          <p className={styles.error} id={errorId} role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <button
        className={styles.submitButton}
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "正在进入…" : "进入合成演示"}
      </button>
    </form>
  );
}
