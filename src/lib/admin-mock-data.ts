export function exportToCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export const FORBIDDEN_WORDS_DEFAULT = [
  'спам','мошенничество','фейк','скам','обман',
  'реклама','казино','ставки','заработок','крипта','инвестиции',
  'наркотики','закладки','продажа','куплю','порно','секс',
  'работа на дому','пассивный доход','быстрый доход','заработок в интернете',
  'форекс','бинарные опционы','покер','слоты','микрозайм',
  'кидалово','лохотрон','обнал','кардинг','фишинг','накрутка',
  'продам аккаунт','куплю аккаунт','мефедрон','кокаин','амфетамин',
  'кладмен','закладчик',
];
