const express = require("express");
const path = require("path");
const { chat } = require("./llm");
const { interviewPrompt, verdictPrompt, respondentPrompt } = require("./prompts");

const app = express();
const PORT = process.env.PORT || 3000;

// express.json() is middleware that parses JSON request bodies —
// like a Rack middleware in Ruby or an Actix extractor in Rust.
app.use(express.json());

// Serve static files (index.html, style.css, app.js) from the public/ directory.
app.use(express.static(path.join(__dirname, "public")));

// --- Recent questions buffer ---
// Stores the last N opening questions across all games so we can ask the judge
// to avoid repeating them. Lives in memory — resets on server restart, which is fine.
const RECENT_QUESTIONS_MAX = 5;
const recentFirstQuestions = [];

function recordFirstQuestion(question) {
  recentFirstQuestions.push(question);
  // If the buffer exceeds max, drop the oldest entry.
  if (recentFirstQuestions.length > RECENT_QUESTIONS_MAX) {
    // `shift()` removes and returns the first element — like pop_front or shift in Ruby.
    recentFirstQuestions.shift();
  }
}

// Build the opening message for the judge, including recent questions to avoid.
function buildOpeningMessage() {
  let msg = "Begin the interview. Ask your first question.";
  if (recentFirstQuestions.length > 0) {
    msg += "\n\nFor variety, try to avoid opening questions similar to these recent ones:\n";
    msg += recentFirstQuestions.map((q) => `- "${q}"`).join("\n");
  }
  return msg;
}

// --- Helpers ---

// Build the judge's conversation messages for an ongoing interview.
// `transcript` is an array of { question, answer } objects.
function buildInterviewMessages(transcript) {
  const messages = [
    { role: "user", content: "Begin the interview. Ask your first question." },
  ];

  for (const round of transcript) {
    messages.push({ role: "assistant", content: round.question });
    // Only add the answer turn if there is one (the last entry may be question-only).
    if (round.answer !== undefined) {
      messages.push({
        role: "user",
        content: `Respondent's answer: ${round.answer}\n\nAsk your next question.`,
      });
    }
  }

  return messages;
}

// Run a full 3-round interview between the judge and the AI respondent.
// `firstQuestion` is reused from the human's interview so both start the same way.
// Follow-up questions adapt based on the AI respondent's answers.
// Returns an array of { question, answer } objects.
async function runAiInterview(firstQuestion) {
  const transcript = [];
  const messages = [
    { role: "user", content: "Begin the interview. Ask your first question." },
    // Pretend the judge already asked this question — keeps the conversation
    // history consistent so follow-ups make sense.
    { role: "assistant", content: firstQuestion },
  ];

  for (let i = 0; i < 3; i++) {
    // First round reuses the human's opening question; subsequent rounds are adaptive.
    const question = i === 0
      ? firstQuestion
      : await chat("judge", interviewPrompt, messages);

    if (i > 0) {
      messages.push({ role: "assistant", content: question });
    }

    // AI respondent answers the question
    const answer = await chat("respondent", respondentPrompt, [
      { role: "user", content: question },
    ]);

    transcript.push({ question, answer });

    // Feed the answer back to the judge (unless it's the last round)
    if (i < 2) {
      messages.push({
        role: "user",
        content: `Respondent's answer: ${answer}\n\nAsk your next question.`,
      });
    }
  }

  return transcript;
}

// Format a transcript for the verdict prompt.
function formatTranscript(label, transcript) {
  return transcript.map((round, i) =>
    `Q${i + 1}: ${round.question}\n${label}: ${round.answer}`
  ).join("\n\n");
}

// --- API Routes ---

// Start a new game. The judge generates the first question for the human.
app.post("/api/start", async (_req, res) => {
  try {
    const messages = [
      { role: "user", content: buildOpeningMessage() },
    ];

    const question = await chat("judge", interviewPrompt, messages);
    recordFirstQuestion(question);

    res.json({ question, round: 1 });
  } catch (err) {
    res.status(500).json({ error: "Failed to start game. Check your LLM configuration." });
  }
});

// Submit an answer for the current round.
// The client sends: { humanAnswer, round, history }
// `history` is the human's interview so far: [{ question, answer }, ..., { question }]
app.post("/api/answer", async (req, res) => {
  try {
    const { humanAnswer, round, history } = req.body;

    // Complete the current round by adding the human's answer.
    const currentRound = history[history.length - 1];
    currentRound.answer = humanAnswer;

    // `history` is now the full human transcript up to this round.
    const humanTranscript = history;

    if (round >= 3) {
      // --- Final round: run the AI interview, then get the verdict ---

      // Run a full 3-round interview with the AI respondent.
      // Both interviews start with the same opening question for a fair comparison.
      const firstQuestion = humanTranscript[0].question;
      const aiTranscript = await runAiInterview(firstQuestion);

      // Randomly assign "A" or "B" labels so the judge can't assume
      // the first interview is always the human.
      const humanIsA = Math.random() < 0.5;
      const humanLabel = humanIsA ? "A" : "B";
      const aiLabel = humanIsA ? "B" : "A";

      const transcriptA = humanIsA ? humanTranscript : aiTranscript;
      const transcriptB = humanIsA ? aiTranscript : humanTranscript;

      // Ask the judge to compare both transcripts and deliver a verdict.
      const verdictMessages = [
        {
          role: "user",
          content: [
            "Here are the transcripts from both interviews:\n",
            `--- Respondent A ---\n${formatTranscript("A", transcriptA)}`,
            `\n\n--- Respondent B ---\n${formatTranscript("B", transcriptB)}`,
            "\n\nDeliver your verdict as JSON.",
          ].join(""),
        },
      ];

      const verdictRaw = await chat("judge", verdictPrompt, verdictMessages);

      // Parse the JSON verdict. Strip markdown code fences if the model wraps it.
      let verdict;
      try {
        const cleaned = verdictRaw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
        verdict = JSON.parse(cleaned);
      } catch (parseErr) {
        // Verdict JSON failed to parse — fall back to a generic verdict.
        verdict = {
          humanIs: humanLabel,
          analysisA: verdictRaw,
          analysisB: "",
          summary: "",
        };
      }

      res.json({
        verdict,
        humanTranscript,
        aiTranscript,
        humanLabel,
      });
    } else {
      // --- Not the last round: ask the judge for the next question ---

      const judgeMessages = buildInterviewMessages(humanTranscript);
      // The last answer was already added, so prompt for the next question.
      // The buildInterviewMessages function already added "Ask your next question."
      // after the last answer.

      const nextQuestion = await chat("judge", interviewPrompt, judgeMessages);

      res.json({
        question: nextQuestion,
        round: round + 1,
        history: humanTranscript,
      });
    }
  } catch (err) {
    res.status(500).json({ error: "Something went wrong. Try again." });
  }
});

// `app.listen` starts the HTTP server — like `HttpServer::new(...).bind(...).run()` in Actix.
app.listen(PORT, () => {
  console.log(`Reverse Turing Test running at http://localhost:${PORT}`);
  console.log(`Judge: ${process.env.JUDGE_PROVIDER || "openai"} / ${process.env.JUDGE_MODEL || "gpt-4o-mini"}`);
  console.log(`Respondent: ${process.env.RESPONDENT_PROVIDER || "openai"} / ${process.env.RESPONDENT_MODEL || "gpt-4o-mini"}`);
});
