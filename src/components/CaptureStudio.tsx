import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Grid3X3,
  ImagePlus,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { CapturedPage, HighlightSensitivity, OcrLanguage } from "../types";
import { fileToDataUrl, resizeImageForUpload, urlToDataUrl } from "../utils/textFormatter";

const SAMPLE_BOOK_IMAGE_URL = "/src/assets/images/sample_book_highlight_1795039177510.jpg";

const LANGUAGE_OPTIONS: Array<{ value: OcrLanguage; label: string }> = [
  { value: "eng+fas", label: "فارسی + انگلیسی" },
  { value: "eng", label: "انگلیسی" },
  { value: "fas", label: "فارسی" },
];

const SENSITIVITY_OPTIONS: Array<{ value: HighlightSensitivity; label: string }> = [
  { value: "high", label: "بالا (کمرنگ)" },
  { value: "medium", label: "متعادل" },
  { value: "low", label: "پررنگ" },
];

interface CaptureStudioProps {
  pages: CapturedPage[];
  activePageId: string | null;
  onSelectPage: (id: string) => void;
  onAddPages: (newPages: CapturedPage[]) => void;
  onRemovePage: (id: string) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  progressPercent: number;
  progressStatus: string;
  language: OcrLanguage;
  onChangeLanguage: (language: OcrLanguage) => void;
  sensitivity: HighlightSensitivity;
  onChangeSensitivity: (sensitivity: HighlightSensitivity) => void;
  errorMessage: string | null;
}

export function CaptureStudio({
  pages,
  activePageId,
  onSelectPage,
  onAddPages,
  onRemovePage,
  onAnalyze,
  isAnalyzing,
  progressPercent,
  progressStatus,
  language,
  onChangeLanguage,
  sensitivity,
  onChangeSensitivity,
  errorMessage,
}: CaptureStudioProps) {
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [showGridGuide, setShowGridGuide] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isLoadingSample, setIsLoadingSample] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);

  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0] ?? null;

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    if (!isCameraOpen) {
      stopCameraStream();
      return;
    }

    let cancelled = false;
    setCameraError(null);

    async function startCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError("دوربین زنده در این مرورگر پشتیبانی نمی‌شود. می‌توانید از دکمه دوربین گوشی یا گالری استفاده کنید.");
        return;
      }

      try {
        stopCameraStream();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 2560 },
            height: { ideal: 1440 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch {
        if (!cancelled) {
          setCameraError(
            "دسترسی به دوربین زنده مسدود یا در دسترس نیست. می‌توانید از گزینه «دوربین دستگاه» یا «انتخاب از گالری» استفاده کنید."
          );
        }
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      stopCameraStream();
    };
  }, [isCameraOpen, facingMode]);

  const handleCaptureFrame = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    const maxDimension = 2400;
    const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

    const newPage: CapturedPage = {
      id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      dataUrl,
      name: `عکس دوربین ${pages.length + 1}`,
      source: "camera",
    };

    onAddPages([newPage]);
    setIsCameraOpen(false);
  };

  const processFiles = async (fileList: FileList | null, source: "camera" | "gallery") => {
    if (!fileList || fileList.length === 0) return;

    const imageFiles = Array.from(fileList).filter(
      (f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|bmp|gif)$/i.test(f.name)
    );
    if (imageFiles.length === 0) return;

    const prepared: CapturedPage[] = [];
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      try {
        const rawUrl = await fileToDataUrl(file);
        const optimizedUrl = await resizeImageForUpload(rawUrl, 2400, 0.92);
        prepared.push({
          id: `page-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
          dataUrl: optimizedUrl,
          name: file.name || `صفحه ${pages.length + i + 1}`,
          source,
        });
      } catch {
        // Skip unreadable image file
      }
    }

    if (prepared.length > 0) {
      onAddPages(prepared);
      setIsCameraOpen(false);
    }
  };

  const handleLoadSample = async () => {
    setIsLoadingSample(true);
    try {
      const dataUrl = await urlToDataUrl(SAMPLE_BOOK_IMAGE_URL);
      const samplePage: CapturedPage = {
        id: `sample-${Date.now()}`,
        dataUrl,
        name: "نمونه صفحه کتاب",
        source: "sample",
      };
      onAddPages([samplePage]);
      setIsCameraOpen(false);
    } catch {
      setCameraError("بارگذاری تصویر نمونه با خطا مواجه شد.");
    } finally {
      setIsLoadingSample(false);
    }
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6">
      {/* Studio Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
        <div>
          <h2 className="text-base font-bold text-zinc-900">تصویر کتاب یا متن</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            عکسبرداری با دوربین یا بارگذاری تصویر از گالری دستگاه
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCameraOpen((prev) => !prev)}
            className={`inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
              isCameraOpen
                ? "bg-zinc-900 text-white"
                : "border border-zinc-200 bg-zinc-50 text-zinc-800 hover:bg-zinc-100"
            }`}
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
            <span>{isCameraOpen ? "بستن دوربین" : "دوربین زنده"}</span>
          </button>

          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            className="inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-100"
          >
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
            <span>انتخاب از گالری</span>
          </button>
        </div>
      </div>

      {/* Hidden inputs */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void processFiles(e.target.files, "gallery");
          e.target.value = "";
        }}
      />
      <input
        ref={nativeCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void processFiles(e.target.files, "camera");
          e.target.value = "";
        }}
      />

      {/* Main Viewport Area */}
      <div className="mt-4 flex-1">
        {isCameraOpen ? (
          <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950">
            {cameraError ? (
              <div className="flex min-h-[340px] flex-col items-center justify-center p-6 text-center text-white">
                <Camera className="h-10 w-10 text-zinc-400" aria-hidden="true" />
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-zinc-200">{cameraError}</p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => nativeCameraInputRef.current?.click()}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
                  >
                    <Camera className="h-4 w-4" aria-hidden="true" />
                    <span>باز کردن دوربین دستگاه</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                  >
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    <span>آپلود از گالری</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="relative aspect-[3/4] max-h-[460px] w-full bg-black">
                  <video
                    ref={videoRef}
                    playsInline
                    autoPlay
                    muted
                    className="h-full w-full object-cover"
                  />
                  {showGridGuide && (
                    <div className="pointer-events-none absolute inset-6 rounded-lg border border-amber-300/60">
                      <div className="absolute inset-x-0 top-1/3 border-t border-white/20" />
                      <div className="absolute inset-x-0 top-2/3 border-t border-white/20" />
                      <div className="absolute inset-y-0 left-1/3 border-l border-white/20" />
                      <div className="absolute inset-y-0 left-2/3 border-l border-white/20" />
                    </div>
                  )}
                </div>

                {/* Camera Controls Bar */}
                <div className="flex items-center justify-between bg-zinc-950/95 px-4 py-3 text-white">
                  <button
                    type="button"
                    onClick={() => setShowGridGuide((v) => !v)}
                    aria-label="تغییر خطوط راهنمای کادر"
                    className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border transition-colors ${
                      showGridGuide
                        ? "border-amber-400/50 bg-amber-500/20 text-amber-300"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400"
                    }`}
                  >
                    <Grid3X3 className="h-5 w-5" />
                  </button>

                  <button
                    type="button"
                    onClick={handleCaptureFrame}
                    className="inline-flex min-h-[48px] items-center gap-2 rounded-full bg-amber-500 px-6 py-2.5 text-sm font-bold text-zinc-950 transition-transform hover:bg-amber-400 active:scale-[0.97]"
                  >
                    <Camera className="h-4 w-4" aria-hidden="true" />
                    <span>ثبت عکس صفحه</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setFacingMode((prev) => (prev === "environment" ? "user" : "environment"))
                      }
                      aria-label="تغییر دوربین جلو و عقب"
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCameraOpen(false)}
                      aria-label="بستن دوربین"
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : activePage ? (
          <div className="space-y-3">
            {/* Active Page Preview */}
            <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-[#F2EFE9]">
              <div className={`relative w-full ${isZoomed ? "max-h-[480px] overflow-auto" : "h-[360px] sm:h-[420px]"}`}>
                <img
                  src={activePage.dataUrl}
                  alt={activePage.name}
                  referrerPolicy="no-referrer"
                  className={
                    isZoomed
                      ? "mx-auto w-full min-w-[640px] object-contain"
                      : "h-full w-full object-contain p-2"
                  }
                />
              </div>

              {/* Subtle Overlay Controls */}
              <div className="flex items-center justify-between border-t border-zinc-200/80 bg-white/90 px-3 py-2 backdrop-blur-xs">
                <span className="truncate text-xs font-medium text-zinc-700 max-w-[180px] sm:max-w-[260px]">
                  {activePage.name}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsZoomed((z) => !z)}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                  >
                    {isZoomed ? (
                      <>
                        <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>نمای کامل</span>
                      </>
                    ) : (
                      <>
                        <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>بزرگ‌نمایی</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemovePage(activePage.id)}
                    aria-label="حذف این صفحه"
                    className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-zinc-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Page Thumbnail Queue */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {pages.map((page, index) => {
                const isSelected = page.id === activePage.id;
                return (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => onSelectPage(page.id)}
                    className={`group relative h-16 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
                      isSelected
                        ? "border-amber-500 ring-2 ring-amber-500/20"
                        : "border-zinc-200 opacity-75 hover:opacity-100"
                    }`}
                  >
                    <img
                      src={page.dataUrl}
                      alt={`صفحه ${index + 1}`}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute bottom-0.5 right-0.5 rounded bg-zinc-950/75 px-1 text-[10px] font-medium text-white tabular-nums">
                      {index + 1}
                    </span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 text-[11px] font-medium text-zinc-600 transition-colors hover:border-zinc-400 hover:bg-zinc-100"
              >
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
                <span>افزودن</span>
              </button>

              <button
                type="button"
                onClick={() => setIsCameraOpen(true)}
                className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 text-[11px] font-medium text-zinc-600 transition-colors hover:border-zinc-400 hover:bg-zinc-100"
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
                <span>دوربین</span>
              </button>
            </div>
          </div>
        ) : (
          /* Empty Capture / Upload Dropzone */
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              void processFiles(e.dataTransfer.files, "gallery");
            }}
            className={`flex min-h-[360px] flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              isDragging
                ? "border-amber-500 bg-amber-50/60"
                : "border-zinc-200 bg-[#FAF9F6]"
            }`}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-amber-600">
              <Camera className="h-6 w-6" aria-hidden="true" />
            </div>
            <h3 className="mt-4 text-base font-bold text-zinc-900">
              از صفحه کتاب عکس بگیرید یا تصویر آپلود کنید
            </h3>
            <p className="mt-1.5 max-w-sm text-xs leading-6 text-zinc-500">
              تشخیص آفلاین متن‌های هایلایت‌شده (حتی هایلایت‌های کمرنگ) در صفحات فارسی و انگلیسی بدون نیاز به اینترنت.
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setIsCameraOpen(true)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
                <span>عکسبرداری با دوربین</span>
              </button>

              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span>آپلود از گالری</span>
              </button>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-4 border-t border-zinc-200/70 pt-4">
              <button
                type="button"
                onClick={() => nativeCameraInputRef.current?.click()}
                className="text-xs font-medium text-zinc-600 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-900"
              >
                استفاده از دوربین پیش‌فرض گوشی
              </button>
              <span className="text-zinc-300" aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => void handleLoadSample()}
                disabled={isLoadingSample}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 underline decoration-amber-300 underline-offset-4 hover:text-amber-800 disabled:opacity-60"
              >
                {isLoadingSample ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>امتحان با تصویر نمونه کتاب</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Extraction Controls Footer */}
      <div className="mt-5 space-y-3 border-t border-zinc-100 pt-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <span className="mb-1.5 block text-xs font-medium text-zinc-600">زبان متن</span>
            <div
              role="group"
              aria-label="انتخاب زبان متن"
              className="grid grid-cols-3 gap-1 rounded-xl border border-zinc-200 bg-[#FAF9F6] p-1"
            >
              {LANGUAGE_OPTIONS.map((opt) => {
                const active = language === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={isAnalyzing}
                    onClick={() => onChangeLanguage(opt.value)}
                    className={`min-h-[36px] rounded-lg px-2 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors ${
                      active
                        ? "bg-white text-zinc-900 shadow-xs ring-1 ring-zinc-200/80"
                        : "text-zinc-600 hover:text-zinc-900"
                    } disabled:opacity-60`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-zinc-600">حساسیت هایلایت</span>
            <div
              role="group"
              aria-label="انتخاب حساسیت تشخیص هایلایت"
              className="grid grid-cols-3 gap-1 rounded-xl border border-zinc-200 bg-[#FAF9F6] p-1"
            >
              {SENSITIVITY_OPTIONS.map((opt) => {
                const active = sensitivity === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={isAnalyzing}
                    onClick={() => onChangeSensitivity(opt.value)}
                    className={`min-h-[36px] rounded-lg px-2 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors ${
                      active
                        ? "bg-white text-zinc-900 shadow-xs ring-1 ring-zinc-200/80"
                        : "text-zinc-600 hover:text-zinc-900"
                    } disabled:opacity-60`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs leading-relaxed text-red-800"
          >
            {errorMessage}
          </div>
        )}

        <button
          type="button"
          onClick={onAnalyze}
          disabled={pages.length === 0 || isAnalyzing}
          className="flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span className="tabular-nums">
                {progressStatus ? `${progressStatus} (${progressPercent}٪)` : "در حال پردازش آفلاین..."}
              </span>
            </>
          ) : (
            <span>
              {pages.length > 1
                ? `استخراج آفلاین هایلایت‌های ${pages.length} صفحه`
                : "استخراج آفلاین متن‌های هایلایت‌شده"}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
