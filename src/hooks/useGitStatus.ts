import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { bridge, onFileChange } from '../lib/tauri-bridge';

/* ================================================================
   Git working-tree status for the posh-git style status bar.

   Data source: `git status --porcelain=v1 --branch` (already
   allowlisted by run_git_command in the Rust backend). Refreshes on
   fs watcher events (debounced), window focus, and a polling interval
   (catches git commands whose changes no file watcher reports).
   Returns null when the working directory is not a git repository.
   ================================================================ */

export interface GitStatus {
  branch: string | null;
  /** Upstream ref, e.g. "origin/main" — null when no remote tracking */
  upstream: string | null;
  ahead: number;
  behind: number;
  added: number;
  modified: number;
  deleted: number;
}

/** Per-file status code → single change bucket (no double counting of
 *  staged + unstaged columns; `MM` counts once as modified). */
function bucketFor(x: string, y: string): keyof Pick<GitStatus, 'added' | 'modified' | 'deleted'> | null {
  if (x === '?' && y === '?') return 'added'; // untracked
  const cols = x + y;
  if (cols.includes('A')) return 'added';
  if (cols.includes('D')) return 'deleted';
  if (/[MRC]/.test(cols)) return 'modified';
  return null;
}

/** Parse `git status --porcelain=v1 --branch` output; null = not a repo. */
export function parseGitPorcelain(out: string): GitStatus | null {
  const lines = out.split('\n');
  const header = lines.find((l) => l.startsWith('## '));
  if (!header) return null;

  const status: GitStatus = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    added: 0,
    modified: 0,
    deleted: 0,
  };

  const body = header.slice(3);
  if (body.startsWith('No commits yet on ')) {
    // Repo with no commits: `git status -b` prints the branch as part of the sentence
    status.branch = body.slice('No commits yet on '.length);
  } else if (body.includes('...')) {
    // "main...origin/main [ahead 2, behind 1]" (flags only when upstream diverges)
    const [branch, rest] = body.split('...', 2);
    status.branch = branch;
    const flags = rest.match(/\[(.*)\]\s*$/)?.[1] ?? '';
    const ahead = flags.match(/ahead\s+(\d+)/)?.[1];
    const behind = flags.match(/behind\s+(\d+)/)?.[1];
    status.ahead = ahead ? parseInt(ahead, 10) : 0;
    status.behind = behind ? parseInt(behind, 10) : 0;
    status.upstream = rest.replace(/\s*\[.*\]\s*$/, '');
  } else {
    status.branch = body.trim() || null; // e.g. detached HEAD: "HEAD (no branch)"
  }

  for (const line of lines) {
    if (line.length < 2 || line.startsWith('#')) continue;
    const bucket = bucketFor(line[0], line[1]);
    if (bucket) status[bucket] += 1;
  }

  return status.branch ? status : null;
}

export function useGitStatus() {
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const dirRef = useRef(workingDirectory);
  dirRef.current = workingDirectory;
  // Skip a fetch if one is already in flight; queue one trailing refetch
  const busyRef = useRef(false);
  const pendingRef = useRef(false);
  // Whether the last fetch found a git repo — controls polling frequency
  const isRepoRef = useRef(true);
  // Poll tick counter — throttles polling outside git repos
  const pollTicksRef = useRef(0);

  const refresh = useCallback(async () => {
    const dir = dirRef.current;
    if (!dir) {
      setStatus(null);
      return;
    }
    if (busyRef.current) {
      pendingRef.current = true;
      return;
    }
    busyRef.current = true;
    try {
      const out = await bridge.runGitCommand(dir, ['status', '--porcelain=v1', '--branch']);
      const parsed = parseGitPorcelain(out);
      isRepoRef.current = parsed !== null;
      setStatus(parsed);
    } catch {
      // Not a git repo, git missing, or command rejected — hide the bar
      isRepoRef.current = false;
      setStatus(null);
    } finally {
      busyRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void refresh();
      }
    }
  }, []);

  useEffect(() => {
    setStatus(null);
    pollTicksRef.current = 0;
    if (!workingDirectory) return;

    void refresh();

    // Poll — catches commits/branch switches that no file watcher reports.
    // Inside a repo: every 5s. Outside (non-git dir): every 30s — a failing
    // `git status` per 5s would be wasted process spawns.
    const poll = setInterval(() => {
      if (isRepoRef.current || pollTicksRef.current++ % 6 === 0) void refresh();
    }, 5000);

    // File watcher events (debounced — builds can fire many events)
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let unlisten: (() => void) | null = null;
    void onFileChange((ev) => {
      if (ev.root !== workingDirectory) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(refresh, 400);
    }).then((fn) => {
      unlisten = fn;
    });

    // Refresh on window focus (e.g. after external git operations)
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(poll);
      if (debounce) clearTimeout(debounce);
      unlisten?.();
      window.removeEventListener('focus', onFocus);
    };
  }, [workingDirectory, refresh]);

  return status;
}
