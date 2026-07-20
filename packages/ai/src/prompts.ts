import { readFile } from "node:fs/promises";

export interface PromptBundle {
  interviewer: string;
  profileDrafter: string;
  searchPlanner: string;
  searchReranker: string;
}

async function prompt(name: string): Promise<string> {
  return readFile(new URL(`../prompts/${name}`, import.meta.url), "utf8");
}

export async function loadPromptBundle(): Promise<PromptBundle> {
  const [interviewer, profileDrafter, searchPlanner, searchReranker] =
    await Promise.all([
      prompt("interviewer-system.md"),
      prompt("profile-drafter-system.md"),
      prompt("search-planner-system.md"),
      prompt("search-reranker-system.md"),
    ]);
  return { interviewer, profileDrafter, searchPlanner, searchReranker };
}
