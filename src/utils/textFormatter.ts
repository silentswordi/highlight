export function sanitizeFileName(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  if (!cleaned) return "highlights";
  return cleaned.replace(/\.(txt|md)$/i, "");
}

export function buildPlainTextDocument(highlights: string[]): string {
  return highlights
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .join("\n\n");
}

export function downloadTextFile(fileName: string, content: string, format: "txt" | "md" = "txt"): void {
  const safeBase = sanitizeFileName(fileName);
  const fullFileName = `${safeBase}.${format}`;
  const payload = format === "txt" ? `\uFEFF${content}` : content;
  const mimeType = format === "txt" ? "text/plain;charset=utf-8" : "text/markdown;charset=utf-8";
  const blob = new Blob([payload], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = fullFileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function resizeImageForUpload(dataUrl: string, maxDimension = 2400, quality = 0.92): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth, naturalHeight } = img;
      if (!naturalWidth || !naturalHeight) {
        resolve(dataUrl);
        return;
      }

      const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
      const targetWidth = Math.round(naturalWidth * scale);
      const targetHeight = Math.round(naturalHeight * scale);

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("خطا در خواندن تصویر"));
    img.src = dataUrl;
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("خطا در خواندن فایل"));
      }
    };
    reader.onerror = () => reject(new Error("خطا در خواندن فایل"));
    reader.readAsDataURL(file);
  });
}

export async function urlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("خطا در بارگذاری تصویر نمونه");
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("خطا در تبدیل تصویر"));
      }
    };
    reader.onerror = () => reject(new Error("خطا در تبدیل تصویر"));
    reader.readAsDataURL(blob);
  });
}
