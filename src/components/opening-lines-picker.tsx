import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLanguage } from '@/context/language-context';
import { useFeatureFlags } from '@/context/feature-flags-context';
import { cn } from '@/lib/utils';
import {
  OPENING_LINE_CATEGORIES,
  openingLineKeys,
  missingPlaceholders,
  renderOpeningLine,
  type OpeningLineCategory,
  type OpeningLineVars,
} from '@/lib/opening-lines';

type OpeningLinesPickerProps = {
  firstName?: string | null;
  commonInterest?: string | null;
  onPick: (text: string) => void;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
};

export function OpeningLinesPicker({ firstName, commonInterest, onPick, side = 'top', align = 'end' }: OpeningLinesPickerProps) {
  const { t } = useLanguage();
  const { openingLinesEnabled } = useFeatureFlags();
  const [category, setCategory] = useState<OpeningLineCategory>(OPENING_LINE_CATEGORIES[0]);
  const [open, setOpen] = useState(false);

  if (!openingLinesEnabled) return null;

  const vars: OpeningLineVars = { firstName, commonInterest };
  const lines = openingLineKeys(category)
    .map((key) => t(key))
    .filter((line) => missingPlaceholders(line, vars).length === 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="opening-lines-button"
          aria-label={t('chats.opening.button')}
          title={t('chats.opening.button')}
          className="text-muted-foreground hover:text-primary transition-colors"
        >
          <Sparkles size={16} />
        </button>
      </PopoverTrigger>
      <PopoverContent data-testid="opening-lines-popover" side={side} align={align} className="w-72 p-2 rounded-2xl border-0 shadow-2xl bg-white">
        <p className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t('chats.opening.title')}</p>
        <div className="flex flex-wrap gap-1 pb-2">
          {OPENING_LINE_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              data-testid={`opening-lines-category-${c}`}
              onClick={() => setCategory(c)}
              className={cn('px-2 py-1 text-[11px] font-bold rounded-full transition-all', category === c ? 'gradient-bg text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70')}
            >
              {t(`chats.opening.category.${c}`)}
            </button>
          ))}
        </div>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {lines.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">{t('chats.opening.empty')}</p>}
          {lines.map((line) => {
            const text = renderOpeningLine(line, vars);
            return (
              <button
                key={line}
                type="button"
                data-testid="opening-line"
                onClick={() => { onPick(text); setOpen(false); }}
                className="w-full text-left text-xs font-medium px-3 py-2 rounded-xl bg-muted/40 hover:bg-primary/10 hover:text-primary transition-all"
              >
                {text}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
