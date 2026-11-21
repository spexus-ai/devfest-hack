export async function requestModel(url, key, body, { fetcher = fetch, provider, timeout = 45000 } = {}) {
  if (!key) throw new Error('The API key is not configured for ' + provider + '.');
  const response = await fetcher(url, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(provider + ' returned HTTP ' + response.status + '.');
  return response.json();
}
