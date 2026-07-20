import {
  parsePdf,
  parseWord,
  parseExcel,
  parseFile,
  FileParseError,
} from "../file-parser";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import zlib from "zlib";

// ---------------------------------------------------------------------------
// Minimal .docx builder (a .docx is a ZIP of XML parts — we build one from
// scratch using Node's built-in zlib, avoiding any extra deps). The resulting
// file is a valid Word document with one paragraph containing KNOWN_TEXT.
// ---------------------------------------------------------------------------

const KNOWN_TEXT = "HelloFromMammoth";

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function buildZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const compressed = zlib.deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const sizeUncompressed = entry.data.length;
    const sizeCompressed = compressed.length;

    // Local file header
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(8, 8); // method = deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(sizeCompressed, 18);
    localHeader.writeUInt32LE(sizeUncompressed, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    localParts.push(localHeader, nameBuf, compressed);

    // Central directory header
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(8, 10); // method
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0, 14); // mod date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(sizeCompressed, 20);
    centralHeader.writeUInt32LE(sizeUncompressed, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDirStart = offset;
  for (const part of centralParts) {
    localParts.push(part);
    offset += part.length;
  }
  const centralDirSize = offset - centralDirStart;

  // End of central directory record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, eocd]);
}

function buildMinimalDocx(text: string): Buffer {
  // Minimal docx OOXML parts
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>${escaped}</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

  return buildZip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
  ]);
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function testAll(): Promise<void> {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  function assert(condition: boolean, name: string): void {
    if (condition) {
      console.log(`  \u2713 ${name}`);
      passed++;
    } else {
      console.error(`  \u2717 ${name}`);
      failed++;
      failures.push(name);
    }
  }

  console.log("file-parser self-test\n");

  // -------------------------------------------------------------------------
  // Test 1: parseExcel extracts cell values and sheet headers
  // -------------------------------------------------------------------------
  {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Name", "Age"],
        ["Alice", "30"],
        ["Bob", "25"],
      ]),
      "Sheet1",
    );
    const buf = Buffer.from(
      XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
    );
    const text = await parseExcel(buf, "people.xlsx");
    assert(
      text.includes("Alice") && text.includes("[Sheet: Sheet1]"),
      "parseExcel extracts cell values and sheet headers",
    );
  }

  // -------------------------------------------------------------------------
  // Test 2: parseExcel throws FileParseError on corrupted input
  // (XLSX.read is lenient with random bytes, so we corrupt a real xlsx
  //  zip header to guarantee an error path.)
  // -------------------------------------------------------------------------
  {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["A", "B"]]),
      "S",
    );
    const realBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const corrupted = Buffer.concat([
      realBuf.slice(0, realBuf.length - 200),
      Buffer.alloc(200, 0x00),
    ]);
    let threwFileParseError = false;
    let messageIncludesFileName = false;
    try {
      await parseExcel(corrupted, "bad.xlsx");
    } catch (err) {
      threwFileParseError = err instanceof FileParseError;
      if (err instanceof FileParseError) {
        messageIncludesFileName = err.message.includes("bad.xlsx");
      }
    }
    assert(threwFileParseError, "parseExcel throws FileParseError on corrupted input");
    assert(
      messageIncludesFileName,
      "FileParseError message includes file name",
    );
  }

  // -------------------------------------------------------------------------
  // Test 3: parsePdf extracts text from a real PDF (built with jspdf)
  // -------------------------------------------------------------------------
  {
    const doc = new jsPDF();
    doc.text("HelloFromPdfParse", 10, 10);
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    const text = await parsePdf(pdfBuffer, "doc.pdf");
    assert(
      text.includes("HelloFromPdfParse"),
      "parsePdf extracts text from a real PDF",
    );
  }

  // -------------------------------------------------------------------------
  // Test 4: parsePdf throws FileParseError on garbage input
  // -------------------------------------------------------------------------
  {
    let threwFileParseError = false;
    try {
      await parsePdf(Buffer.from("not a pdf"), "bad.pdf");
    } catch (err) {
      threwFileParseError = err instanceof FileParseError;
    }
    assert(threwFileParseError, "parsePdf throws FileParseError on garbage input");
  }

  // -------------------------------------------------------------------------
  // Test 5: parseWord extracts text from a real .docx built in-memory
  // -------------------------------------------------------------------------
  {
    const docxBuffer = buildMinimalDocx(KNOWN_TEXT);
    const text = await parseWord(docxBuffer, "doc.docx");
    assert(
      text.includes(KNOWN_TEXT),
      "parseWord extracts text from a real .docx",
    );
  }

  // -------------------------------------------------------------------------
  // Test 6: parseWord throws FileParseError on garbage input
  // -------------------------------------------------------------------------
  {
    let threwFileParseError = false;
    try {
      await parseWord(Buffer.from("not a docx"), "bad.docx");
    } catch (err) {
      threwFileParseError = err instanceof FileParseError;
    }
    assert(threwFileParseError, "parseWord throws FileParseError on garbage input");
  }

  // -------------------------------------------------------------------------
  // Test 7: parseFile dispatches correctly to parseExcel
  // -------------------------------------------------------------------------
  {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Hello", "World"]]),
      "S1",
    );
    const buf = Buffer.from(
      XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
    );
    const text = await parseFile(buf, "excel", "dispatch.xlsx");
    assert(
      text.includes("Hello") && text.includes("[Sheet: S1]"),
      "parseFile dispatches to parseExcel for excel type",
    );
  }

  // -------------------------------------------------------------------------
  // Test 8: parseFile dispatches correctly to parsePdf
  // -------------------------------------------------------------------------
  {
    const doc = new jsPDF();
    doc.text("DispatchPdf", 10, 10);
    const pdfBuf = Buffer.from(doc.output("arraybuffer"));
    const text = await parseFile(pdfBuf, "pdf", "dispatch.pdf");
    assert(
      text.includes("DispatchPdf"),
      "parseFile dispatches to parsePdf for pdf type",
    );
  }

  // -------------------------------------------------------------------------
  // Test 9: parseFile dispatches correctly to parseWord
  // -------------------------------------------------------------------------
  {
    const docxBuf = buildMinimalDocx("DispatchWord");
    const text = await parseFile(docxBuf, "word", "dispatch.docx");
    assert(
      text.includes("DispatchWord"),
      "parseFile dispatches to parseWord for word type",
    );
  }

  // -------------------------------------------------------------------------
  // Test 10: FileParseError carries fileType metadata
  // -------------------------------------------------------------------------
  {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["x"]]),
      "S",
    );
    const realBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const corrupted = Buffer.concat([
      realBuf.slice(0, realBuf.length - 200),
      Buffer.alloc(200, 0x00),
    ]);
    let caught: FileParseError | null = null;
    try {
      await parseExcel(corrupted, "meta.xlsx");
    } catch (err) {
      if (err instanceof FileParseError) {
        caught = err;
      }
    }
    assert(caught !== null, "FileParseError is catchable");
    if (caught) {
      assert(caught.fileType === "excel", "FileParseError.fileType === 'excel'");
      assert(caught.fileName === "meta.xlsx", "FileParseError.fileName === 'meta.xlsx'");
      assert(caught.name === "FileParseError", "FileParseError.name === 'FileParseError'");
    }
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("Failures:");
    for (const name of failures) {
      console.error(`  - ${name}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

testAll().catch((err) => {
  console.error("Unhandled error during test run:", err);
  process.exit(1);
});
