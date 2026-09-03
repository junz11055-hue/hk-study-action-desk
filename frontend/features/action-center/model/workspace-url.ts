type WorkspaceHrefOptions = Readonly<{
  taskId?: string;
  notificationId?: string;
  focusNotificationId?: string;
}>;

export function workspaceHref(options: WorkspaceHrefOptions = {}): string {
  const query = new URLSearchParams();
  if (options.notificationId !== undefined) {
    query.set("notification", options.notificationId);
  }
  if (options.focusNotificationId !== undefined) {
    query.set("focus", options.focusNotificationId);
  }
  if (options.taskId !== undefined) {
    query.set("taskId", options.taskId);
  }

  const search = query.toString();
  const hash =
    options.focusNotificationId === undefined
      ? ""
      : `#notification-${encodeURIComponent(options.focusNotificationId)}`;
  return `/workspace${search.length === 0 ? "" : `?${search}`}${hash}`;
}
