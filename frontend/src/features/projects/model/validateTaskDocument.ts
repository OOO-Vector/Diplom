import { readBytes } from "./projectDocuments";
export const maxSpecificationBytes = 10 * 1024 * 1024;
export const maxSpecificationCharacters = 200_000;

export function checkTaskDocumentFile(
  file: File,
): { error: string; reason?: "format" | "size" } | undefined {
  if (!/\.(txt|pdf)$/i.test(file.name))
    return {
      reason: "format",
      error:
        "Unsupported file format. Please provide a UTF-8 .txt or a .pdf with a text layer.",
    };
  if (file.size > maxSpecificationBytes)
    return { reason: "size", error: "The file exceeds the 10 MiB limit." };
  if (!file.size) return { error: "The file is empty." };
}

export async function validateTaskDocument(
  file: File,
): Promise<{ text: string } | { error: string; reason?: "format" | "size" }> {
  const invalid = checkTaskDocumentFile(file);
  if (invalid) return invalid;
  const extension = file.name.split(".").pop()?.toLowerCase();

  try {
    const buffer = await readBytes(file);
    const bytes = new Uint8Array(buffer);
    let text: string;
    if (extension === "pdf") {
      const { extractPdfText } = await import("./hasPdfText");
      text = (await extractPdfText(bytes)).trim();
      if (!text)
        return {
          reason: "format",
          error:
            "The PDF has no extractable text layer. Scanned pages require a text-layer PDF.",
        };
    } else {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
      if (!text) return { error: "The file contains no text." };
      if (/\p{Cc}/u.test(text.replace(/[\t\n\r\f]/g, "")))
        return { error: "The TXT file contains invalid text characters." };
    }
    if (
      text.length > maxSpecificationCharacters &&
      [...text].length > maxSpecificationCharacters
    )
      return {
        error: "The extracted text exceeds the 200,000-character limit.",
      };
    return { text };
  } catch {
    return {
      error:
        extension === "pdf"
          ? "Could not read the PDF. Choose an unlocked PDF with extractable text."
          : "Could not read the TXT file. Save it as UTF-8 and try again.",
    };
  }
}
