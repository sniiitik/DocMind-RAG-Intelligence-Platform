"""
RAGAS Batch Evaluation Script — Groq Version
==============================================
Uses Groq (LLaMA 3.3 70B) as the judge instead of OpenAI.
You already have a Groq API key from DocMind — use that here.

HOW TO USE:
1. Add GROQ_API_KEY to your local .env or backend/.env file
2. Export your spreadsheet as CSV and set CSV_PATH below
3. Run: python3 ragas_eval.py
4. Results saved to: ragas_results.csv

INSTALL:
    pip install ragas datasets langchain-groq pandas
"""

import os
from pathlib import Path

import pandas as pd
from datasets import Dataset
from dotenv import load_dotenv

# ── CONFIGURATION ─────────────────────────────────────────────────────────────
ROOT_DIR = Path(__file__).resolve().parents[2]
EXPERIMENTS_DIR = ROOT_DIR / "experiments"
DATA_DIR = EXPERIMENTS_DIR / "data"

load_dotenv(ROOT_DIR / ".env")
load_dotenv(ROOT_DIR / "backend" / ".env")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise ValueError(
        "Missing GROQ_API_KEY. Add it to .env or backend/.env, but do not commit it."
    )

CSV_PATH = DATA_DIR / "RAG_Eval_Experiment_Sheet.csv"
OUTPUT_CSV = DATA_DIR / "ragas_results.csv"

# Column names — match the cleaned CSV headers
COL_QUERY   = "Query Text"
COL_ANSWER  = "Generated Answer (paste from DocMind)"
COL_CONTEXT = "Retrieved Context (top-k chunks)"


# ── SETUP GROQ AS RAGAS LLM ───────────────────────────────────────────────────
def setup_groq_llm():
    from langchain_groq import ChatGroq
    from ragas.llms import LangchainLLMWrapper
    from ragas.embeddings import LangchainEmbeddingsWrapper
    from langchain_community.embeddings import HuggingFaceEmbeddings

    llm = ChatGroq(
        model="llama-3.3-70b-versatile",
        api_key=GROQ_API_KEY,
        temperature=0,
    )

    embeddings = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )

    return LangchainLLMWrapper(llm), LangchainEmbeddingsWrapper(embeddings)


# ── LOAD DATA FROM CSV ────────────────────────────────────────────────────────
def load_data():
    print(f"Loading data from {CSV_PATH}...")

    # FIX 1: skip the title row and method-group row — real headers are on row 3
    df = pd.read_csv(CSV_PATH, header=2)

    # FIX 2: strip newline characters from column names (Excel export artefact)
    df.columns = df.columns.str.replace('\n', ' ', regex=False).str.strip()

    # Debug — print cleaned column names so you can verify
    print(f"Columns found: {df.columns.tolist()}")

    # Drop rows where answer or context is empty
    df = df.dropna(subset=[COL_QUERY, COL_ANSWER, COL_CONTEXT])
    df = df[df[COL_ANSWER].str.strip() != ""]
    df = df[df[COL_CONTEXT].str.strip() != ""]

    print(f"Loaded {len(df)} valid rows.")

    questions = df[COL_QUERY].tolist()
    answers   = df[COL_ANSWER].tolist()
    contexts  = [[ctx] for ctx in df[COL_CONTEXT].tolist()]

    return df, questions, answers, contexts


# ── RUN RAGAS ─────────────────────────────────────────────────────────────────
def run_ragas():
    from ragas import evaluate
    from ragas.metrics import faithfulness, answer_relevancy

    print("Setting up Groq LLM and local embeddings...")
    llm_wrapper, emb_wrapper = setup_groq_llm()

    faithfulness.llm            = llm_wrapper
    answer_relevancy.llm        = llm_wrapper
    answer_relevancy.embeddings = emb_wrapper

    df_original, questions, answers, contexts = load_data()

    dataset = Dataset.from_dict({
        "question": questions,
        "answer":   answers,
        "contexts": contexts,
    })

    print(f"\nRunning RAGAS on {len(dataset)} queries...")
    print("Using Groq (LLaMA 3.3 70B) as judge + local MiniLM embeddings")
    print("Estimated time: 3–8 minutes (Groq is fast)\n")

    results = evaluate(
        dataset,
        metrics=[faithfulness, answer_relevancy],
        raise_exceptions=False,
    )

    result_df = results.to_pandas()
    result_df.insert(0, "query_num",  list(range(1, len(result_df) + 1)))
    result_df.insert(1, "query_type", df_original["Query Type"].values[:len(result_df)])
    result_df.insert(2, "doc_source", df_original["Doc Source"].values[:len(result_df)])
    result_df.insert(3, "query_text", questions)
    result_df.insert(4, "answer",     answers)

    result_df.to_csv(OUTPUT_CSV, index=False)
    print(f"\nDone! Results saved to: {OUTPUT_CSV}")

    print("\n── RAGAS Summary ───────────────────────────────────")
    for qtype in ["Factual", "Paraphrased", "Multi-hop"]:
        subset = result_df[result_df["query_type"] == qtype]
        if len(subset) == 0:
            continue
        print(f"\n{qtype} ({len(subset)} queries):")
        print(f"  Faithfulness:     {subset['faithfulness'].mean():.3f}")
        print(f"  Answer Relevancy: {subset['answer_relevancy'].mean():.3f}")

    print(f"\nAll queries ({len(result_df)}):")
    print(f"  Faithfulness:     {result_df['faithfulness'].mean():.3f}")
    print(f"  Answer Relevancy: {result_df['answer_relevancy'].mean():.3f}")

    return result_df


if __name__ == "__main__":
    run_ragas()