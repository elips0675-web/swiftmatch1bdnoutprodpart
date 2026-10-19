import { describe, it, expect, vi, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { reducer, useToast, toast } from "@/hooks/use-toast"

type ToastState = { toasts: Array<{ id: string; title?: React.ReactNode; open?: boolean }> }

const baseToast = (id: string) => ({ id, title: `T${id}`, open: true })

afterEach(() => {
  vi.useRealTimers()
})

describe("reducer (чистые переходы)", () => {
  it("ADD_TOAST ограничивает ленту одним тостом, новый вытесняет старый", () => {
    const once = reducer({ toasts: [] }, { type: "ADD_TOAST", toast: { ...baseToast("1"), title: "A" } })
    expect(once.toasts).toHaveLength(1)
    expect(once.toasts[0].title).toBe("A")
    const twice = reducer(once, { type: "ADD_TOAST", toast: { ...baseToast("2"), title: "B" } })
    expect(twice.toasts).toHaveLength(1)
    expect(twice.toasts[0].id).toBe("2")
    expect(twice.toasts[0].title).toBe("B")
  })

  it("UPDATE_TOAST мержит только совпавший id", () => {
    const state = { toasts: [{ ...baseToast("1") }, { ...baseToast("2") }] }
    const next = reducer(state, { type: "UPDATE_TOAST", toast: { id: "2", description: "D" } })
    expect(next.toasts[0].title).toBe("T1")
    expect("description" in next.toasts[0]).toBe(false)
    expect(next.toasts[1].title).toBe("T2")
    expect(next.toasts[1]).toMatchObject({ description: "D" })
  })

  it("DISMISS_TOAST с id закрывает один тост, без id — все", () => {
    const state = { toasts: [{ ...baseToast("1") }, { ...baseToast("2") }] }
    const one = reducer(state, { type: "DISMISS_TOAST", toastId: "1" })
    expect(one.toasts[0].open).toBe(false)
    expect(one.toasts[1].open).toBe(true)
    const all = reducer(state, { type: "DISMISS_TOAST" })
    expect(all.toasts.every((t) => t.open === false)).toBe(true)
  })

  it("REMOVE_TOAST с id фильтрует, без id очищает ленту", () => {
    const state = { toasts: [{ ...baseToast("1") }, { ...baseToast("2") }] }
    const one = reducer(state, { type: "REMOVE_TOAST", toastId: "1" })
    expect(one.toasts.map((t) => t.id)).toEqual(["2"])
    const none = reducer(state, { type: "REMOVE_TOAST" })
    expect(none.toasts).toEqual([])
  })

  it("повторный DISMISS_TOAST того же id не плодит таймеры удаления", () => {
    const state = { toasts: [baseToast("dup")] }
    const first = reducer(state, { type: "DISMISS_TOAST", toastId: "dup" })
    expect(first.toasts[0].open).toBe(false)
    const second = reducer(first, { type: "DISMISS_TOAST", toastId: "dup" })
    expect(second.toasts[0].open).toBe(false)
  })
})

describe("toast() и useToast", () => {
  it("toast() возвращает id/dismiss/update и добавляет открытый тост", () => {
    const { result } = renderHook(() => useToast())
    let handle: ReturnType<typeof toast> | undefined
    act(() => { handle = result.current.toast({ title: "A" }) })
    expect(handle?.id).toBeTypeOf("string")
    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].title).toBe("A")
    expect(result.current.toasts[0].open).toBe(true)
    act(() => { if (handle) handle.update({ ...handle, description: "B" }) })
    expect(result.current.toasts[0].title).toBe("A")
    expect(result.current.toasts[0].description).toBe("B")
    act(() => { handle?.dismiss() })
    expect(result.current.toasts[0].open).toBe(false)
  })

  it("каждый toast() получает новый id, в ленте живёт только последний", () => {
    const { result } = renderHook(() => useToast())
    let id1 = ""
    let id2 = ""
    act(() => { id1 = result.current.toast({ title: "A" }).id })
    act(() => { id2 = result.current.toast({ title: "B" }).id })
    expect(id1).not.toBe(id2)
    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].title).toBe("B")
  })

  it("onOpenChange(false) закрывает тост, onOpenChange(true) не делает ничего", () => {
    const { result } = renderHook(() => useToast())
    act(() => { result.current.toast({ title: "X" }) })
    const handle = result.current.toasts[0].onOpenChange
    expect(handle).toBeTypeOf("function")
    act(() => { handle?.(true) })
    expect(result.current.toasts[0].open).toBe(true)
    act(() => { handle?.(false) })
    expect(result.current.toasts[0].open).toBe(false)
  })

  it("размонтированный хук отписан: его setState не вызывается дальше", () => {
    const first = renderHook(() => useToast())
    act(() => { first.result.current.toast({ title: "A" }) })
    expect(first.result.current.toasts).toHaveLength(1)
    first.unmount()
    act(() => { toast({ title: "B" }) })
    const second = renderHook(() => useToast())
    expect(second.result.current.toasts).toHaveLength(1)
    expect(second.result.current.toasts[0].title).toBe("B")
  })

  it("после TOAST_REMOVE_DELAY тост удаляется из состояния", () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useToast())
    act(() => { result.current.toast({ title: "T" }) })
    act(() => { result.current.dismiss() })
    expect(result.current.toasts[0].open).toBe(false)
    act(() => { vi.advanceTimersByTime(1000000) })
    expect(result.current.toasts).toHaveLength(0)
    unmount()
  })

  it("dismiss без id закрывает текущий тост (сквозной путь хука)", () => {
    const { result } = renderHook(() => useToast())
    act(() => { result.current.toast({ title: "T" }) })
    act(() => { result.current.dismiss() })
    expect(result.current.toasts[0].open).toBe(false)
  })
})
