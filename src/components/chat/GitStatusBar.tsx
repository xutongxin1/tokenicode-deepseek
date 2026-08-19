import { useGitStatus } from '../../hooks/useGitStatus';
import { useT } from '../../lib/i18n';

/**
 * GitStatusBar — posh-git style working-tree summary.
 *
 * Rendered inline in the InputBar tool row, next to the rewind button.
 * Shows: branch name, ahead/behind vs upstream (↑N green / ↓N red),
 * and +added / ~modified / -deleted file counts. Hidden when the working
 * directory is not a git repository (or on very narrow windows).
 */
export function GitStatusBar() {
  const t = useT();
  const status = useGitStatus();

  if (!status?.branch) return null;

  const { branch, upstream, ahead, behind, added, modified, deleted } = status;
  const hasChanges = added > 0 || modified > 0 || deleted > 0;

  const titleParts: string[] = [];
  if (ahead > 0) titleParts.push(`${t('git.ahead')} ${ahead}`);
  if (behind > 0) titleParts.push(`${t('git.behind')} ${behind}`);
  if (!upstream) titleParts.push(t('git.noUpstream'));
  titleParts.push(
    hasChanges
      ? `${t('git.changes')}: +${added} ~${modified} -${deleted}`
      : t('git.clean'),
  );

  return (
    <div
      className="hidden md:flex items-center gap-1.5 text-[11px] font-mono
        select-none cursor-default"
      title={titleParts.join(' · ')}
    >
      {/* Branch */}
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
        className="text-accent flex-shrink-0">
        <circle cx="4.5" cy="3.5" r="1.8" />
        <circle cx="4.5" cy="12.5" r="1.8" />
        <circle cx="11.5" cy="6" r="1.8" />
        <path d="M4.5 5.3v5.4M11.5 7.8c0 3-2.2 3.8-5 4.7" />
      </svg>
      <span className="text-accent font-medium">{branch}</span>

      {/* Ahead/behind vs upstream */}
      {ahead > 0 && <span className="text-success">↑{ahead}</span>}
      {behind > 0 && <span className="text-error">↓{behind}</span>}

      {/* Change counts */}
      {hasChanges ? (
        <>
          {added > 0 && <span className="text-success">+{added}</span>}
          {modified > 0 && <span className="text-warning">~{modified}</span>}
          {deleted > 0 && <span className="text-error">-{deleted}</span>}
        </>
      ) : (
        <span className="text-success">✓</span>
      )}
    </div>
  );
}
