import {
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdfText(
  bytes: Uint8Array,
  stopAfterFirst = false,
) {
  const task = getDocument({
    data: bytes,
    isEvalSupported: false,
    stopAtErrors: true,
  });

  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const { items } = await page.getTextContent();
      const text = items
        .map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
        )
        .join("")
        .trim();
      if (text) {
        if (stopAfterFirst) return text;
        pages.push(text);
      }
    }
    return pages.join("\n\n");
  } finally {
    await task.destroy();
  }
}

export async function hasPdfText(bytes: Uint8Array) {
  return Boolean(await extractPdfText(bytes, true));
}
