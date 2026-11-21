export async function requestModel(url, key, body, { fetcher = fetch, provider, timeout = 45000 } = {}) {
  if (!key) throw new Error('Не настроен ключ ' + provider + '.');
  const response = await fetcher(url, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(provider + ' вернул HTTP ' + response.status + '.');
  return response.json();
}
