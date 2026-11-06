/**
 * Vite's build-time env when a Vite app bundles this library, or `{}`.
 *
 * Lives in its own module because jest can't parse `import.meta`; the jest
 * config maps this file to a stub.
 */
export function viteEnv(): Record<string, string | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (import.meta as any).env ?? {};
}
