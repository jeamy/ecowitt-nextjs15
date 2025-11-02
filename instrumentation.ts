// Only register instrumentation for Node.js runtime, not Edge
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" || !process.env.NEXT_RUNTIME) {
    const { register: nodeRegister } = await import("./src/instrumentation");
    return nodeRegister();
  }
}
