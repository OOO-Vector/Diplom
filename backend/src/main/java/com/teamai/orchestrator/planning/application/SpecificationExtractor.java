package com.teamai.orchestrator.planning.application;

import com.teamai.orchestrator.core.application.CoreException;
import org.apache.pdfbox.io.*;
import org.apache.pdfbox.pdfparser.PDFParser;
import org.apache.pdfbox.text.*;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.Locale;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

@Component
public class SpecificationExtractor {
    public static final int MAX_BYTES = 10 * 1024 * 1024, MAX_CHARACTERS = 200_000;
    private final Semaphore slots = new Semaphore(2);

    public String extract(InputStream input, long length, String mediaType, String filename) {
        if (length > MAX_BYTES) throw tooLarge();
        MediaType type;
        try { type = MediaType.parseMediaType(mediaType); }
        catch (IllegalArgumentException exception) {
            throw new CoreException(415, "UNSUPPORTED_MEDIA_TYPE", "Use UTF-8 TXT or PDF");
        }
        boolean pdf = type.getType().equals("application") && type.getSubtype().equals("pdf");
        boolean txt = type.getType().equals("text") && type.getSubtype().equals("plain");
        if ((!pdf && !txt) || (txt && type.getCharset() != null && !type.getCharset().equals(StandardCharsets.UTF_8))
                || !filename.toLowerCase(Locale.ROOT).endsWith(pdf ? ".pdf" : ".txt"))
            throw new CoreException(415, "UNSUPPORTED_MEDIA_TYPE", "Use UTF-8 TXT or PDF with a matching filename");
        if (!slots.tryAcquire()) throw new CoreException(429, "IMPORT_BUSY", "Document import capacity is busy");
        try {
            byte[] bytes = input.readNBytes(MAX_BYTES + 1);
            if (bytes.length > MAX_BYTES) throw tooLarge();
            String text;
            if (pdf) text = pdf(bytes);
            else {
                text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
                if (text.startsWith("\uFEFF")) text = text.substring(1);
                if (text.startsWith("%PDF-")) throw invalid();
            }
            if (text.codePointCount(0, text.length()) > MAX_CHARACTERS) throw textTooLarge();
            boolean visible = false;
            for (int i = 0; i < text.length();) {
                int cp = text.codePointAt(i); i += Character.charCount(cp);
                if ((cp >= 0xD800 && cp <= 0xDFFF) || (Character.isISOControl(cp) && cp != '\n' && cp != '\r' && cp != '\t' && cp != '\f')) throw invalid();
                if (!Character.isWhitespace(cp) && !Character.isSpaceChar(cp) && Character.getType(cp) != Character.FORMAT) visible = true;
            }
            if (!visible) throw invalid();
            return text;
        } catch (IOException exception) {
            throw invalid(); // Parser/decoder messages may include attacker-controlled document text.
        } finally { slots.release(); }
    }

    private String pdf(byte[] bytes) throws IOException {
        if (bytes.length < 5 || !new String(bytes, 0, 5, StandardCharsets.US_ASCII).equals("%PDF-")) throw invalid();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        try (var source = new RandomAccessReadBuffer(bytes)) {
            var parser = new PDFParser(source, "", null, null,
                    () -> new ScratchFile(MemoryUsageSetting.setupMixed(1024 * 1024, 64L * 1024 * 1024)));
            try (var document = parser.parse(false)) {
                if (document.isEncrypted() || !document.getCurrentAccessPermission().canExtractContent()) throw invalid();
                if (document.getNumberOfPages() > 1000) throw processingLimit();
                var writer = new BoundedText();
                var stripper = new PDFTextStripper() {
                    private int glyphs;
                    private int operators;
                    @Override protected void processOperator(org.apache.pdfbox.contentstream.operator.Operator operator,
                            java.util.List<org.apache.pdfbox.cos.COSBase> operands) throws IOException {
                        if (++operators > 1_000_000 || System.nanoTime() > deadline) throw processingLimit();
                        super.processOperator(operator, operands);
                    }
                    @Override protected void processTextPosition(TextPosition position) {
                        if (++glyphs > 400_000 || System.nanoTime() > deadline) throw processingLimit();
                        super.processTextPosition(position);
                    }
                    @Override public void processPage(org.apache.pdfbox.pdmodel.PDPage page) throws IOException {
                        if (System.nanoTime() > deadline) throw processingLimit();
                        super.processPage(page);
                    }
                };
                // The persisted text and character budget must not depend on the server OS.
                stripper.setLineSeparator("\n");
                stripper.setPageEnd("\n");
                stripper.writeText(document, writer);
                return writer.text.toString();
            }
        } catch (CoreException exception) { throw exception; }
        catch (RuntimeException exception) { throw invalid(); }
    }

    private static final class BoundedText extends Writer {
        final StringBuilder text = new StringBuilder();
        int count;
        char previous;
        public void write(char[] chars, int offset, int length) {
            for (int i = offset; i < offset + length; i++) {
                char current = chars[i];
                if (!(Character.isHighSurrogate(previous) && Character.isLowSurrogate(current)) && ++count > MAX_CHARACTERS) throw textTooLarge();
                text.append(current); previous = current;
            }
        }
        public void flush() {}
        public void close() {}
    }
    public static CoreException invalid() { return new CoreException(400, "INVALID_SPECIFICATION", "Document is empty, invalid, encrypted or has no extractable text"); }
    private static CoreException tooLarge() { return new CoreException(413, "PAYLOAD_TOO_LARGE", "File exceeds 10 MiB"); }
    private static CoreException textTooLarge() { return new CoreException(413, "SPECIFICATION_TEXT_TOO_LARGE", "Extracted text exceeds 200000 Unicode characters"); }
    private static CoreException processingLimit() { return new CoreException(422, "SPECIFICATION_PROCESSING_LIMIT", "Document exceeds processing limits"); }
}
