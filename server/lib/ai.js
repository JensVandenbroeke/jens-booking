const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

async function askAI(prompt) {
  switch (provider) {
    case 'claude':  return askClaude(prompt);
    case 'codex':   return askCodex(prompt);
    default:        return askGemini(prompt);
  }
}

async function askGemini(prompt) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

async function askClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content[0].text.trim();
}

async function askCodex(prompt) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'codex-mini-latest',
      input: prompt,
    }),
  });
  const data = await res.json();
  return data.output[0].content[0].text.trim();
}

module.exports = { askAI };
