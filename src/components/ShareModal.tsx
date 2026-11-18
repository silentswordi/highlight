import { useState } from "react";
import { Check, Copy, Download, Mail, MessageCircle, Send, Share2, X } from "lucide-react";
import { downloadTextFile, sanitizeFileName } from "../utils/textFormatter";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  fileName: string;
  content: string;
}

export function ShareModal({ isOpen, onClose, title, fileName, content }: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [nativeError, setNativeError] = useState<string | null>(null);

  if (!isOpen) return null;

  const canUseNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNativeError("مرورگر اجازه دسترسی خودکار به کلیپ‌بورد را نداد.");
    }
  };

  const handleNativeShare = async () => {
    if (!canUseNativeShare) return;
    setNativeError(null);
    try {
      const safeName = `${sanitizeFileName(fileName)}.txt`;
      const txtFile = new File([`\uFEFF${content}`], safeName, { type: "text/plain;charset=utf-8" });
      const shareDataWithFile: ShareData = {
        title: title || safeName,
        text: content,
        files: [txtFile],
      };

      if (typeof navigator.canShare === "function" && navigator.canShare(shareDataWithFile)) {
        await navigator.share(shareDataWithFile);
      } else {
        await navigator.share({
          title: title || safeName,
          text: content,
        });
      }
      onClose();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setNativeError("اشتراک‌گذاری مستقیم در این مرورگر پشتیبانی نشد؛ می‌توانید از گزینه‌های زیر استفاده کنید.");
    }
  };

  const encodedText = encodeURIComponent(content);
  const encodedSubject = encodeURIComponent(title || sanitizeFileName(fileName));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-zinc-950/50 p-0 sm:p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 id="share-modal-title" className="text-lg font-bold text-zinc-900">
              اشتراک‌گذاری متن استخراج‌شده
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              فایل متنی: {sanitizeFileName(fileName)}.txt
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن پنجره اشتراک‌گذاری"
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {nativeError && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {nativeError}
          </div>
        )}

        <div className="space-y-2.5">
          {canUseNativeShare && (
            <button
              type="button"
              onClick={handleNativeShare}
              className="flex min-h-[48px] w-full items-center justify-between rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
            >
              <span className="flex items-center gap-3">
                <Share2 className="h-4 w-4" aria-hidden="true" />
                <span>ارسال مستقیم با منوی دستگاه (فایل و متن)</span>
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className="flex min-h-[46px] w-full items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100"
          >
            <span className="flex items-center gap-3">
              {copied ? (
                <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4 text-zinc-600" aria-hidden="true" />
              )}
              <span>{copied ? "متن کامل در کلیپ‌بورد کپی شد" : "کپی متن کامل در کلیپ‌بورد"}</span>
            </span>
          </button>

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <a
              href={`https://wa.me/?text=${encodedText}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50"
            >
              <MessageCircle className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              <span>واتساپ</span>
            </a>

            <a
              href={`https://t.me/share/url?url=&text=${encodedText}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50"
            >
              <Send className="h-4 w-4 text-sky-600" aria-hidden="true" />
              <span>تلگرام</span>
            </a>

            <a
              href={`mailto:?subject=${encodedSubject}&body=${encodedText}`}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50"
            >
              <Mail className="h-4 w-4 text-zinc-600" aria-hidden="true" />
              <span>ایمیل</span>
            </a>

            <button
              type="button"
              onClick={() => downloadTextFile(fileName, content, "md")}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50"
            >
              <Download className="h-4 w-4 text-amber-600" aria-hidden="true" />
              <span>دانلود Markdown</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
