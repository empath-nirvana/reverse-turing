const express = require("express");
const path = require("path");
const { chat } = require("./llm");
const { judgePrompt, respondentPrompt } = require("./prompts");

const app = express();
const PORT = process.env.PORT || 3000;

// express.json() is middleware that parses JSON request bodies —
// like a Rack middleware in Ruby or an Actix extractor in Rust.
app.use(express.json());

// Serve static files (index.html, style.css, app.js) from the public/ directory.
app.use(express.static(path.join(__dirname, "public")));

// --- Helpers ---

// Build the judge's conversation history from the game history array.
// The judge sees its own questions as "assistant" messages, and the paired
// A/B answers as "user" messages — this mirrors a back-and-forth conversation.
function buildJudgeMessages(history) {
  const messages = [
    { role: "user", content: "Begin the reverse Turing test. Ask your first question." },
  ];

  for (const round of history) {
    // The judge's own question, recalled as an assistant turn.
    messages.push({ role: "assistant", content: round.question });
    // Both respondents' answers, shown to the judge as a user turn.
    messages.push({
      role: "user",
      content: `Respondent A: ${round.answerA}\n\nRespondent B: ${round.answerB}`,
    });
  }

  return messages;
}

// --- API Routes ---

// Start a new game. The judge generates the first question.
app.post("/api/start", async (_req, res) => {
  try {
    const messages = [
      { role: "user", content: "Begin the reverse Turing test. Ask your first question." },
    ];

    const question = await chat(judgePrompt, messages);

    // Randomly assign the human to be "A" or "B" — the human never sees this,
    // but the server needs it to know which slot the human's answers go in.
    const humanSlot = Math.random() < 0.5 ? "A" : "B";

    res.json({ question, humanSlot, round: 1 });
  } catch (err) {
    console.error("Error in /api/start:", err);
    res.status(500).json({ error: "Failed to start game. Check your LLM configuration." });
  }
});

// Submit an answer for the current round.
// The client sends: { humanAnswer, humanSlot, round, history }
app.post("/api/answer", async (req, res) => {
  try {
    const { humanAnswer, humanSlot, round, history } = req.body;
    const aiSlot = humanSlot === "A" ? "B" : "A";

    // Get the current question from the last history entry (client sends it with just the question).
    const currentQuestion = history[history.length - 1]?.question || "";

    // Ask the respondent LLM the same question the judge asked.
    const respondentAnswer = await chat(respondentPrompt, [
      { role: "user", content: currentQuestion },
    ]);

    // Slot the human and respondent answers into A/B based on the random assignment.
    const roundResult = {
      question: currentQuestion,
      [`answer${humanSlot}`]: humanAnswer,
      [`answer${aiSlot}`]: respondentAnswer,
    };

    // Replace the incomplete last entry (question-only) with the full round result.
    // `slice(0, -1)` returns all elements except the last — like [0..-2] in Ruby.
    const updatedHistory = [...history.slice(0, -1), roundResult];

    if (round >= 3) {
      // Final round — ask the judge for its verdict.
      const judgeMessages = buildJudgeMessages(updatedHistory);
      judgeMessages.push({
        role: "user",
        content: "All 3 rounds are complete. Deliver your verdict now as JSON.",
      });

      const verdictRaw = await chat(judgePrompt, judgeMessages);

      // Parse the JSON verdict from the judge's response.
      // The judge might wrap it in markdown code fences, so strip those first.
      let verdict;
      try {
        const cleaned = verdictRaw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
        verdict = JSON.parse(cleaned);
      } catch (parseErr) {
        console.error("Failed to parse verdict JSON:", verdictRaw);
        // Fallback: construct a verdict from the raw text.
        verdict = {
          humanIs: humanSlot, // Default to "judge got it right" if we can't parse
          reasoning: verdictRaw,
        };
      }

      res.json({ verdict, history: updatedHistory });
    } else {
      // Not the last round — ask the judge for the next question.
      const judgeMessages = buildJudgeMessages(updatedHistory);
      judgeMessages.push({
        role: "user",
        content: "Ask your next question.",
      });

      const nextQuestion = await chat(judgePrompt, judgeMessages);

      res.json({
        question: nextQuestion,
        round: round + 1,
        history: updatedHistory,
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
  console.log(`LLM provider: ${process.env.LLM_PROVIDER || "mock"}`);
});
