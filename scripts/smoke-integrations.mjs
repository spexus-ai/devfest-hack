import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const run = promisify(execFile);
const fixture = fileURLToPath(new URL('../test/fixtures/receipt-smoke.png', import.meta.url));
const base = process.env.MAILPIT_BASE_URL ?? 'http://127.0.0.1:8025';
const sha = (data) => createHash('sha256').update(data).digest('hex');

async function request(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

async function model(url, key, body) {
  return (await request(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })).json();
}

const probes = [
  ['Tesseract', null, async () => {
    const { stdout } = await run('tesseract', [fixture, 'stdout', '-l', 'eng', '--psm', '6'], { timeout: 15000 });
    assert.match(stdout, /PASTA/i);
    assert.match(stdout, /40[.,]00/);
  }],
  ['Qwen', 'OPENROUTER_API_KEY', async (key) => {
    const data = await model('https://openrouter.ai/api/v1/chat/completions', key, {
      model: process.env.OPENROUTER_MODEL ?? 'qwen/qwen3.5-flash-02-23',
      provider: { require_parameters: true },
      max_tokens: 512,
      reasoning: { enabled: false },
      messages: [
        { role: 'system', content: 'Return only JSON with one field named item. Preserve capitalization.' },
        { role: 'user', content: 'Extract the item from PASTA 32.00. Return a JSON object like {"item":"PASTA"}.' },
      ],
      response_format: { type: 'json_schema', json_schema: {
        name: 'smoke_item',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['item'],
          properties: { item: { type: 'string' } },
        },
      } },
    });
    assert.equal(JSON.parse(data.choices[0].message.content).item.toUpperCase(), 'PASTA');
  }],
  ['Jev', 'TYPESAFE_API_KEY', async (key) => {
    const data = await model('https://api.typesafe.ai/v1/systemone', key, {
      model: process.env.TYPESAFE_MODEL ?? 'jev-latest',
      state: 'A line item on a synthetic receipt is red wine.',
      questions: { alcohol: { type: 'noul', instructions: 'Is red wine an alcoholic beverage?' } },
    });
    assert.equal(data.answers.alcohol.type, 'noul');
    assert.ok(data.answers.alcohol.noul > 0.5);
  }],
  ['Mailpit', null, async () => {
    const client = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? '127.0.0.1',
      port: Number(process.env.SMTP_PORT ?? 1025),
    });
    const subject = `Autopilot smoke ${randomUUID()}`;
    const original = await readFile(fixture);
    const info = await client.sendMail({
      from: 'smoke@example.test',
      to: 'smoke@example.test',
      subject,
      text: 'Synthetic integration fixture.',
      attachments: [{ filename: 'receipt.png', content: original }],
    });
    const query = new URLSearchParams({ query: 'to:smoke@example.test' });
    const inbox = await (await request(`${base}/api/v1/search?${query}`)).json();
    const entry = inbox.messages.find((message) => message.Subject === subject);
    assert.ok(entry && info.accepted.includes('smoke@example.test'));
    const email = await (await request(`${base}/api/v1/message/${entry.ID}`)).json();
    assert.equal(email.Attachments.length, 1);
    const attachment = await request(`${base}/api/v1/message/${entry.ID}/part/${email.Attachments[0].PartID}`);
    assert.equal(sha(Buffer.from(await attachment.arrayBuffer())), sha(original));
  }],
];

for (const [name, credential, probe] of probes) {
  const key = credential ? process.env[credential] : undefined;
  if (credential && !key) {
    console.log(`PENDING ${name} — ${credential} missing`);
    process.exitCode = 1;
    continue;
  }
  try {
    await probe(key);
    console.log(`PASS ${name}`);
  } catch (error) {
    const safeMessage = /^HTTP \d+$/.test(error.message) ? error.message : error.name;
    console.error(`FAIL ${name} — ${safeMessage}`);
    process.exitCode = 1;
  }
}
