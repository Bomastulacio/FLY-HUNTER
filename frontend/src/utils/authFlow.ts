import { supabase } from '../lib/supabase';
import { getRememberedGoogleAccount } from './rememberedAccount';

export function mountAuth() {
  const register = document.body.dataset.authMode === 'register';
  const form = document.getElementById('auth-form') as HTMLFormElement;
  const email = document.getElementById('auth-email') as HTMLInputElement;
  const password = document.getElementById('auth-password') as HTMLInputElement;
  const submit = document.getElementById('submit-btn') as HTMLButtonElement;
  const google = document.getElementById('google-btn') as HTMLButtonElement;
  const otherGoogle = document.getElementById('other-google-btn') as HTMLButtonElement | null;
  const error = document.getElementById('error-msg')!;
  const confirmation = document.getElementById('confirmation')!;
  const resend = document.getElementById('resend-btn') as HTMLButtonElement;
  const status = document.getElementById('resend-message')!;
  let confirmedEmail = '';
  let resendAt = 0;
  const redirect = `${window.location.origin}/alertas`;
  const loginDestination = register ? '/alertas' : '/';
  const remembered = register ? null : getRememberedGoogleAccount();
  const rememberedBtn = document.getElementById('remembered-btn') as HTMLButtonElement | null;
  if (remembered && rememberedBtn) {
    document.getElementById('remembered-name')!.textContent = remembered.name;
    document.getElementById('remembered-email')!.textContent = remembered.email;
    const avatar = document.getElementById('remembered-avatar')!;
    if (remembered.avatarUrl) {
      const image = document.createElement('img');
      image.src = remembered.avatarUrl;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      avatar.replaceChildren(image);
    } else avatar.textContent = remembered.name.charAt(0).toUpperCase();
    rememberedBtn.hidden = false;
    google.hidden = true;
    google.style.display = 'none';
    if (otherGoogle) otherGoogle.hidden = false;
  }
  void supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) window.location.replace(loginDestination);
  }).catch(() => { /* Keep the sign-in form usable during network errors. */ });
  function showError(message: string) { error.textContent = message; error.hidden = false; }
  function friendly(message: string) {
    if (/invalid login credentials/i.test(message)) return 'El email o la contraseña no coinciden. Revisalos e intentá de nuevo.';
    if (/email not confirmed/i.test(message)) return 'Todavía falta confirmar tu email. Abrí el enlace que recibiste por correo.';
    if (/rate limit|too many|security purposes/i.test(message)) return 'Esperá un momento antes de volver a intentarlo.';
    return 'No pudimos completar este paso. Revisá tu conexión e intentá de nuevo.';
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    error.hidden = true;
    const repeat = document.getElementById('auth-confirm') as HTMLInputElement | null;
    if (register && repeat && password.value !== repeat.value) { showError('Las contraseñas no coinciden.'); repeat.focus(); return; }
    const label = submit.innerHTML;
    submit.disabled = google.disabled = true;
    submit.textContent = register ? 'Creando tu cuenta…' : 'Entrando…';
    try {
      if (register) {
        const name = (document.getElementById('auth-name') as HTMLInputElement).value.trim();
        const { data, error: authError } = await supabase.auth.signUp({ email: email.value.trim(), password: password.value, options: { data: { full_name: name }, emailRedirectTo: redirect } });
        if (authError) { showError(friendly(authError.message)); return; }
        if (data.session) { window.location.assign('/alertas'); return; }
        if (data.user?.identities?.length === 0) { showError('Si ya tenés una cuenta con este email, usá Iniciar sesión o confirmá el correo que recibiste.'); return; }
        confirmedEmail = email.value.trim();
        document.getElementById('confirmation-email')!.textContent = confirmedEmail;
        form.hidden = true;
        confirmation.hidden = false;
        document.getElementById('auth-title')!.textContent = 'Un paso más.';
        document.getElementById('auth-description')!.textContent = 'Confirmá tu email para guardar tus viajes en tu cuenta.';
        document.getElementById('confirmation-title')!.focus();
        password.value = ''; if (repeat) repeat.value = '';
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
        if (authError) { showError(friendly(authError.message)); return; }
        window.location.assign(loginDestination);
      }
    } catch { showError('No pudimos conectarnos. Probá de nuevo en unos instantes.'); }
    finally { submit.disabled = google.disabled = false; submit.innerHTML = label; }
  });
  async function startGoogle(useRememberedAccount: boolean) {
    if (google.disabled || (rememberedBtn && rememberedBtn.disabled)) return;
    error.hidden = true;
    google.disabled = submit.disabled = true;
    if (rememberedBtn) rememberedBtn.disabled = true;
    if (otherGoogle) otherGoogle.disabled = true;
    try {
      const queryParams = useRememberedAccount && remembered ? { login_hint: remembered.email } : undefined;
      const { error: authError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}${loginDestination}`, queryParams } });
      if (authError) showError(friendly(authError.message));
    } catch { showError('No pudimos conectar con Google. Intentá de nuevo.'); }
    finally {
      google.disabled = submit.disabled = false;
      if (rememberedBtn) rememberedBtn.disabled = false;
      if (otherGoogle) otherGoogle.disabled = false;
    }
  }
  rememberedBtn?.addEventListener('click', () => { void startGoogle(true); });
  google.addEventListener('click', () => { void startGoogle(false); });
  otherGoogle?.addEventListener('click', () => { void startGoogle(false); });
  resend.addEventListener('click', async () => {
    if (!confirmedEmail || resend.disabled || Date.now() < resendAt) return;
    resend.disabled = true; status.textContent = 'Enviando…';
    try {
      const { error: authError } = await supabase.auth.resend({ type: 'signup', email: confirmedEmail, options: { emailRedirectTo: redirect } });
      status.textContent = authError ? friendly(authError.message) : 'Listo. Revisá tu bandeja de entrada.';
      resendAt = Date.now() + 60000;
      resend.textContent = 'Podés reenviarlo en un minuto';
      window.setTimeout(() => { resend.disabled = false; resend.textContent = 'Reenviar el correo'; }, 60000);
    } catch { status.textContent = 'No se pudo enviar. Intentá de nuevo.'; resend.disabled = false; }
  });
  document.getElementById('change-email')!.addEventListener('click', () => {
    confirmation.hidden = true; form.hidden = false; error.hidden = true; status.textContent = '';
    document.getElementById('auth-title')!.textContent = 'Un viaje por delante.';
    document.getElementById('auth-description')!.textContent = 'Creá tu cuenta. Después elegimos dónde y cuándo querés viajar.';
    email.focus();
  });
}
