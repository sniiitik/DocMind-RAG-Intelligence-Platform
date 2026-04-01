# backend/ingest.py
import os
from fastapi import APIRouter, UploadFile, File, HTTPException
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_huggingface import HuggingFaceEmbeddings
import chromadb
import tempfile

router = APIRouter()

# Local embeddings — completely free, runs on your Mac
embeddings_model = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

# ChromaDB local client
chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection("documents")

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50
)

@router.post("/ingest")
async def ingest_document(file: UploadFile = File(...)):
    # Save upload to temp file
    suffix = ".pdf" if file.content_type == "application/pdf" else ".txt"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        # Load document
        if suffix == ".pdf":
            loader = PyPDFLoader(tmp_path)
        else:
            loader = TextLoader(tmp_path)

        docs = loader.load()
        chunks = splitter.split_documents(docs)

        # Embed and store
        texts = [c.page_content for c in chunks]
        metadatas = [{"source": file.filename, "page": c.metadata.get("page", 0)} for c in chunks]
        ids = [f"{file.filename}_{i}" for i in range(len(chunks))]
        embeds = embeddings_model.embed_documents(texts)

        collection.add(documents=texts, embeddings=embeds, metadatas=metadatas, ids=ids)

        return {"message": f"Ingested {len(chunks)} chunks from {file.filename}"}

    finally:
        os.unlink(tmp_path)

@router.get("/documents")
def list_documents():
    results = collection.get()
    sources = list(set(m["source"] for m in results["metadatas"])) if results["metadatas"] else []
    return {"documents": sources, "total_chunks": len(results["ids"])}

@router.delete("/documents/{filename}")
def delete_document(filename: str):
    try:
        # Get all docs
        results = collection.get()

        if not results["metadatas"]:
            return {"message": "No documents found"}

        # Find IDs that match this file
        ids_to_delete = [
            results["ids"][i]
            for i, m in enumerate(results["metadatas"])
            if m.get("source") == filename
        ]

        if not ids_to_delete:
            raise HTTPException(status_code=404, detail="Document not found")

        # Delete those chunks
        collection.delete(ids=ids_to_delete)

        return {
            "message": f"Deleted {filename}",
            "chunks_removed": len(ids_to_delete)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))