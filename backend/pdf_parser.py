# backend/pdf_parser.py
from typing import Any, Dict, List

import fitz  # PyMuPDF


def table_to_markdown(rows: list[list[Any]]) -> str:
    """
    Convert a table extracted by PyMuPDF into markdown.
    Markdown tables preserve structure better for RAG than plain whitespace.
    """
    cleaned_rows = []

    for row in rows:
        cleaned_row = [
            str(cell or "").strip().replace("\n", " ")
            for cell in row
        ]

        if any(cell for cell in cleaned_row):
            cleaned_rows.append(cleaned_row)

    if not cleaned_rows:
        return ""

    # If first row looks like a header, use it.
    # Otherwise create generic column names.
    first_row = cleaned_rows[0]
    column_count = max(len(row) for row in cleaned_rows)

    normalized_rows = [
        row + [""] * (column_count - len(row))
        for row in cleaned_rows
    ]

    header = normalized_rows[0]
    body = normalized_rows[1:]

    if not any(header):
        header = [f"Column {i + 1}" for i in range(column_count)]
        body = normalized_rows

    markdown = "| " + " | ".join(header) + " |\n"
    markdown += "| " + " | ".join(["---"] * column_count) + " |\n"

    for row in body:
        markdown += "| " + " | ".join(row[:column_count]) + " |\n"

    return markdown.strip()


def extract_pdf_pages_with_tables(file_path: str) -> List[Dict[str, Any]]:
    """
    Extract page text and tables from a PDF.

    Returns:
    [
        {
            "page": 1,
            "text": "...",
            "tables": ["markdown table", ...]
        }
    ]
    """
    doc = fitz.open(file_path)
    pages = []

    try:
        for page_index, page in enumerate(doc):
            page_number = page_index + 1

            text = page.get_text("text") or ""
            tables_as_markdown = []

            try:
                table_finder = page.find_tables()

                for table in table_finder:
                    rows = table.extract()
                    markdown_table = table_to_markdown(rows)

                    if markdown_table:
                        tables_as_markdown.append(markdown_table)

            except Exception:
                # Some PDFs/pages will not support clean table extraction.
                # We still keep the normal text extraction.
                pass

            pages.append(
                {
                    "page": page_number,
                    "text": text.strip(),
                    "tables": tables_as_markdown,
                }
            )

    finally:
        doc.close()

    return pages