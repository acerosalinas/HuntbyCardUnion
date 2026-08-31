// heic2any ships no types of its own and has no @types package - minimal
// ambient declaration covering the one call shape lib/imageNormalize.ts uses.
declare module "heic2any" {
  interface Heic2AnyOptions {
    blob: Blob;
    toType?: string;
    quality?: number;
    multiple?: boolean;
  }

  export default function heic2any(options: Heic2AnyOptions): Promise<Blob | Blob[]>;
}
