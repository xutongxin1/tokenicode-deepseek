import React, { memo, useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useLightboxStore } from './ImageLightbox';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFileStore } from '../../stores/fileStore';
import { bridge } from '../../lib/tauri-bridge';
import { rehypeKatexFix } from '../../lib/rehype-katex-fix';
import { useT } from '../../lib/i18n';
import {
  wrapBareFilePaths,
  resolvePathCandidate,
  getCachedResolution,
  resolveFolderCandidate,
  getCachedFolderResolution,
  isAbsolutePath,
  FILE_PATH_RE,
  FOLDER_PATH_RE,
  KNOWN_EXT_RE,
  KNOWN_FILE_EXTENSIONS,
  DIR_CANDIDATE_RE,
  looksLikeDirectory,
} from '../../lib/path-links';
import { FileIcon } from './FileIcon';
import 'katex/dist/katex.min.css';

/* ================================================================
   AsyncImage — loads local files via Rust base64 bridge
   ================================================================ */
function isLocalPath(src: string): boolean {
  return (
    src.startsWith('file://') ||
    src.startsWith('/') ||
    /^[A-Za-z]:[/\\]/.test(src)
  );
}

function AsyncImage({ src, alt }: { src: string; alt?: string }) {
  const t = useT();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const showThumbnails = useSettingsStore((s) => s.showImageThumbnails);

  useEffect(() => {
    const filePath = src.startsWith('file://') ? src.slice(7) : src;
    bridge.readFileBase64(filePath).then(setDataUrl).catch(() => setError(true));
  }, [src]);

  const filePath = src.startsWith('file://') ? src.slice(7) : src;
  const fileName = filePath.split(/[\\/]/).pop() || filePath;

  const handleClick = useCallback((e: React.MouseEvent) => {
    if ((e.ctrlKey || e.metaKey) && useSettingsStore.getState().ctrlClickOpenExternally) {
      bridge.openWithDefaultApp(filePath);
    } else {
      useLightboxStore.getState().openFile(filePath, alt);
    }
  }, [filePath, alt]);

  if (error) {
    return (
      <div className="my-3 rounded-xl overflow-hidden border border-border-subtle
        inline-block max-w-full">
        <div className="flex items-center justify-center gap-2 py-6 px-4
          text-xs text-text-muted bg-bg-secondary">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="2" width="14" height="12" rx="2" />
            <circle cx="5" cy="6" r="1.5" />
            <path d="M1 11l4-4 3 3 2-2 5 5" />
          </svg>
          {t('msg.imgError')}
        </div>
        {alt && (
          <div className="px-3 py-1.5 text-xs text-text-muted bg-bg-secondary
            border-t border-border-subtle">{alt}</div>
        )}
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div className="my-3 rounded-xl overflow-hidden border border-border-subtle
        inline-block bg-bg-secondary px-6 py-4">
        <span className="w-4 h-4 border-2 border-accent/30 border-t-accent
          rounded-full animate-spin inline-block" />
      </div>
    );
  }

  // Thumbnail mode: compact preview card
  if (showThumbnails) {
    return (
      <div className="my-2 rounded-lg overflow-hidden border border-border-subtle
        shadow-sm inline-block max-w-[240px] group cursor-pointer
        hover:border-accent/40 hover:shadow-md transition-all duration-200"
        onClick={handleClick}
        title={t('msg.clickToEnlarge') + (useSettingsStore.getState().ctrlClickOpenExternally ? ' — ' + t('msg.ctrlClickToOpenExternally') : '')}
      >
        <div className="relative bg-bg-secondary/50">
          <img
            src={dataUrl}
            alt={alt || ''}
            className="w-full h-36 object-cover"
          />
          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20
            transition-colors duration-200 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
              stroke="white" strokeWidth="1.5"
              className="opacity-0 group-hover:opacity-80 transition-opacity drop-shadow-sm">
              <circle cx="8" cy="8" r="5" />
              <path d="M12 12l5 5M8 5.5v5M5.5 8h5" />
            </svg>
          </div>
        </div>
        <div className="px-2.5 py-1.5 flex items-center gap-1.5">
          <span className="text-[10px]">🖼️</span>
          <span className="text-[11px] text-text-muted truncate flex-1">
            {alt || fileName}
          </span>
          <span className="text-[10px] text-text-tertiary opacity-0
            group-hover:opacity-100 transition-opacity">
            {t('msg.clickToView')}
          </span>
        </div>
      </div>
    );
  }

  // Full-size mode (original behavior)
  return (
    <div className="my-3 rounded-xl overflow-hidden border border-border-subtle
      shadow-sm inline-block max-w-full">
      <img
        src={dataUrl}
        alt={alt || ''}
        className="max-w-full max-h-96 object-contain cursor-zoom-in"
        onClick={handleClick}
      />
      {alt && (
        <div className="px-3 py-1.5 text-xs text-text-muted bg-bg-secondary
          border-t border-border-subtle">{alt}</div>
      )}
    </div>
  );
}

/* ================================================================
   CopyButton — hover-reveal copy for code blocks
   ================================================================ */
export function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 px-2 py-1 rounded-md text-[10px]
        font-medium opacity-0 group-hover:opacity-100 transition-smooth
        bg-bg-tertiary/80 text-text-muted hover:text-text-primary
        hover:bg-bg-tertiary border border-border-subtle"
    >
      {copied ? t('msg.copied') : t('msg.copyCode')}
    </button>
  );
}

/** Extract plain text from nested React nodes (for copy button) */
function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as any).props.children);
  }
  return '';
}

/* File-path regexes and bare-path wrapping live in src/lib/path-links.ts
   (shared with MessageBubble and unit-tested). */

/* ================================================================
   PathChip / ResolvablePathChip — clickable file paths in assistant text
   ================================================================ */

/** Clickable file-path chip — relative candidates display as-is; absolute
 *  ones show the full path (truncated only when extremely long; hover
 *  title always shows the resolved absolute path). Icon varies by file
 *  type (same FileIcon as the file tree).
 *  Click = preview in right panel; Ctrl/Cmd+click = open with the system
 *  default app (same as the file tree). */
function PathChip({ resolved, display }: { resolved: string; display?: string }) {
  return (
    <button
      onClick={(e) => {
        if ((e.ctrlKey || e.metaKey) && useSettingsStore.getState().ctrlClickOpenExternally) {
          bridge.openWithDefaultApp(resolved);
        } else {
          useFileStore.getState().selectFile(resolved);
        }
      }}
      onContextMenu={(e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          bridge.revealInFinder(resolved);
        }
      }}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5
        bg-accent/10 border border-accent/25 rounded-md
        text-xs text-accent font-medium cursor-pointer
        hover:bg-accent/20 hover:border-accent/40
        transition-all duration-150 select-none
        align-baseline leading-normal whitespace-nowrap"
      title={resolved}
    >
      <FileIcon name={resolved} size={12} className="flex-shrink-0" />
      <span className="max-w-[240px] truncate">{display ?? resolved}</span>
    </button>
  );
}

/** Path (absolute or relative) — verified against disk in the background.
 *  Renders as plain code until resolution settles; becomes a PathChip only
 *  if the path actually exists. Resolution is cached per (cwd, candidate),
 *  so each message processes each path at most once. */
function ResolvablePathChip({ candidate, base }: {
  candidate: string;
  base: string;
}) {
  const [state, setState] = useState<'pending' | 'missing' | { abs: string }>(() => {
    const hit = getCachedResolution(base, candidate);
    if (hit === undefined) return 'pending';
    return hit ? { abs: hit } : 'missing';
  });

  useEffect(() => {
    if (state !== 'pending') return;
    let cancelled = false;
    resolvePathCandidate(base, candidate).then((abs) => {
      if (!cancelled) setState(abs ? { abs } : 'missing');
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, candidate]);

  if (state !== 'pending' && state !== 'missing') {
    return (
      <PathChip
        resolved={state.abs}
        display={isAbsolutePath(candidate) ? state.abs : candidate}
      />
    );
  }
  // Pending or unresolvable — render as plain inline code
  return <code>{candidate}</code>;
}

/** Clickable folder chip — relative candidates display as-is (kept short);
 *  absolute ones show the full path. Hover title always shows the resolved
 *  absolute path.
 *  Click = reveal in file manager; Ctrl/Cmd+click = open with the system
 *  default app. */
function FolderChip({ resolved, display }: { resolved: string; display?: string }) {
  return (
    <button
      onClick={(e) => {
        if ((e.ctrlKey || e.metaKey) && useSettingsStore.getState().ctrlClickOpenExternally) {
          bridge.openWithDefaultApp(resolved);
        } else {
          bridge.revealInFinder(resolved);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        bridge.revealInFinder(resolved);
      }}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5
        bg-accent/10 border border-accent/25 rounded-md
        text-xs text-accent font-medium cursor-pointer
        hover:bg-accent/20 hover:border-accent/40
        transition-all duration-150 select-none
        align-baseline leading-normal whitespace-nowrap"
      title={resolved}
    >
      <FileIcon name={resolved} isDir size={12} className="flex-shrink-0" />
      <span className="max-w-[240px] truncate">{display ?? `${resolved}/`}</span>
    </button>
  );
}

/** Folder path (absolute or relative) — verified in the background via
 *  checkFileAccess (read_dir succeeds only for directories). Becomes a
 *  FolderChip only if the directory exists on disk. */
function ResolvableFolderChip({ candidate, base }: {
  candidate: string;
  base: string;
}) {
  const [state, setState] = useState<'pending' | 'missing' | { abs: string }>(() => {
    const hit = getCachedFolderResolution(base, candidate);
    if (hit === undefined) return 'pending';
    return hit ? { abs: hit } : 'missing';
  });

  useEffect(() => {
    if (state !== 'pending') return;
    let cancelled = false;
    resolveFolderCandidate(base, candidate).then((abs) => {
      if (!cancelled) setState(abs ? { abs } : 'missing');
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, candidate]);

  if (state !== 'pending' && state !== 'missing') {
    return (
      <FolderChip
        resolved={state.abs}
        // Relative candidates stay short (trailing slash restored — the
        // code handler strips it before resolution); absolute ones show
        // the full resolved path.
        display={isAbsolutePath(candidate) ? `${state.abs}/` : `${candidate}/`}
      />
    );
  }
  return <code>{candidate}</code>;
}

/* ================================================================
   MarkdownRenderer — shared markdown rendering with syntax highlighting
   ================================================================ */
interface Props {
  content: string;
  className?: string;
  /** Base path for resolving relative image paths (defaults to workingDirectory) */
  basePath?: string;
}

// Sanitize schema: GitHub defaults + className on all elements (needed for highlight.js)
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'style', 'ariaHidden'],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src || []), 'data'],
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RemarkPlugin = any;

const EMPTY_REMARK_PLUGINS: RemarkPlugin[] = [];
let cachedRemarkPlugins: RemarkPlugin[] | null = null;
let remarkPluginsPromise: Promise<RemarkPlugin[]> | null = null;
let warnedAboutGfmFallback = false;

function supportsRemarkGfmRegex(): boolean {
  try {
    // remark-gfm's autolink-literal dependency uses this exact regex shape.
    // Older WebKit parses `(?<=` as an invalid group specifier and crashes
    // during module evaluation, so we gate the import on syntax support.
    void new RegExp(
      '(?<=^|\\s|\\p{P}|\\p{S})([-.\\w+]+)@([-\\w]+(?:\\.[-\\w]+)+)',
      'gu',
    );
    return true;
  } catch {
    return false;
  }
}

async function loadRemarkPlugins(): Promise<RemarkPlugin[]> {
  if (cachedRemarkPlugins) return cachedRemarkPlugins;

  if (!supportsRemarkGfmRegex()) {
    if (!warnedAboutGfmFallback) {
      warnedAboutGfmFallback = true;
      console.warn('[TOKENICODE] remark-gfm disabled: current JS runtime does not support its regex syntax');
    }
    cachedRemarkPlugins = EMPTY_REMARK_PLUGINS;
    return cachedRemarkPlugins;
  }

  if (!remarkPluginsPromise) {
    remarkPluginsPromise = Promise.all([
      import('remark-gfm'),
      import('remark-cjk-friendly'),
      import('remark-math'),
    ])
      .then(([gfmMod, cjkMod, mathMod]) => {
        cachedRemarkPlugins = [gfmMod.default, cjkMod.default, mathMod.default];
        return cachedRemarkPlugins;
      })
      .catch((error) => {
        console.warn('[TOKENICODE] failed to load remark plugins, falling back to basic markdown', error);
        cachedRemarkPlugins = EMPTY_REMARK_PLUGINS;
        return cachedRemarkPlugins;
      });
  }

  return remarkPluginsPromise;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Pipeline order is critical:
//  1. rehypeRaw       — parse raw HTML in markdown
//  2. rehypeKatexFix  — fix common LaTeX syntax before sanitize
//  3. rehypeSanitize   — sanitize with KaTeX-friendly schema
//  4. rehypeHighlight — highlight code blocks (not math)
//  5. rehypeKatex     — render KaTeX math nodes LAST
const REHYPE_PLUGINS: any[] = [
  rehypeRaw,
  rehypeKatexFix,
  [rehypeSanitize, SANITIZE_SCHEMA],
  rehypeHighlight,
  rehypeKatex,
];

/** Error boundary scoped to a single markdown block.
 *  A malformed message (e.g. truncated table from rate-limit) crashes only
 *  its own bubble, not the entire app. */
class MarkdownErrorBoundary extends React.Component<
  { children: ReactNode; fallback: string },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: string }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.warn('[MarkdownRenderer] render failed, falling back to plain text:', error.message);
  }
  render() {
    if (this.state.hasError) {
      return (
        <pre className="whitespace-pre-wrap break-words text-xs text-text-secondary">
          {this.props.fallback}
        </pre>
      );
    }
    return this.props.children;
  }
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className, basePath }: Props) {
  const t = useT();
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const pathLinksEnabled = useSettingsStore((s) => s.pathLinksEnabled);
  const resolveBase = basePath || workingDirectory || '';
  const [remarkPlugins, setRemarkPlugins] = useState<RemarkPlugin[]>(() => cachedRemarkPlugins ?? EMPTY_REMARK_PLUGINS);

  useEffect(() => {
    if (cachedRemarkPlugins !== null) return;

    let cancelled = false;
    loadRemarkPlugins().then((plugins) => {
      if (!cancelled) setRemarkPlugins(plugins);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Pre-process: wrap bare file paths in backticks so `code` handler makes them clickable
  const processedContent = useMemo(
    () => (pathLinksEnabled ? wrapBareFilePaths(content) : content),
    [content, pathLinksEnabled],
  );

  // Stable components object — only recreated if `t` or resolveBase changes
  const components = useMemo(() => ({
    table: ({ children }: { children?: ReactNode }) => (
      <div className="my-3 overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full border-collapse text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: ReactNode }) => (
      <thead className="bg-bg-secondary">{children}</thead>
    ),
    th: ({ children }: { children?: ReactNode }) => (
      <th className="px-3 py-2 text-left font-medium text-text-muted
        border-b border-border-subtle text-[11px]">{children}</th>
    ),
    td: ({ children }: { children?: ReactNode }) => (
      <td className="px-3 py-2 text-text-primary border-b border-border-subtle
        text-xs">{children}</td>
    ),
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      // Detect false-positive autolinks: remark-gfm treats file-like text
      // (e.g. AGENTS.md, config.rs) as URLs because some extensions are
      // valid TLDs (.md = Moldova, .rs = Serbia, .sh = St. Helena, etc.)
      const childText = typeof children === 'string' ? children : '';
      const FILE_EXT_RE = /\.(md|txt|json|ts|tsx|js|jsx|py|rs|go|toml|yaml|yml|html|css|sh|log|env|cfg|ini|xml|csv|sql|lock|swift|kt|java|c|h|cpp|hpp|rb|lua|zig|vue|svelte)$/i;
      if (
        href &&
        FILE_EXT_RE.test(childText) &&
        (href === `http://${childText}` || href === `https://${childText}`)
      ) {
        return <code className="rounded bg-black/[0.06] px-1 py-0.5 text-[0.9em] dark:bg-white/[0.08]">{children}</code>;
      }

      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (href) openUrl(href);
          }}
          className="text-accent hover:underline inline-flex items-center
            gap-0.5 cursor-pointer"
          title={href}
        >
          {children}
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            className="flex-shrink-0 opacity-60">
            <path d="M4.5 1.5h6v6M10.5 1.5L4 8" />
          </svg>
        </a>
      );
    },
    img: ({ src, alt }: { src?: string; alt?: string }) => {
      // Resolve relative paths against the working directory
      let resolvedSrc = src || '';
      if (
        resolvedSrc &&
        !resolvedSrc.startsWith('file://') &&
        !resolvedSrc.startsWith('/') &&
        !resolvedSrc.startsWith('data:') &&
        !resolvedSrc.startsWith('http://') &&
        !resolvedSrc.startsWith('https://') &&
        !/^[A-Za-z]:[/\\]/.test(resolvedSrc) &&
        resolveBase
      ) {
        const base = resolveBase.endsWith('/') ? resolveBase : resolveBase + '/';
        resolvedSrc = `${base}${resolvedSrc}`;
      }

      // Local files: load via Rust base64 bridge (file:// URLs don't work in Tauri webview)
      if (isLocalPath(resolvedSrc)) {
        return <AsyncImage src={resolvedSrc} alt={alt || undefined} />;
      }

      // Remote URLs & data URIs: render directly
      return (
      <div className="my-3 rounded-xl overflow-hidden border border-border-subtle
        shadow-sm inline-block max-w-full">
        <img
          src={resolvedSrc}
          alt={alt || ''}
          className="max-w-full max-h-96 object-contain cursor-zoom-in"
          onClick={() => {
            if (!resolvedSrc) return;
            if (resolvedSrc.startsWith('data:')) {
              useLightboxStore.getState().open(resolvedSrc, undefined, alt);
            } else {
              openUrl(resolvedSrc);
            }
          }}
          onError={(e) => {
            const el = e.currentTarget;
            el.style.display = 'none';
            const placeholder = el.nextElementSibling;
            if (placeholder) (placeholder as HTMLElement).style.display = 'flex';
          }}
        />
        <div className="hidden items-center justify-center gap-2 py-6 px-4
          text-xs text-text-muted bg-bg-secondary">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="2" width="14" height="12" rx="2" />
            <circle cx="5" cy="6" r="1.5" />
            <path d="M1 11l4-4 3 3 2-2 5 5" />
          </svg>
          {t('msg.imgError')}
        </div>
        {alt && (
          <div className="px-3 py-1.5 text-xs text-text-muted bg-bg-secondary
            border-t border-border-subtle">
            {alt}
          </div>
        )}
      </div>
      );
    },
    pre: ({ children }: { children?: ReactNode }) => {
      const codeText = extractText(children);
      return (
        <div className="relative group my-3">
          <CopyButton text={codeText} />
          <pre className="bg-bg-secondary rounded-xl p-4
            border border-border-subtle overflow-x-auto">
            {children}
          </pre>
        </div>
      );
    },
    code: ({ children, className }: { children?: ReactNode; className?: string }) => {
      // Fenced code blocks (language-xxx) — don't intercept, let <pre> handle them
      if (className) return <code className={className}>{children}</code>;
      // Path chips disabled — render plain inline code, no clickable paths
      if (!pathLinksEnabled) {
        return <code>{children}</code>;
      }

      const text = extractText(children).trim();
      // Every chip — absolute or relative — goes through background
      // existence verification, so truncated paths like
      // `.../55433fdd-....jsonl` never become clickable.
      if (FOLDER_PATH_RE.test(text)) {
        // Folder paths (trailing separator) — folder chip (FileIcon)
        return (
          <ResolvableFolderChip
            candidate={text.replace(/[\\/]+$/, '')}
            base={resolveBase}
          />
        );
      }
      const ext = text.split('.').pop()?.toLowerCase() ?? '';
      if (((FILE_PATH_RE.test(text) || KNOWN_EXT_RE.test(text)) && KNOWN_FILE_EXTENSIONS.has(ext))) {
        return <ResolvablePathChip candidate={text} base={resolveBase} />;
      }
      // Path-shaped text whose last segment has no known extension
      // (C:/GitProject/ToCC, src/components) — treat as a directory
      // candidate; checkFileAccess only succeeds if it really is one.
      if (DIR_CANDIDATE_RE.test(text) && looksLikeDirectory(text)) {
        return (
          <ResolvableFolderChip
            candidate={text.replace(/[\\/]+$/, '')}
            base={resolveBase}
          />
        );
      }
      return <code>{children}</code>;
    },
  }), [t, resolveBase, pathLinksEnabled]);

  return (
    <div className={`prose prose-sm max-w-none
      prose-code:bg-bg-secondary prose-code:px-1.5 prose-code:py-0.5
      prose-code:rounded-md prose-code:text-sm prose-code:text-accent
      prose-pre:bg-bg-secondary prose-pre:rounded-xl prose-pre:p-4
      prose-pre:border prose-pre:border-border-subtle
      prose-headings:text-text-primary prose-a:text-accent
      prose-strong:text-text-primary ${className || ''}`}>
      <MarkdownErrorBoundary fallback={content}>
        <Markdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={REHYPE_PLUGINS}
          components={components}
        >
          {processedContent}
        </Markdown>
      </MarkdownErrorBoundary>
    </div>
  );
});
