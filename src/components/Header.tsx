import { Plus } from "lucide-react";

interface HeaderProps {
  onNewScan: () => void;
}

export function Header({ onNewScan }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-[#FAF9F6]/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
        {/* Brand Wordmark */}
        <span className="whitespace-nowrap shrink-0 text-xl font-extrabold tracking-tight text-zinc-900">
          نکته‌نگار
        </span>

        {/* Primary Action */}
        <button
          type="button"
          onClick={onNewScan}
          className="inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap shrink-0 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>اسکن جدید</span>
        </button>
      </div>
    </header>
  );
}
