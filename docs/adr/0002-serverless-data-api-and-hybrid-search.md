# ADR 0002: Aurora Data API and bounded hybrid search

- Status: Accepted
- Date: 2026-07-15

## Context

Expected traffic is modest and idle cost matters. Search needs semantic recall while preserving exact terms and evidence.

## Decision

Production uses Aurora PostgreSQL Serverless v2, scale-to-zero where the selected engine/region supports it, and RDS Data API from non-VPC Lambdas. Local development uses direct PostgreSQL. Search retrieves active/consented/fresh/version-compatible candidates independently through full text, vector distance, and optional trigram matching; Reciprocal Rank Fusion combines ranks. A bounded, schema-validated reranker may reorder only those candidates and must cite exact substrings. Invalid AI output falls back to deterministic RRF.

## Consequences

Cold resumes are visible and retried. Static SQL remains explicit. RDS Proxy and OpenSearch are intentionally excluded.
