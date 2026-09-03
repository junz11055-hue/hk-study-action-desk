"use client";

import {
  useEffect,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

type FocusTargetProps = Readonly<{
  targetId: string | null;
  requestKey?: number;
}>;

export function FocusTarget({ targetId, requestKey }: FocusTargetProps) {
  useEffect(() => {
    if (targetId === null) {
      return;
    }

    let animationFrameId = 0;
    let attemptsRemaining = 12;

    const focusWhenVisible = () => {
      const matchingTargets = Array.from(
        document.querySelectorAll<HTMLElement>("[id]"),
      ).filter((element) => element.id === targetId);
      const target =
        matchingTargets.find((element) => element.getClientRects().length > 0) ??
        (matchingTargets.length === 1 ? matchingTargets[0] : null);
      if (target instanceof HTMLElement) {
        target.focus();
        if (document.activeElement === target && target.getClientRects().length > 0) {
          return;
        }
      }

      attemptsRemaining -= 1;
      if (attemptsRemaining > 0) {
        animationFrameId = window.requestAnimationFrame(focusWhenVisible);
      }
    };

    focusWhenVisible();

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [requestKey, targetId]);

  return null;
}

type EvidenceDisclosureLinkProps = Readonly<{
  children: ReactNode;
  detailsId: string;
  href: string;
}>;

export function EvidenceDisclosureLink({
  children,
  detailsId,
  href,
}: EvidenceDisclosureLinkProps) {
  const revealEvidence = () => {
    const matchingTargets = Array.from(
      document.querySelectorAll<HTMLDetailsElement>("details[id]"),
    ).filter((element) => element.id === detailsId);
    const details =
      matchingTargets.find((element) => element.getClientRects().length > 0) ??
      (matchingTargets.length === 1 ? matchingTargets.at(0) ?? null : null);
    if (details === null) return;

    const summary = details.querySelector<HTMLElement>(":scope > summary");
    if (summary === null) return;

    details.open = true;
    summary.focus();
  };
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    revealEvidence();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    revealEvidence();
  };

  return (
    <a
      aria-controls={detailsId}
      href={href}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {children}
    </a>
  );
}
