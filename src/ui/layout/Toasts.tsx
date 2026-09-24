import { useToasts } from '../../store/toast';

const TONE = { info: 'border-p8-blue', success: 'border-p8-green', error: 'border-p8-red' } as const;

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto border-l-4 ${TONE[t.tone]} border-y border-r border-y-line border-r-line bg-panel2 px-3 py-1.5 text-[12px] shadow-[var(--shadow-hard)] animate-slide-up`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
