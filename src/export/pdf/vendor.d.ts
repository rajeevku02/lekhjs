// Ambient declarations for the two untyped modules `pdf/index.ts` imports. Their shapes are the
// structural ports in `ports.ts`; `index.ts` casts once and nothing else sees these modules.
declare module 'pdfkit' {
  const PDFDocument: unknown;
  export default PDFDocument;
}

declare module 'fontkit' {
  export function create(buffer: Uint8Array, postscriptName?: string): unknown;
}
