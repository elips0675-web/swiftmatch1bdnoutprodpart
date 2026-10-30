import React, { lazy, Suspense, ComponentType } from "react";

interface DynamicOptions {
  ssr?: boolean;
  loading?: () => React.ReactNode;
  suspense?: boolean;
}

export default function dynamic<P extends object = Record<string, never>>(
  importFn: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>,
  options: DynamicOptions = {},
) {
  const Lazy: React.LazyExoticComponent<ComponentType<P>> = lazy(async () => {
    const mod = await importFn();
    if (mod && typeof mod === "object" && "default" in mod) return mod as { default: ComponentType<P> };
    return { default: mod as ComponentType<P> };
  });
  const Loading = options.loading ?? (() => null);
  const Content = Lazy as unknown as ComponentType<P>;
  const Wrapped: React.FC<P> = (props: P) => (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
  Wrapped.displayName = "DynamicComponent";
  return Wrapped as unknown as ComponentType<P>;
}
