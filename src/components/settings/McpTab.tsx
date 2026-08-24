import { useEffect, useState, useCallback } from 'react';
import { useMcpStore, isHttpTransport } from '../../stores/mcpStore';
import type { DiscoveredMcpServer, McpServer, McpServerConfig } from '../../stores/mcpStore';
import { useT } from '../../lib/i18n';
import { bridge } from '../../lib/tauri-bridge';

export function McpTab() {
  const t = useT();
  const servers = useMcpStore((s) => s.servers);
  const discoveredServers = useMcpStore((s) => s.discoveredServers);
  const isLoading = useMcpStore((s) => s.isLoading);
  const isScanning = useMcpStore((s) => s.isScanning);
  const scanMessage = useMcpStore((s) => s.scanMessage);
  const fetchServers = useMcpStore((s) => s.fetchServers);
  const scanInstalledServers = useMcpStore((s) => s.scanInstalledServers);
  const importDiscoveredServers = useMcpStore((s) => s.importDiscoveredServers);
  const addServer = useMcpStore((s) => s.addServer);
  const updateServer = useMcpStore((s) => s.updateServer);
  const deleteServer = useMcpStore((s) => s.deleteServer);
  const editingServer = useMcpStore((s) => s.editingServer);
  const isAdding = useMcpStore((s) => s.isAdding);
  const setEditing = useMcpStore((s) => s.setEditing);
  const setAdding = useMcpStore((s) => s.setAdding);

  useEffect(() => {
    fetchServers();
    scanInstalledServers();
  }, [fetchServers, scanInstalledServers]);

  const handleDelete = useCallback(async (name: string) => {
    if (confirm(t('mcp.confirmDelete'))) {
      await deleteServer(name);
    }
  }, [deleteServer, t]);

  const missingDiscovered = discoveredServers.filter((server) => !server.imported);

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-medium text-text-primary">
            {t('mcp.title')}
          </h3>
          <span className="text-xs text-text-tertiary">{servers.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => scanInstalledServers()}
            disabled={isScanning}
            className="px-2.5 py-1.5 rounded border border-border-subtle
              text-xs text-text-muted hover:bg-bg-secondary hover:text-text-primary
              transition-smooth disabled:opacity-50 disabled:cursor-not-allowed"
            title="扫描终端和本地配置里的 MCP"
          >
            {isScanning ? '扫描中...' : '扫描本地'}
          </button>
          {missingDiscovered.length > 0 && (
            <button
              onClick={() => importDiscoveredServers()}
              className="px-2.5 py-1.5 rounded bg-accent text-text-inverse
                text-xs font-medium hover:bg-accent-hover transition-smooth"
              title="导入扫描到但当前未显示的 MCP"
            >
              导入 {missingDiscovered.length}
            </button>
          )}
          <button
            onClick={() => fetchServers()}
            className="p-1.5 rounded hover:bg-bg-secondary
              text-text-tertiary transition-smooth"
            title={t('mcp.refresh')}
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none"
              stroke="currentColor" strokeWidth="1.5">
              <path d="M1 6a5 5 0 019-2M11 6a5 5 0 01-9 2" />
              <path d="M10 1v3h-3M2 11V8h3" />
            </svg>
          </button>
          <button
            onClick={() => setAdding(true)}
            className="p-1.5 rounded hover:bg-bg-secondary
              text-text-tertiary transition-smooth"
            title={t('mcp.add')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content — always expanded */}
      {scanMessage && (
        <p className="text-xs text-text-tertiary">{scanMessage}</p>
      )}

      {discoveredServers.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted">本地扫描结果</span>
            <span className="text-xs text-text-tertiary">
              {missingDiscovered.length > 0 ? `${missingDiscovered.length} 个未导入` : '全部已导入'}
            </span>
          </div>
          {missingDiscovered.length > 0 && (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {missingDiscovered.map((server) => (
                <DiscoveredMcpCard
                  key={`${server.source}-${server.name}-${server.config.command}`}
                  server={server}
                  onImport={() => importDiscoveredServers([server.name])}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {/* Add form */}
        {isAdding && (
          <McpServerForm
            onSave={async (name, config) => { await addServer(name, config); }}
            onCancel={() => setAdding(false)}
            t={t}
          />
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="w-5 h-5 border-2 border-accent/30
              border-t-accent rounded-full animate-spin" />
          </div>
        ) : servers.length === 0 && !isAdding ? (
          <p className="text-[13px] text-text-tertiary text-center py-6">
            {t('mcp.noServers')}
          </p>
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
              <McpServerCardCompact
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

function DiscoveredMcpCard({
  server,
  onImport,
}: {
  server: DiscoveredMcpServer;
  onImport: () => void;
}) {
  const envCount = Object.keys(server.config.env).length;
  const cmdDisplay = [server.config.command, ...server.config.args].join(' ');

  return (
    <div className={`px-3 py-2.5 rounded-lg border transition-smooth
      ${server.imported ? 'border-border-subtle bg-bg-secondary/20' : 'border-accent/20 bg-accent/5'}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-text-primary truncate flex-1">
          {server.name}
        </span>
        <button
          onClick={onImport}
          className="px-2 py-0.5 rounded-md text-[11px] font-medium
            bg-accent text-text-inverse hover:bg-accent-hover transition-smooth"
        >
          导入
        </button>
      </div>
      <p className="mt-1 text-[11px] text-text-tertiary truncate" title={server.source}>
        {server.source}
      </p>
      <p className="mt-1 text-xs text-text-muted font-mono truncate" title={cmdDisplay}>
        {cmdDisplay}
      </p>
      {envCount > 0 && (
        <p className="mt-0.5 text-[11px] text-text-tertiary">{envCount} 个环境变量</p>
      )}
    </div>
  );
}

/* Compact server card */
type PingStatus = 'idle' | 'pinging' | 'success' | 'failed';

function McpServerCardCompact({
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
    <div className="px-4 py-3 rounded-lg transition-smooth group border
      border-border-subtle hover:bg-bg-secondary">
      {/* Name + type + actions */}
      <div className="flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5"
          className="text-text-tertiary flex-shrink-0">
          <path d="M2 4a2 2 0 012-2h8a2 2 0 012 2v1H2V4z" />
          <path d="M2 7h12v5a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" />
        </svg>
        <span className="text-[13px] font-medium truncate flex-1 text-text-primary">
          {server.name}
        </span>
        <span className="flex-shrink-0 px-2 py-0.5 text-xs rounded-md
          bg-blue-500/15 text-blue-400 font-medium">
          {server.config.type}
        </span>
        {/* Ping button */}
        <button
          onClick={handlePing}
          disabled={pingStatus === 'pinging'}
          className="flex-shrink-0 p-1 rounded hover:bg-bg-tertiary
            transition-smooth text-text-muted hover:text-accent
            disabled:opacity-50 disabled:cursor-wait"
          title={t('mcp.ping')}
        >
          {pingStatus === 'pinging' ? (
            <span className="block w-3 h-3 border-[1.5px] border-accent/30
              border-t-accent rounded-full animate-spin" />
          ) : (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1.5 5.5a9.5 9.5 0 0113 0M4 8a6 6 0 018 0M6.5 10.5a2.5 2.5 0 013.5 0" />
              <circle cx="8" cy="13" r="1" fill="currentColor" stroke="none" />
            </svg>
          )}
        </button>
        {/* Ping result */}
        {pingStatus === 'success' && (
          <span
            className="flex-shrink-0 flex items-center gap-1 text-[10px] text-green-400"
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
        <button
          onClick={onEdit}
          className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100
            hover:bg-bg-tertiary transition-smooth text-text-tertiary"
          title={t('mcp.edit')}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100
            hover:bg-red-500/10 transition-smooth text-text-tertiary hover:text-red-500"
          title={t('mcp.delete')}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z" />
          </svg>
        </button>
      </div>
      {/* Command / URL */}
      <p className="text-xs text-text-muted mt-1 font-mono truncate pl-5">
        {displayLine}
      </p>
      {!isHttp && envCount > 0 && (
        <p className="text-xs text-text-tertiary mt-0.5 pl-5">
          {envCount} {t('mcp.envCount')}
        </p>
      )}
    </div>
  );
}

/* Add/Edit form for MCP servers */
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

  const inputClass = `w-full px-3 py-2 text-[13px] bg-bg-chat border border-border-subtle
    rounded-lg outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary`;

  return (
    <div className="px-4 py-3 rounded-lg border border-accent/30 bg-accent/5 space-y-3">
      <div>
        <label className="text-xs text-text-muted">
          {t('mcp.name')}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('mcp.namePlaceholder')}
          className={inputClass}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
        />
      </div>
      <div>
        <label className="text-xs text-text-muted">
          {t('mcp.transport')}
        </label>
        <div className="flex gap-1 mt-1">
          {(['stdio', 'http'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setTransport(mode)}
              className={`flex-1 px-2 py-1.5 text-xs rounded-lg transition-smooth border ${
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
          <div>
            <label className="text-xs text-text-muted">
              {t('mcp.command')}
            </label>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t('mcp.commandPlaceholder')}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-xs text-text-muted">
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
          <div>
            <label className="text-xs text-text-muted">
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
          <div>
            <label className="text-xs text-text-muted">
              {t('mcp.url')}
            </label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('mcp.urlPlaceholder')}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label className="text-xs text-text-muted">
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
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={!name.trim() || (transport === 'http' ? !url.trim() : !command.trim()) || isSaving}
          className="flex-1 px-4 py-2 text-[13px] font-medium bg-accent text-text-inverse rounded-lg
            hover:bg-accent-hover disabled:opacity-40 transition-smooth"
        >
          {isSaving ? '...' : t('mcp.save')}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-[13px] text-text-muted hover:text-text-primary transition-smooth"
        >
          {t('mcp.cancel')}
        </button>
      </div>
    </div>
  );
}
