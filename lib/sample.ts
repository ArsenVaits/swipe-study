import type { Lesson } from "./lesson";

export const sampleName = "The Feedback Field Guide.pdf";
export const samplePdf = "/sample/feedback-field-guide.pdf";
export const sampleVideo = "/sample/feedback.mp4";
export const samplePoster = "/sample/feedback.webp";
export const samplePages = [
  { title: "Feedback that lands", text: "The Situation–Behavior–Impact (SBI) framework helps you give specific feedback. First, name the situation so the other person knows exactly when and where it happened. Then describe the behavior you observed, using concrete details. Finally, explain the impact it had on you, the team, or the work. After you share the impact, give the other person room to respond." },
  { title: "Practice the SBI framework", text: "Before a feedback conversation, write one sentence for each part of the SBI framework. Pick a recent moment you can describe clearly. When you write about behavior, use details someone else could have seen or heard. State the impact from your own perspective. Read the three sentences aloud and replace generalizations with observations." },
];

export const sampleLesson: Lesson = {
  title: "The feedback formula",
  explanation: "Use Situation, Behavior, and Impact to give feedback someone can act on. Name the moment, describe what you observed, then explain how it affected you, your team, or the work. Give the other person time to respond.",
  narration: "Start by naming the situation so the other person knows when and where it happened. Describe the behavior you observed using concrete details. Explain the impact on you, the team, or the work, then give the other person room to respond.",
  captions: ["Name the situation.", "Describe the behavior.", "Explain the impact."],
  quiz: {
    question: "What comes right after naming the situation?",
    options: ["Explain the impact on the team.", "Describe what you observed.", "Give the other person time to respond."],
    correctIndex: 1,
    explanation: "The second step is Behavior. Describe what you actually saw or heard using concrete details.",
  },
  source: { page: 1, quote: "Then describe the behavior you observed, using concrete details." },
};
