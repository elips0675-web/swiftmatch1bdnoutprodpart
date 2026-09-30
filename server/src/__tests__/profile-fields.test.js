import { describe, it, expect } from 'vitest'
import {
  FieldError,
  blankToUndef,
  dateField,
  enumField,
  intField,
  numField,
  textField,
} from '../profile-fields.js'

describe('profile-fields: пустые значения не должны ронять запись', () => {
  it("blankToUndef считает '' , null и undefined пустыми", () => {
    expect(blankToUndef('')).toBeUndefined()
    expect(blankToUndef(null)).toBeUndefined()
    expect(blankToUndef(undefined)).toBeUndefined()
    expect(blankToUndef(0)).toBe(0)
    expect(blankToUndef('x')).toBe('x')
  })

  it("текст: '' остаётся '' (пользователь очистил поле), undefined — не трогаем", () => {
    expect(textField('', 100)).toBe('')
    expect(textField(undefined, 100)).toBeUndefined()
    expect(textField(null, 100)).toBeUndefined()
    expect(textField('Москва', 100)).toBe('Москва')
  })

  it('текст: обрезает под размер колонки вместо 500 на ER_DATA_TOO_LONG', () => {
    expect(textField('x'.repeat(101), 100)).toHaveLength(100)
  })

  it('число: пустая строка из инпута не валидируется, а пропускается', () => {
    expect(intField('', 'height', { min: 0, max: 250 })).toBeUndefined()
    expect(intField(null, 'height')).toBeUndefined()
    expect(intField(undefined, 'height')).toBeUndefined()
    expect(intField('172', 'height')).toBe(172)
    expect(intField(172.9, 'height')).toBe(172)
  })

  it('число: непригодное значение — 400 с именем поля, а не 500', () => {
    expect(() => intField('abc', 'height')).toThrow(FieldError)
    expect(() => intField(-5, 'height', { min: 0, max: 250 })).toThrow(/height must be between/)
    expect(() => intField(9999999, 'height', { min: 0, max: 250 })).toThrow(/height must be between/)
    expect(() => intField(15, 'age', { min: 16, max: 120 })).toThrow(/age must be between/)
  })

  it('age: нулевое значение считается «не задан» (поле производное от birth_date)', () => {
    expect(intField(0, 'age', { min: 16, max: 120, zeroBlank: true })).toBeUndefined()
    expect(intField('0', 'age', { min: 16, max: 120, zeroBlank: true })).toBeUndefined()
    expect(intField(30, 'age', { min: 16, max: 120, zeroBlank: true })).toBe(30)
  })

  it('координаты: дробные, пустое пропускается, вне диапазона — FieldError', () => {
    expect(numField('', 'passport_lat')).toBeUndefined()
    expect(numField('55.7558', 'passport_lat')).toBe(55.7558)
    expect(() => numField(999, 'passport_lat', { min: -90, max: 90 })).toThrow(/passport_lat/)
    expect(() => numField(-999, 'passport_lng', { min: -180, max: 180 })).toThrow(/passport_lng/)
  })

  it('ENUM: пустое пропускается, неизвестное значение — FieldError', () => {
    expect(enumField('', 'gender', ['male', 'female'])).toBeUndefined()
    expect(enumField('female', 'gender', ['male', 'female'])).toBe('female')
    expect(() => enumField('bogus', 'gender', ['male', 'female'])).toThrow(/gender must be one of/)
  })

  it('дата: принимает YYYY-MM-DD, отсекает мусор и несуществующие дни', () => {
    expect(dateField('1990-07-04', 'birth_date')).toBe('1990-07-04')
    expect(dateField('', 'birth_date')).toBeUndefined()
    expect(() => dateField('мусор', 'birth_date')).toThrow(/must be YYYY-MM-DD/)
    expect(() => dateField('1990-02-31', 'birth_date')).toThrow(/not a real date/)
  })

  it('FieldError несёт статус 400 и имя поля', () => {
    const err = new FieldError('height', 'height must be a number')
    expect(err.status).toBe(400)
    expect(err.field).toBe('height')
  })
})
