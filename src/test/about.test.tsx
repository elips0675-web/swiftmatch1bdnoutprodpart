import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}));

vi.mock('@/components/layout/app-header', () => ({
  AppHeader: () => null,
}));

import AboutPage from '@/pages/about';

describe('Страница about', () => {
  it('рисует заголовок, описание и название раздела стека', () => {
    render(<AboutPage />);

    expect(screen.getByText('about.title')).toBeInTheDocument();
    expect(screen.getByText('about.description')).toBeInTheDocument();
    expect(screen.getByText('about.stack.title')).toBeInTheDocument();
  });

  it('рисует четыре карточки стека: заголовок и описание каждой берутся из t()', () => {
    render(<AboutPage />);

    for (const key of ['about.frontend', 'about.backend', 'about.ai', 'about.performance']) {
      expect(screen.getByText(`${key}.title`)).toBeInTheDocument();
      expect(screen.getByText(`${key}.desc`)).toBeInTheDocument();
    }
  });

  it('бейджи обещают стек проекта, а не чужой', () => {
    render(<AboutPage />);

    expect(screen.getByText('React 18')).toBeInTheDocument();
    expect(screen.getByText('Vite')).toBeInTheDocument();
    expect(screen.getByText('Express')).toBeInTheDocument();
    expect(screen.getByText('MySQL 8')).toBeInTheDocument();
    expect(screen.getByText('Socket.io')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('Lazy loading')).toBeInTheDocument();
    expect(screen.getByText('Code-splitting')).toBeInTheDocument();

    expect(screen.queryByText(/Next\.js/)).toBeNull();
    expect(screen.queryByText('React 19')).toBeNull();
    expect(screen.queryByText(/Firebase/)).toBeNull();
    expect(screen.queryByText('Firestore')).toBeNull();
    expect(screen.queryByText('Genkit')).toBeNull();
    expect(screen.queryByText(/Gemini/)).toBeNull();
    expect(screen.queryByText('RSC')).toBeNull();
  });

  it('описание мобильного блока берётся из ключа, а не из русского текста в разметке', () => {
    render(<AboutPage />);

    expect(screen.getByText('about.mobile.desc')).toBeInTheDocument();
    expect(screen.queryByText(/Проект полностью оптимизирован/)).toBeNull();
  });

  it('подвал показывает версию', () => {
    render(<AboutPage />);

    expect(screen.getByText('SwiftMatch v1.0.0')).toBeInTheDocument();
  });
});
