// LLM abstraction layer.
//
// Two roles — judge and respondent — can each use a different provider/model.
// Configure via env vars:
//   JUDGE_PROVIDER   / JUDGE_MODEL    (defaults: openai / gpt-4o-mini)
//   RESPONDENT_PROVIDER / RESPONDENT_MODEL (defaults: anthropic / claude-haiku-4-5-20251001)
//
// Supported providers: "mock", "openai", "anthropic"

// --- Provider config ---
// Each role reads its own pair of env vars, with sensible defaults.
const config = {
  judge: {
    provider: process.env.JUDGE_PROVIDER || "openai",
    model: process.env.JUDGE_MODEL || "gpt-4o-mini",
  },
  respondent: {
    provider: process.env.RESPONDENT_PROVIDER || "openai",
    model: process.env.RESPONDENT_MODEL || "gpt-4o-mini",
  },
};

// --- Provider implementations ---
// Each implements: chat(model, systemPrompt, messages) -> string

const providers = {
  mock: {
    async chat(_model, _systemPrompt, _messages) {
      return "This is a mock LLM response.";
    },
  },

  openai: {
    _client: null,
    _getClient() {
      if (!this._client) {
        const OpenAI = require("openai");
        this._client = new OpenAI(); // Reads OPENAI_API_KEY from env automatically
      }
      return this._client;
    },

    async chat(model, systemPrompt, messages) {
      const client = this._getClient();

      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        temperature: 0.7,
      });

      return response.choices[0].message.content;
    },
  },

  anthropic: {
    _client: null,
    _getClient() {
      if (!this._client) {
        // The Anthropic SDK uses `default` export, so we need `.default || module`
        // to handle both CommonJS and ESM interop. This is a JS module system quirk.
        const Anthropic = require("@anthropic-ai/sdk");
        this._client = new Anthropic(); // Reads ANTHROPIC_API_KEY from env automatically
      }
      return this._client;
    },

    async chat(model, systemPrompt, messages) {
      const client = this._getClient();

      // Anthropic's API is slightly different from OpenAI's:
      // - `system` is a top-level parameter, not a message in the array
      // - `max_tokens` is required (OpenAI defaults it)
      const response = await client.messages.create({
        model,
        system: systemPrompt,
        messages,
        max_tokens: 1024,
        temperature: 0.7,
      });

      // Anthropic returns content as an array of blocks — we want the first text block.
      return response.content[0].text;
    },
  },
};

// --- Public API ---
// `role` is "judge" or "respondent" — determines which provider/model to use.

async function chat(role, systemPrompt, messages) {
  const { provider, model } = config[role];
  if (!provider) {
    throw new Error(`Unknown role: ${role}`);
  }
  const impl = providers[provider];
  if (!impl) {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }
  return impl.chat(model, systemPrompt, messages);
}

module.exports = { chat };
