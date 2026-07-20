import type { AiAdapter } from "@gis/ai";
import type { SqlExecutor } from "@gis/db";

function vectorLiteral(values: readonly number[]): string {
  return `[${values.map((value) => value.toFixed(8)).join(",")}]`;
}

export async function reembedBatch(
  executor: SqlExecutor,
  ai: AiAdapter,
  config: {
    modelId: string;
    fromVersion: string;
    toVersion: string;
    dimension: number;
    limit: number;
  },
): Promise<number> {
  const profiles = await executor.query<{
    person_id: string;
    approved_text: string;
    approved_text_sha256: string;
  }>(
    `SELECT person_id::text, approved_text, approved_text_sha256 FROM profiles
     WHERE embedding_model_id <> $1 OR embedding_version = $2 ORDER BY person_id LIMIT $3`,
    [config.modelId, config.fromVersion, Math.min(config.limit, 100)],
  );
  let updated = 0;
  for (const profile of profiles.rows) {
    const embedding = await ai.embed(profile.approved_text, config.dimension);
    const result = await executor.query(
      `UPDATE profiles SET embedding = $3::vector, embedding_model_id = $4, embedding_version = $5
       WHERE person_id = $1::uuid AND approved_text_sha256 = $2`,
      [
        profile.person_id,
        profile.approved_text_sha256,
        vectorLiteral(embedding),
        config.modelId,
        config.toVersion,
      ],
    );
    updated += result.rowCount;
  }
  return updated;
}
