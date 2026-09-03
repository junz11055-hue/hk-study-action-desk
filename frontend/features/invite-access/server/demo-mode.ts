export function isHostedDemoMode(): boolean {
  return (
    process.env.NEXT_PUBLIC_DEMO_MODE === "hosted" ||
    process.env.DEMO_MODE === "hosted"
  );
}
