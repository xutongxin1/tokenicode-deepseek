import { useState, useCallback, useEffect } from 'react';
import { type ChatMessage, useChatStore, getActiveTabState } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';
import { buildAskUserQuestionAnswers } from '../../lib/ask-user-question';

/** Decode literal Unicode escape sequences (e.g. `\u2014`) that appear in text. */
function decodeUnicodeEscapes(text: string): string {
  return text.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

interface Props {
  message: ChatMessage;
  /** When true, card renders in floating overlay mode (no left margin). */
  floating?: boolean;
}

/**
 * QuestionCard — enhanced interactive question flow (AskUserQuestion).
 *
 * Enhancements over the inline version:
 * - Card wrapper with accent left border when active
 * - Visual progress bar (colored segments) replacing "1 / 3" text
 * - Better option styling with hover scale effect
 * - Answered questions shown with timeline connector
 */
export function QuestionCard({ message, floating }: Props) {
  const t = useT();
  const questions = message.questions || [];
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedMap, setSelectedMap] = useState<Record<number, Set<number>>>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});
  const [useOther, setUseOther] = useState<Record<number, boolean>>({});
  const [answeredMap, setAnsweredMap] = useState<Record<number, string>>({});
  // Collapsed by default once resolved — expand to review the full Q&A.
  const [expanded, setExpanded] = useState(false);
  // Which question's option list is expanded inside the Q&A record
  // (per-question collapse: users rarely want every option list open).
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const currentQ = questions[currentIdx];
  const isFullyResolved = message.resolved;

  // Reset per-message UI state when the card is reused for another message
  useEffect(() => {
    setExpanded(false);
    setExpandedIdx(null);
  }, [message.id]);

  // Question → answer pairs for the resolved/collapsed record. Prefer the
  // persisted answers (survive tab switches + history reload); fall back to
  // the in-memory answeredMap for the live interaction.
  const answeredPairs = questions
    .map((q, i) => ({
      q: decodeUnicodeEscapes(q.question),
      a: decodeUnicodeEscapes(message.questionAnswers?.[q.question] ?? answeredMap[i] ?? ''),
      options: q.options || [],
    }))
    .filter((p) => p.a);

  const handleToggle = useCallback((optIdx: number, multi: boolean) => {
    if (isFullyResolved) return;
    const qIdx = currentIdx;
    setSelectedMap((prev) => {
      const current = prev[qIdx] || new Set<number>();
      const next = new Set(current);
      if (multi) {
        if (next.has(optIdx)) next.delete(optIdx);
        else next.add(optIdx);
      } else {
        next.clear();
        next.add(optIdx);
      }
      setUseOther((p) => ({ ...p, [qIdx]: false }));
      return { ...prev, [qIdx]: next };
    });
  }, [isFullyResolved, currentIdx]);

  const handleOtherToggle = useCallback(() => {
    if (isFullyResolved) return;
    const qIdx = currentIdx;
    setUseOther((prev) => {
      const next = !prev[qIdx];
      if (next) {
        setSelectedMap((p) => ({ ...p, [qIdx]: new Set<number>() }));
      }
      return { ...prev, [qIdx]: next };
    });
  }, [isFullyResolved, currentIdx]);

  const getCurrentAnswer = useCallback((): string => {
    const qIdx = currentIdx;
    const q = questions[qIdx];
    if (!q) return '';
    if (useOther[qIdx] && otherText[qIdx]?.trim()) {
      return otherText[qIdx].trim();
    }
    const selected = selectedMap[qIdx] || new Set<number>();
    return Array.from(selected)
      .map((i) => q.options[i]?.label)
      .filter(Boolean)
      .join(', ');
  }, [currentIdx, questions, selectedMap, useOther, otherText]);

  const hasCurrentSelection = useOther[currentIdx]
    ? !!otherText[currentIdx]?.trim()
    : (selectedMap[currentIdx]?.size || 0) > 0;

  const interactionState = message.interactionState ?? (isFullyResolved ? 'resolved' : 'pending');
  const isSending = interactionState === 'sending';
  const isFailed = interactionState === 'failed';
  const awaitingSdkPatch = !isFullyResolved && !message.permissionData?.requestId;

  const handleConfirm = useCallback(async () => {
    if (isFullyResolved || isSending || awaitingSdkPatch) return;
    const answerText = getCurrentAnswer();
    setAnsweredMap((prev) => ({ ...prev, [currentIdx]: answerText }));

    const isLast = currentIdx >= questions.length - 1;
    if (isLast) {
      const qTabId = useSessionStore.getState().selectedSessionId;
      if (!qTabId) return;
      const { setInteractionState, setQuestionAnswers, setSessionStatus, setActivityStatus } = useChatStore.getState();
      const stdinId = getActiveTabState().sessionMeta.stdinId;
      if (!stdinId) return;
      const answers = buildAskUserQuestionAnswers(questions, selectedMap, otherText, useOther);
      // Persist the Q&A record on the message so the resolved card (and
      // reloaded history) can show a collapsible "question → answer" view.
      setQuestionAnswers(qTabId, message.id, answers);
      setInteractionState(qTabId, message.id, 'sending');
      try {
        const permData = message.permissionData;
        if (!permData?.requestId) throw new Error('AskUserQuestion request is not ready');
        const updatedInput = { ...message.toolInput, answers };
        await bridge.respondPermission(stdinId, permData.requestId, true, undefined, permData.toolUseId, updatedInput);
        setInteractionState(qTabId, message.id, 'resolved');
        setSessionStatus(qTabId, 'running');
        setActivityStatus(qTabId, { phase: 'thinking' });
      } catch (err) {
        setInteractionState(qTabId, message.id, 'failed', String(err));
      }
    } else {
      setCurrentIdx(currentIdx + 1);
    }
  }, [isFullyResolved, isSending, awaitingSdkPatch, currentIdx, questions, selectedMap, useOther, otherText, message.id, message.permissionData, message.toolInput, getCurrentAnswer]);

  const handleSkip = useCallback(async () => {
    if (isFullyResolved || isSending || awaitingSdkPatch) return;
    const skipTabId = useSessionStore.getState().selectedSessionId;
    if (!skipTabId) return;
    const { setInteractionState, setSessionStatus, setActivityStatus } = useChatStore.getState();
    const stdinId = getActiveTabState().sessionMeta.stdinId;
    if (!stdinId) return;
    setInteractionState(skipTabId, message.id, 'sending');
    try {
      const permData = message.permissionData;
      if (!permData?.requestId) throw new Error('AskUserQuestion request is not ready');
      const updatedInput = { ...message.toolInput, answers: {} };
      await bridge.respondPermission(stdinId, permData.requestId, true, undefined, permData.toolUseId, updatedInput);
      setInteractionState(skipTabId, message.id, 'resolved');
      setSessionStatus(skipTabId, 'running');
      setActivityStatus(skipTabId, { phase: 'thinking' });
    } catch (err) {
      setInteractionState(skipTabId, message.id, 'failed', String(err));
    }
  }, [isFullyResolved, isSending, awaitingSdkPatch, message.id]);

  return (
    <div className={`${floating ? '' : 'ml-11'} animate-scale-in ${isFullyResolved ? 'opacity-80' : ''}`}>
      <div className={`rounded-xl border overflow-hidden transition-all duration-200
        ${isFullyResolved
          ? 'border-border-subtle bg-bg-secondary/20'
          : 'border-l-[3px] border-l-accent border-r border-t border-b border-r-accent/15 border-t-accent/15 border-b-accent/15 bg-gradient-to-r from-accent/[0.03] to-transparent'
        }`}>

        {/* Already answered questions — timeline view (live interaction only;
            once resolved the collapsible Q&A record below takes over) */}
        {!isFullyResolved && Object.keys(answeredMap).length > 0 && (
          <div className="px-3 pt-2 pb-1 space-y-1">
            {Object.entries(answeredMap).map(([idxStr, answer]) => {
              const qIdx = Number(idxStr);
              const q = questions[qIdx];
              if (!q) return null;
              return (
                <div key={qIdx} className="flex items-start gap-2 py-1">
                  {/* Timeline connector dot */}
                  <div className="flex flex-col items-center flex-shrink-0 mt-0.5">
                    <div className="w-2 h-2 rounded-full bg-success" />
                    {qIdx < Object.keys(answeredMap).length - 1 && (
                      <div className="w-px h-3 bg-border-subtle mt-0.5" />
                    )}
                  </div>
                  <div className="text-xs text-text-muted min-w-0">
                    <span className="text-text-secondary">{decodeUnicodeEscapes(q.question)}</span>
                    {' \u2192 '}
                    <span className="text-text-primary font-medium">{decodeUnicodeEscapes(answer)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Resolved state — collapsible Q&A record. Collapsed by default:
            one-line summary (first question → answer), expandable to the
            full list so the user can review how they answered each question. */}
        {isFullyResolved && answeredPairs.length > 0 && (
          <div className="px-3 py-2">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center gap-2 text-left
                cursor-pointer group"
              title={expanded ? t('msg.qaCollapse') : t('msg.qaExpand')}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"
                className={`flex-shrink-0 text-text-tertiary transition-transform
                  duration-150 ${expanded ? 'rotate-90' : ''}`}>
                <path d="M3 1.5L7 5l-4 3.5" />
              </svg>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
                stroke="currentColor" strokeWidth="1.5" className="text-success flex-shrink-0">
                <path d="M2.5 6l2.5 2.5 4.5-4.5" />
              </svg>
              <span className="text-xs text-text-muted min-w-0 truncate flex-1">
                <span className="text-text-secondary">{answeredPairs[0].q}</span>
                {' → '}
                <span className="text-text-primary font-medium">{answeredPairs[0].a}</span>
              </span>
              {answeredPairs.length > 1 && (
                <span className="flex-shrink-0 px-1.5 py-0.5 rounded
                  bg-bg-tertiary text-[10px] text-text-tertiary font-medium">
                  +{answeredPairs.length - 1}
                </span>
              )}
            </button>

            {/* Expanded full Q&A list — each question collapses further to
                show the option list that was offered at the time */}
            {expanded && (
              <div className="mt-2 space-y-1 border-t border-border-subtle pt-2">
                {answeredPairs.map((p, i) => {
                  const itemExpanded = expandedIdx === i;
                  const selectedLabels = p.a.split(', ').map((s) => s.trim());
                  return (
                    <div key={i}>
                      <div className="flex items-start gap-2">
                        <div className="flex flex-col items-center flex-shrink-0 mt-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-success" />
                          {i < answeredPairs.length - 1 && (
                            <div className="w-px h-3 bg-border-subtle mt-0.5" />
                          )}
                        </div>
                        <button
                          onClick={() => setExpandedIdx(itemExpanded ? null : i)}
                          className="flex-1 min-w-0 flex items-start gap-1.5 text-left
                            cursor-pointer group"
                          title={p.options.length > 0
                            ? (itemExpanded ? t('msg.qaCollapse') : t('msg.qaOptionsHint'))
                            : undefined}
                        >
                          <span className="text-xs text-text-muted min-w-0 leading-relaxed">
                            <span className="text-text-secondary">{p.q}</span>
                            {' → '}
                            <span className="text-text-primary font-medium">{p.a}</span>
                          </span>
                          {p.options.length > 0 && (
                            <span className="flex-shrink-0 flex items-center gap-0.5
                              mt-0.5 text-[10px] text-text-tertiary
                              group-hover:text-text-secondary transition-colors">
                              <svg width="8" height="8" viewBox="0 0 10 10" fill="none"
                                stroke="currentColor" strokeWidth="1.5"
                                strokeLinecap="round" strokeLinejoin="round"
                                className={`transition-transform duration-150 ${itemExpanded ? 'rotate-90' : ''}`}>
                                <path d="M3 1.5L7 5l-4 3.5" />
                              </svg>
                              {p.options.length}{t('msg.qaOptions')}
                            </span>
                          )}
                        </button>
                      </div>

                      {/* Per-question option list (collapsed by default) */}
                      {itemExpanded && p.options.length > 0 && (
                        <div className="ml-4 mt-1.5 space-y-1">
                          {p.options.map((opt, oi) => {
                            const isSelected = selectedLabels.includes(
                              decodeUnicodeEscapes(opt.label),
                            );
                            return (
                              <div key={oi} className={`flex items-start gap-1.5 text-[11px]
                                px-2 py-1 rounded-lg
                                ${isSelected
                                  ? 'bg-accent/10 text-accent'
                                  : 'text-text-tertiary'}`}>
                                <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
                                  stroke="currentColor" strokeWidth="1.5"
                                  className={`flex-shrink-0 mt-0.5 ${isSelected ? 'text-accent' : 'opacity-40'}`}>
                                  {isSelected
                                    ? <path d="M2.5 6l2.5 2.5 4.5-4.5" />
                                    : <circle cx="6" cy="6" r="4" />}
                                </svg>
                                <span className="min-w-0 leading-relaxed">
                                  <span className={isSelected ? 'font-medium' : ''}>
                                    {decodeUnicodeEscapes(opt.label)}
                                  </span>
                                  {opt.description && (
                                    <span className="text-text-tertiary ml-1.5">
                                      {'—'} {decodeUnicodeEscapes(opt.description)}
                                    </span>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Resolved state — no answer record available */}
        {isFullyResolved && answeredPairs.length === 0 && (
          <div className="flex items-center gap-1.5 px-3 py-2">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
              stroke="currentColor" strokeWidth="1.5" className="text-success">
              <path d="M2.5 6l2.5 2.5 4.5-4.5" />
            </svg>
            <span className="text-xs text-text-muted">{t('msg.responded')}</span>
          </div>
        )}

        {/* Current question — interactive */}
        {!isFullyResolved && currentQ && (
          <div className="px-3 py-3">
            {/* Visual progress bar for multi-question */}
            {questions.length > 1 && (
              <div className="flex items-center gap-1.5 mb-3">
                <div className="flex gap-0.5 flex-1">
                  {questions.map((_, i) => (
                    <div key={i} className={`h-1 rounded-full flex-1 transition-all duration-300
                      ${i < currentIdx
                        ? 'bg-success'
                        : i === currentIdx
                          ? 'bg-accent'
                          : 'bg-border-subtle'
                      }`} />
                  ))}
                </div>
                <span className="text-[10px] text-text-tertiary font-mono flex-shrink-0">
                  {currentIdx + 1}/{questions.length}
                </span>
              </div>
            )}

            {/* Question text with header badge */}
            <div className="flex items-start gap-2 mb-3">
              {currentQ.header && (
                <span className="flex-shrink-0 px-1.5 py-0.5 rounded
                  bg-accent/10 text-accent text-[10px] font-bold
                  uppercase tracking-wider mt-px">
                  {decodeUnicodeEscapes(currentQ.header)}
                </span>
              )}
              <span className="text-xs text-text-primary font-medium leading-relaxed">
                {decodeUnicodeEscapes(currentQ.question)}
              </span>
            </div>

            {/* Options */}
            <div className="flex flex-col gap-1.5 mb-3">
              {currentQ.options.map((opt, optIdx) => {
                const isSelected = selectedMap[currentIdx]?.has(optIdx) || false;
                return (
                  <button
                    key={optIdx}
                    onClick={() => handleToggle(optIdx, !!currentQ.multiSelect)}
                    className={`text-left px-3 py-2 rounded-lg text-xs
                      transition-all duration-150 border cursor-pointer
                      hover:scale-[1.01]
                      ${isSelected
                        ? 'border-accent bg-accent/10 text-accent shadow-sm'
                        : 'border-border-subtle text-text-secondary hover:border-accent/30 hover:bg-bg-secondary/50'
                      }`}
                  >
                    <span className="font-medium">{decodeUnicodeEscapes(opt.label)}</span>
                    {opt.description && (
                      <span className="text-text-tertiary ml-1.5">{'\u2014'} {decodeUnicodeEscapes(opt.description)}</span>
                    )}
                  </button>
                );
              })}

              {/* Other option */}
              <button
                onClick={handleOtherToggle}
                className={`text-left px-3 py-2 rounded-lg text-xs
                  transition-all duration-150 border cursor-pointer
                  hover:scale-[1.01]
                  ${useOther[currentIdx]
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border-subtle text-text-tertiary hover:border-accent/30 hover:bg-bg-secondary/50'
                  }`}
              >
                {t('msg.questionOther')}
              </button>
            </div>

            {/* Other text input */}
            {useOther[currentIdx] && (
              <div className="mb-3">
                <input
                  type="text"
                  value={otherText[currentIdx] || ''}
                  onChange={(e) => setOtherText((p) => ({ ...p, [currentIdx]: e.target.value }))}
                  placeholder={t('msg.questionOtherPlaceholder')}
                  autoFocus
                  className="w-full max-w-xs px-3 py-1.5 rounded-lg text-xs
                    bg-transparent border border-border-subtle
                    focus:border-border-focus outline-none text-text-primary
                    placeholder:text-text-tertiary transition-smooth"
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (hasCurrentSelection) handleConfirm();
                    }
                  }}
                />
              </div>
            )}

            {/* Error state */}
            {isFailed && message.interactionError && (
              <div className="mb-2 text-[11px] text-error bg-error/5 rounded-lg px-2.5 py-1.5
                border border-error/20">
                {message.interactionError}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleConfirm}
                disabled={!hasCurrentSelection || isSending || awaitingSdkPatch}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold
                  bg-accent text-text-inverse hover:bg-accent-hover
                  transition-smooth cursor-pointer shadow-sm
                  disabled:opacity-30 disabled:cursor-not-allowed
                  ${isSending ? 'animate-pulse-soft' : ''}`}
              >
                {isSending
                  ? 'Sending...'
                  : awaitingSdkPatch
                    ? t('msg.questionLoading')
                    : currentIdx >= questions.length - 1 ? t('msg.questionSubmit') : t('msg.questionNext')}
              </button>
              <button
                onClick={handleSkip}
                disabled={isSending || awaitingSdkPatch}
                className="px-3 py-1.5 rounded-lg text-xs font-medium
                  text-text-tertiary hover:text-text-primary
                  hover:bg-bg-tertiary transition-smooth cursor-pointer
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {t('msg.questionSkip')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
