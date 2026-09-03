export function isHostedDemoMode(): boolean {
  return process.env.DEMO_MODE === "hosted";
}
