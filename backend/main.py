# backend/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from ingest import router as ingest_router
from retriever import router as retriever_router
from evaluator import router as eval_router

app = FastAPI(title="RAG App API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest_router, prefix="/api")
app.include_router(retriever_router, prefix="/api")
app.include_router(eval_router, prefix="/api")

@app.get("/")
def root():
    return {"status": "RAG backend running"}