/// <reference types="vite/client" />

declare module '*.ico' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}

// Injected by vite.config.ts at build time (see the `define` block).
declare const __APP_VERSION__: string;
declare const __BUILD_HASH__: string;
declare const __BUILD_TIME__: string;
