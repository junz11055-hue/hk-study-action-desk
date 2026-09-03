import { isTrustedCalendarInstant } from "../data/synthetic-date-facts.js";

export class CalendarPreviewError extends Error {
  constructor(message, statusCode = 422) {
    super(message);
    this.name = "CalendarPreviewError";
    this.statusCode = statusCode;
  }
}

export function createCalendarPreview({ email, card, actionId, dateId }) {
  if (!email || !card || card.messageId !== email.id) {
    throw new CalendarPreviewError("The analyzed message is not available", 404);
  }

  const action = card.actions.find((item) => item.id === actionId);
  const date = card.dates.find((item) => item.id === dateId);
  if (!action || !date) {
    throw new CalendarPreviewError("The action or date does not belong to this message");
  }
  if (!action.calendarEligible || action.dueAt === null) {
    throw new CalendarPreviewError("This action is not eligible for calendar preview");
  }
  if (
    date.normalizedAt === null ||
    date.timezone !== "Asia/Hong_Kong" ||
    date.confidence === "low" ||
    !["confirmed", "updated"].includes(date.status)
  ) {
    throw new CalendarPreviewError("The date needs confirmation before a preview can be created");
  }
  if (action.dueAt !== date.normalizedAt) {
    throw new CalendarPreviewError("The selected action and date do not match");
  }
  if (!isTrustedCalendarInstant(email.id, date.normalizedAt)) {
    throw new CalendarPreviewError("The selected date is not a trusted calendar start or deadline");
  }

  const evidence = date.evidenceIds.map((evidenceId) => {
    const item = card.evidence.find((candidate) => candidate.id === evidenceId);
    if (!item) throw new CalendarPreviewError("Calendar evidence is incomplete");
    return { id: item.id, quote: item.quote };
  });

  return Object.freeze({
    previewOnly: true,
    synthetic: true,
    title: `[演示] ${action.labelZh}`,
    startsAt: date.normalizedAt,
    timezone: "Asia/Hong_Kong",
    reminderMinutesBefore: 1_440,
    sourceMessage: {
      id: email.id,
      subject: email.subject,
      senderName: email.senderName,
    },
    evidence,
    disclaimer:
      "这是本地合成数据的日历预览，不会写入任何真实日历；管理该事项也不代表学校手续已经完成。",
  });
}
