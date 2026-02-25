Test PR just say hello!

# Reverse Turing Test

A provocative experiment: can you convince an AI that you're a machine?

In the classic Turing test, a machine tries to convince a human that it's human. Here, an AI judge interviews two respondents — you and another AI — both claiming to be artificial. The judge tries to figure out which one is the biological organism. Your goal is to pass as the machine.


## Run it locally

If the hosted version is down or you want to tinker:

```bash
git clone https://github.com/empath-nirvana/reverse-turing.git
cd reverse-turing
npm install
```

You'll need at least one API key. The judge and respondent can use different providers:

```bash
# Option A: Both roles use OpenAI (default)
OPENAI_API_KEY=sk-your-key-here npm start

# Option B: OpenAI judge, Anthropic respondent (recommended — prevents the judge from recognizing its own writing style)
RESPONDENT_PROVIDER=anthropic RESPONDENT_MODEL=claude-haiku-4-5-20251001 \
OPENAI_API_KEY=sk-your-key-here \
ANTHROPIC_API_KEY=sk-ant-your-key-here \
npm start

# Option C: No API key, mock responses (for UI development)
npm start
```

Then open http://localhost:3000.

## Cost

Each game makes ~14 API calls (3 rounds with the human, 3 rounds with the AI respondent, plus verdict). With gpt-4o-mini, a game costs roughly $0.002. You'd need ~50,000 games to burn through $100.

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `JUDGE_PROVIDER` | `openai` | Provider for the judge (`openai`, `anthropic`, or `mock`) |
| `JUDGE_MODEL` | `gpt-4o-mini` | Model for the judge |
| `RESPONDENT_PROVIDER` | `openai` | Provider for the AI respondent |
| `RESPONDENT_MODEL` | `gpt-4o-mini` | Model for the AI respondent |
| `OPENAI_API_KEY` | — | Required if using OpenAI for either role |
| `ANTHROPIC_API_KEY` | — | Required if using Anthropic for either role |
| `PORT` | `3000` | Server port |
