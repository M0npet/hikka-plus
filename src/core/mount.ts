import { createShadowRootUi, type ContentScriptContext } from '#imports';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

export interface InlineFeature {
  /** Ім'я тегу хоста Shadow DOM — завжди з префіксом hikka-plus-, щоб не зіткнутися з іншими розширеннями. */
  name: `hikka-plus-${string}`;
  shouldMount: () => boolean;
  /** Кандидати якорів по черзі: перший знайдений — використовується. */
  anchors: { selector: string; append: 'first' | 'last' | 'before' | 'after' }[];
  render: () => ReactNode;
}

interface Mounted {
  host: HTMLElement;
  remove: () => void;
}

/**
 * Монтує вбудовані блоки й стежить, щоб вони жили на сторінці:
 * Hikka — це SPA на Next.js, React сайту може перемалювати DOM і прибрати наш блок.
 */
export class Mounter {
  private mounted = new Map<string, Mounted>();
  private pending = new Set<string>();
  private scheduled = false;

  constructor(
    private ctx: ContentScriptContext,
    private features: InlineFeature[],
  ) {}

  start() {
    this.reconcile();
    const obs = new MutationObserver(() => this.schedule());
    obs.observe(document.body, { childList: true, subtree: true });
    this.ctx.onInvalidated(() => {
      obs.disconnect();
      for (const m of this.mounted.values()) m.remove();
      this.mounted.clear();
    });
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.reconcile();
    });
  }

  private reconcile() {
    for (const f of this.features) {
      const m = this.mounted.get(f.name);
      const want = f.shouldMount();
      if (m && (!want || !m.host.isConnected)) {
        m.remove();
        this.mounted.delete(f.name);
      }
      if (want && !this.mounted.has(f.name) && !this.pending.has(f.name)) void this.mount(f);
    }
  }

  private async mount(f: InlineFeature) {
    const anchor = f.anchors.find((a) => document.querySelector(a.selector));
    if (!anchor) return;
    this.pending.add(f.name);
    try {
      const ui = await createShadowRootUi<Root>(this.ctx, {
        name: f.name,
        position: 'inline',
        anchor: anchor.selector,
        append: anchor.append,
        onMount: (container) => {
          const root = createRoot(container);
          root.render(f.render());
          return root;
        },
        onRemove: (root) => root?.unmount(),
      });
      ui.mount();
      this.mounted.set(f.name, { host: ui.shadowHost, remove: () => ui.remove() });
    } finally {
      this.pending.delete(f.name);
    }
  }
}

/** Оверлей поверх сторінки (читалка). */
export async function mountOverlay(ctx: ContentScriptContext, node: ReactNode) {
  const ui = await createShadowRootUi<Root>(ctx, {
    name: 'hikka-plus-reader',
    position: 'modal',
    zIndex: 2147483000,
    anchor: 'body',
    append: 'last',
    onMount: (container) => {
      const root = createRoot(container);
      root.render(node);
      return root;
    },
    onRemove: (root) => root?.unmount(),
  });
  ui.mount();
  return () => ui.remove();
}
