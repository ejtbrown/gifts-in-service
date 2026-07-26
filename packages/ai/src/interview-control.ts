import type { InterviewMessage } from "@gis/shared";
import type { InterviewTurn } from "./adapter.js";

const WRAP_REQUEST =
  /\b(?:I (?:am|['’]m) (?:ready to )?)?(?:wrap up|finish the interview)\b|\b(?:that(?:['’]s| is)|this is) (?:it|all)\b|\b(?:nothing|not anything) (?:else|more)(?: to add)?\b|\b(?:can(?:not|['’]t)|could(?: not|n['’]t)) think of anything else\b/iu;
const ALREADY_ANSWERED =
  /\b(?:I (?:already|just) answered (?:that|this)|already answered|I (?:said|told you) (?:that|this) already)\b/iu;
const MOVE_ON =
  /\b(?:next question|move on|skip (?:that|this|it)|leave (?:that|this|it)(?: there)?|rather not (?:go into|discuss) (?:that|this|it))\b/iu;

const QUESTION_STOP_WORDS = new Set([
  "about",
  "also",
  "could",
  "have",
  "help",
  "kind",
  "like",
  "more",
  "parts",
  "please",
  "share",
  "tell",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);

function latestUserMessage(messages: readonly InterviewMessage[]): string {
  return (
    [...messages].reverse().find((message) => message.role === "user")
      ?.content ?? ""
  );
}

function questionTerms(message: string): Set<string> {
  return new Set(
    (message.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((word) => word.length >= 4 && !QUESTION_STOP_WORDS.has(word))
      .map((word) => word.replace(/(?:ing|ed)$/u, "").replace(/s$/u, "")),
  );
}

export function repeatsEarlierQuestion(
  candidate: string,
  messages: readonly InterviewMessage[],
): boolean {
  if (!candidate.includes("?")) return false;
  const candidateTerms = questionTerms(candidate);
  if (candidateTerms.size < 4) return false;
  return messages
    .filter(
      (message) =>
        message.role === "assistant" && message.content.includes("?"),
    )
    .some((message) => {
      const earlierTerms = questionTerms(message.content);
      if (earlierTerms.size < 4) return false;
      const overlap = [...candidateTerms].filter((term) =>
        earlierTerms.has(term),
      ).length;
      return (
        overlap >= 4 &&
        overlap / Math.min(candidateTerms.size, earlierTerms.size) >= 0.7
      );
    });
}

export function honorMemberInterviewDirection(
  turn: InterviewTurn,
  messages: readonly InterviewMessage[],
): InterviewTurn {
  if (
    turn.action === "SUBMIT_PROFILE" ||
    turn.action === "REQUEST_PROFILE_DELETION"
  )
    return turn;

  const latest = latestUserMessage(messages);
  if (WRAP_REQUEST.test(latest))
    return {
      ...turn,
      action: "PROPOSE_PROFILE",
      message: "I’ll prepare the proposed profile from what you shared.",
      referenced_profile_text: null,
      invalidate_proposed_profile: false,
      follow_up_notes: [],
    };

  if (turn.action !== "CONTINUE") return turn;
  const alreadyAnswered = ALREADY_ANSWERED.test(latest);
  const moveOn = MOVE_ON.test(latest);
  const repeated = repeatsEarlierQuestion(turn.message, messages);
  if (!alreadyAnswered && !repeated) return turn;

  return {
    ...turn,
    message: alreadyAnswered
      ? "You’re right—I’ll use what you already shared. Is there another area you’d like to add, or would you like me to prepare the profile for review?"
      : moveOn
        ? "Understood—we’ll leave that there. Is there another area you’d like to add, or would you like me to prepare the profile for review?"
        : "I have enough on that topic. Is there another area you’d like to add, or would you like me to prepare the profile for review?",
    follow_up_notes: [],
  };
}
