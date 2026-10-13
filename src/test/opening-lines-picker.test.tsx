import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

const mockFlags = vi.hoisted(() => ({ openingLinesEnabled: true }))

vi.mock('@/context/feature-flags-context', () => ({
  useFeatureFlags: () => mockFlags,
}))

const DICT: Record<string, string> = {
  'chats.opening.button': 'Открыть готовые фразы',
  'chats.opening.title': 'Готовые фразы',
  'chats.opening.empty': 'Нет доступных фраз',
  'chats.opening.category.friendly': 'Дружелюбно',
  'chats.opening.category.interests': 'Общие интересы',
  'chats.opening.category.humor': 'С юмором',
  'chats.opening.category.flirty': 'Флирт',
  'chats.opening.category.activity': 'Совместное',
  'chats.opening.friendly.1': 'Привет, {{firstName}}! Как дела?',
  'chats.opening.friendly.2': 'Привет! Рад знакомству',
  'chats.opening.friendly.3': 'Привет! Как настроение?',
  'chats.opening.friendly.4': 'Привет! Что нового?',
  'chats.opening.interests.1': '{{firstName}}, тема — {{commonInterest}}',
  'chats.opening.interests.2': '{{commonInterest}} — наша тема',
  'chats.opening.interests.3': 'Общий интерес: {{commonInterest}}',
  'chats.opening.interests.4': 'О, {{commonInterest}}!',
  'chats.opening.humor.1': 'Шутка один',
  'chats.opening.humor.2': 'Шутка два',
  'chats.opening.humor.3': 'Шутка три',
  'chats.opening.humor.4': 'Шутка четыре',
  'chats.opening.flirty.1': 'Флирт один',
  'chats.opening.flirty.2': 'Флирт два',
  'chats.opening.flirty.3': 'Флирт три',
  'chats.opening.flirty.4': 'Флирт четыре',
  'chats.opening.activity.1': 'Активность один',
  'chats.opening.activity.2': 'Активность два',
  'chats.opening.activity.3': 'Активность три',
  'chats.opening.activity.4': 'Активность четыре',
}

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => DICT[key] ?? key, language: 'ru' }),
}))

import { OpeningLinesPicker } from '@/components/opening-lines-picker'

describe('OpeningLinesPicker: библиотека готовых фраз', () => {
  beforeEach(() => {
    cleanup()
    mockFlags.openingLinesEnabled = true
  })

  afterEach(() => {
    cleanup()
  })

  function openPicker() {
    fireEvent.click(screen.getByTestId('opening-lines-button'))
  }

  it('скрыт, когда фича-флаг выключен', () => {
    mockFlags.openingLinesEnabled = false
    render(<OpeningLinesPicker firstName="Аня" onPick={vi.fn()} />)
    expect(screen.queryByTestId('opening-lines-button')).toBeNull()
  })

  it('подставляет имя и отдаёт готовый текст по клику', () => {
    const onPick = vi.fn()
    render(<OpeningLinesPicker firstName="Аня" onPick={onPick} />)
    openPicker()
    fireEvent.click(screen.getByText('Привет, Аня! Как дела?'))
    expect(onPick).toHaveBeenCalledWith('Привет, Аня! Как дела?')
  })

  it('фразы категории «общие интересы» без интереса не показываются', () => {
    render(<OpeningLinesPicker firstName="Аня" commonInterest={null} onPick={vi.fn()} />)
    openPicker()
    fireEvent.click(screen.getByTestId('opening-lines-category-interests'))
    expect(screen.queryAllByTestId('opening-line')).toHaveLength(0)
    expect(screen.getByText('Нет доступных фраз')).toBeTruthy()
  })

  it('с общим интересом фразы категории появляются и подставляются', () => {
    const onPick = vi.fn()
    render(<OpeningLinesPicker firstName="Аня" commonInterest="кино" onPick={onPick} />)
    openPicker()
    fireEvent.click(screen.getByTestId('opening-lines-category-interests'))
    fireEvent.click(screen.getByText('Аня, тема — кино'))
    expect(onPick).toHaveBeenCalledWith('Аня, тема — кино')
  })
})
