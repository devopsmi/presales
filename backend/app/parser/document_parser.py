"""
文档解析器

支持解析 PDF、Word（.docx）、纯文本（.txt）、Excel（.xlsx）四种格式，
统一返回纯文本字符串供下游 Agent 使用。
"""

from pathlib import Path


class DocumentParser:
    """文档解析器，根据文件扩展名选择对应的解析方式。"""

    @staticmethod
    async def parse(file_path: str | Path) -> str:
        """
        解析文档，返回纯文本内容。

        参数:
            file_path: 文件路径

        返回:
            解析后的纯文本字符串

        抛出:
            ValueError: 不支持的文档格式
            FileNotFoundError: 文件不存在
        """
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"文件不存在: {file_path}")

        suffix = path.suffix.lower()
        if suffix == ".pdf":
            return await DocumentParser._parse_pdf(path)
        elif suffix == ".docx":
            return DocumentParser._parse_docx(path)
        elif suffix == ".xlsx":
            return DocumentParser._parse_xlsx(path)
        elif suffix == ".txt":
            return DocumentParser._parse_txt(path)
        else:
            raise ValueError(f"不支持的文档格式: {suffix}，仅支持 .pdf / .docx / .xlsx / .txt")

    @staticmethod
    async def _parse_pdf(path: Path) -> str:
        """使用 pymupdf 解析 PDF 文档。"""
        import fitz  # pymupdf

        text_parts: list[str] = []
        async with await fitz.open_async(str(path)) as doc:
            for page in doc:
                text_parts.append(page.get_text())
        return "\n".join(text_parts).strip()

    @staticmethod
    def _parse_docx(path: Path) -> str:
        """使用 python-docx 解析 Word 文档。"""
        from docx import Document

        doc = Document(str(path))
        text_parts: list[str] = []
        for para in doc.paragraphs:
            text_parts.append(para.text)
        return "\n".join(text_parts).strip()

    @staticmethod
    def _parse_xlsx(path: Path) -> str:
        """
        解析 Excel（.xlsx）文件，将每个工作表转为 Markdown 表格文本。

        合并单元格的值仅取左上角单元格。
        """
        from openpyxl import load_workbook

        wb = load_workbook(path, data_only=True)
        parts: list[str] = []

        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            parts.append(f"## 工作表：{sheet_name}")

            rows_data: list[list[str]] = []
            for row in ws.iter_rows(min_row=1, max_row=ws.max_row, values_only=True):
                row_vals = [str(v) if v is not None else "" for v in row]
                # 跳过全空行
                if any(v.strip() for v in row_vals):
                    rows_data.append(row_vals)

            if not rows_data:
                continue

            # 计算最大列数
            max_cols = max(len(r) for r in rows_data)

            # 生成 Markdown 表格
            header = rows_data[0]
            parts.append("| " + " | ".join(header) + " |")
            parts.append("| " + " | ".join(["---"] * len(header)) + " |")
            for data_row in rows_data[1:]:
                padded = data_row + [""] * (max_cols - len(data_row))
                parts.append("| " + " | ".join(padded[:len(header)]) + " |")

            parts.append("")

        wb.close()
        return "\n".join(parts).strip()

    @staticmethod
    def _parse_txt(path: Path) -> str:
        """直接读取纯文本文件，自动检测编码。"""
        encodings = ["utf-8", "gbk", "gb2312", "utf-16"]
        for enc in encodings:
            try:
                return path.read_text(encoding=enc).strip()
            except (UnicodeDecodeError, UnicodeError):
                continue
        # 兜底：使用 binary 读取并忽略错误
        return path.read_text(encoding="utf-8", errors="ignore").strip()
