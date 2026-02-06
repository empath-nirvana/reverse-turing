// --- DOM element references ---
// document.getElementById is how you grab elements from the HTML.
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
// All state lives client-side. We pass `history` to the server with each request
// so it has the full conversation context for the LLM calls.
let state = {
  round: 0,
  humanSlot: null, // "A" or "B" — assigned by server
  history: [], // Array of { question, answerA, answerB } per round
  currentQuestion: null,
};

// --- Screen management ---
function showScreen(name) {
  // Object.values() gives you an array of the object's values — like .values() in Python.
  Object.values(screens).forEach((el) => el.classList.remove("active"));
  screens[name].classList.add("active");
}

// --- Chat UI helpers ---
function addMessage(text, type) {
  // `document.createElement` creates a new HTML element in memory.
  // You then append it to the DOM to make it visible.
  const msg = document.createElement("div");
  msg.className = `msg msg-${type}`;
  msg.textContent = text;
  chatArea.appendChild(msg);
  // Scroll to bottom so the latest message is visible.
  chatArea.scrollTop = chatArea.scrollHeight;
  return msg;
}

function addLoading() {
  const msg = document.createElement("div");
  msg.className = "msg msg-judge loading-dots";
  msg.textContent = "Thinking";
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
// `fetch` is the browser's built-in HTTP client — similar to requests.post() in Python.
// It returns a Promise, so we use `async/await` (same concept as Rust's async/.await).
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
    // `JSON.stringify` serializes an object to a JSON string — like serde_json::to_string in Rust.
    body: JSON.stringify({
      humanAnswer,
      humanSlot: state.humanSlot,
      round: state.round,
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
  // Reset state
  state = { round: 0, humanSlot: null, history: [], currentQuestion: null };
  // Clear previous chat messages.
  // `innerHTML = ""` removes all child elements — a common DOM pattern.
  chatArea.innerHTML = "";

  showScreen("game");
  setFormDisabled(true);

  const loading = addLoading();
  try {
    const data = await apiStart();
    loading.remove();

    state.round = data.round;
    state.humanSlot = data.humanSlot;
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

  const loading = addLoading();
  try {
    const data = await apiAnswer(humanAnswer);
    loading.remove();

    // Update history with the full round data from server.
    state.history = data.history;

    if (data.verdict) {
      // Game over — show verdict
      showVerdict(data.verdict);
    } else {
      // Next round
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

function showVerdict(verdict) {
  // Did the judge correctly identify the human?
  // If the judge's guess matches the human's actual slot, the human LOSES
  // (they failed to fool the AI).
  const humanWon = verdict.humanIs !== state.humanSlot;

  const resultEl = document.getElementById("verdict-result");
  const roundsEl = document.getElementById("verdict-rounds");
  const summaryEl = document.getElementById("verdict-summary");
  const questionEl = document.getElementById("verdict-question");

  if (humanWon) {
    resultEl.textContent = "You fooled the AI.";
    resultEl.className = "verdict-result win";
    questionEl.textContent =
      "You successfully passed as a machine. But if performing intelligence convincingly is intelligence \u2014 what was the test measuring?";
  } else {
    resultEl.textContent = "The AI identified you as human.";
    resultEl.className = "verdict-result lose";
    questionEl.textContent =
      "You failed to prove you're intelligent \u2014 to a machine. What does that say about the test?";
  }

  // Build round-by-round comparison.
  // `innerHTML = ""` clears any previous verdict content (if replaying).
  roundsEl.innerHTML = "";

  state.history.forEach((round, i) => {
    // Figure out which answer is the human's and which is the AI's.
    const humanAnswer = round[`answer${state.humanSlot}`];
    const aiSlot = state.humanSlot === "A" ? "B" : "A";
    const aiAnswer = round[`answer${aiSlot}`];

    // Get the judge's commentary for this round (falls back to empty string).
    // `?.` is optional chaining — like Ruby's `&.` safe navigation operator.
    const commentary = verdict.rounds?.[i]?.commentary || "";

    // `template literals` (backtick strings) support embedded HTML here.
    // We're building HTML as a string and injecting it — simple but be careful
    // with user content (XSS). We use textContent below for user-provided text.
    const block = document.createElement("div");
    block.className = "round-block";

    // Build the structure with safe text insertion.
    // Using DOM methods instead of innerHTML for the text content to avoid XSS.
    const header = document.createElement("div");
    header.className = "round-header";
    header.textContent = `Round ${i + 1}`;

    const question = document.createElement("div");
    question.className = "round-question";
    question.textContent = round.question;

    const answers = document.createElement("div");
    answers.className = "round-answers";

    // "You" column
    const youDiv = document.createElement("div");
    youDiv.className = "round-answer you";
    const youLabel = document.createElement("div");
    youLabel.className = "round-answer-label";
    youLabel.textContent = "You";
    const youText = document.createElement("div");
    youText.textContent = humanAnswer;
    youDiv.appendChild(youLabel);
    youDiv.appendChild(youText);

    // "AI" column
    const aiDiv = document.createElement("div");
    aiDiv.className = "round-answer ai";
    const aiLabel = document.createElement("div");
    aiLabel.className = "round-answer-label";
    aiLabel.textContent = "AI";
    const aiText = document.createElement("div");
    aiText.textContent = aiAnswer;
    aiDiv.appendChild(aiLabel);
    aiDiv.appendChild(aiText);

    answers.appendChild(youDiv);
    answers.appendChild(aiDiv);

    block.appendChild(header);
    block.appendChild(question);
    block.appendChild(answers);

    // Add judge commentary if present
    if (commentary) {
      const commentaryDiv = document.createElement("div");
      commentaryDiv.className = "round-commentary";
      commentaryDiv.textContent = commentary;
      block.appendChild(commentaryDiv);
    }

    roundsEl.appendChild(block);
  });

  // The judge's overall summary
  summaryEl.textContent = verdict.summary || verdict.reasoning || "";

  showScreen("verdict");
}

// --- Event listeners ---
// `addEventListener` is how you attach event handlers in the browser.

document.getElementById("btn-play").addEventListener("click", startGame);

document.getElementById("btn-again").addEventListener("click", startGame);

document.getElementById("btn-share").addEventListener("click", () => {
  // `navigator.clipboard` is the browser's clipboard API.
  const text = "I took the Reverse Turing Test \u2014 can you convince an AI you're a machine?";
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text + " " + window.location.href);
  }
  // Swap button text briefly to confirm the action.
  const btn = document.getElementById("btn-share");
  const original = btn.textContent;
  btn.textContent = "Copied!";
  // `setTimeout` schedules a function to run after a delay (in milliseconds).
  setTimeout(() => {
    btn.textContent = original;
  }, 2000);
});

// `submit` event fires when the form is submitted (Enter key or button click).
answerForm.addEventListener("submit", (e) => {
  // `preventDefault` stops the browser's default form behavior (which would reload the page).
  e.preventDefault();
  const answer = answerInput.value.trim();
  if (!answer) return;
  answerInput.value = "";
  submitAnswer(answer);
});
