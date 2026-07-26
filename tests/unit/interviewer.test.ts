import { describe, expect, it } from "vitest";
import {
  FakeAiAdapter,
  type InterviewContext,
} from "../../packages/ai/src/index.js";
import {
  interviewMessageSchema,
  type InterviewMessage,
} from "../../packages/shared/src/index.js";

const ai = new FakeAiAdapter();
const initialContext: InterviewContext = {
  hasProposedProfile: false,
  previousCompletenessConfidence: "LOW",
  previousFollowUpNotes: [],
  previousConversationMemory: { establishedFacts: [], closedTopics: [] },
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
      previousConversationMemory: turn.conversation_memory,
    },
    message: turn.message,
    action: turn.action,
    confidence: turn.completeness_confidence,
  };
}

describe("balanced interview flow", () => {
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

  it("retains an introduced topic even when the assistant never asked about it", async () => {
    const turn = await ai.interview(
      [
        {
          role: "assistant",
          content: "What experience would you like to start with?",
        },
        {
          role: "user",
          content:
            "I had a 30-year career working with computers and electronics.",
        },
        {
          role: "assistant",
          content: "What kinds of electronics work did you do?",
        },
        {
          role: "user",
          content:
            "I repaired circuit boards and soldered components, and I could offer occasional troubleshooting advice only.",
        },
      ],
      initialContext,
    );

    expect(turn.completeness_confidence).toBe("LOW");
    expect(turn.follow_up_notes).toContain(
      "computer experience introduced earlier still needs follow-up",
    );
    expect(turn.message).toMatch(
      /computer work.*not covered|computers.*tasks/iu,
    );
  });

  it("uses an answer from earlier in a longer conversation instead of reviving its follow-up note", async () => {
    const turn = await ai.interview(
      [
        {
          role: "assistant",
          content: "What kinds of computer work did you do?",
        },
        {
          role: "user",
          content:
            "I supported desktops, networks, and servers for a fictional museum.",
        },
        {
          role: "assistant",
          content: "How might you want to help?",
        },
        {
          role: "user",
          content:
            "I could offer occasional troubleshooting advice from home only.",
        },
        {
          role: "assistant",
          content: "Is there anything else you would like staff to know?",
        },
        { role: "user", content: "I also enjoy organizing exhibits." },
      ],
      {
        ...initialContext,
        previousFollowUpNotes: [
          "computer experience introduced earlier still needs follow-up",
        ],
        previousConversationMemory: {
          establishedFacts: [
            "Supported desktops, networks, and servers for a fictional museum.",
            "Can offer occasional troubleshooting advice from home only.",
          ],
          closedTopics: [],
        },
      },
    );

    expect(turn.follow_up_notes).not.toContain(
      "computer experience introduced earlier still needs follow-up",
    );
    expect(turn.message).not.toMatch(/computer work|computers.*tasks/iu);
    expect(turn.conversation_memory.establishedFacts).toContain(
      "Supported desktops, networks, and servers for a fictional museum.",
    );
  });

  it("acknowledges an already-answered correction and stops pursuing the topic", async () => {
    const turn = await ai.interview(
      [
        {
          role: "assistant",
          content: "What experience would you like to share?",
        },
        {
          role: "user",
          content:
            "I taught art workshops and can lead occasional hands-on projects.",
        },
        {
          role: "assistant",
          content: "What kinds of projects did you teach?",
        },
        {
          role: "user",
          content:
            "Collage, printmaking, and simple sculpture for adult learners.",
        },
        {
          role: "assistant",
          content:
            "What specific art projects do you teach, and what age groups?",
        },
        { role: "user", content: "I already answered that." },
      ],
      {
        ...initialContext,
        previousFollowUpNotes: [
          "art projects and participant age range need follow-up",
        ],
        previousConversationMemory: {
          establishedFacts: [
            "Taught collage, printmaking, and simple sculpture to adult learners.",
            "Can lead occasional hands-on projects.",
          ],
          closedTopics: [],
        },
      },
    );

    expect(turn.action).toBe("CONTINUE");
    expect(turn.message).toMatch(/you’re right|use what you already shared/iu);
    expect(turn.message).not.toMatch(/what specific art|what age/iu);
    expect(turn.follow_up_notes).toEqual([]);
    expect(turn.conversation_memory.closedTopics).not.toHaveLength(0);
  });

  it("honors a wrap-up signal after more than the previous transcript limit", async () => {
    const messages: InterviewMessage[] = Array.from(
      { length: 25 },
      (_, index) => ({
        role: index % 2 === 0 ? ("assistant" as const) : ("user" as const),
        content:
          index % 2 === 0
            ? `Fictional interview question ${index + 1}?`
            : `Fictional grounded answer ${index + 1}.`,
      }),
    );
    const withWrapRequest = [
      ...messages,
      {
        role: "user" as const,
        content: "I can’t think of anything else.",
      },
    ];

    expect(() =>
      interviewMessageSchema.shape.messages.parse(withWrapRequest),
    ).not.toThrow();
    const turn = await ai.interview(withWrapRequest, initialContext);
    expect(turn.action).toBe("PROPOSE_PROFILE");
    expect(turn.follow_up_notes).toEqual([]);
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
