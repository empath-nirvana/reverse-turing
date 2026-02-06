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
// Returns an array of { question, answer } objects.
async function runAiInterview() {
  const transcript = [];
  const messages = [
    { role: "user", content: "Begin the interview. Ask your first question." },
  ];

  for (let i = 0; i < 3; i++) {
    // Judge generates a question
    const question = await chat("judge", interviewPrompt, messages);
    messages.push({ role: "assistant", content: question });

    // AI respondent answers it
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
      { role: "user", content: "Begin the interview. Ask your first question." },
    ];

    const question = await chat("judge", interviewPrompt, messages);

    res.json({ question, round: 1 });
  } catch (err) {
    console.error("Error in /api/start:", err);
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
      const aiTranscript = await runAiInterview();

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
        console.error("Failed to parse verdict JSON:", verdictRaw);
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
    console.error("Error in /api/answer:", err);
    res.status(500).json({ error: "Something went wrong. Try again." });
  }
});

// `app.listen` starts the HTTP server — like `HttpServer::new(...).bind(...).run()` in Actix.
app.listen(PORT, () => {
  console.log(`Reverse Turing Test running at http://localhost:${PORT}`);
  console.log(`Judge: ${process.env.JUDGE_PROVIDER || "openai"} / ${process.env.JUDGE_MODEL || "gpt-4o-mini"}`);
  console.log(`Respondent: ${process.env.RESPONDENT_PROVIDER || "openai"} / ${process.env.RESPONDENT_MODEL || "gpt-4o-mini"}`);
});
