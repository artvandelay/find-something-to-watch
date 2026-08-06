import assert from "node:assert/strict";
import {
  CONVERSATION_TITLE_MODEL,
  MAX_CONVERSATION_TITLE_WORDS,
  generateConversationTitle,
  sanitizeConversationTitle
} from "../docs/js/conversation-title.js";

assert.equal(CONVERSATION_TITLE_MODEL, "openai/gpt-5-nano");
assert.equal(sanitizeConversationTitle("  Title: A funny, short show for tonight  "), "A funny, short show for tonight");
assert.equal(
  sanitizeConversationTitle("One two three four five six seven eight nine").split(/\s+/).length,
  MAX_CONVERSATION_TITLE_WORDS
);

let request = null;
const title = await generateConversationTitle(
  { baseUrl: "https://openrouter.ai/api/v1", apiKey: "test-key", model: "openai/gpt-5.6-terra-pro" },
  "I want a funny show under thirty minutes",
  {
    fetchImpl: async (_url, init) => {
      request = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "Short Funny Shows Tonight" } }] })
      };
    }
  }
);
assert.equal(title, "Short Funny Shows Tonight");
assert.equal(request.model, CONVERSATION_TITLE_MODEL);
assert.equal(request.stream, false);
assert.equal(request.messages[1].content, "I want a funny show under thirty minutes");

console.log("check_conversation_title OK");
