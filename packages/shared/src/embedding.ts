export function embeddingVersion(
  adapter: "fake" | "bedrock",
  modelId: string,
  dimension: number,
): string {
  return `${adapter}:${modelId}:${dimension}:v1`;
}
