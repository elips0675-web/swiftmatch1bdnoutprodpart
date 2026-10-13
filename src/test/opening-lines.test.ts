import { describe, it, expect } from 'vitest'
import {
  OPENING_LINE_CATEGORIES,
  openingLineKeys,
  missingPlaceholders,
  renderOpeningLine,
  firstNameOf,
} from '@/lib/opening-lines'

describe('opening-lines: библиотека шаблонов', () => {
  it('перечисляет пять категорий и по четыре ключа в каждой', () => {
    expect(OPENING_LINE_CATEGORIES).toEqual(['friendly', 'interests', 'humor', 'flirty', 'activity'])
    for (const category of OPENING_LINE_CATEGORIES) {
      expect(openingLineKeys(category)).toEqual([
        `chats.opening.${category}.1`,
        `chats.opening.${category}.2`,
        `chats.opening.${category}.3`,
        `chats.opening.${category}.4`,
      ])
    }
  })

  it('подставляет имя и общий интерес', () => {
    expect(renderOpeningLine('Привет, {{firstName}}!', { firstName: 'Аня' })).toBe('Привет, Аня!')
    expect(renderOpeningLine('{{firstName}} — {{commonInterest}}', { firstName: 'Аня', commonInterest: 'кино' }))
      .toBe('Аня — кино')
  })

  it('незаполненный плейсхолдер становится пустой строкой, а не остаётся литералом', () => {
    expect(renderOpeningLine('Привет, {{firstName}}!', {})).toBe('Привет, !')
    expect(renderOpeningLine('Тема: {{commonInterest}}', { commonInterest: null })).toBe('Тема: ')
  })

  it('недостающие плейсхолдеры перечисляются (по ним прячется фраза)', () => {
    expect(missingPlaceholders('Привет, {{firstName}}!', { firstName: 'Аня' })).toEqual([])
    expect(missingPlaceholders('Привет, {{firstName}}!', {})).toEqual(['firstName'])
    expect(missingPlaceholders('{{commonInterest}}', {})).toEqual(['commonInterest'])
    expect(missingPlaceholders('Без плейсхолдеров', {})).toEqual([])
  })

  it('firstNameOf берёт первое слово и терпит пустое значение', () => {
    expect(firstNameOf('Аня Иванова')).toBe('Аня')
    expect(firstNameOf('  Аня  ')).toBe('Аня')
    expect(firstNameOf('')).toBe('')
    expect(firstNameOf(null)).toBe('')
    expect(firstNameOf(undefined)).toBe('')
  })
})
