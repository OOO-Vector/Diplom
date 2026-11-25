// @vitest-environment node
import { expect, it, vi } from "vitest";
import { hasPdfText } from "./hasPdfText";

vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", async () => {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const resolve = createRequire(import.meta.url).resolve;
  return {
    default: pathToFileURL(
      resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
    ).href,
  };
});

function makePdf(stream: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return String(offset).padStart(10, "0") + " 00000 n \n";
  });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

it("detects text in a PDF and rejects pages containing only graphics", async () => {
  await expect(
    hasPdfText(makePdf("BT /F1 12 Tf 10 50 Td (Specification) Tj ET")),
  ).resolves.toBe(true);
  await expect(hasPdfText(makePdf("10 10 40 40 re f"))).resolves.toBe(false);
});
