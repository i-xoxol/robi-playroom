document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.target.querySelector('button'), error = document.querySelector('#login-error');
  button.disabled = true; error.textContent = '';
  try {
    const response = await fetch('/games/robot-pal/api/login', { method: 'POST', mode: 'same-origin', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Robi-Request': 'same-origin' }, body: JSON.stringify({ password: document.querySelector('#password').value }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Спробуйте ще раз.'); location.reload();
  } catch (e) { error.textContent = e.message; button.disabled = false; }
});
