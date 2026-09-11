import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Paperclip } from "lucide-react";

export interface PickedImage {
  path: string;
  dataUrl: string;
  name: string;
}

/** Both coding-agent composers use the native picker, including WebView2. */
export function ImageAttachmentButton({
  onAttach,
  onError,
  onLoadingChange,
  disabled,
  remaining = 8,
}: {
  onAttach: (images: PickedImage[]) => void | Promise<void>;
  onError: (error: unknown) => void;
  onLoadingChange?: (loading: boolean) => void;
  disabled?: boolean;
  remaining?: number;
}) {
  const [loading, setLoading] = useState(false);
  const pick = async () => {
    if (loading) return;
    setLoading(true);
    onLoadingChange?.(true);
    try {
      const selection = await open({
        title: "Attach images",
        multiple: true,
        directory: false,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
        ],
      });
      if (!selection) return;
      const paths = Array.isArray(selection) ? selection : [selection];
      if (paths.length > remaining)
        throw new Error(
          `You can attach ${remaining} more image${remaining === 1 ? "" : "s"}.`,
        );
      const images = await Promise.all(
        paths.map(async (path) => ({
          path,
          name: path.split(/[\\/]/).pop() || "Image",
          dataUrl: await invoke<string>("read_chat_image", { path }),
        })),
      );
      await onAttach(images);
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
      onLoadingChange?.(false);
    }
  };
  return (
    <button
      type="button"
      className="chat-attach-btn"
      title={loading ? "Loading images..." : "Attach images"}
      aria-label="Attach images"
      disabled={disabled || loading || remaining <= 0}
      onClick={() => void pick()}
    >
      <Paperclip size={16} aria-hidden="true" />
    </button>
  );
}
