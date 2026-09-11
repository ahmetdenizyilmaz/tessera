import { CODEX_PERMISSION_MODES } from "../../lib/codexPermissions";
import type { CodexPermissionMode } from "../../types/codex";

export function CodexPermissionSelect({
  value,
  onChange,
  label = "Codex permissions",
  disabled = false,
}: {
  value: CodexPermissionMode | "custom";
  onChange: (mode: CodexPermissionMode) => void;
  label?: string;
  disabled?: boolean;
}) {
  const preset = CODEX_PERMISSION_MODES.find((entry) => entry.id === value);
  return (
    <div className="form-group">
      <label className="form-label">
        {label}
        <select
          className="form-select"
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value as CodexPermissionMode)}
        >
          {value === "custom" && <option value="custom" disabled>Custom permissions</option>}
          {CODEX_PERMISSION_MODES.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.label}</option>
          ))}
        </select>
      </label>
      {preset && <p className="form-hint">{preset.description}</p>}
    </div>
  );
}
