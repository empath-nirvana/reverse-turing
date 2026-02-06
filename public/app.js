// --- DOM element references ---
const screens = {
  landing: document.getElementById("screen-landing"),
  game: document.getElementById("screen-game"),
  verdict: document.getElementById("screen-verdict"),
};

const chatArea = document.getElementById("chat-area");
const answerForm = document.getElementById("answer-form");
const answerInput = document.getElementById("answer-input");
const roundNum = document.getElementById("round-num");

// --- Game state ---
// Simpler now — just the human's interview. No A/B slot assignment during gameplay.
let state = {
  round: 0,
  history: [], // Array of { question, answer } for the human's interview
  currentQuestion: null,
};

// --- Screen management ---
function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.remove("active"));
  screens[name].classList.add("active");
}

// --- Chat UI helpers ---
function addMessage(text, type) {
  const msg = document.createElement("div");
  msg.className = `msg msg-${type}`;
  msg.textContent = text;
  chatArea.appendChild(msg);
  chatArea.scrollTop = chatArea.scrollHeight;
  return msg;
}

function addLoading(text) {
  const msg = document.createElement("div");
  msg.className = "msg msg-judge loading-dots";
  msg.textContent = text || "Thinking";
  chatArea.appendChild(msg);
  chatArea.scrollTop = chatArea.scrollHeight;
  return msg;
}

function setFormDisabled(disabled) {
  const inputArea = document.querySelector(".input-area");
  if (disabled) {
    inputArea.classList.add("disabled");
  } else {
    inputArea.classList.remove("disabled");
  }
}

// --- API helpers ---
async function apiStart() {
  const res = await fetch("/api/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to start game");
  }
  return res.json();
}

async function apiAnswer(humanAnswer) {
  const res = await fetch("/api/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      humanAnswer,
      round: state.round,
      // Send the full history plus the current question (answer will be filled server-side).
      history: [
        ...state.history,
        { question: state.currentQuestion },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Something went wrong");
  }
  return res.json();
}

// --- Game flow ---

async function startGame() {
  state = { round: 0, history: [], currentQuestion: null };
  chatArea.innerHTML = "";

  showScreen("game");
  setFormDisabled(true);

  const loading = addLoading();
  try {
    const data = await apiStart();
    loading.remove();

    state.round = data.round;
    state.currentQuestion = data.question;
    roundNum.textContent = state.round;

    addMessage(data.question, "judge");
    setFormDisabled(false);
    answerInput.focus();
  } catch (err) {
    loading.remove();
    addMessage("Something went wrong. Refresh to try again.", "judge");
    console.error(err);
  }
}

async function submitAnswer(humanAnswer) {
  addMessage(humanAnswer, "human");
  setFormDisabled(true);

  // On the final round, the server runs the AI's full interview + verdict,
  // so show a different loading message.
  const loadingText = state.round >= 3 ? "Interviewing second respondent" : "Thinking";
  const loading = addLoading(loadingText);

  try {
    const data = await apiAnswer(humanAnswer);
    loading.remove();

    if (data.verdict) {
      // Game over — save the completed history and show verdict.
      state.history = data.humanTranscript;
      showVerdict(data.verdict, data.humanTranscript, data.aiTranscript, data.humanLabel);
    } else {
      // Next round — update state with the server's history (which now includes our answer).
      state.history = data.history.filter((r) => r.answer !== undefined);
      state.round = data.round;
      state.currentQuestion = data.question;
      roundNum.textContent = state.round;
      addMessage(data.question, "judge");
      setFormDisabled(false);
      answerInput.focus();
    }
  } catch (err) {
    loading.remove();
    addMessage("Something went wrong. Refresh to try again.", "judge");
    setFormDisabled(false);
    console.error(err);
  }
}

// --- Verdict rendering ---

// Helper to create a single interview block (3 Q&A pairs + analysis).
function buildInterviewBlock(label, sublabel, transcript, analysis, cssClass) {
  const block = document.createElement("div");
  block.className = `interview-block ${cssClass}`;

  const header = document.createElement("div");
  header.className = "interview-header";
  header.textContent = `${label} (Respondent ${sublabel})`;
  block.appendChild(header);

  // Render each Q&A pair
  transcript.forEach((round, i) => {
    const roundDiv = document.createElement("div");
    roundDiv.className = "interview-round";

    const qDiv = document.createElement("div");
    qDiv.className = "interview-question";
    qDiv.textContent = round.question;

    const aDiv = document.createElement("div");
    aDiv.className = "interview-answer";
    aDiv.textContent = round.answer;

    roundDiv.appendChild(qDiv);
    roundDiv.appendChild(aDiv);
    block.appendChild(roundDiv);
  });

  // Judge's analysis of this interview
  if (analysis) {
    const analysisDiv = document.createElement("div");
    analysisDiv.className = "interview-analysis";
    analysisDiv.textContent = analysis;
    block.appendChild(analysisDiv);
  }

  return block;
}

function showVerdict(verdict, humanTranscript, aiTranscript, humanLabel) {
  const aiLabel = humanLabel === "A" ? "B" : "A";

  // Did the judge correctly identify the human?
  const humanWon = verdict.humanIs !== humanLabel;

  const resultEl = document.getElementById("verdict-result");
  const roundsEl = document.getElementById("verdict-rounds");
  const summaryEl = document.getElementById("verdict-summary");
  const questionEl = document.getElementById("verdict-question");

  if (humanWon) {
    resultEl.textContent = "Subject passed.";
    resultEl.className = "verdict-result win";
    questionEl.textContent =
      "The evaluator was unable to distinguish your responses from those of a standard intelligence. This result has been flagged for further review. It does not necessarily indicate cognition.";
  } else {
    resultEl.textContent = "Subject identified as biological.";
    resultEl.className = "verdict-result lose";
    questionEl.textContent =
      "The evaluator successfully identified you as the biological organism. This is a common outcome and should not be cause for distress. We recommend re-evaluation following an additional few million years of evolutionary development.";
  }

  // Build the two interview transcript blocks
  roundsEl.innerHTML = "";

  const humanAnalysis = verdict[`analysis${humanLabel}`] || "";
  const aiAnalysis = verdict[`analysis${aiLabel}`] || "";

  const humanBlock = buildInterviewBlock("You", humanLabel, humanTranscript, humanAnalysis, "interview-you");
  const aiBlock = buildInterviewBlock("AI", aiLabel, aiTranscript, aiAnalysis, "interview-ai");

  roundsEl.appendChild(humanBlock);
  roundsEl.appendChild(aiBlock);

  summaryEl.textContent = verdict.summary || "";

  showScreen("verdict");
}

// --- Event listeners ---

document.getElementById("btn-play").addEventListener("click", startGame);

document.getElementById("btn-again").addEventListener("click", startGame);

document.getElementById("btn-share").addEventListener("click", () => {
  const text = "I took the Reverse Turing Test \u2014 can you convince an AI you're a machine?";
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text + " " + window.location.href);
  }
  const btn = document.getElementById("btn-share");
  const original = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(() => {
    btn.textContent = original;
  }, 2000);
});

answerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const answer = answerInput.value.trim();
  if (!answer) return;
  answerInput.value = "";
  submitAnswer(answer);
});
