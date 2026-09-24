import { useMemo } from 'react';
import { CHAR_LIMIT, countChars, countTokens, TOKEN_LIMIT } from '../../cart/tokens';
import { useProject } from '../../store/project';

function colorFor(ratio: number): string {
  if (ratio >= 0.95) return 'var(--color-p8-red)';
  if (ratio >= 0.8) return 'var(--color-p8-orange)';
  if (ratio >= 0.65) return 'var(--color-p8-yellow)';
  return 'var(--color-p8-blue)';
}

export function TokenMeter() {
  const rev = useProject((s) => s.revisions.code);
  const id = useProject((s) => s.id);
  const code = useProject.getState().cart?.code ?? '';
  const { tokens, chars } = useMemo(() => ({ tokens: countTokens(code), chars: countChars(code) }), [rev, id, code]);
  const ratio = tokens / TOKEN_LIMIT;
  return (
    <div className="flex items-center gap-3" data-testid="token-meter" title="PICO-8 token and character limits">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-1 text-[11px] tabular-nums">
          <span style={{ color: colorFor(ratio) }} className="font-bold">
            {tokens}
          </span>
          <span className="text-dim">/{TOKEN_LIMIT} tokens</span>
        </div>
        <div className="h-1 w-32 bg-line">
          <div className="h-full transition-[width,background-color] duration-200" style={{ width: `${Math.min(100, ratio * 100)}%`, background: colorFor(ratio) }} />
        </div>
      </div>
      <div className="hidden text-[11px] text-dim tabular-nums lg:block" title="characters">
        <span style={{ color: chars > CHAR_LIMIT ? 'var(--color-p8-red)' : undefined }}>{chars}</span>/{CHAR_LIMIT}
      </div>
    </div>
  );
}
