import { normalizeText } from "./lesson";
import type { PDFDocumentProxy } from "pdfjs-dist";

export async function openPdf(file: File) {
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose a PDF smaller than 20 MB.");
  const reader = await import("pdfjs-dist");
  reader.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs";
  const data = await file.arrayBuffer();
  const signature = new TextDecoder().decode(data.slice(0, 1024));
  if (!signature.includes("%PDF-")) throw new Error("Choose a valid .pdf file.");
  const task = reader.getDocument({ data });
  try {
    return await task.promise;
  } catch (error) {
    await task.destroy().catch(() => undefined);
    if (error instanceof Error && error.name === "PasswordException") {
      throw new Error("Use an unlocked copy of this PDF.");
    }
    throw new Error("This PDF could not be opened. Try saving a fresh copy.");
  }
}

export async function readPage(document: PDFDocumentProxy, pageNumber: number) {
  const page = await document.getPage(pageNumber);
  const content = await page.getTextContent();
  return normalizeText(content.items.map((item) => "str" in item ? item.str : "").join(" "));
}
