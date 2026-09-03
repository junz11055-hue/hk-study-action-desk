export const workspaceViews = [
  "notifications",
  "managed",
  "guides",
  "settings",
] as const;

export type WorkspaceView = (typeof workspaceViews)[number];

export function isReferenceWorkspaceView(
  value: string,
): value is Exclude<WorkspaceView, "notifications"> {
  return value === "managed" || value === "guides" || value === "settings";
}
