/** Copies text to the clipboard; falls back to a hidden textarea where the async API is blocked (older mobile browsers, non-secure origins). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Copies an image (not its link) so it can be pasted straight into
 * Messenger/Viber. Browsers only accept PNG on the clipboard, so the image is
 * re-drawn onto a canvas first. Returns false if the browser blocks it (e.g.
 * the image host sends no CORS headers) - callers should fall back to the link.
 */
export async function copyImageFromUrl(url: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
    const blob = await (await fetch(url, { mode: "cors" })).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch {
    return false;
  }
}
