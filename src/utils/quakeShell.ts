import { spawn } from 'child_process';

export interface QuakeShellOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
}

/**
 * Run a shell/tmux command for the quake assistant and return combined
 * stdout + stderr + exit info as a single string. Unlike execAsync this never
 * rejects — a non-zero exit, timeout, or abort is reported in the returned text
 * so it can be fed straight back to the model.
 */
export function runQuakeShell(command: string, opts: QuakeShellOptions): Promise<string> {
  const { cwd, env, signal, timeoutMs } = opts;

  return new Promise((resolve) => {
    const proc = spawn(command, [], {
      shell: true,
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    let settled = false;

    const finish = (tail?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      const parts: string[] = [];
      if (out.trim()) parts.push(out.trimEnd());
      if (err.trim()) parts.push(`[stderr]\n${err.trimEnd()}`);
      if (tail) parts.push(tail);
      resolve(parts.join('\n') || '(no output)');
    };

    const onAbort = () => {
      proc.kill('SIGTERM');
      finish('[aborted]');
    };

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      finish(`[timed out after ${timeoutMs}ms]`);
    }, timeoutMs);

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    proc.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
    });
    proc.stderr?.on('data', (d: Buffer) => {
      err += d.toString();
    });
    proc.on('error', (e: Error) => finish(`[error] ${e.message}`));
    proc.on('close', (code: number | null) => {
      finish(code && code !== 0 ? `[exit ${code}]` : undefined);
    });
  });
}
