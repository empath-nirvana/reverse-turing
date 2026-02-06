# Reverse Turing Test

A web app where humans try to convince an AI judge that they are also an AI.

## Concept

The classic Turing test, flipped. An LLM judge asks questions to two respondents — one human, one LLM. The judge tries to identify the human. The human's goal is to pass as a machine. The point is provocative: if you can't convince an AI you're intelligent, what does that say about intelligence tests?

## Architecture

Single-page app with a Node/Express backend.

- `server.js` — Express server, serves static files and proxies LLM calls
- `public/` — Frontend (index.html, style.css, app.js)
- `llm.js` — LLM abstraction layer (mock, ollama, or cloud API)
- `prompts.js` — System prompts for the judge and the respondent LLM

## LLM Provider

The LLM layer is swappable via `LLM_PROVIDER` env var:
- `mock` — Canned responses for UI development (default)
- `ollama` — Local model via Ollama
- `api` — Cloud API (for production/Vercel deployment)

## Game Flow

1. Landing page → "Play" button
2. Judge asks 3 questions, one at a time
3. Human answers each question; respondent LLM answers the same question behind the scenes
4. After 3 rounds, judge sees all Q&A pairs and delivers a verdict with reasoning
5. Verdict screen shows the result + a provocative closing question
6. Share button

## Design Principles

- The whole experience should take under 2 minutes
- Human never sees the other LLM's answers
- The verdict reasoning is the product — it should be thought-provoking
- No accounts, no auth, no database for v1
- Conversation state lives client-side, passed to server with each request

## Tech Stack

- Node.js + Express
- Vanilla HTML/CSS/JS (no framework)
- Deployment target: Vercel

## Code Style

The primary developer is experienced with Rust, Ruby, and Python but not JS/TS. Add comments to explain JS idioms, patterns, or anything that wouldn't be obvious to someone coming from those languages. No need to explain basic programming concepts — just JS-specific stuff.

## Dev

```bash
npm install
npm run dev    # starts server with nodemon
npm start      # starts server
```

Set `LLM_PROVIDER=mock` (default) for development without a model.
