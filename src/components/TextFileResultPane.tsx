import { useState } from "react";
import { Check, Copy, Download, FileText, Highlighter, Share2 } from "lucide-react";
import { countWords, downloadTextFile, sanitizeFileName } from "../utils/textFormatter";

interface TextFileResultPaneProps {
  hasResult: boolean;
  isAnalyzing: boolean;
  progressPercent?: number;
  progressStatus?: string;
  fileName: string;
  onChangeFileName: (name: string) => void;
  plainText: string;
  onChangePlainText: (text: string) => void;
  onOpenShare: () => void;
}

export function TextFileResultPane({
  hasResult,
  isAnalyzing,
  progressPercent = 0,
  progressStatus = "",
  fileName,
  onChangeFileName,
  plainText,
  onChangePlainText,
  onOpenShare,
}: TextFileResultPaneProps) {
  const [copiedFull, setCopiedFull] = useState(false);

  const wordCount = countWords(plainText);
  const charCount = plainText.length;
  const lineCount = plainText ? plainText.split("\n").length : 0;
  const isEmptyHighlights = hasResult && !plainText.trim();

  const handleCopyFull = async () => {
    if (!plainText.trim()) return;
    try {
      await navigator.clipboard.writeText(plainText);
      setCopiedFull(true);
      setTimeout(() => setCopiedFull(false), 2000);
    } catch {
      // Clipboard blocked fallback
    }
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6">
      {/* Pane Header */}
      <div className="flex items-center gap-2.5 border-b border-zinc-100 pb-4">
        <FileText className="h-5 w-5 text-amber-600" aria-hidden="true" />
        <div>
          <h2 className="text-base font-bold text-zinc-900">فایل متنی استخراج‌شده</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {hasResult
              ? "فقط بخش‌های هایلایت‌شده بدون عنوان یا شماره‌گذاری اضافه"
              : "پس از پردازش آفلاین تصویر، متن هایلایت‌شده در قالب فایل متنی اینجا نمایش داده می‌شود"}
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="mt-4 flex flex-1 flex-col">
        {isAnalyzing ? (
          <div className="flex flex-1 min-h-[360px] flex-col items-center justify-center rounded-xl border border-zinc-200 bg-[#FAF9F6] p-8 text-center">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-zinc-200 border-t-amber-500" />
            <p className="mt-4 text-sm font-semibold text-zinc-800">
              {progressStatus || "در حال پردازش آفلاین تصویر و استخراج هایلایت‌ها..."}
            </p>
            <div className="mt-4 w-full max-w-xs">
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${Math.max(4, Math.min(100, progressPercent))}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs font-medium text-zinc-500 tabular-nums">
                {progressPercent}٪
              </p>
            </div>
            <p className="mt-2 max-w-xs text-xs leading-6 text-zinc-500">
              تمام تحلیل رنگ و تشخیص متن به‌صورت محلی داخل مرورگر و بدون اینترنت انجام می‌شود.
            </p>
          </div>
        ) : !hasResult ? (
          <div className="flex flex-1 min-h-[360px] flex-col justify-between rounded-xl border border-zinc-200 bg-[#FAF9F6] p-6">
            <div>
              <div className="flex items-center justify-between border-b border-zinc-200/80 pb-3 text-xs text-zinc-500">
                <span className="font-mono-txt" dir="ltr">
                  highlights.txt
                </span>
                <span>پیش‌نمایش فایل خروجی</span>
              </div>
              <div className="mt-5 space-y-3 text-sm leading-7 text-zinc-400 select-none">
                <p>جملات و پاراگراف‌های هایلایت‌شده دقیقاً با متن اصلی تایپ می‌شوند...</p>
                <p>متن‌های غیرهایلایت، جدول‌ها، الگوریتم‌ها و توضیحات عکس‌ها نادیده گرفته می‌شوند.</p>
                <p>خروجی بدون متن اضافه آماده ذخیره به‌صورت فایل متنی و اشتراک‌گذاری است.</p>
              </div>
            </div>

            <div className="mt-6 border-t border-zinc-200/80 pt-3 text-xs text-zinc-500">
              یک تصویر اضافه کنید و دکمه «استخراج آفلاین متن‌های هایلایت‌شده» را بزنید.
            </div>
          </div>
        ) : isEmptyHighlights ? (
          <div className="flex flex-1 min-h-[320px] flex-col items-center justify-center rounded-xl border border-zinc-200 bg-[#FAF9F6] p-6 text-center">
            <Highlighter className="h-8 w-8 text-zinc-400" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-bold text-zinc-800">
              متن هایلایت‌شده‌ای در این تصویر پیدا نشد
            </h3>
            <p className="mt-1.5 max-w-sm text-xs leading-6 text-zinc-500">
              اگر هایلایت صفحه بسیار محو است، با نور بهتر عکس بگیرید و دوباره امتحان کنید.
            </p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col">
            {/* Editable File Name */}
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-zinc-200 bg-[#FAF9F6] px-3 py-2">
              <span className="whitespace-nowrap text-xs font-medium text-zinc-600">نام فایل:</span>
              <div className="flex flex-1 items-center rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 focus-within:border-amber-500">
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => onChangeFileName(e.target.value)}
                  aria-label="نام فایل متنی"
                  className="w-full bg-transparent text-xs font-medium text-zinc-900 focus:outline-none"
                />
                <span className="font-mono-txt text-xs text-zinc-400" dir="ltr">
                  .txt
                </span>
              </div>
            </div>

            {/* Plain Text File Sheet */}
            <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50/70 px-3.5 py-2 text-xs text-zinc-500">
                <span className="font-mono-txt min-w-0 truncate" dir="ltr">
                  {sanitizeFileName(fileName)}.txt
                </span>
                <span className="tabular-nums shrink-0 whitespace-nowrap">
                  {lineCount} خط · {wordCount} کلمه · {charCount} کاراکتر
                </span>
              </div>

              <textarea
                dir="auto"
                value={plainText}
                onChange={(e) => onChangePlainText(e.target.value)}
                aria-label="محتوای فایل متنی استخراج‌شده"
                className="min-h-[320px] flex-1 resize-y bg-white p-4 text-sm leading-8 text-zinc-900 focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Save & Share Actions Bar */}
      <div className="mt-5 border-t border-zinc-100 pt-4">
        <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center">
          <button
            type="button"
            disabled={!hasResult || !plainText.trim()}
            onClick={() => downloadTextFile(fileName, plainText, "txt")}
            className="col-span-2 inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-zinc-900 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>ذخیره فایل متنی (.txt)</span>
          </button>

          <button
            type="button"
            disabled={!hasResult || !plainText.trim()}
            onClick={() => void handleCopyFull()}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-xs sm:text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
          >
            {copiedFull ? (
              <>
                <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                <span>کپی شد</span>
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" aria-hidden="true" />
                <span>کپی متن</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={!hasResult || !plainText.trim()}
            onClick={onOpenShare}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-xs sm:text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
          >
            <Share2 className="h-4 w-4" aria-hidden="true" />
            <span>اشتراک‌گذاری</span>
          </button>
        </div>
      </div>
    </div>
  );
}
