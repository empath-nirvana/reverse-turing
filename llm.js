// LLM abstraction layer.
//
// Two roles — judge and respondent — can each use a different provider/model/temperature.
// Configure via env vars:
//   JUDGE_PROVIDER   / JUDGE_MODEL   / JUDGE_TEMPERATURE
//   RESPONDENT_PROVIDER / RESPONDENT_MODEL / RESPONDENT_TEMPERATURE
//
// Supported providers: "mock", "openai", "anthropic"

// --- Provider config ---
// `parseFloat` converts a string env var to a number. `||` provides the default
// if the env var is unset or parses to NaN (which is falsy in JS).
const config = {
  judge: {
    provider: process.env.JUDGE_PROVIDER || "openai",
    model: process.env.JUDGE_MODEL || "gpt-4o-mini",
    temperature: parseFloat(process.env.JUDGE_TEMPERATURE) || 0.7,
  },
  respondent: {
    provider: process.env.RESPONDENT_PROVIDER || "openai",
    model: process.env.RESPONDENT_MODEL || "gpt-4o-mini",
    temperature: parseFloat(process.env.RESPONDENT_TEMPERATURE) || 0.7,
  },
};

// --- Provider implementations ---
// Each implements: chat(model, systemPrompt, messages, temperature) -> string

const providers = {
  mock: {
    async chat(_model, _systemPrompt, _messages, _temperature) {
      return "This is a mock LLM response.";
    },
  },

  openai: {
    _client: null,
    _getClient() {
      if (!this._client) {
        const OpenAI = require("openai");
        this._client = new OpenAI();
      }
      return this._client;
    },

    async chat(model, systemPrompt, messages, temperature) {
      const client = this._getClient();

      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        temperature,
      });

      return response.choices[0].message.content;
    },
  },

  anthropic: {
    _client: null,
    _getClient() {
      if (!this._client) {
        const Anthropic = require("@anthropic-ai/sdk");
        this._client = new Anthropic();
      }
      return this._client;
    },

    async chat(model, systemPrompt, messages, temperature) {
      const client = this._getClient();

      const response = await client.messages.create({
        model,
        system: systemPrompt,
        messages,
        max_tokens: 1024,
        temperature: Math.min(temperature, 1.0), // Anthropic caps temperature at 1.0
      });

      return response.content[0].text;
    },
  },
};

// --- Public API ---
// `role` is "judge" or "respondent" — determines which provider/model/temperature to use.

async function chat(role, systemPrompt, messages) {
  const { provider, model, temperature } = config[role];
  if (!provider) {
    throw new Error(`Unknown role: ${role}`);
  }
  const impl = providers[provider];
  if (!impl) {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }
  return impl.chat(model, systemPrompt, messages, temperature);
}

module.exports = { chat };
