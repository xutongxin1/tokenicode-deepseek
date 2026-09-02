/**
 * BtwPopover — 顺带一问 (side question), the /btw equivalent.
 *
 * Claude Code's official /btw slash command is hard-gated in headless mode
 * (cmd_unavailable_headless), so TOKENICODE replicates its behaviour exactly:
 *  - an independent, one-shot CLI process (the main conversation is NOT paused)
 *  - ALL tools disabled (official canUseTool: deny) + the official side-question
 *    system reminder injected verbatim by the Rust backend
 *  - the answer is shown in this floating panel; nothing is written to the
 *    main conversation transcript (records are in-memory per tab, matching the
 *    official sidechain's ephemeral transcripts)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge, onBtwStream, onBtwStderr, onBtwExit } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';
import { useBtwStore, type BtwRecord } from '../../stores/btwStore';
import { useChatStore, type ChatMessage } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useProviderStore } from '../../stores/providerStore';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Stable fallback — a fresh `[]` in a selector would break snapshot equality */
const EMPTY_RECORDS: BtwRecord[] = [];

/* ------------------------------------------------------------------ */
/*  Context excerpt — mirrors the official sidechain sharing the       */
/*  conversation context with the side question                        */
/* ------------------------------------------------------------------ */

const EXCERPT_MAX_MESSAGES = 20;
const EXCERPT_MAX_CHARS = 6000;

function buildContextExcerpt(messages: ChatMessage[]): string {
  const recent = messages.slice(-EXCERPT_MAX_MESSAGES);
  const lines: string[] = [];
  for (const m of recent) {
    let text = '';
    if (m.role === 'user') {
      text = m.content;
    } else if (m.type === 'text') {
      text = m.content;
    } else if (m.type === 'tool_use') {
      text = `[tool: ${m.toolName || 'unknown'}]`;
    } else if (m.type === 'tool_result') {
      text = '[tool result]';
    } else if (m.type === 'todo') {
      text = '[todo update]';
    } else if (m.type === 'question') {
      text = '[asked the user a question]';
    } else if (m.type === 'permission') {
      text = '[permission request]';
    } else if (m.type === 'plan_review') {
      text = '[plan review]';
    } else {
      continue; // thinking, plan, etc. — not useful for a side question
    }
    const clean = text.trim();
    if (!clean) continue;
    lines.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${clean}`);
  }
  let excerpt = lines.join('\n');
  if (excerpt.length > EXCERPT_MAX_CHARS) {
    excerpt = excerpt.slice(-EXCERPT_MAX_CHARS);
  }
  return excerpt;
}

/* ------------------------------------------------------------------ */
/*  Listener lifecycle — survives popover close so a running side      */
/*  question completes in the background                               */
/* ------------------------------------------------------------------ */

const activeListeners = new Map<string, (() => void)[]>();

function cleanupListeners(stdinId: string) {
  const unlisteners = activeListeners.get(stdinId);
  if (unlisteners) {
    for (const un of unlisteners) un();
    activeListeners.delete(stdinId);
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function BtwPopover({ open, onClose }: Props) {
  const t = useT();
  const [question, setQuestion] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabId = useSessionStore((s) => s.selectedSessionId) || '';
  const records = useBtwStore((s) => (tabId ? s.records[tabId] : undefined)) ?? EMPTY_RECORDS;
  const runningStdin = useBtwStore((s) => (tabId ? s.runningStdin[tabId] : undefined)) ?? null;
  const isRunning = runningStdin !== null;

  // Auto-scroll to the newest record
  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [open, records]);

  // Auto-focus the input + close on outside click when opened
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      // Ignore the trigger button — it toggles itself on click
      if ((e.target as HTMLElement).closest('[data-btw-trigger]')) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onClose]);

  const handleAsk = useCallback(async () => {
    const q = question.trim();
    if (!q || !tabId || isRunning) return;

    const cwd = useSettingsStore.getState().workingDirectory || '';
    const messages = useChatStore.getState().getTab(tabId)?.messages ?? [];
    const excerpt = buildContextExcerpt(messages);
    const prompt = excerpt
      ? `Recent conversation context:\n\n${excerpt}\n\n---\n\nSide question from the user: ${q}`
      : q;

    const stdinId = `btw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record: BtwRecord = {
      id: stdinId,
      question: q,
      answer: '',
      status: 'thinking',
      timestamp: Date.now(),
    };

    useBtwStore.getState().addRecord(tabId, record);
    useBtwStore.getState().setRunningStdin(tabId, stdinId);
    setQuestion('');

    try {
      await bridge.startSession({
        prompt,
        cwd,
        session_id: stdinId,
        model: useSettingsStore.getState().selectedModel,
        thinking_level: useSettingsStore.getState().thinkingLevel,
        permission_mode: 'default',
        provider_id: useProviderStore.getState().activeProviderId ?? undefined,
        is_sidechain: true,
      });
    } catch (err) {
      console.error('[btw] failed to start side question:', err);
      useBtwStore.getState().updateRecord(tabId, stdinId, {
        status: 'error',
        error: String(err),
      });
      useBtwStore.getState().setRunningStdin(tabId, null);
      return;
    }

    const unlisteners: (() => void)[] = [];
    const finish = (patch: Partial<BtwRecord>) => {
      cleanupListeners(stdinId);
      useBtwStore.getState().updateRecord(tabId, stdinId, patch);
      useBtwStore.getState().setRunningStdin(tabId, null);
    };

    // Stream listener — parse NDJSON, collect text, kill after the turn ends
    const unStream = await onBtwStream(stdinId, (msg: any) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'process_exit') {
        const rec = useBtwStore.getState().records[tabId]?.find((r) => r.id === stdinId);
        if (rec?.status === 'thinking') {
          finish({ status: rec.answer ? 'done' : 'error', error: rec.answer ? undefined : 'process exited' });
        }
        return;
      }
      if (msg.type === 'result') {
        // Turn complete — answer is done; kill the one-shot process
        finish({ status: 'done' });
        bridge.killSession(stdinId).catch(() => {});
        return;
      }
      if (msg.type === 'system' && msg.subtype === 'error') {
        finish({ status: 'error', error: msg.message || msg.error || 'system error' });
        return;
      }
      if (msg.type === 'stream_event') {
        const evt = msg.event;
        if (evt?.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          appendAnswer(stdinId, tabId, evt.delta.text || '');
        }
        return;
      }
      if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) appendAnswer(stdinId, tabId, block.text);
        }
      }
    });
    unlisteners.push(unStream);

    const unErr = await onBtwStderr(stdinId, () => {
      // stderr is diagnostics — ignore unless the process dies without result
    });
    unlisteners.push(unErr);

    const unExit = await onBtwExit(stdinId, () => {
      const rec = useBtwStore.getState().records[tabId]?.find((r) => r.id === stdinId);
      if (rec?.status === 'thinking') {
        finish({ status: rec.answer ? 'done' : 'error', error: rec.answer ? undefined : 'process exited' });
      }
    });
    unlisteners.push(unExit);

    activeListeners.set(stdinId, unlisteners);
  }, [question, tabId, isRunning]);

  // Close: keep any running question alive in the background (official
  // sidechain semantics — the main agent is never interrupted)
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div ref={rootRef} className="absolute bottom-full right-0 mb-2 w-[440px] max-w-[90vw]
      bg-bg-card border border-border-subtle rounded-2xl shadow-2xl
      flex flex-col overflow-hidden z-50 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5
        border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" className="text-accent">
            <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v6a1.5 1.5 0 01-1.5 1.5H6l-3 2.5v-2.5h-.5A1.5 1.5 0 012 9.5v-6z" />
            <path d="M6 6h4M6 8.5h2.5" strokeLinecap="round" />
          </svg>
          <span className="text-xs font-semibold text-text-primary">{t('btw.title')}</span>
        </div>
        <button
          onClick={handleClose}
          className="p-1 rounded-lg text-text-tertiary hover:text-text-primary
            hover:bg-bg-secondary transition-smooth"
          title={t('common.cancel')}
        >
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" strokeWidth="1.5">
            <path d="M2 2l6 6M8 2l-6 6" />
          </svg>
        </button>
      </div>

      {/* Records */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2
        space-y-3 max-h-[320px]">
        {records.length === 0 && (
          <div className="text-center py-8 text-xs text-text-tertiary">
            {t('btw.empty')}
          </div>
        )}
        {records.map((rec) => (
          <div key={rec.id} className="space-y-1.5">
            <div className="flex justify-end">
              <div className="max-w-[85%] px-3 py-1.5 rounded-xl rounded-br-sm
                bg-accent/10 text-text-primary text-[13px] leading-relaxed
                whitespace-pre-wrap break-words">
                {rec.question}
              </div>
            </div>
            {rec.status === 'thinking' && (
              <div className="flex items-center gap-2 pl-1 text-xs text-text-tertiary">
                <span className="w-3 h-3 border-2 border-accent/30 border-t-accent
                  rounded-full animate-spin" />
                {t('btw.thinking')}
              </div>
            )}
            {rec.status === 'error' && (
              <div className="pl-1 text-xs text-error">
                {t('btw.error')}{rec.error ? `: ${rec.error}` : ''}
              </div>
            )}
            {rec.status === 'done' && (
              <div className="pl-1 text-[13px] text-text-primary">
                <MarkdownRenderer content={rec.answer} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-border-subtle p-2.5">
        <div className="flex items-end gap-2 bg-bg-input border border-border-subtle
          rounded-xl px-3 py-2 focus-within:border-border-focus transition-smooth">
          <textarea
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleAsk();
              }
              if (e.key === 'Escape') handleClose();
            }}
            placeholder={t('btw.placeholder')}
            rows={1}
            className="flex-1 min-w-0 bg-transparent text-[13px] text-text-primary
              placeholder:text-text-tertiary resize-none outline-none
              leading-normal max-h-24"
          />
          <button
            onClick={handleAsk}
            disabled={!question.trim() || isRunning}
            className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center
              justify-center transition-smooth
              ${!question.trim() || isRunning
                ? 'bg-bg-tertiary text-text-tertiary cursor-not-allowed'
                : 'bg-accent hover:bg-accent-hover text-text-inverse cursor-pointer'
              }`}
            title={t('btw.ask')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              strokeLinejoin="round">
              <path d="M1.5 6h9M7 1.5L10.5 6 7 10.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function appendAnswer(stdinId: string, tabId: string, delta: string) {
  const current = useBtwStore.getState().records[tabId]?.find((r) => r.id === stdinId);
  if (!current) return;
  useBtwStore.getState().updateRecord(tabId, stdinId, {
    answer: current.answer + delta,
  });
}
