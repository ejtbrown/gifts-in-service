import { describe, expect, it } from "vitest";
import {
  FakeAiAdapter,
  type InterviewContext,
} from "../../packages/ai/src/index.js";
import type { InterviewMessage } from "../../packages/shared/src/index.js";

const ai = new FakeAiAdapter();
const initialContext: InterviewContext = {
  hasProposedProfile: false,
  previousCompletenessConfidence: "LOW",
  previousFollowUpNotes: [],
  currentProfile: null,
};

async function continueInterview(
  messages: InterviewMessage[],
  response: string,
  context: InterviewContext,
): Promise<{
  messages: InterviewMessage[];
  context: InterviewContext;
  message: string;
  action: string;
  confidence: string;
}> {
  const withResponse = [
    ...messages,
    { role: "user" as const, content: response },
  ];
  const turn = await ai.interview(withResponse, context);
  return {
    messages: [
      ...withResponse,
      { role: "assistant" as const, content: turn.message },
    ],
    context: {
      ...context,
      previousCompletenessConfidence: turn.completeness_confidence,
      previousFollowUpNotes: turn.follow_up_notes,
    },
    message: turn.message,
    action: turn.action,
    confidence: turn.completeness_confidence,
  };
}

describe("probative interview flow", () => {
  it("drills into a retired attorney's specialty, jurisdiction, and transferable help", async () => {
    let state = await continueInterview(
      [
        {
          role: "assistant",
          content: "What experience would you like to start with?",
        },
      ],
      "I am a retired attorney.",
      initialContext,
    );
    expect(state.confidence).toBe("LOW");
    expect(state.message).toMatch(/specialty|area of law/iu);
    expect(state.message).toMatch(/jurisdiction/iu);

    state = await continueInterview(
      state.messages,
      "My practice was estate planning in Illinois.",
      state.context,
    );
    expect(state.confidence).toBe("LOW");
    expect(state.message).toMatch(/advising|reviewing documents/iu);

    state = await continueInterview(
      state.messages,
      "I could occasionally review governance documents and offer advice only; I would not represent anyone.",
      state.context,
    );
    expect(state.confidence).toMatch(/MODERATE|HIGH/u);
    expect(state.action).toBe("CONTINUE");
    expect(state.message).toMatch(/anything else|another skill|prepare/iu);

    state = await continueInterview(
      state.messages,
      "That is all; please wrap up the profile.",
      state.context,
    );
    expect(state.action).toBe("PROPOSE_PROFILE");
  });

  it("branches from a broad educator label through role and teaching context", async () => {
    let state = await continueInterview(
      [
        {
          role: "assistant",
          content: "What experience would you like to start with?",
        },
      ],
      "I worked as an educator.",
      initialContext,
    );
    expect(state.message).toMatch(
      /teacher.*administrator|administrator.*teacher/iu,
    );

    state = await continueInterview(
      state.messages,
      "I was a teacher.",
      state.context,
    );
    expect(state.message).toMatch(/subjects|age groups|settings/iu);

    state = await continueInterview(
      state.messages,
      "I taught middle school math.",
      state.context,
    );
    expect(state.confidence).toBe("LOW");
    expect(state.message).toMatch(/tutoring|mentoring|curriculum/iu);

    state = await continueInterview(
      state.messages,
      "I would consider occasional tutoring or curriculum advice, but no ongoing classroom role.",
      state.context,
    );
    expect(state.confidence).toMatch(/MODERATE|HIGH/u);
    expect(state.message).toMatch(/anything else|another skill|prepare/iu);
  });

  it("honors an explicit early request to stop without claiming completeness", async () => {
    const turn = await ai.interview(
      [
        { role: "assistant", content: "What would you like to share?" },
        { role: "user", content: "I enjoy gardening. Please wrap up." },
      ],
      initialContext,
    );
    expect(turn.action).toBe("PROPOSE_PROFILE");
    expect(turn.completeness_confidence).toBe("LOW");
  });

  it("retains an omitted question thread until it is answered", async () => {
    let state = await continueInterview(
      [
        {
          role: "assistant",
          content:
            "You mentioned computers and electronics. What computer work did you do, and what electronics work did you do?",
        },
      ],
      "For electronics, I repaired circuit boards and soldered components. I could offer occasional troubleshooting advice only.",
      initialContext,
    );

    expect(state.confidence).toBe("LOW");
    expect(state.context.previousFollowUpNotes).toContain(
      "computer experience introduced earlier still needs follow-up",
    );
    expect(state.message).toMatch(
      /computer work.*not covered|computers.*tasks/iu,
    );

    state = await continueInterview(
      state.messages,
      "My computer work included desktop support, networks, and server administration.",
      state.context,
    );

    expect(state.context.previousFollowUpNotes).not.toContain(
      "computer experience introduced earlier still needs follow-up",
    );
    expect(state.confidence).toMatch(/MODERATE|HIGH/u);
  });

  it("routes a whole-profile deletion request to confirmation without confusing it with an edit", async () => {
    const deletion = await ai.interview(
      [
        { role: "assistant", content: "What would you like to change?" },
        { role: "user", content: "Please delete my entire profile." },
      ],
      { ...initialContext, currentProfile: "Existing fictional profile text." },
    );
    expect(deletion.action).toBe("REQUEST_PROFILE_DELETION");

    const edit = await ai.interview(
      [
        { role: "assistant", content: "What would you like to change?" },
        {
          role: "user",
          content: "Please remove computer repair from my profile.",
        },
      ],
      { ...initialContext, currentProfile: "Existing fictional profile text." },
    );
    expect(edit.action).not.toBe("REQUEST_PROFILE_DELETION");
  });
});
