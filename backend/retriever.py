# backend/retriever.py
import os
from fastapi import APIRouter
from pydantic import BaseModel
from langchain_huggingface import HuggingFaceEmbeddings
import chromadb
from groq import Groq
from dotenv import load_dotenv

load_dotenv()
router = APIRouter()

embeddings_model = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection("documents")
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

class QueryRequest(BaseModel):
    question: str
    top_k: int = 5

@router.post("/query")
def query(request: QueryRequest):
    # Embed the question
    query_embedding = embeddings_model.embed_query(request.question)

    # Retrieve top-k chunks
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=request.top_k
    )

    chunks = results["documents"][0]
    sources = results["metadatas"][0]

    if not chunks:
        return {"answer": "No relevant documents found.", "sources": [], "context": []}

    # Build prompt with retrieved context
    context = "\n\n".join([f"[Source: {s['source']}, Page {s['page']}]\n{c}"
                           for c, s in zip(chunks, sources)])

    prompt = f"""You are a helpful assistant. Answer the question using ONLY the context below.
If the answer is not in the context, say "I don't have enough information to answer this."
Always cite which source and page your answer comes from.

Context:
{context}

Question: {request.question}

Answer:"""

    response = groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
    )

    answer = response.choices[0].message.content

    return {
        "answer": answer,
        "sources": list(set(s["source"] for s in sources)),
        "context": [{"text": c, "source": s["source"], "page": s["page"]}
                    for c, s in zip(chunks, sources)]
    }