declare module 'markmap-lib' {
  export class Transformer {
    transform(markdown: string): { root: any };
  }
}

declare module 'markmap-view' {
  export class Markmap {
    static create(el: string | SVGElement, options?: any, data?: any): Markmap;
    setData(data: any): void;
    fit(): void;
    rescale(scale: number): void;
    destroy(): void;
  }
}
