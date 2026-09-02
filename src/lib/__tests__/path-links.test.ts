import { describe, expect, it } from 'vitest';
import {
  isAbsolutePath,
  joinPath,
  wrapBareFilePaths,
  FILE_PATH_RE,
  KNOWN_EXT_RE,
} from '../path-links';

describe('isAbsolutePath', () => {
  it('detects Unix and Windows absolute paths', () => {
    expect(isAbsolutePath('/home/user/src/main.rs')).toBe(true);
    expect(isAbsolutePath('C:\\Users\\x\\src\\main.rs')).toBe(true);
    expect(isAbsolutePath('C:/Users/x/src/main.rs')).toBe(true);
    expect(isAbsolutePath('\\\\server\\share\\a.ts')).toBe(true);
  });

  it('rejects relative paths', () => {
    expect(isAbsolutePath('src/main.rs')).toBe(false);
    expect(isAbsolutePath('./foo.ts')).toBe(false);
    expect(isAbsolutePath('../bar.ts')).toBe(false);
    expect(isAbsolutePath('CLAUDE.md')).toBe(false);
  });
});

describe('joinPath', () => {
  it('joins candidates onto the cwd', () => {
    expect(joinPath('C:/proj', 'src/main.rs')).toBe('C:/proj/src/main.rs');
    expect(joinPath('C:/proj/', './src/main.rs')).toBe('C:/proj/src/main.rs');
    expect(joinPath('', 'src/main.rs')).toBe('src/main.rs');
  });
});

describe('FILE_PATH_RE', () => {
  it('matches backticked absolute and relative paths, incl. Windows backslashes and spaces', () => {
    expect(FILE_PATH_RE.test('C:\\Users\\x\\src\\main.rs')).toBe(true);
    expect(FILE_PATH_RE.test('C:/Users/x/src/main.rs')).toBe(true);
    expect(FILE_PATH_RE.test('C:\\My Projects\\app\\main.ts')).toBe(true);
    expect(FILE_PATH_RE.test('/home/user/src/main.rs')).toBe(true);
    expect(FILE_PATH_RE.test('src/components/App.tsx')).toBe(true);
    expect(FILE_PATH_RE.test('./foo/bar.rs')).toBe(true);
    expect(FILE_PATH_RE.test('../foo/bar.rs')).toBe(true);
    expect(FILE_PATH_RE.test('src\\foo\\bar.rs')).toBe(true);
    expect(FILE_PATH_RE.test('.history/v0.7.7/_v0882_analysis.py')).toBe(true);
    expect(FILE_PATH_RE.test('.history\\v0.7.7\\_v0882_analysis.py')).toBe(true);
  });

  it('rejects non-path text', () => {
    expect(FILE_PATH_RE.test('hello world')).toBe(false);
    expect(FILE_PATH_RE.test('run npm install')).toBe(false);
  });

  it('bare known-extension filenames still match via KNOWN_EXT_RE', () => {
    expect(KNOWN_EXT_RE.test('CLAUDE.md')).toBe(true);
    expect(KNOWN_EXT_RE.test('package.json')).toBe(true);
    expect(KNOWN_EXT_RE.test('not a path')).toBe(false);
  });
});

describe('wrapBareFilePaths', () => {
  it('wraps absolute paths in prose', () => {
    expect(wrapBareFilePaths('Edit C:\\GitProject\\x\\src\\App.tsx now'))
      .toBe('Edit `C:\\GitProject\\x\\src\\App.tsx` now');
    expect(wrapBareFilePaths('see /home/u/src/main.rs for details'))
      .toBe('see `/home/u/src/main.rs` for details');
  });

  it('wraps common project-relative paths', () => {
    expect(wrapBareFilePaths('open src/components/App.tsx and lib/utils.ts'))
      .toBe('open `src/components/App.tsx` and `lib/utils.ts`');
  });

  it('wraps dot-directory paths (.history/...)', () => {
    expect(wrapBareFilePaths('see .history/v0.7.7/_v0882_analysis.py for details'))
      .toBe('see `.history/v0.7.7/_v0882_analysis.py` for details');
    expect(wrapBareFilePaths('目录在 .history/v0.7.7/ 里'))
      .toBe('目录在 `.history/v0.7.7/` 里');
  });

  it('leaves fenced code blocks and inline code untouched', () => {
    const input = 'run it:\n```bash\ncat /etc/hosts\n```\nand see `/etc/hosts`';
    expect(wrapBareFilePaths(input)).toBe(input);
  });

  it('does not wrap unknown extensions', () => {
    expect(wrapBareFilePaths('meet at 3.45pm src/foo.xyz now'))
      .toBe('meet at 3.45pm src/foo.xyz now');
  });

  it('does not wrap markdown link targets', () => {
    expect(wrapBareFilePaths('[docs](src/docs/readme.md)'))
      .toBe('[docs](src/docs/readme.md)');
  });
});
