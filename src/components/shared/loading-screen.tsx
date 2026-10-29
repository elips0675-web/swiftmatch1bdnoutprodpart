export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = { sm: 'h-5 w-5 border-2', md: 'h-8 w-8 border-3', lg: 'h-12 w-12 border-4' }
  return (
    <div
      className={`animate-spin rounded-full border-rose-200 border-t-rose-500 ${sizeClass[size]}`}
    />
  )
}

export function PageLoading() {
  return (
    <div className="flex h-64 items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  )
}
