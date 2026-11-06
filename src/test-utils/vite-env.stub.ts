// Jest stand-in for src/utils/vite-env.ts, which uses `import.meta`.
export function viteEnv(): Record<string, string | undefined> {
  return {};
}
