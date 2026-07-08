const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const accessInput = document.querySelector("#accessInput");
const loginMessage = document.querySelector("#loginMessage");
const loginTime = document.querySelector("#loginTime");

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "No fue posible iniciar sesion.");
  return payload;
};

const formatDateTime = (value = new Date()) =>
  new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const setMessage = (message, { error = false } = {}) => {
  loginMessage.textContent = message;
  loginMessage.classList.toggle("is-error", error);
};

const updateLoginClock = () => {
  loginTime.textContent = `Fecha y hora del acceso: ${formatDateTime()}`;
};

const login = async (event) => {
  event.preventDefault();
  setMessage("Validando...");

  try {
    await requestJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: usernameInput.value,
        password: passwordInput.value,
        accessPoint: accessInput.value,
      }),
    });
    passwordInput.value = "";
    window.location.assign("/consulta.html");
  } catch (error) {
    setMessage(error.message, { error: true });
  }
};

const redirectIfAuthenticated = async () => {
  try {
    await requestJson("/api/session");
    window.location.assign("/consulta.html");
  } catch {
    usernameInput.focus();
  }
};

loginForm.addEventListener("submit", login);
updateLoginClock();
window.setInterval(updateLoginClock, 30000);
redirectIfAuthenticated();
