export interface McpField {
  type?: string;
  title?: string;
  description?: string;
  enum?: string[];
  oneOf?: { const: string; title?: string }[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
}
export interface McpSchema {
  type?: string;
  properties?: Record<string, McpField>;
  required?: string[];
}

export function supportedMcpSchema(schema: McpSchema): boolean {
  return (
    schema.type === "object" &&
    !!schema.properties &&
    Object.values(schema.properties).every((f) =>
      ["string", "number", "integer", "boolean"].includes(f.type ?? ""),
    )
  );
}

export function mcpFormContent(
  schema: McpSchema,
  values: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const value = values[name] ?? "";
    if (!value && !schema.required?.includes(name)) continue;
    if (!value) throw new Error(`Enter ${field.title || name}.`);
    if (field.type === "boolean") result[name] = value === "true";
    else if (field.type === "number" || field.type === "integer") {
      const number = Number(value);
      if (
        !Number.isFinite(number) ||
        (field.type === "integer" && !Number.isInteger(number)) ||
        (field.minimum !== undefined && number < field.minimum) ||
        (field.maximum !== undefined && number > field.maximum)
      ) {
        throw new Error(
          `Enter a valid ${field.type} for ${field.title || name}.`,
        );
      }
      result[name] = number;
    } else result[name] = value;
  }
  return result;
}

export function McpForm({
  schema,
  values,
  onChange,
  disabled,
}: {
  schema: McpSchema;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  disabled: boolean;
}) {
  return (
    <>
      {Object.entries(schema.properties ?? {}).map(([name, field]) => {
        const options =
          field.enum?.map((value) => ({ value, label: value })) ??
          field.oneOf?.map((o) => ({
            value: o.const,
            label: o.title ?? o.const,
          }));
        const change = (value: string) =>
          onChange({ ...values, [name]: value });
        return (
          <label className="form-label" key={name}>
            {field.title || name}
            {schema.required?.includes(name) ? " *" : ""}
            {field.description && <small>{field.description}</small>}
            {field.type === "boolean" || options ? (
              <select
                className="form-select"
                disabled={disabled}
                value={values[name] ?? ""}
                onChange={(e) => change(e.target.value)}
              >
                <option value="">Choose an answer</option>
                {(
                  options ?? [
                    { value: "true", label: "Yes" },
                    { value: "false", label: "No" },
                  ]
                ).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="form-input"
                disabled={disabled}
                value={values[name] ?? ""}
                onChange={(e) => change(e.target.value)}
                type={
                  ["number", "integer"].includes(field.type ?? "")
                    ? "number"
                    : field.format === "email"
                      ? "email"
                      : "text"
                }
                min={field.minimum}
                max={field.maximum}
                minLength={field.minLength}
                maxLength={field.maxLength}
                step={field.type === "integer" ? 1 : "any"}
              />
            )}
          </label>
        );
      })}
    </>
  );
}
