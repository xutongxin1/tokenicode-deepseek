/**
 * Regression tests: verify the MarkdownRenderer turns file paths and folder
 * paths (absolute, backticked and bare) into clickable chips that display
 * the full resolved path — and that truncated / non-existent paths never
 * become chips.
 *
 * Every chip goes through background existence verification, so the tests
 * mock the tauri bridge and pre-warm the resolution caches (static render
 * does not run effects).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownRenderer } from '../../components/shared/MarkdownRenderer';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  resolvePathCandidate,
  resolveFolderCandidate,
} from '../../lib/path-links';

vi.mock('../../lib/tauri-bridge', () => ({
  bridge: {
    getFileSize: vi.fn(async (p: string) => {
      if (p.startsWith('C:/Users/xtx/.claude/projects/') && p.endsWith('.jsonl')) return 12345;
      if (p === 'C:/GitProject/DPEFM-Prony/.history/v0.7.7/_v0882_analysis.py') return 5678;
      throw new Error('not a file');
    }),
    checkFileAccess: vi.fn(async (p: string) => {
      if (p === 'C:/Users/xtx/.claude' || p === 'C:/GitProject/ToCC' || p === 'src/components') {
        return true;
      }
      return false;
    }),
    openWithDefaultApp: vi.fn(),
    revealInFinder: vi.fn(),
    readFileBase64: vi.fn(async () => ''),
  },
}));

const ABS = 'C:/Users/xtx/.claude/projects/c--GitProject-ToCC/55433fdd-fea3-443d-9a15-08725a6bf9b9.jsonl';
const FOLDER = 'C:/Users/xtx/.claude/';
const TRUNCATED = '.../55433fdd-fea3-443d-9a15-08725a6bf9b9.jsonl';

beforeAll(async () => {
  // Pre-warm the resolution caches exactly as the app would after its
  // background checks settle.
  await resolvePathCandidate('', ABS);        // exists → chip
  await resolvePathCandidate('', TRUNCATED);  // missing → plain code
  await resolvePathCandidate(
    'C:/GitProject/DPEFM-Prony',
    '.history/v0.7.7/_v0882_analysis.py',
  ); // dot-directory relative path → chip
  await resolveFolderCandidate('', 'C:/Users/xtx/.claude');
  await resolveFolderCandidate('', 'C:/GitProject/ToCC');
  await resolveFolderCandidate('', 'src/components');
});

describe('MarkdownRenderer path chips', () => {
  it('renders a backticked absolute path as a PathChip showing the full path', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content={`路径在 \`${ABS}\` 里`} />,
    );
    expect(html).toContain('data-icon-type="document"');
    // PathChip renders a <button> with the resolved path as title
    expect(html).toContain(`title="${ABS}"`);
    // Full absolute path displayed inside the chip (truncated only by CSS)
    expect(html).toContain(`${ABS}</span>`);
  });

  it('renders a bare absolute path as a PathChip (wrapBareFilePaths)', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content={`路径在 ${ABS} 里`} />,
    );
    expect(html).toContain(`title="${ABS}"`);
    expect(html).not.toContain('data-icon-type="folder"');
  });

  it('renders a bare relative path with known ext as code (pending resolution)', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content="打开 src/main.rs 看看" />,
    );
    // Should be wrapped in backticks → inline code (pending → <code>)
    expect(html).toContain('<code');
    expect(html).toContain('src/main.rs');
  });

  it('renders a backticked folder path as a FolderChip showing the full path', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content={`目录在 \`${FOLDER}\` 里`} />,
    );
    expect(html).toContain('data-icon-type="folder"');
    expect(html).toContain('title="C:/Users/xtx/.claude"');
    expect(html).toContain('C:/Users/xtx/.claude/</span>');
  });

  it('renders a bare folder path as a FolderChip (wrapBareFilePaths)', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content={`目录在 ${FOLDER} 里`} />,
    );
    expect(html).toContain('data-icon-type="folder"');
    expect(html).toContain('.claude/');
  });

  it('does NOT turn the directory prefix of a file path into a folder chip', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content={`路径在 ${ABS} 里`} />,
    );
    expect(html).not.toContain('data-icon-type="folder"');
    expect(html).toContain(`title="${ABS}"`);
  });

  it('does NOT render a truncated path (...jsonl) as a chip', () => {
    // Bare: prefix class excludes `.`, so leading ellipses prevent wrapping
    const bare = renderToStaticMarkup(
      <MarkdownRenderer content={`路径 ${TRUNCATED} 里`} />,
    );
    expect(bare).not.toContain('title=');
    // Backticked: existence check fails → plain code, never a chip
    const ticked = renderToStaticMarkup(
      <MarkdownRenderer content={`路径 \`${TRUNCATED}\` 里`} />,
    );
    expect(ticked).not.toContain('title=');
    expect(ticked).toContain('<code');
  });

  it('renders an extension-less absolute path as a FolderChip', () => {
    const ticked = renderToStaticMarkup(
      <MarkdownRenderer content={'路径 `C:/GitProject/ToCC` 里'} />,
    );
    expect(ticked).toContain('data-icon-type="folder"');
    expect(ticked).toContain('title="C:/GitProject/ToCC"');
    const bare = renderToStaticMarkup(
      <MarkdownRenderer content={'路径 "C:/GitProject/ToCC" 里'} />,
    );
    expect(bare).toContain('data-icon-type="folder"');
    expect(bare).toContain('title="C:/GitProject/ToCC"');
  });

  it('renders a relative folder path (src/components/) as a FolderChip', () => {
    const ticked = renderToStaticMarkup(
      <MarkdownRenderer content={'目录 `src/components/` 里'} />,
    );
    expect(ticked).toContain('data-icon-type="folder"');
    expect(ticked).toContain('src/components/');
    const bare = renderToStaticMarkup(
      <MarkdownRenderer content={'目录 src/components/ 里'} />,
    );
    expect(bare).toContain('data-icon-type="folder"');
  });

  it('renders a dot-directory file path (.history/...) as a PathChip', () => {
    const ticked = renderToStaticMarkup(
      <MarkdownRenderer
        basePath="C:/GitProject/DPEFM-Prony"
        content={'路径 `.history/v0.7.7/_v0882_analysis.py` 里'}
      />,
    );
    // .py → the code icon (FileIcon, same as the file tree)
    expect(ticked).toContain('data-icon-type="code"');
    expect(ticked).toContain(
      'title="C:/GitProject/DPEFM-Prony/.history/v0.7.7/_v0882_analysis.py"',
    );
    // Relative candidates display as-is (not the resolved absolute path)
    expect(ticked).toContain('.history/v0.7.7/_v0882_analysis.py</span>');
    // Bare dot-directory paths get wrapped and resolve too
    const bare = renderToStaticMarkup(
      <MarkdownRenderer
        basePath="C:/GitProject/DPEFM-Prony"
        content={'路径 .history/v0.7.7/_v0882_analysis.py 里'}
      />,
    );
    expect(bare).toContain('data-icon-type="code"');
  });

  it('renders paths as plain code when path links are disabled in settings', () => {
    useSettingsStore.setState({ pathLinksEnabled: false });
    // renderToStaticMarkup renders via React's server renderer, whose
    // useSyncExternalStore only calls getServerSnapshot(). Zustand feeds
    // it getInitialState() — the frozen state object from store creation
    // (pathLinksEnabled: true). Spying the bound hook cannot intercept it
    // (zustand reads the internal vanilla api), so flip the flag on the
    // initial-state object itself to make the disabled state SSR-visible.
    const initialState = useSettingsStore.getInitialState() as {
      pathLinksEnabled: boolean;
    };
    initialState.pathLinksEnabled = false;
    try {
      const ticked = renderToStaticMarkup(
        <MarkdownRenderer content={`路径在 \`${ABS}\` 里`} />,
      );
      expect(ticked).not.toContain('title=');
      expect(ticked).toContain('<code');
      // Bare paths are not wrapped either
      const bare = renderToStaticMarkup(
        <MarkdownRenderer content={`目录在 ${FOLDER} 里`} />,
      );
      expect(bare).not.toContain('title=');
      expect(bare).not.toContain('data-icon-type="folder"');
    } finally {
      initialState.pathLinksEnabled = true;
      useSettingsStore.setState({ pathLinksEnabled: true });
    }
  });
});
