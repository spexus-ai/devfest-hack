import { api, node, post, setNav, showError } from './ui.js';

const login = document.querySelector('#login');
const upload = document.querySelector('#upload');

function render(user) {
  if (user?.role === 'reviewer') {
    location.replace('/approvals');
    return;
  }
  setNav(user);
  login.hidden = Boolean(user);
  upload.hidden = user?.role !== 'claimant';
}

try {
  render((await api('/api/me')).user);
} catch {
  render(null);
}

login.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(null);
  try {
    const result = await post('/api/login', Object.fromEntries(new FormData(login)));
    login.reset();
    render(result.user);
  } catch (error) {
    showError(error);
  }
});

upload.receipts.addEventListener('change', () => {
  document.querySelector('#files').replaceChildren(...Array.from(upload.receipts.files, (file) => node('li', file.name)));
});

upload.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(null);
  const button = upload.querySelector('button');
  button.disabled = true;
  try {
    const { sessionId } = await api('/api/sessions', { method: 'POST', body: new FormData(upload) });
    location.assign('/chat.html?id=' + encodeURIComponent(sessionId));
  } catch (error) {
    showError(error);
    button.disabled = false;
  }
});
