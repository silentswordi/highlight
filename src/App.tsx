/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { CaptureStudio } from "./components/CaptureStudio";
import { Header } from "./components/Header";
import { ShareModal } from "./components/ShareModal";
import { TextFileResultPane } from "./components/TextFileResultPane";
import type { CapturedPage, HighlightSensitivity, OcrLanguage } from "./types";
import { extractHighlightsOffline } from "./utils/offlineHighlightExtractor";
import { buildPlainTextDocument } from "./utils/textFormatter";

export default function App() {
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);

  const [language, setLanguage] = useState<OcrLanguage>("eng+fas");
  const [sensitivity, setSensitivity] = useState<HighlightSensitivity>("high");

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStatus, setProgressStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasResult, setHasResult] = useState(false);

  const [fileName, setFileName] = useState("highlights");
  const [plainText, setPlainText] = useState("");
  const [isShareOpen, setIsShareOpen] = useState(false);

  const handleAddPages = (newPages: CapturedPage[]) => {
    setPages((prev) => [...prev, ...newPages]);
    if (newPages.length > 0) {
      setActivePageId(newPages[0].id);
    }
    setErrorMessage(null);
  };

  const handleRemovePage = (id: string) => {
    setPages((prev) => {
      const remaining = prev.filter((p) => p.id !== id);
      if (activePageId === id) {
        setActivePageId(remaining[0]?.id ?? null);
      }
      return remaining;
    });
  };

  const handleNewScan = () => {
    setPages([]);
    setActivePageId(null);
    setHasResult(false);
    setErrorMessage(null);
    setProgressPercent(0);
    setProgressStatus("");
    setFileName("highlights");
    setPlainText("");
  };

  const handleAnalyze = async () => {
    if (pages.length === 0 || isAnalyzing) return;

    setIsAnalyzing(true);
    setProgressPercent(5);
    setProgressStatus("در حال آماده‌سازی پردازش آفلاین...");
    setErrorMessage(null);

    try {
      const highlights = await extractHighlightsOffline(
        pages,
        { language, sensitivity },
        (pct, status) => {
          setProgressPercent(pct);
          setProgressStatus(status);
        }
      );

      const pureText = buildPlainTextDocument(highlights);

      setFileName(`highlights-${new Date().toISOString().slice(0, 10)}`);
      setPlainText(pureText);
      setHasResult(true);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "خطای غیرمنتظره در تحلیل آفلاین تصویر رخ داد."
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-zinc-900">
      <Header onNewScan={handleNewScan} />

      <main>
        <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 pb-12">
          {/* Concise Editorial Hero Strip */}
          <div className="mb-6 flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-zinc-200/80 pb-5">
            <div className="max-w-2xl">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 [text-wrap:balance]">
                استخراج{" "}
                <span className="rounded-sm bg-amber-200/75 px-1.5 py-0.5 text-zinc-950">
                  متن‌های هایلایت‌شده
                </span>{" "}
                به فایل متنی
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                از صفحه کتاب یا متن عکس بگیرید یا از گالری بارگذاری کنید؛ تمام پردازش تشخیص متن و رنگ هایلایت به‌صورت ۱۰۰٪ آفلاین روی دستگاه خودتان انجام و به فایل متنی تبدیل می‌شود.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500 whitespace-nowrap">
              <span>پردازش ۱۰۰٪ آفلاین روی دستگاه</span>
              <span aria-hidden="true">·</span>
              <span>بدون نیاز به اینترنت یا هوش مصنوعی</span>
              <span aria-hidden="true">·</span>
              <span>خروجی .txt و اشتراک‌گذاری</span>
            </div>
          </div>

          {/* Two-Column Equal-Height Studio Split */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-stretch">
            <CaptureStudio
              pages={pages}
              activePageId={activePageId}
              onSelectPage={setActivePageId}
              onAddPages={handleAddPages}
              onRemovePage={handleRemovePage}
              onAnalyze={() => void handleAnalyze()}
              isAnalyzing={isAnalyzing}
              progressPercent={progressPercent}
              progressStatus={progressStatus}
              language={language}
              onChangeLanguage={setLanguage}
              sensitivity={sensitivity}
              onChangeSensitivity={setSensitivity}
              errorMessage={errorMessage}
            />

            <TextFileResultPane
              hasResult={hasResult}
              isAnalyzing={isAnalyzing}
              progressPercent={progressPercent}
              progressStatus={progressStatus}
              fileName={fileName}
              onChangeFileName={setFileName}
              plainText={plainText}
              onChangePlainText={setPlainText}
              onOpenShare={() => setIsShareOpen(true)}
            />
          </div>
        </section>
      </main>

      <ShareModal
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        title={fileName}
        fileName={fileName}
        content={plainText}
      />
    </div>
  );
}
