#!/usr/bin/env python3
"""
PDF Ingestion Script
Usage: python ingest.py <folder_path> [--collection name] [--reset]
"""
import os
import sys
import re
from pathlib import Path
from typing import List
import chromadb
from pypdf import PdfReader
from dotenv import load_dotenv
from embedder import embed_text, embed_batch

# Load environment variables
load_dotenv()

# Configuration
CHROMA_URL = os.getenv("CHROMA_URL", "http://localhost:8000")
DEFAULT_COLLECTION = os.getenv("CHROMA_COLLECTION", "pdf_context")
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "800"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "150"))
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "unknown")

MIN_CONTENT_CHARS = 80
MIN_WORD_COUNT = 12


def clean_text(raw: str) -> str:
    """Clean and normalize extracted PDF text"""
    # Normalize line endings
    text = raw.replace("\r\n", "\n").replace("\f", "\n")
    
    # Reduce multiple newlines
    text = re.sub(r"\n{3,}", "\n\n", text)
    
    # Process line by line
    lines = []
    for line in text.split("\n"):
        line = line.rstrip()
        s = line.strip()
        
        # Skip page numbers and decorative lines
        if not s:
            lines.append(line)
            continue
        if re.match(r"^\d+$", s):
            continue
        if re.match(r"^[-–—=_.*•·|/\\]{2,}$", s):
            continue
        
        lines.append(line)
    
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def is_useful_chunk(chunk: str) -> bool:
    """Check if a chunk contains meaningful content"""
    s = chunk.strip()
    
    if len(s) < MIN_CONTENT_CHARS:
        return False
    
    word_count = len([w for w in s.split() if w])
    if word_count < MIN_WORD_COUNT:
        return False
    
    # Check alpha ratio
    alpha_chars = len(re.findall(r"[a-zA-ZÀ-ÿ]", s))
    if alpha_chars / len(s) < 0.3:
        return False
    
    return True


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """Split text into overlapping chunks"""
    paragraphs = re.split(r"\n\n+", text)
    chunks = []
    current = ""
    
    for para in paragraphs:
        candidate = f"{current}\n\n{para}" if current else para
        
        if len(candidate) <= size:
            current = candidate
        else:
            if current:
                chunks.append(current.strip())
            
            # Handle oversized paragraphs
            if len(para) > size:
                s = 0
                while s < len(para):
                    end = min(s + size, len(para))
                    chunks.append(para[s:end].strip())
                    if end == len(para):
                        break
                    s += size - overlap
                current = ""
            else:
                current = para
    
    if current.strip():
        chunks.append(current.strip())
    
    return [c for c in chunks if is_useful_chunk(c)]


def extract_text(pdf_path: Path) -> str:
    """Extract text from a PDF file"""
    reader = PdfReader(pdf_path)
    text = ""
    for page in reader.pages:
        text += page.extract_text() + "\n"
    return clean_text(text)


def get_pdf_files(directory: Path) -> List[Path]:
    """Recursively find all PDF files in a directory"""
    return list(directory.rglob("*.pdf"))


async def check_dimension(collection, sample_text: str) -> int:
    """Check embedding dimension compatibility"""
    # Get test embedding
    test_emb = embed_text(sample_text)
    our_dim = len(test_emb)
    
    # Check existing collection dimension
    existing = collection.peek(limit=1)
    if existing["embeddings"] and len(existing["embeddings"]) > 0:
        stored_dim = len(existing["embeddings"][0])
        if stored_dim != our_dim:
            raise ValueError(
                f"Dimension mismatch! Collection has {stored_dim}-dim embeddings "
                f"but current model produces {our_dim}-dim.\n"
                f"  → Run with --reset to delete and recreate the collection, "
                f"or use the same model that created it."
            )
    
    return our_dim


def main():
    # Parse CLI arguments
    args = sys.argv[1:]
    
    folder_arg = None
    collection_name = DEFAULT_COLLECTION
    do_reset = False
    
    i = 0
    while i < len(args):
        if args[i] == "--collection" and i + 1 < len(args):
            collection_name = args[i + 1]
            i += 2
        elif args[i] == "--reset":
            do_reset = True
            i += 1
        elif not args[i].startswith("--"):
            folder_arg = args[i]
            i += 1
        else:
            i += 1
    
    if not folder_arg:
        print("Usage: python ingest.py <folder_path> [--collection name] [--reset]")
        sys.exit(1)
    
    folder = Path(folder_arg).resolve()
    if not folder.exists():
        print(f"Folder not found: {folder}")
        sys.exit(1)
    
    # Connect to ChromaDB
    client = chromadb.HttpClient(host=CHROMA_URL.replace("http://", "").split(":")[0],
                                  port=int(CHROMA_URL.split(":")[-1]))
    
    # Reset collection if requested
    if do_reset:
        try:
            client.delete_collection(name=collection_name)
            print(f"🗑  Deleted existing collection \"{collection_name}\"")
        except:
            pass
    
    # Get or create collection
    collection = client.get_or_create_collection(
        name=collection_name,
        metadata={
            "hnsw:space": "cosine",
            "embedding_model": EMBEDDING_MODEL
        }
    )
    
    # Find PDF files
    pdf_files = get_pdf_files(folder)
    print(f"\nFound {len(pdf_files)} PDF(s) in {folder}")
    
    total_chunks = 0
    dim_checked = False
    
    for pdf_path in pdf_files:
        filename = str(pdf_path.relative_to(folder))
        print(f"\n📄 Processing: {filename}")
        
        try:
            # Extract and chunk text
            raw_text = extract_text(pdf_path)
            chunks = chunk_text(raw_text)
            print(f"   → {len(chunks)} chunks")
            
            if len(chunks) == 0:
                print("   ⚠️  Skipped: no usable content extracted")
                continue
            
            # Check dimension on first batch
            if not dim_checked:
                dim = check_dimension(collection, chunks[0])
                print(f"   ✓ Embedding dimension: {dim}")
                dim_checked = True
            
            # Process in batches
            BATCH_SIZE = 32
            for i in range(0, len(chunks), BATCH_SIZE):
                batch = chunks[i:i + BATCH_SIZE]
                embeddings = embed_batch(batch)
                
                ids = [f"{filename}::chunk::{i + j}" for j in range(len(batch))]
                metadatas = [
                    {
                        "source": filename,
                        "fullPath": str(pdf_path),
                        "chunkIndex": i + j,
                        "totalChunks": len(chunks),
                        "embedding_model": EMBEDDING_MODEL
                    }
                    for j in range(len(batch))
                ]
                
                collection.upsert(
                    ids=ids,
                    embeddings=embeddings,
                    documents=batch,
                    metadatas=metadatas
                )
                
                print(f"   ✓ {min(i + BATCH_SIZE, len(chunks))}/{len(chunks)} chunks stored", end="\r")
            
            total_chunks += len(chunks)
            print(f"   ✅ Done: {filename}                    ")
            
        except ValueError as e:
            if "Dimension mismatch" in str(e):
                print(f"\n❌ {e}")
                sys.exit(1)
            print(f"   ❌ Failed: {filename} — {e}")
        except Exception as e:
            print(f"   ❌ Failed: {filename} — {e}")
    
    print(f"\n🎉 Ingestion complete! {total_chunks} chunks from {len(pdf_files)} PDFs stored in \"{collection_name}\"")


if __name__ == "__main__":
    main()
