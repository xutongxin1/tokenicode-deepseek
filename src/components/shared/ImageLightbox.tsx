import { useEffect, useCallback, useState, useRef } from 'react';
import { create } from 'zustand';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';

/* ================================================================
   Lightbox store — global state for the image lightbox overlay
   ================================================================ */

interface LightboxState {
  isOpen: boolean;
  /** Data URL or file path to display */
  imageSrc: string | null;
  /** Original file path (for "open externally" action) */
  filePath: string | null;
  /** Optional alt text */
  alt: string;

  open: (src: string, filePath?: string, alt?: string) => void;
  /** Open by loading a file from disk via Rust base64 */
  openFile: (path: string, alt?: string) => void;
  close: () => void;
}

export const useLightboxStore = create<LightboxState>()((set) => ({
  isOpen: false,
  imageSrc: null,
  filePath: null,
  alt: '',

  open: (src, filePath, alt) =>
    set({ isOpen: true, imageSrc: src, filePath: filePath || null, alt: alt || '' }),

  openFile: async (path, alt) => {
    // Images over 50MB are not loaded in-app — hand to the system app.
    try {
      const size = await bridge.getFileSize(path);
      if (size > 50 * 1024 * 1024) {
        await bridge.openWithDefaultApp(path);
        return;
      }
    } catch {
      // Size check failed — fall through to in-app preview.
    }
    set({ isOpen: true, imageSrc: null, filePath: path, alt: alt || '' });
    try {
      const dataUrl = await bridge.readFileBase64(path);
      set({ imageSrc: dataUrl });
    } catch {
      set({ isOpen: false, imageSrc: null });
    }
  },

  close: () =>
    set({ isOpen: false, imageSrc: null, filePath: null, alt: '' }),
}));

/* ================================================================
   ImageLightbox component — fullscreen overlay
   ================================================================ */

export function ImageLightbox() {
  const t = useT();
  const isOpen = useLightboxStore((s) => s.isOpen);
  const imageSrc = useLightboxStore((s) => s.imageSrc);
  const filePath = useLightboxStore((s) => s.filePath);
  const alt = useLightboxStore((s) => s.alt);
  const close = useLightboxStore((s) => s.close);

  // Wheel zoom — plain wheel zooms, no Ctrl needed. Clamped 0.2x–8x.
  const [scale, setScale] = useState(1);
  // The scale the DOM currently reflects (state may briefly be ahead of the
  // DOM when wheel events coalesce into one render).
  const renderedScaleRef = useRef(1);
  // Pan offset in px; only meaningful when scale > 1. Drag-to-pan keeps the
  // zoomed image fully reachable instead of clipping it around the center.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  // True if the last pointer interaction was a pan drag (suppresses the
  // click-to-close that fires right after releasing the button)
  const movedRef = useRef(false);
  // Displayed (unscaled) image size — used to clamp pan so the image can
  // never be dragged fully out of view.
  const [display, setDisplay] = useState({ w: 0, h: 0 });

  const zoomBy = useCallback((factor: number) => {
    setScale((s) => Math.min(8, Math.max(0.2, s * factor)));
  }, []);

  // Clamp pan so the zoomed image always still covers the viewport's center
  // area — edges of the rendered image must not pass the center of the screen.
  const clampPan = useCallback((p: { x: number; y: number }, s: number) => {
    if (s <= 1 || display.w === 0) return { x: 0, y: 0 };
    const renderedW = display.w * s;
    const renderedH = display.h * s;
    const maxX = Math.max(0, (renderedW - window.innerWidth) / 2);
    const maxY = Math.max(0, (renderedH - window.innerHeight) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, p.x)),
      y: Math.min(maxY, Math.max(-maxY, p.y)),
    };
  }, [display.w, display.h]);

  // ESC to close
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  }, [close]);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  // Reset zoom/pan whenever the overlay opens or the image changes
  useEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [isOpen, imageSrc]);

  // Re-clamp pan after zoom changes (e.g. zoomed back out below 1), and
  // keep the rendered-scale ref in sync with the DOM.
  useEffect(() => {
    renderedScaleRef.current = scale;
    setPan((p) => {
      const next = clampPan(p, scale);
      return next.x === p.x && next.y === p.y ? p : next;
    });
  }, [scale, clampPan]);

  // Drag-to-pan while zoomed in
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) {
        movedRef.current = true;
      }
      setPan(clampPan({ x: d.panX + (e.clientX - d.x), y: d.panY + (e.clientY - d.y) }, scale));
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [dragging, scale, clampPan]);

  // Wheel zoom via a window-level CAPTURE listener. The overlay covers the
  // whole viewport, so every wheel event while it is open zooms the image.
  // Capture phase + native listener are required: React's root wheel
  // listener is passive (preventDefault would be a no-op and the chat
  // behind would scroll), and an element-level listener can miss events
  // depending on WebView2 event routing.
  //
  // Zoom anchors on the pointer: the image point under the cursor stays put
  // (the pan is shifted to compensate), instead of zooming about the center.
  useEffect(() => {
    if (!isOpen) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const oldScale = renderedScaleRef.current;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newScale = Math.min(8, Math.max(0.2, oldScale * factor));
      if (newScale === oldScale) return;
      const f = newScale / oldScale;
      // Image center sits at the screen center + pan (the overlay is a
      // centered flex container). Cursor offset from that center.
      const dx = e.clientX - window.innerWidth / 2;
      const dy = e.clientY - window.innerHeight / 2;
      renderedScaleRef.current = newScale;
      setScale(newScale);
      // Keep the image point under the cursor fixed:
      // (dx - pan.x) / oldScale must equal (dx - pan'.x) / newScale.
      setPan((p) =>
        clampPan({ x: dx - (dx - p.x) * f, y: dy - (dy - p.y) * f }, newScale),
      );
    };
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', onWheel, true);
  }, [isOpen, clampPan]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center
        bg-black/80 backdrop-blur-sm animate-fade-in cursor-zoom-out"
      onClick={close}
    >
      {/* Close button */}
      <button
        onClick={close}
        className="absolute top-4 right-4 p-2 rounded-full
          bg-white/10 hover:bg-white/20 text-white
          transition-smooth z-10"
      >
        <svg width="20" height="20" viewBox="0 0 14 14" fill="none"
          stroke="currentColor" strokeWidth="2">
          <path d="M4 4l6 6M10 4l-6 6" />
        </svg>
      </button>

      {/* Open externally button */}
      {filePath && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            bridge.openWithDefaultApp(filePath);
          }}
          className="absolute top-4 left-4 px-3 py-1.5 rounded-lg
            bg-white/10 hover:bg-white/20 text-white text-xs font-medium
            transition-smooth z-10"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
            stroke="currentColor" strokeWidth="1.5" className="inline mr-1.5">
            <path d="M5 1H2a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V7" />
            <path d="M7 1h4v4M11 1L5.5 6.5" />
          </svg>
          Open
        </button>
      )}

      {/* Image */}
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={alt}
          className={`max-w-[90vw] max-h-[90vh] object-contain rounded-lg shrink-0
            shadow-2xl ${dragging ? 'cursor-grabbing' : scale > 1 ? 'cursor-grab' : 'cursor-default'}
            ${dragging ? '' : 'transition-transform duration-75'}`}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0) {
              // Fit natural size into 90vw × 90vh — the actual unscaled
              // rendered size, used to clamp the pan range.
              const k = Math.min(
                (window.innerWidth * 0.9) / img.naturalWidth,
                (window.innerHeight * 0.9) / img.naturalHeight,
              );
              setDisplay({ w: img.naturalWidth * k, h: img.naturalHeight * k });
            }
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
            setDragging(true);
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (movedRef.current) {
              movedRef.current = false; // was a pan drag — don't close
            } else {
              close();
            }
          }}
          draggable={false}
        />
      ) : (
        /* Loading spinner */
        <div className="flex items-center justify-center">
          <svg className="animate-spin-slow" width="32" height="32"
            viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </div>
      )}

      {/* Alt text caption */}
      {alt && imageSrc && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2
          px-4 py-2 rounded-lg bg-black/60 text-white/80 text-xs
          max-w-[80vw] truncate">
          {alt}
        </div>
      )}

      {/* Zoom controls — wheel zooms too; buttons are an explicit affordance */}
      {imageSrc && (
        <div
          className="absolute bottom-6 right-4 flex items-center gap-1 z-10"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => zoomBy(1 / 1.25)}
            className="w-7 h-7 rounded-lg bg-black/60 hover:bg-black/80
              text-white/80 text-sm transition-smooth cursor-pointer"
            title={t('img.zoomOut')}
          >
            −
          </button>
          <button
            onClick={() => setScale(1)}
            className="px-2 h-7 min-w-[52px] rounded-lg bg-black/60 hover:bg-black/80
              text-white/80 text-xs transition-smooth cursor-pointer"
            title={t('img.resetZoom')}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            onClick={() => zoomBy(1.25)}
            className="w-7 h-7 rounded-lg bg-black/60 hover:bg-black/80
              text-white/80 text-sm transition-smooth cursor-pointer"
            title={t('img.zoomIn')}
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}
