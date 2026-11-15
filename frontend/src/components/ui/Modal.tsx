"use client";

import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidthClassName?: string;
  contained?: boolean;
  className?: string;
}

/**
 * Shared glassmorphism modal shell (dark backdrop blur, rounded-3xl card)
 * matching the style already used ad-hoc across crds/schedules/settings
 * pages, extracted so new features (Guardian preflight, fleet drill-down)
 * do not re-implement the same markup.
 */
export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidthClassName = "max-w-md",
  contained = false,
  className = "",
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
        ) || [],
      );
    window.setTimeout(() => focusable()[0]?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || "Dialog"}
        className={`bg-slate-900 border border-slate-800 rounded-3xl w-full ${maxWidthClassName} ${className} p-6 shadow-2xl relative ${contained ? "h-[min(90vh,850px)] flex flex-col" : "max-h-[85vh] overflow-y-auto"}`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
        {(title || subtitle) && (
          <div className={contained ? "shrink-0" : ""}>
            {title && (
              <h3 className="text-xl font-bold text-white mb-1 pr-6">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-slate-500 text-xs mb-4 font-mono">
                {subtitle}
              </p>
            )}
          </div>
        )}
        <div className={contained ? "min-h-0 flex-1" : ""}>
          {children}
        </div>
      </div>
    </div>
  );
}
