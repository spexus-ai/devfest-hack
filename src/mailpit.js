const idOf = (value) => String(value ?? '').replace(/^<|>$/g, '');

export function createMailpit(base = process.env.MAILPIT_BASE_URL ?? 'http://mailpit:8025', fetcher = fetch) {
  async function get(path) {
    const response = await fetcher(base + path, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Mailpit вернул HTTP ' + response.status + '.');
    return response;
  }
  async function list(to) {
    const results = [];
    for (let start = 0; ; start += 50) {
      const params = new URLSearchParams({ query: 'to:' + to, start: String(start), limit: '50' });
      const data = await (await get('/api/v1/search?' + params)).json();
      const messages = data.messages ?? [];
      results.push(...messages);
      if (messages.length < 50) return results;
    }
  }
  const address = (id) => '/api/v1/message/' + encodeURIComponent(id);
  return {
    list,
    message: async (id) => (await get(address(id))).json(),
    headers: async (id) => (await get(address(id) + '/headers')).json(),
    part: async (id, partId) => Buffer.from(await (await get(
      address(id) + '/part/' + encodeURIComponent(partId))).arrayBuffer()),
    findByMessageId: async (to, messageId) => (await list(to)).find((message) => idOf(message.MessageID) === idOf(messageId)),
  };
}
