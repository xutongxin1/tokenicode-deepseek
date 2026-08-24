import { useEffect, useState, useCallback } from 'react';
import { useMcpStore, isHttpTransport } from '../../stores/mcpStore';
import type { McpServer, McpServerConfig } from '../../stores/mcpStore';
import { useT } from '../../lib/i18n';
import { bridge } from '../../lib/tauri-bridge';

export function McpPanel() {
  const t = useT();
  const servers = useMcpStore((s) => s.servers);
  const isLoading = useMcpStore((s) => s.isLoading);
  const fetchServers = useMcpStore((s) => s.fetchServers);
  const addServer = useMcpStore((s) => s.addServer);
  const updateServer = useMcpStore((s) => s.updateServer);
  const deleteServer = useMcpStore((s) => s.deleteServer);
  const editingServer = useMcpStore((s) => s.editingServer);
  const isAdding = useMcpStore((s) => s.isAdding);
  const setEditing = useMcpStore((s) => s.setEditing);
  const setAdding = useMcpStore((s) => s.setAdding);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const handleDelete = useCallback(async (name: string) => {
    if (confirm(t('mcp.confirmDelete'))) {
      await deleteServer(name);
    }
  }, [deleteServer, t]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2
        border-b border-border-subtle">
        <div className="flex items-center gap-2 min-w-0">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            className="text-accent flex-shrink-0">
            <path d="M2 4a2 2 0 012-2h8a2 2 0 012 2v1H2V4z" />
            <path d="M2 7h12v5a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" />
            <circle cx="5" cy="10" r="1" fill="currentColor" stroke="none" />
            <circle cx="8" cy="10" r="1" fill="currentColor" stroke="none" />
          </svg>
          <span className="text-xs font-semibold text-text-primary">
            {t('mcp.title')}
          </span>
          <span className="text-[10px] text-text-muted flex-shrink-0">
            {servers.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => fetchServers()}
            className="p-1 rounded hover:bg-bg-secondary
              text-text-tertiary transition-smooth"
            title={t('mcp.refresh')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
              stroke="currentColor" strokeWidth="1.5">
              <path d="M1 6a5 5 0 019-2M11 6a5 5 0 01-9 2" />
              <path d="M10 1v3h-3M2 11V8h3" />
            </svg>
          </button>
          <button
            onClick={() => setAdding(true)}
            className="p-1 rounded hover:bg-bg-secondary
              text-text-tertiary transition-smooth"
            title={t('mcp.add')}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        </div>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Add form at top */}
        {isAdding && (
          <McpServerForm
            onSave={async (name, config) => {
              await addServer(name, config);
            }}
            onCancel={() => setAdding(false)}
            t={t}
          />
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-accent/30
              border-t-accent rounded-full animate-spin" />
          </div>
        ) : servers.length === 0 && !isAdding ? (
          <div className="flex flex-col items-center justify-center py-8
            text-text-tertiary text-xs gap-2">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none"
              stroke="currentColor" strokeWidth="1.2"
              className="text-text-tertiary/40">
              <path d="M4 8a4 4 0 014-4h16a4 4 0 014 4v2H4V8z" />
              <path d="M4 14h24v10a4 4 0 01-4 4H8a4 4 0 01-4-4V14z" />
              <circle cx="10" cy="20" r="2" />
              <circle cx="16" cy="20" r="2" />
            </svg>
            <p className="text-xs text-text-tertiary leading-relaxed">
              {t('mcp.noServers')}
            </p>
          </div>
        ) : (
          servers.map((server) => (
            editingServer === server.name ? (
              <McpServerForm
                key={server.name}
                server={server}
                onSave={async (name, config) => {
                  await updateServer(server.name, name, config);
                }}
                onCancel={() => setEditing(null)}
                t={t}
              />
            ) : (
              <McpServerCard
                key={server.name}
                server={server}
                onEdit={() => setEditing(server.name)}
                onDelete={() => handleDelete(server.name)}
                t={t}
              />
            )
          ))
        )}
      </div>
    </div>
  );
}

/* Server card */
type PingStatus = 'idle' | 'pinging' | 'success' | 'failed';

function McpServerCard({
  server,
  onEdit,
  onDelete,
  t,
}: {
  server: McpServer;
  onEdit: () => void;
  onDelete: () => void;
  t: (key: string) => string;
}) {
  const isHttp = isHttpTransport(server.config);
  const envCount = Object.keys(server.config.env).length;
  const cmdDisplay = [server.config.command, ...server.config.args].join(' ');
  const displayLine = isHttp ? (server.config.url || '') : cmdDisplay;

  const [pingStatus, setPingStatus] = useState<PingStatus>('idle');
  const [latency, setLatency] = useState<number | null>(null);
  const [pingDetail, setPingDetail] = useState<string | null>(null);

  const handlePing = useCallback(async () => {
    setPingStatus('pinging');
    setPingDetail(null);
    try {
      const result = await bridge.pingMcpServer(server.config);
      setLatency(result.latencyMs);
      if (result.ok) {
        setPingStatus('success');
        setPingDetail(
          result.serverName
            ? `${result.serverName}${result.serverVersion ? ` v${result.serverVersion}` : ''}`
            : null
        );
      } else {
        setPingStatus('failed');
        setPingDetail(result.error || t('mcp.pingFailed'));
      }
    } catch (e) {
      setPingStatus('failed');
      setPingDetail(String(e));
    }
  }, [server.config, t]);

  return (
    <div className="mx-1.5 mb-1 px-2.5 py-2 rounded-lg
      transition-smooth group border border-transparent
      hover:bg-bg-secondary hover:border-border-subtle">
      {/* Row 1: Name + type badge + ping + actions */}
      <div className="flex items-center gap-1.5">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5"
          className="text-text-tertiary flex-shrink-0">
          <path d="M2 4a2 2 0 012-2h8a2 2 0 012 2v1H2V4z" />
          <path d="M2 7h12v5a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" />
        </svg>
        <span className="text-[13px] font-medium truncate flex-1 text-text-primary">
          {server.name}
        </span>
        <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] rounded-md
          bg-blue-500/15 text-blue-400 font-medium">
          {server.config.type}
        </span>
        {/* Ping button */}
        <button
          onClick={handlePing}
          disabled={pingStatus === 'pinging'}
          className="flex-shrink-0 p-0.5 rounded hover:bg-bg-tertiary
            transition-smooth text-text-tertiary hover:text-accent
            disabled:opacity-50 disabled:cursor-wait"
          title={t('mcp.ping')}
        >
          {pingStatus === 'pinging' ? (
            <span className="block w-2.5 h-2.5 border-[1.5px] border-accent/30
              border-t-accent rounded-full animate-spin" />
          ) : (
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1.5 5.5a9.5 9.5 0 0113 0M4 8a6 6 0 018 0M6.5 10.5a2.5 2.5 0 013.5 0" />
              <circle cx="8" cy="13" r="1" fill="currentColor" stroke="none" />
            </svg>
          )}
        </button>
        {/* Ping result */}
        {pingStatus === 'success' && (
          <span
            className="flex-shrink-0 flex items-center gap-1 text-[9px] text-green-400"
            title={pingDetail || t('mcp.pingSuccess')}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            {latency !== null && `${latency}ms`}
          </span>
        )}
        {pingStatus === 'failed' && (
          <span
            className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-red-400"
            title={pingDetail || t('mcp.pingFailed')}
          />
        )}
        {/* Edit button */}
        <button
          onClick={onEdit}
          className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100
            hover:bg-bg-tertiary transition-smooth text-text-tertiary"
          title={t('mcp.edit')}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z" />
          </svg>
        </button>
        {/* Delete button */}
        <button
          onClick={onDelete}
          className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100
            hover:bg-red-500/10 transition-smooth text-text-tertiary hover:text-red-500"
          title={t('mcp.delete')}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z" />
          </svg>
        </button>
      </div>

      {/* Row 2: Command / URL in monospace */}
      <p className="text-[11px] text-text-muted mt-1 font-mono truncate pl-4">
        {displayLine}
      </p>

      {/* Row 3: Env var count (stdio only) */}
      {!isHttp && envCount > 0 && (
        <p className="text-[10px] text-text-tertiary mt-0.5 pl-4">
          {envCount} {t('mcp.envCount')}
        </p>
      )}
    </div>
  );
}

/* Add/Edit form */
function McpServerForm({
  server,
  onSave,
  onCancel,
  t,
}: {
  server?: McpServer;
  onSave: (name: string, config: McpServerConfig) => Promise<void>;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  const [name, setName] = useState(server?.name || '');
  const [transport, setTransport] = useState<'stdio' | 'http'>(
    server && isHttpTransport(server.config) ? 'http' : 'stdio'
  );
  const [command, setCommand] = useState(server?.config.command || '');
  const [argsText, setArgsText] = useState(server?.config.args.join('\n') || '');
  const [envText, setEnvText] = useState(
    server?.config.env
      ? Object.entries(server.config.env).map(([k, v]) => `${k}=${v}`).join('\n')
      : ''
  );
  const [url, setUrl] = useState(server?.config.url || '');
  const [headersText, setHeadersText] = useState(
    server?.config.headers
      ? Object.entries(server.config.headers).map(([k, v]) => `${k}=${v}`).join('\n')
      : ''
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    if (transport === 'http' && !url.trim()) return;
    if (transport === 'stdio' && !command.trim()) return;
    setIsSaving(true);
    try {
      const parseKeyValueLines = (text: string): Record<string, string> => {
        const record: Record<string, string> = {};
        text.split('\n').forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            record[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
          }
        });
        return record;
      };
      if (transport === 'http') {
        // Preserve legacy `sse` type when editing an sse server as http.
        const finalType = server?.config.type === 'sse' ? 'sse' : 'http';
        await onSave(name.trim(), {
          command: '',
          args: [],
          env: {},
          type: finalType,
          url: url.trim(),
          headers: parseKeyValueLines(headersText),
        });
      } else {
        const args = argsText.split('\n').map((s) => s.trim()).filter(Boolean);
        await onSave(name.trim(), {
          command: command.trim(),
          args,
          env: parseKeyValueLines(envText),
          type: 'stdio',
        });
      }
    } finally {
      setIsSaving(false);
    }
  }, [name, transport, command, argsText, envText, url, headersText, onSave, server]);

  const inputClass = `w-full px-2 py-1 text-xs bg-bg-chat border border-border-subtle
    rounded-lg outline-none focus:border-accent text-text-primary`;

  return (
    <div className="mx-1.5 mb-1 px-2.5 py-2 rounded-lg border border-accent/30
      bg-accent/5 space-y-2">
      {/* Name */}
      <div>
        <label className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">
          {t('mcp.name')}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('mcp.namePlaceholder')}
          className={inputClass}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
          }}
        />
      </div>

      {/* Transport */}
      <div>
        <label className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">
          {t('mcp.transport')}
        </label>
        <div className="flex gap-1 mt-1">
          {(['stdio', 'http'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setTransport(mode)}
              className={`flex-1 px-2 py-1 text-xs rounded-lg transition-smooth border ${
                transport === mode
                  ? 'bg-accent/15 border-accent/40 text-accent'
                  : 'bg-bg-chat border-border-subtle text-text-muted hover:text-text-primary'
              }`}
            >
              {mode === 'stdio' ? t('mcp.transportStdio') : t('mcp.transportHttp')}
            </button>
          ))}
        </div>
      </div>

      {transport === 'stdio' ? (
        <>
          {/* Command */}
          <div>
            <label className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">
              {t('mcp.command')}
            </label>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t('mcp.commandPlaceholder')}
              className={inputClass}
            />
          </div>

          {/* Args */}
          <div>
            <label className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">
              {t('mcp.args')}
            </label>
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder={t('mcp.argsHint')}
              rows={2}
              className={`${inputClass} resize-none font-mono`}
            />
          </div>

          {/* Env */}
          <div>
            <label className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">
              {t('mcp.env')}
            </label>
            <textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder={t('mcp.envHint')}
              rows={2}
              className={`${inputClass} resize-none font-mono`}
            />
          </div>
        </>
      ) : (
        <>
          {/* URL */}
          <div>
            <label className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">
              {t('mcp.url')}
            </label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('mcp.urlPlaceholder')}
              className={`${inputClass} font-mono`}
            />
          </div>

          {/* Headers */}
          <div>
            <label className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider">
              {t('mcp.headers')}
            </label>
            <textarea
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              placeholder={t('mcp.headersHint')}
              rows={2}
              className={`${inputClass} resize-none font-mono`}
            />
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!name.trim() || (transport === 'http' ? !url.trim() : !command.trim()) || isSaving}
          className="flex-1 px-2 py-1 text-xs bg-accent text-text-inverse rounded-lg
            hover:bg-accent-hover disabled:opacity-40 transition-smooth"
        >
          {isSaving ? '...' : t('mcp.save')}
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-1 text-xs text-text-muted hover:text-text-primary transition-smooth"
        >
          {t('mcp.cancel')}
        </button>
      </div>
    </div>
  );
}
