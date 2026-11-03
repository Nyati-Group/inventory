export async function register() {
  // NEXT_RUNTIME is inlined at compile time, so the edge bundle never pulls in the Node-only job runner.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
