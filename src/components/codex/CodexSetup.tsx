import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useWizardStore } from "../../store/wizardStore";
import { useSettingsStore } from "../../store/settingsStore";
import { openCodexSession } from "../../lib/codexSessions";
import { CodexHistory } from "./CodexHistory";
import { CodexPermissionSelect } from "./CodexPermissionSelect";
import { codexPermissionMode, codexPermissions } from "../../lib/codexPermissions";
import type {
  CodexConfig,
  CodexDiscovery,
  CodexThread,
} from "../../types/codex";

export function CodexSetup({ wizardId }: { wizardId: string }) {
  const wizard = useWizardStore();
  const last = useSettingsStore.getState().settings.lastSessionPreset;
  const [config, setConfig] = useState<CodexConfig>(() => ({
    cwd: wizard.cwd,
    model: last?.kind === "codex" ? (last.codex?.model ?? "") : "",
    effort: last?.kind === "codex" ? (last.codex?.effort ?? "") : "",
    ...codexPermissions(useSettingsStore.getState().settings.defaultCodexPermissionMode),
    instructions: "",
    executablePath: last?.codex?.executablePath ?? "",
    terminal: wizard.panelView === "terminal",
  }));
  const [info, setInfo] = useState<CodexDiscovery>();
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(false);
  const [selected, setSelected] = useState<CodexThread>();
  const patch = (value: Partial<CodexConfig>) =>
    setConfig((c) => ({ ...c, ...value }));
  const discover = async () => {
    setLoading(true);
    setError("");
    setInfo(undefined);
    try {
      const data = await invoke<CodexDiscovery>("codex_discover", {
        executablePath: config.executablePath || null,
      });
      setInfo(data);
      const model =
        data.models.find((m) => m.model === config.model) ||
        data.models.find((m) => m.isDefault) ||
        data.models[0];
      if (model)
        patch({
          model: model.model,
          effort: model.supportedReasoningEfforts.some(
            (e) => e.reasoningEffort === config.effort,
          )
            ? config.effort
            : model.defaultReasoningEffort,
        });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void discover();
  }, []);
  const model = info?.models.find((m) => m.model === config.model);
  const authenticated =
    !!info && (!info.account.requiresOpenaiAuth || !!info.account.account);
  const create = async () => {
    setCreating(true);
    setError("");
    try {
      await openCodexSession(
        { ...config, terminal: wizard.panelView === "terminal" },
        selected?.id,
        wizardId,
      );
    } catch (e) {
      setError(String(e));
      setCreating(false);
    }
  };
  return (
    <div className="codex-setup">
      <div className="form-row">
        <strong>Codex CLI</strong>
        <span className="form-hint">
          {loading
            ? "Checking installation…"
            : authenticated
              ? "Existing Codex login ready"
              : "Sign in with codex login"}
        </span>
        <button
          className="btn btn-secondary"
          onClick={() => void discover()}
          disabled={loading}
        >
          Retry
        </button>
      </div>
      <details>
        <summary>Executable path</summary>
        <input
          className="form-input"
          aria-label="Codex executable path"
          value={config.executablePath}
          onChange={(e) => {
            patch({ executablePath: e.target.value });
            setInfo(undefined);
          }}
          placeholder="Auto-detect Codex on PATH"
        />
        <p className="form-hint">
          Use Retry after changing the path. Tessera reuses the CLI login.
        </p>
      </details>
      {error && (
        <p role="alert" className="codex-error">
          {error}
        </p>
      )}
      <label className="form-label">
        Model
        <select
          className="form-select"
          aria-label="Codex setup model"
          value={config.model}
          onChange={(e) => {
            const m = info?.models.find((m) => m.model === e.target.value);
            patch({
              model: e.target.value,
              effort: m?.defaultReasoningEffort ?? "",
            });
          }}
        >
          {!info?.models.length && <option value="">No models loaded</option>}
          {info?.models.map((m) => (
            <option key={m.id} value={m.model}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="form-label">
        Reasoning
        <select
          className="form-select"
          aria-label="Codex setup reasoning"
          value={config.effort}
          onChange={(e) => patch({ effort: e.target.value })}
        >
          {model?.supportedReasoningEfforts.map((e) => (
            <option key={e.reasoningEffort} value={e.reasoningEffort}>
              {e.reasoningEffort}
            </option>
          ))}
        </select>
      </label>
      <label className="form-label">
        Project folder
        <div className="form-row">
          <input
            className="form-input form-input-grow"
            aria-label="Codex project folder"
            value={config.cwd}
            onChange={(e) => {
              patch({ cwd: e.target.value });
              setSelected(undefined);
            }}
          />
          <button
            className="btn btn-secondary"
            onClick={async () => {
              const path = await open({ directory: true, multiple: false });
              if (path) {
                patch({ cwd: path });
                setSelected(undefined);
              }
            }}
          >
            Browse
          </button>
        </div>
      </label>
      <CodexPermissionSelect
        value={codexPermissionMode(config)}
        onChange={(mode) => patch(codexPermissions(mode))}
        disabled={creating}
      />
      <details>
        <summary>Additional instructions</summary>
        <textarea
          className="form-textarea"
          rows={3}
          value={config.instructions}
          onChange={(e) => patch({ instructions: e.target.value })}
        />
      </details>
      <button
        className="btn btn-secondary"
        onClick={() => setHistory((v) => !v)}
      >
        {history ? "Hide history" : "Browse existing Codex conversations"}
      </button>
      {history && (
        <CodexHistory
          executablePath={config.executablePath}
          onSelect={(thread) => {
            setSelected(thread);
            patch({ cwd: thread.cwd });
            setHistory(false);
          }}
        />
      )}
      {selected && (
        <p>
          Resume: {selected.name || selected.preview || selected.id}{" "}
          <button
            className="btn btn-secondary"
            onClick={() => setSelected(undefined)}
          >
            Start fresh instead
          </button>
        </p>
      )}
      <button
        className="btn btn-primary"
        disabled={
          !authenticated || !config.model || !config.cwd || creating || loading
        }
        onClick={() => void create()}
      >
        {creating
          ? "Starting Codex…"
          : selected
            ? "Resume Codex"
            : "Add Codex panel"}
      </button>
    </div>
  );
}
