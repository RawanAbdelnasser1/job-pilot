import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

function markdownParagraphs(markdown: string): Paragraph[] {
  return markdown.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      return new Paragraph({
        text: trimmed.slice(2),
        heading: HeadingLevel.TITLE,
      });
    }
    if (trimmed.startsWith("## ")) {
      return new Paragraph({
        text: trimmed.slice(3),
        heading: HeadingLevel.HEADING_1,
      });
    }
    if (trimmed.startsWith("### ")) {
      return new Paragraph({
        text: trimmed.slice(4),
        heading: HeadingLevel.HEADING_2,
      });
    }
    if (trimmed.startsWith("- ")) {
      return new Paragraph({
        text: trimmed.slice(2),
        bullet: { level: 0 },
      });
    }
    return new Paragraph({ children: [new TextRun(trimmed)] });
  });
}

/** Produce a deliberately simple, one-column document for ATS parsers. */
export async function markdownToDocx(markdown: string): Promise<Buffer> {
  const document = new Document({
    sections: [
      {
        properties: {},
        children: markdownParagraphs(markdown),
      },
    ],
  });
  return Packer.toBuffer(document);
}