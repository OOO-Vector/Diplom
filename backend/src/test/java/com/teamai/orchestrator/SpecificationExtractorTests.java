package com.teamai.orchestrator;

import com.teamai.orchestrator.core.application.CoreException;
import com.teamai.orchestrator.planning.application.SpecificationExtractor;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.font.*;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class SpecificationExtractorTests {
    byte[] document(int pages, int charactersPerPage) throws Exception {
        try(var document=new PDDocument();var output=new ByteArrayOutputStream()) {
            var font=new PDType1Font(Standard14Fonts.FontName.HELVETICA);
            for(int i=0;i<pages;i++) {
                var page=new PDPage();document.addPage(page);
                if(charactersPerPage>0)try(var content=new PDPageContentStream(document,page)) {
                    content.beginText();content.setFont(font,1);content.newLineAtOffset(1,1);
                    content.showText("x".repeat(charactersPerPage));content.endText();
                }
            }
            document.save(output);return output.toByteArray();
        }
    }
    @Test void pdfOutputAndPageCountAreBoundedDuringExtraction() throws Exception {
        var extractor=new SpecificationExtractor();
        var longText=document(21,10000);
        var textError=assertThrows(CoreException.class,()->extractor.extract(new ByteArrayInputStream(longText),longText.length,"application/pdf","x.pdf"));
        assertEquals(413,textError.status());assertEquals("SPECIFICATION_TEXT_TOO_LARGE",textError.code());
        var pages=document(1001,0);
        var pageError=assertThrows(CoreException.class,()->extractor.extract(new ByteArrayInputStream(pages),pages.length,"application/pdf","x.pdf"));
        assertEquals(422,pageError.status());assertEquals("SPECIFICATION_PROCESSING_LIMIT",pageError.code());
    }
    @Test void strictPdfParserRejectsTruncatedDocumentRatherThanRepairingIt() throws Exception {
        byte[] valid=document(1,10), truncated=java.util.Arrays.copyOf(valid,valid.length/2);
        var error=assertThrows(CoreException.class,()->new SpecificationExtractor().extract(new ByteArrayInputStream(truncated),truncated.length,"application/pdf","x.pdf"));
        assertEquals(400,error.status());assertEquals("INVALID_SPECIFICATION",error.code());
    }
    @Test void extractionCapacityIsBoundedAndReleasedAfterCompletionOrFailure() throws Exception {
        var extractor=new SpecificationExtractor();var entered=new CountDownLatch(2);var release=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(2)) {
            Callable<String> work=()->extractor.extract(new InputStream() {
                public int read(){return -1;}
                public byte[] readNBytes(int count) throws IOException {
                    entered.countDown();
                    try {if(!release.await(10,TimeUnit.SECONDS))throw new IOException("Test latch timed out");}
                    catch(InterruptedException ex){Thread.currentThread().interrupt();throw new IOException("Interrupted");}
                    return new byte[]{'x'};
                }
            },-1,"text/plain","x.txt");
            var a=pool.submit(work);var b=pool.submit(work);
            try {
                assertTrue(entered.await(5,TimeUnit.SECONDS));
                var busy=assertThrows(CoreException.class,()->extractor.extract(new ByteArrayInputStream(new byte[]{'x'}),1,"text/plain","x.txt"));
                assertEquals(429,busy.status());assertEquals("IMPORT_BUSY",busy.code());
            } finally {release.countDown();}
            assertEquals("x",a.get(5,TimeUnit.SECONDS));assertEquals("x",b.get(5,TimeUnit.SECONDS));
        }
        for(int i=0;i<3;i++)assertEquals(400,assertThrows(CoreException.class,()->extractor.extract(new ByteArrayInputStream(new byte[0]),0,"text/plain","x.txt")).status());
        assertEquals("x",extractor.extract(new ByteArrayInputStream(new byte[]{'x'}),1,"text/plain","x.txt"));
    }
}
