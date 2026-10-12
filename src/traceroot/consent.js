import './style.css';
const id = location.hash.slice(1),
  button = document.getElementById('submit-diagnostic'),
  checkbox = document.getElementById('consent'),
  message = document.getElementById('message');
let ready = false;
checkbox.onchange = () => {
  button.disabled = !ready || !checkbox.checked;
};
async function initialize() {
  try {
    if (!/^[a-f0-9]{48}$/.test(id))
      throw new Error('This diagnostic link is invalid.');
    const response = await fetch(`/api/traceroot/diagnostic/${id}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    document.getElementById('diagnostic-title').textContent = data.title;
    if (data.completed)
      message.textContent = 'This diagnostic has already been submitted.';
    else ready = true;
  } catch (error) {
    message.textContent = error.message;
  }
}
void initialize();

button.onclick = async () => {
  if (!ready || !checkbox.checked) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/traceroot/diagnostic/${id}/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: true }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    message.textContent = 'Submitted with consent. You can close this page.';
    ready = false;
    checkbox.disabled = true;
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
  }
};
