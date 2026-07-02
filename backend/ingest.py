# backend/ingest.py
import os
import tempfile
import uuid
from pathlib import Path
from typing import List
import re

import chromadb
from fastapi import APIRouter, File, HTTPException, UploadFile
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import TextLoader
from langchain_huggingface import HuggingFaceEmbeddings

from pdf_parser import extract_pdf_pages_with_tables


router = APIRouter()

# Local embeddings — free, runs locally
embeddings_model = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

# ChromaDB local client
chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection("documents")

# Larger chunks + more overlap for better RAG context
splitter = RecursiveCharacterTextSplitter(
    chunk_size=1200,
    chunk_overlap=250,
    separators=["\n\n", "\n", ". ", " ", ""],
)


def get_file_suffix(file: UploadFile) -> str:
    filename = file.filename or ""
    suffix = Path(filename).suffix.lower()

    if suffix in [".pdf", ".txt", ".md"]:
        return suffix

    if file.content_type == "application/pdf":
        return ".pdf"

    return ".txt"


def delete_existing_document(filename: str) -> int:
    """
    Remove existing chunks for this document before re-ingesting.
    This prevents duplicate chunks if the same file is uploaded again.
    """
    results = collection.get()

    if not results.get("ids") or not results.get("metadatas"):
        return 0

    ids_to_delete = [
        results["ids"][i]
        for i, metadata in enumerate(results["metadatas"])
        if metadata and metadata.get("source") == filename
    ]

    if ids_to_delete:
        collection.delete(ids=ids_to_delete)

    return len(ids_to_delete)


def build_text_chunks(text: str) -> List[str]:
    if not text or not text.strip():
        return []

    return [
        chunk.strip()
        for chunk in splitter.split_text(text)
        if chunk and chunk.strip()
    ]


def infer_section_title(chunk: str) -> str | None:
    lines = [line.strip() for line in chunk.splitlines() if line.strip()]
    if not lines:
        return None

    first_line = lines[0][:120]

    if len(first_line.split()) <= 12:
        if first_line.isupper():
            return first_line.title()

        if re.match(r"^(\d+(\.\d+)*)\s+.+", first_line):
            return first_line

        if len(first_line) <= 80 and first_line[-1:] not in ".!?":
            return first_line

    return None


def text_density(chunk: str) -> str:
    words = chunk.split()
    if not words:
        return "low"
    if len(words) >= 180:
        return "high"
    if len(words) >= 90:
        return "medium"
    return "low"


def ingest_pdf_file(tmp_path: str, filename: str):
    pages = extract_pdf_pages_with_tables(tmp_path)

    documents = []
    metadatas = []
    ids = []

    chunk_index = 0

    for page in pages:
        page_number = page["page"]

        # Normal page text chunks
        for chunk in build_text_chunks(page.get("text", "")):
            section_title = infer_section_title(chunk)
            documents.append(chunk)
            metadatas.append(
                {
                    "source": filename,
                    "document_name": filename,
                    "page": page_number,
                    "chunk_index": chunk_index,
                    "content_type": "text",
                    "source_label": f"{filename}, page {page_number}",
                    "section_title": section_title,
                    "structure_hint": "section" if section_title else "body",
                    "text_density": text_density(chunk),
                }
            )
            ids.append(f"{filename}_{uuid.uuid4()}")
            chunk_index += 1

        # Table chunks, stored separately as markdown
        for table_index, table_markdown in enumerate(page.get("tables", [])):
            for chunk in build_text_chunks(table_markdown):
                section_title = infer_section_title(chunk)
                documents.append(chunk)
                metadatas.append(
                    {
                        "source": filename,
                        "document_name": filename,
                        "page": page_number,
                        "chunk_index": chunk_index,
                        "content_type": "table",
                        "table_index": table_index,
                        "source_label": f"{filename}, page {page_number}, table {table_index + 1}",
                        "section_title": section_title,
                        "structure_hint": "table",
                        "text_density": text_density(chunk),
                    }
                )
                ids.append(f"{filename}_{uuid.uuid4()}")
                chunk_index += 1

    return documents, metadatas, ids


def ingest_text_file(tmp_path: str, filename: str):
    loader = TextLoader(tmp_path, encoding="utf-8")
    docs = loader.load()

    full_text = "\n\n".join(doc.page_content for doc in docs)

    documents = []
    metadatas = []
    ids = []

    for chunk_index, chunk in enumerate(build_text_chunks(full_text)):
        section_title = infer_section_title(chunk)
        documents.append(chunk)
        metadatas.append(
            {
                "source": filename,
                "document_name": filename,
                "page": 1,
                "chunk_index": chunk_index,
                "content_type": "text",
                "source_label": filename,
                "section_title": section_title,
                "structure_hint": "section" if section_title else "body",
                "text_density": text_density(chunk),
            }
        )
        ids.append(f"{filename}_{uuid.uuid4()}")

    return documents, metadatas, ids


@router.post("/ingest")
async def ingest_document(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Uploaded file must have a filename.")

    suffix = get_file_suffix(file)

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        deleted_count = delete_existing_document(file.filename)

        if suffix == ".pdf":
            texts, metadatas, ids = ingest_pdf_file(tmp_path, file.filename)
        elif suffix in [".txt", ".md"]:
            texts, metadatas, ids = ingest_text_file(tmp_path, file.filename)
        else:
            raise HTTPException(
                status_code=400,
                detail="Unsupported file type. Please upload PDF, TXT, or MD files.",
            )

        if not texts:
            raise HTTPException(
                status_code=400,
                detail="No extractable text or tables found in this document.",
            )

        embeds = embeddings_model.embed_documents(texts)

        collection.add(
            documents=texts,
            embeddings=embeds,
            metadatas=metadatas,
            ids=ids,
        )

        table_chunks = sum(1 for metadata in metadatas if metadata["content_type"] == "table")
        text_chunks = sum(1 for metadata in metadatas if metadata["content_type"] == "text")

        return {
            "message": f"Ingested {len(texts)} chunks from {file.filename}",
            "document": file.filename,
            "deleted_existing_chunks": deleted_count,
            "chunks_added": len(texts),
            "text_chunks": text_chunks,
            "table_chunks": table_chunks,
        }

    finally:
        os.unlink(tmp_path)


@router.get("/documents")
def list_documents():
    results = collection.get()

    metadatas = results.get("metadatas") or []
    ids = results.get("ids") or []

    documents = {}

    for metadata in metadatas:
        if not metadata:
            continue

        source = metadata.get("source")
        if not source:
            continue

        if source not in documents:
            documents[source] = {
                "name": source,
                "chunks": 0,
                "pages": set(),
                "text_chunks": 0,
                "table_chunks": 0,
            }

        documents[source]["chunks"] += 1

        page = metadata.get("page")
        if page:
            documents[source]["pages"].add(page)

        if metadata.get("content_type") == "table":
            documents[source]["table_chunks"] += 1
        else:
            documents[source]["text_chunks"] += 1

    document_list = []

    for document in documents.values():
        pages = sorted(document["pages"])
        document_list.append(
            {
                "name": document["name"],
                "chunks": document["chunks"],
                "pages": pages,
                "page_count": len(pages),
                "text_chunks": document["text_chunks"],
                "table_chunks": document["table_chunks"],
            }
        )

    return {
        "documents": document_list,
        "total_documents": len(document_list),
        "total_chunks": len(ids),
    }


@router.delete("/documents/{filename}")
def delete_document(filename: str):
    try:
        deleted_count = delete_existing_document(filename)

        if deleted_count == 0:
            raise HTTPException(status_code=404, detail="Document not found")

        return {
            "message": f"Deleted {filename}",
            "chunks_removed": deleted_count,
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
