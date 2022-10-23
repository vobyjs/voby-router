export {};

declare global {
  namespace JSX {
    interface AnchorHTMLAttributes<T extends EventTarget>
      extends HTMLAttributes<T> {
      state?: string;
      noScroll?: boolean;
      replace?: boolean;
      link?: boolean;
    }
  }
}
