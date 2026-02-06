// LLM abstraction layer.
// Swap providers by setting LLM_PROVIDER env var: "mock" or "openai".

// process.env reads environment variables — like std::env::var in Rust or os.environ in Python.
// The `||` here acts as a default value (falsy coalescing).
const provider = process.env.LLM_PROVIDER || "mock";
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Each provider implements the same interface:
//   chat(systemPrompt, messages) -> string
//
// `messages` is an array of { role: "user"|"assistant", content: "..." } objects,
// which is the standard chat format most LLM APIs expect.

const providers = {
  mock: {
    async chat(_systemPrompt, _messages) {
      return "This is a mock LLM response.";
    },
  },

  openai: {
    // Lazy-initialized client. We don't create it at module load time because
    // the env var might not be set yet (e.g., in mock mode).
    _client: null,
    _getClient() {
      if (!this._client) {
        // `require` inside a function is called "lazy require" — it defers loading
        // the module until it's actually needed. Useful when you don't want to pay
        // the import cost (or crash on missing deps) unless the code path is hit.
        const OpenAI = require("openai");
        this._client = new OpenAI(); // Reads OPENAI_API_KEY from env automatically
      }
      return this._client;
    },

    async chat(systemPrompt, messages) {
      const client = this._getClient();

      // The SDK mirrors the REST API: you pass a model name and a messages array.
      // The system message sets the LLM's persona/instructions.
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          // `...messages` spreads the array elements in — like *list in Python.
          ...messages,
        ],
        temperature: 0.7,
      });

      // OpenAI returns an array of "choices" — we always just want the first one.
      return response.choices[0].message.content;
    },
  },
};

// `async function` is like `async fn` in Rust — returns a Promise (similar to a Future).
async function chat(systemPrompt, messages) {
  const impl = providers[provider];
  if (!impl) {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }
  return impl.chat(systemPrompt, messages);
}

module.exports = { chat };
