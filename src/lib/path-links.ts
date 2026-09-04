/**
 * path-links — pure helpers + background resolution cache for rendering
 * file paths inside assistant text output as clickable links.
 *
 * - Absolute paths (/, C:\..., C:/...) are clickable immediately.
 * - Relative paths are resolved against the working directory in the
 *   background (existence check via the Rust backend) and only rendered
 *   clickable once resolution succeeds. Results are cached per
 *   (cwd, candidate) so each unique path is checked exactly once per
 *   app session — this is what makes "process each message once" cheap:
 *   repeated renders hit the cache instead of the filesystem.
 */
import { bridge } from './tauri-bridge';

/* ------------------------------------------------------------------ */
/*  Path classification                                                */
/* ------------------------------------------------------------------ */

export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || p.startsWith('\\\\') || /^[a-zA-Z]:[/\\]/.test(p);
}

/** Join a relative candidate onto cwd (forward-slash result). */
export function joinPath(cwd: string, candidate: string): string {
  if (!cwd) return candidate;
  const base = cwd.replace(/[\\/]+$/, '');
  const clean = candidate.replace(/^\.\//, '');
  return `${base}/${clean}`;
}

/* ------------------------------------------------------------------ */
/*  File-path detection regexes                                        */
/* ------------------------------------------------------------------ */

/** Known code/config file extensions — shared between bare-path wrapping
 *  and inline code detection. */
export const KNOWN_FILE_EXTENSIONS = new Set([
  'md', 'mdx', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonl',
  'toml', 'yaml', 'yml', 'py', 'pyi', 'rs', 'go', 'html', 'htm', 'css',
  'scss', 'sass', 'less', 'vue', 'svelte', 'sh', 'bash', 'zsh', 'fish',
  'env', 'conf', 'cfg', 'ini', 'xml', 'sql', 'graphql', 'gql', 'proto',
  'lock', 'log', 'txt', 'csv', 'rb', 'php', 'java', 'kt', 'swift', 'c',
  'cpp', 'h', 'hpp', 'cs', 'r', 'lua', 'zig', 'ex', 'exs', 'erl', 'ml',
  'mli', 'tf', 'hcl', 'dockerfile', 'makefile', 'mat', 'png', 'jpg', 'jpeg',
  'gif', 'svg', 'webp', 'ico', 'wasm', 'map',
]);

/** Extension alternatives shared by the two bare-name regexes below. */
const KNOWN_EXT_ALT = 'md|mdx|ts|tsx|js|jsx|mjs|cjs|json|jsonl|toml|yaml|yml|py|pyi|rs|go|html|htm|css|scss|sass|less|vue|svelte|sh|bash|zsh|fish|env|conf|cfg|ini|xml|sql|graphql|gql|proto|lock|log|txt|csv|rb|php|java|kt|swift|c|cpp|h|hpp|cs|r|lua|zig|ex|exs|erl|ml|mli|tf|hcl|dockerfile|makefile|mat';

/** Bare filenames with known code/config extensions (CLAUDE.md, package.json). */
export const KNOWN_EXT_RE = new RegExp(`^[\\w][\\w.-]*\\.(?:${KNOWN_EXT_ALT})$`, 'i');

/** Bare known-extension filenames in prose (chunk_XX.mat, make_v2.py) —
 *  wrapped into inline code so the `code` handler can make them clickable.
 *  The prefix class rejects `/`, `\`, backticks AND hyphens, so a filename
 *  that is the tail of a longer path is never double-wrapped — the hyphen
 *  rejection matters for UUID tails (`…/55433fdd-fea3….jsonl` was re-wrapped
 *  as `fea3….jsonl` inside an already-wrapped full path). */
const BARE_KNOWN_NAME_RE = new RegExp(`(^|[^\`\\w.:@#/\\\\-])([\\w][\\w.-]*\\.(?:${KNOWN_EXT_ALT}))(?=[\`\\s,，。;；:：)）]|$)`, 'gi');

/**
 * Detect file paths in inline code — conservative regex to avoid false
 * positives. Matches: absolute paths (/foo.ts, C:\foo.ts), path-prefixed
 * files (./bar.md, src/baz.rs, tmp/logs/x.txt), dot-directory paths
 * (.history/foo.py) and bare filenames with known extensions (handled
 * separately via KNOWN_EXT_RE). The generic segment branch
 * (`[\w@+-][\w.@+-]*[\\/]`) covers any project-relative directory, while
 * the `(?!\.)` guard keeps truncated `.../xxx.jsonl` paths from matching.
 */
export const FILE_PATH_RE = /^(?:\/|\.\.?[\\/]|\.(?!\.)[\w.-]*[\\/]|[\w@+-][\w.@+-]*[\\/]|[a-zA-Z]:[\\/])[\w.@/\\ -]+\.\w{1,10}$/;

/**
 * Bare (non-backticked) file paths in prose. Matches absolute paths
 * (/, C:\..., C:/...), relative (./..., ../...) and any project-relative
 * path (tmp/v0789_probe/log_w1..6.txt, src/foo.ts). Windows absolute paths
 * may contain spaces. The `(?!\.)` guard keeps truncated paths with leading
 * ellipses (`.../55433fdd-....jsonl`) from being wrapped.
 */
export const BARE_PATH_RE = /(^|[^`\w.:@#/])((?:\/(?:[\w.@+-]+\/)*[\w.@+-]+\.\w{1,10}|(?:\.\.?\/|\.(?!\.)[\w.-]*\/|[\w@+-][\w.@+-]*\/)+[\w.@+-]+\.\w{1,10}|[a-zA-Z]:[\\/](?:[\w.@+ -]+[\\/])*[\w.@+ -]+\.\w{1,10}))(?![`\w.])/g;

/**
 * Folder paths (trailing separator) in inline code — e.g. `src/components/`,
 * `C:\Users\xtx\.claude\`, `tmp/logs/`. The trailing slash/backslash is what
 * marks a path as a directory rather than a file.
 */
export const FOLDER_PATH_RE = /^(?:\/|\.\.?[\\/]|\.(?!\.)[\w.-]*[\\/]|[\w@+-][\w.@+-]*[\\/]|[a-zA-Z]:[\\/])[\w.@/\\ +-]+[\\/]$/;

/**
 * Bare folder paths in prose — same shape as BARE_PATH_RE but requiring a
 * trailing separator. The negative lookahead `(?![`\w.])` prevents matching
 * the directory prefix of a longer path (`src/components/foo.ts` or
 * `C:/Users/xtx/.claude/...` must not become a folder chip for the prefix).
 */
export const BARE_FOLDER_PATH_RE = /(^|[^`\w.:@#/])((?:\/|\.\.?\/|\.(?!\.)[\w.-]*\/|[\w@+-][\w.@+-]*\/)+[\w.@+-]+\/|[a-zA-Z]:[\\/](?:[\w.@+ -]+[\\/])+)(?![`\w.])/g;

/**
 * Path-shaped text with no trailing separator — used to detect directory
 * candidates that lack a known file extension (e.g. `C:/GitProject/ToCC`,
 * `src/components`). The lookahead also rejects `/` and `\` so the
 * directory prefix of a longer path never matches. Bare variant wraps such
 * paths in backticks; the callback skips anything whose last segment has a
 * known file extension (those are handled by BARE_PATH_RE).
 */
export const DIR_CANDIDATE_RE = /^(?:\/|\.\.?[\\/]|\.(?!\.)[\w.-]*[\\/]|[\w@+-][\w.@+-]*[\\/]|[a-zA-Z]:[\\/])[\w.@/\\ +-]+$/;

export const BARE_DIR_CANDIDATE_RE = /(^|[^`\w.:@#/])((?:\/|\.\.?\/|\.(?!\.)[\w.-]*\/|[\w@+-][\w.@+-]*\/)+[\w.@+-]+|[a-zA-Z]:[\\/](?:[\w.@+ -]+[\\/])*[\w.@+ -]+)(?![`\w./\\])/g;

/** Last path segment contains no dot → directory candidate. A dot inside
 *  the segment marks a file extension (deferred to the file-path logic,
 *  known or not); a LEADING dot (.claude, .git) is a hidden directory.
 *  Verification (read_dir) still has the final say. */
export function looksLikeDirectory(path: string): boolean {
  const last = path.split(/[\\/]/).filter(Boolean).pop() || '';
  if (!last) return false;
  return last.indexOf('.') <= 0;
}

/**
 * Pre-process markdown to wrap bare file paths in backticks so the
 * `code` component handler can make them clickable.
 *
 * Only processes text outside fenced code blocks, inline code, and
 * markdown link targets. Only wraps paths whose extension is a known
 * code/config file type (avoids wrapping prose like "a.b").
 */
/** Shared guard: skip matches that sit inside markdown link targets. */
function insideMarkdownLinkTarget(str: string, pathStart: number): boolean {
  if (pathStart > 0 && str[pathStart - 1] === '(') return true;
  const before = str.slice(Math.max(0, pathStart - 2), pathStart);
  return before.endsWith('](');
}

export function wrapBareFilePaths(content: string): string {
  // Split by fenced code blocks (``` ... ```) — don't touch code blocks
  const fenced = content.split(/(```[\s\S]*?```)/g);
  return fenced.map((part, i) => {
    if (i % 2 === 1) return part; // inside fenced code block
    // Split by inline code (` ... `) — don't double-wrap
    const inlined = part.split(/(`[^`\n]+`)/g);
    return inlined.map((seg, j) => {
      if (j % 2 === 1) return seg; // inside inline code
      // Folder paths first — they consume trailing-slash paths so the file
      // regex never sees a folder's segments as a partial file match.
      const foldersWrapped = seg.replace(BARE_FOLDER_PATH_RE, (match, prefix, path, offset, str) => {
        const pathStart = offset + prefix.length;
        if (insideMarkdownLinkTarget(str, pathStart)) return match;
        return `${prefix}\`${path}\``;
      });
      // Extension-less path-shaped text (C:/GitProject/ToCC, src/components)
      // → directory candidates; skip anything whose last segment looks like
      // a known file extension (BARE_PATH_RE handles those).
      const dirsWrapped = foldersWrapped.replace(BARE_DIR_CANDIDATE_RE, (match, prefix, path, offset, str) => {
        const pathStart = offset + prefix.length;
        if (insideMarkdownLinkTarget(str, pathStart)) return match;
        if (!looksLikeDirectory(path)) return match;
        return `${prefix}\`${path}\``;
      });
      const pathsWrapped = dirsWrapped.replace(BARE_PATH_RE, (match, prefix, path, offset, str) => {
        const pathStart = offset + prefix.length;
        // Don't wrap if inside a markdown link target: ...](path)
        if (insideMarkdownLinkTarget(str, pathStart)) return match;
        // Only wrap if extension is a known code/config file type
        const ext = path.split('.').pop()?.toLowerCase();
        if (!ext || !KNOWN_FILE_EXTENSIONS.has(ext)) return match;
        return `${prefix}\`${path}\``;
      });
      // Bare filenames with known extensions in prose (make_v2.py, chunk_XX.mat).
      // The prefix class rejects backticks and path separators, so filenames
      // already wrapped above (or tails of longer paths) are never re-wrapped.
      return pathsWrapped.replace(BARE_KNOWN_NAME_RE, (match, prefix, name, offset, str) => {
        const nameStart = offset + prefix.length;
        if (insideMarkdownLinkTarget(str, nameStart)) return match;
        return `${prefix}\`${name}\``;
      });
    }).join('');
  }).join('');
}

/* ------------------------------------------------------------------ */
/*  Background resolution cache                                        */
/* ------------------------------------------------------------------ */

const resolvedCache = new Map<string, string | null>();
const pendingCache = new Map<string, Promise<string | null>>();

function cacheKey(cwd: string, candidate: string): string {
  return `${cwd}\u0000${candidate}`;
}

/** Synchronous cache read. undefined = not resolved yet. */
export function getCachedResolution(cwd: string, candidate: string): string | null | undefined {
  return resolvedCache.get(cacheKey(cwd, candidate));
}

/**
 * Resolve a relative path candidate against cwd in the background.
 * Returns the absolute path if it exists on disk, null otherwise.
 * Cached per (cwd, candidate) — concurrent callers share one backend call.
 */
export function resolvePathCandidate(cwd: string, candidate: string): Promise<string | null> {
  const key = cacheKey(cwd, candidate);
  const hit = resolvedCache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const pending = pendingCache.get(key);
  if (pending) return pending;

  // Absolute candidates are verified as-is (no cwd join); every chip —
  // absolute or relative — is only rendered after an existence check, so
  // truncated/false-positive paths never become clickable.
  const abs = isAbsolutePath(candidate)
    ? candidate.replace(/[\\/]+$/, '')
    : joinPath(cwd, candidate);
  const promise = bridge.getFileSize(abs)
    .then(() => abs)
    .catch(() => null)
    .then((result) => {
      resolvedCache.set(key, result);
      pendingCache.delete(key);
      return result;
    });
  pendingCache.set(key, promise);
  return promise;
}

/* ------------------------------------------------------------------ */
/*  Folder resolution cache (checkFileAccess = read_dir on the Rust   */
/*  side, which succeeds only for directories)                        */
/* ------------------------------------------------------------------ */

const resolvedFolderCache = new Map<string, string | null>();
const pendingFolderCache = new Map<string, Promise<string | null>>();

/** Synchronous folder-cache read. undefined = not resolved yet. */
export function getCachedFolderResolution(cwd: string, candidate: string): string | null | undefined {
  return resolvedFolderCache.get(cacheKey(cwd, candidate));
}

/** Resolve a relative folder candidate against cwd in the background. */
export function resolveFolderCandidate(cwd: string, candidate: string): Promise<string | null> {
  const key = cacheKey(cwd, candidate);
  const hit = resolvedFolderCache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const pending = pendingFolderCache.get(key);
  if (pending) return pending;

  const abs = isAbsolutePath(candidate)
    ? candidate.replace(/[\\/]+$/, '')
    : joinPath(cwd, candidate);
  const promise = bridge.checkFileAccess(abs)
    .then((ok) => (ok ? abs : null))
    .catch(() => null)
    .then((result) => {
      resolvedFolderCache.set(key, result);
      pendingFolderCache.delete(key);
      return result;
    });
  pendingFolderCache.set(key, promise);
  return promise;
}
