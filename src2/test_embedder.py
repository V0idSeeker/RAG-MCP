#!/usr/bin/env python3
"""
Quick test script for the embedder module
"""
from embedder import embed_text, embed_batch

def test_single_embedding():
    """Test single text embedding"""
    print("Testing single embedding...")
    text = "This is a test document about machine learning."
    embedding = embed_text(text)
    print(f"  ✓ Embedding dimension: {len(embedding)}")
    print(f"  ✓ First 5 values: {embedding[:5]}")
    return embedding

def test_batch_embedding():
    """Test batch embedding"""
    print("\nTesting batch embedding...")
    texts = [
        "Machine learning is a subset of artificial intelligence.",
        "Deep learning uses neural networks with multiple layers.",
        "Natural language processing helps computers understand text."
    ]
    embeddings = embed_batch(texts)
    print(f"  ✓ Batch size: {len(embeddings)}")
    print(f"  ✓ Each embedding dimension: {len(embeddings[0])}")
    return embeddings

def test_query_vs_document():
    """Test query vs document embedding (if prefixes are used)"""
    print("\nTesting query vs document embeddings...")
    text = "What is machine learning?"
    
    doc_emb = embed_text(text, text_type="document")
    query_emb = embed_text(text, text_type="query")
    
    print(f"  ✓ Document embedding dimension: {len(doc_emb)}")
    print(f"  ✓ Query embedding dimension: {len(query_emb)}")
    
    # Check if they're different (only if prefixes are used)
    if doc_emb != query_emb:
        print("  ✓ Query and document embeddings differ (prefixes active)")
    else:
        print("  ✓ Query and document embeddings identical (no prefixes)")

if __name__ == "__main__":
    print("=" * 60)
    print("PDF Context MCP - Embedder Test")
    print("=" * 60)
    
    try:
        test_single_embedding()
        test_batch_embedding()
        test_query_vs_document()
        
        print("\n" + "=" * 60)
        print("✅ All tests passed!")
        print("=" * 60)
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
