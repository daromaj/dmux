/**
 * Env-var read fallback for the dmux -> qmux rebrand.
 *
 * Panes and hooks spawned by an old `dmux` binary (or old shell rc files that
 * still export DMUX_* vars) may be running concurrently with a newer `qmux`
 * binary during the transition. Reads should prefer QMUX_<suffix> but fall
 * back to the legacy DMUX_<suffix> so those in-flight panes/hooks keep working.
 *
 * Writes should only ever set QMUX_<suffix> - no fallback needed there.
 */
export function getQmuxEnv(suffix: string): string | undefined {
  return process.env[`QMUX_${suffix}`] ?? process.env[`DMUX_${suffix}`];
}
