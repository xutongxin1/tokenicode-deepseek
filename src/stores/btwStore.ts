import { create } from 'zustand';

/**
 * btwStore — in-memory side-question ("/btw") state.
 *
 * Replicates Claude Code's official /btw semantics: side questions are NOT
 * written to the main conversation transcript, so records live only in
 * memory (per tab) and are lost on restart — exactly like the official
 * sidechain transcripts, which are ephemeral by design.
 */

export interface BtwRecord {
  id: string;
  question: string;
  answer: string;
  status: 'thinking' | 'done' | 'error';
  error?: string;
  timestamp: number;
}

interface BtwState {
  /** Q&A records per tab id */
  records: Record<string, BtwRecord[]>;
  /** stdinId of the currently running side question per tab (null = idle) */
  runningStdin: Record<string, string | null>;

  addRecord: (tabId: string, record: BtwRecord) => void;
  updateRecord: (tabId: string, recordId: string, patch: Partial<BtwRecord>) => void;
  setRunningStdin: (tabId: string, stdinId: string | null) => void;
}

export const useBtwStore = create<BtwState>()((set) => ({
  records: {},
  runningStdin: {},

  addRecord: (tabId, record) =>
    set((state) => ({
      records: {
        ...state.records,
        [tabId]: [...(state.records[tabId] ?? []), record],
      },
    })),

  updateRecord: (tabId, recordId, patch) =>
    set((state) => ({
      records: {
        ...state.records,
        [tabId]: (state.records[tabId] ?? []).map((r) =>
          r.id === recordId ? { ...r, ...patch } : r,
        ),
      },
    })),

  setRunningStdin: (tabId, stdinId) =>
    set((state) => ({
      runningStdin: { ...state.runningStdin, [tabId]: stdinId },
    })),
}));
