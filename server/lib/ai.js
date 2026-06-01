const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

async function askAI(prompt) {
  switch (provider) {
    case 'claude':  return askClaude(prompt);
    case 'codex':   return askCodex(prompt);
    default:        return askGemini(prompt);
  }
}

async function askGemini(prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  const data = await res.json();
  console.log('[askGemini] raw response:', JSON.stringify(data));
  if (data.error) throw new Error('Gemini API error: ' + data.error.message);
  if (!data.candidates || !data.candidates[0]) throw new Error('Gemini response: ' + JSON.stringify(data));
  return data.candidates[0].content.parts[0].text.trim();
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
      max_tokens: 2000,
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

async function askClaudeVision(base64data, caption) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64data } },
          { type: 'text', text: caption || 'What do you see in this image? How can I help?' },
        ],
      }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error('Claude vision error: ' + data.error.message);
  return data.content[0].text.trim();
}

async function askClaudePdf(base64data, caption) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64data } },
          { type: 'text', text: caption || 'Please read this document and summarize it. How can I help?' },
        ],
      }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error('Claude PDF error: ' + data.error.message);
  return data.content[0].text.trim();
}

module.exports = { askAI, askClaudeVision, askClaudePdf };
