import type { ApiClient } from '../../../packages/shared/src/api-client';
import type { AuthUser } from '../../../packages/shared/src/domain';
import { identifierInputMode, identifierIsValid, identifierKind, identifierLabel } from '../../customer/lib/account-id';
import { BOOKING_DRAFT_KEY, isBookingScreen, readDraft, saveDraft } from './booking-draft';

type Context = {
  ui: Record<string, any>; api: ApiClient;
  user: () => AuthUser | null; trips: () => Array<Record<string, any>>;
  scheduledTrips?: () => Array<Record<string, any>>; selectScheduled?: (id:string) => void;
  establish: (result: { token: string; user: AuthUser }) => Promise<void>;
  discardToken: (token: string) => Promise<void>;
  canSaveDraft: () => boolean;
};

/** The Customer app's welcome → identifier → password/sign-up journey, on demand. */
export function installCustomerAuth(c: Context) {
  const { ui, api } = c;
  const state = ui.TaxibeeSource.state;
  const esc = (value: unknown) => ui.escapeHtml(String(value ?? ''));
  const layer = () => document.getElementById('auth-layer')!;
  let step: 'welcome' | 'identifier' | 'password' | 'signup' = 'welcome';
  let identifier = '', password = '', name = '', intended = 'home', previous = 'home';
  let busy = false, generation = 0, observer: ResizeObserver | null = null;
  let sdk: Promise<void> | null = null;
  const authButton = (label: string, action?: string, tone = 'gold', submit = false) => `<button type="${submit ? 'submit' : 'button'}" class="account-btn account-btn-${tone}" ${action ? `data-auth-action="${action}"` : ''}>${label}</button>`;
  const icon = (name: string) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  function field(id: string, label: string, value: string, type: string, autocomplete: string, glyph: string) {
    return `<label class="account-field field-box" for="${id}"><span class="account-icon">${icon(glyph)}</span><span class="account-col"><span class="account-lbl">${label}</span><input id="${id}" value="${esc(value)}" type="${type}" autocomplete="${autocomplete}" aria-label="${label}" ${id === 'identifier' ? 'autocapitalize="none" spellcheck="false"' : ''}></span>${type === 'password' ? `<button type="button" class="account-eye" data-auth-action="password-visibility" data-input="${id}" aria-label="Show password">${icon('eye')}</button>` : ''}</label>`;
  }
  function notice(message: string) {
    const node = document.getElementById('auth-notice');
    if (node) { node.className = 'account-notice is-error'; node.setAttribute('role', 'alert'); node.textContent = message; }
  }
  function syncBusy() {
    layer().querySelectorAll<HTMLButtonElement>('button').forEach(el => { el.disabled = busy && el.dataset.authAction !== 'browse'; });
    layer().querySelectorAll<HTMLInputElement>('input').forEach(el => { el.disabled = busy; });
    const submit = layer().querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = busy || (step === 'identifier' ? !identifierIsValid(identifier) : step === 'signup' ? name.trim().length < 2 || password.length < 6 : password.length === 0);
  }
  function rememberBooking() {
    try { if (layer().classList.contains('is-hidden') && c.canSaveDraft()) saveDraft(sessionStorage, state, c.user()?.id || null); } catch { /* Browsing remains available if storage is blocked. */ }
  }
  function clearDraft() { sessionStorage.removeItem(BOOKING_DRAFT_KEY); }
  const renderScreen = ui.renderCurrentScreen;
  ui.renderCurrentScreen = (...args: any[]) => { renderScreen(...args); rememberBooking(); };
  function restoreDraft() {
    const draft = readDraft(sessionStorage, c.user()?.id || null);
    if (!draft) return null;
    const trip = c.trips().find(t => t.id === draft.queueId) || (draft.scheduleId ? c.scheduledTrips?.().find(t=>t.id===draft.scheduleId) : null);
    if(draft.scheduleId && trip) c.selectScheduled?.(draft.scheduleId);
    Object.assign(state, draft.values);
    // Prices, capacity and availability are always refreshed from Peebee, never restored from storage.
    state.activeTrip = trip || c.trips().find(t => t.routeId === draft.routeId) || null;
    if (trip) { state.searchFrom = trip.boarding; state.searchTo = trip.destination; }
    state.selectedRoute = state.activeTrip?.routeId || draft.routeId;
    return { screen: trip ? draft.screen : 'book', changed: !trip };
  }
  function showApp(screen = previous) {
    ++generation; busy = false; password = ''; observer?.disconnect(); observer = null;
    layer().classList.add('is-hidden');
    for (const id of ['splash-screen', 'onboarding']) document.getElementById(id)?.classList.add('is-hidden');
    document.getElementById('app-shell')?.classList.remove('is-hidden');
    ui.navigate(screen || 'home', {}, false);
  }
  async function complete(result: { token: string; user: AuthUser }, run: number) {
    if (run !== generation) { await c.discardToken(result.token); return; }
    if (result.user.role !== 'customer') { await c.discardToken(result.token); throw new Error('Please use a Peebee customer account.'); }
    await c.establish(result);
    if (run !== generation) return;
    const restored = restoreDraft();
    const dest = isBookingScreen(intended) ? restored?.screen || intended : intended;
    showApp(dest);
    rememberBooking();
    ui.toast(restored?.changed ? 'Your booking choices are saved. Choose a currently available departure.' : isBookingScreen(dest) ? 'Your booking is restored. Review the current price and confirm when ready.' : `Welcome, ${result.user.name}.`, 'success');
  }
  function loadGoogleSdk() {
    if (ui.google?.accounts?.id) return Promise.resolve();
    if (!sdk) sdk = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
      script.onload = () => resolve(); script.onerror = () => { sdk = null; script.remove(); reject(new Error('Google sign-in could not load. Continue with email or phone.')); };
      document.head.append(script);
    });
    return sdk;
  }
  async function mountGoogle(run: number) {
    const { googleClientId } = await api.getAuthConfig();
    if (run !== generation || step !== 'welcome') return;
    if (!googleClientId) throw new Error('Google sign-in is not available right now. Continue with email or phone.');
    await loadGoogleSdk();
    const node = document.getElementById('taxibee-google-button');
    if (run !== generation || step !== 'welcome' || !node) return;
    node.replaceChildren();
    ui.google.accounts.id.initialize({ client_id: googleClientId, auto_select: false, callback: async (response: { credential: string }) => {
      if (run !== generation || busy || !response.credential) return;
      busy = true; syncBusy();
      try { await complete(await api.googleAuth(response.credential, 'customer'), run); }
      catch (e) { if (run === generation) notice(e instanceof Error ? e.message : 'Google sign-in did not work. Continue with email or phone.'); }
      finally { busy = false; if (run === generation) syncBusy(); }
    } });
    let previousWidth = 0;
    const draw = () => {
      if (!node.isConnected || run !== generation) return;
      const width = Math.min(400, Math.round(node.parentElement?.clientWidth || 0));
      if (!width || width === previousWidth) return;
      previousWidth = width; node.replaceChildren();
      ui.google.accounts.id.renderButton(node, { type: 'standard', theme: 'filled_black', size: 'large', shape: 'rectangular', width, text: 'continue_with', logo_alignment: 'center' });
    };
    draw(); observer?.disconnect(); observer = new ResizeObserver(draw); observer.observe(node.parentElement!);
  }
  function render() {
    observer?.disconnect(); observer = null;
    layer().classList.add('taxibee-customer-auth'); layer().setAttribute('aria-label', 'Peebee account');
    const back = `<div class="account-top"><button type="button" class="account-back" data-auth-action="back" aria-label="Back">${icon('arrow-left')}</button><span class="account-step">${step === 'identifier' ? 'Step 1 of 2' : 'Step 2 of 2'}</span></div>`;
    const identity = `<div class="account-field field-box"><span class="account-icon">${icon(identifierKind(identifier) === 'email' ? 'mail' : 'phone')}</span><span class="account-col"><span class="account-lbl">${identifierLabel(identifier)}</span><span class="account-val">${esc(identifier.trim())}</span></span><button type="button" class="account-change" data-auth-action="identifier">Change</button></div>`;
    let content = '';
    if (step === 'welcome') content = `<div class="account-brand"><img src="/brand/peebee-logo-light.svg" alt="" class="account-logo-light" width="36" height="36"><img src="/brand/peebee-logo-dark.svg" alt="" class="account-logo-dark" width="36" height="36"><span>Peebee</span></div><h1 class="account-title is-center">Travel with Taxibee.</h1><p class="account-sub is-center">${isBookingScreen(intended) ? 'Sign in to book. Your booking choices are saved.' : 'Use your existing Peebee account, or create one.'}</p><div class="account-stack"><div id="taxibee-google-button" class="taxibee-google-native" aria-label="Continue with Google"><span role="status">Loading Google sign-in…</span></div><div class="account-or">or</div>${authButton('Continue with email or phone', 'identifier', 'sec')}${authButton('Browse without signing in', 'browse', 'ghost')}</div>`;
    else if (step === 'identifier') content = `${back}<form data-auth-form="identifier"><h1 class="account-title">Sign in or sign up</h1><p class="account-sub">Enter your phone number or email.</p><div class="account-stack">${field('identifier', 'Phone or email', identifier, identifierKind(identifier) === 'email' ? 'email' : 'text', 'username', identifierKind(identifier) === 'email' ? 'mail' : 'phone')}${authButton('Continue', undefined, 'gold', true)}</div></form>`;
    else if (step === 'password') content = `${back}<form data-auth-form="login"><h1 class="account-title">Welcome back</h1><p class="account-sub">Enter your password to log in.</p><div class="account-stack">${identity}${field('password', 'Password', password, 'password', 'current-password', 'lock')}${authButton('Log in', undefined, 'gold', true)}<p class="account-links"><button type="button" data-action="taxibee-password-reset-form">Forgot password?</button></p><p class="account-links">New to Peebee? <button type="button" data-auth-action="signup">Create account</button></p></div></form>`;
    else content = `${back}<form data-auth-form="signup"><h1 class="account-title">Create your account</h1><div class="account-stack">${identity}${field('name', 'Full name', name, 'text', 'name', 'user')}${field('new-password', 'Password · at least 6 characters', password, 'password', 'new-password', 'lock')}${authButton('Create account', undefined, 'gold', true)}<p class="account-links">Already have an account? <button type="button" data-auth-action="password">Log in</button></p></div></form>`;
    layer().innerHTML = `<div class="account-screen"><div class="account-art ${step === 'welcome' ? 'is-welcome' : ''}" aria-hidden="true"><img src="/brand/auth-illustration.webp" alt="" width="1536" height="1024"></div><div class="account-body"><div id="auth-content">${content}<div id="auth-notice" aria-live="polite"></div>${step !== 'welcome' ? '<button type="button" class="account-textlink" data-auth-action="browse">Continue browsing · booking choices saved</button>' : ''}<p class="account-legal"><a href="https://peebee.online/terms">Terms</a> · <a href="https://peebee.online/privacy">Privacy</a> · <a href="/?preview=1">Practice mode</a></p></div></div></div>`;
    ui.refreshIcons(); syncBusy();
    layer().querySelector<HTMLInputElement>('input')?.focus();
    if (step === 'welcome') { const run = generation; void mountGoogle(run).catch(e => { if (run === generation && step === 'welcome') { document.getElementById('taxibee-google-button')?.replaceChildren(); notice(e.message); } }); }
  }
  function open(screen = 'profile', preserve = true) {
    if (preserve) rememberBooking();
    ++generation; intended = screen; previous = state.screen || 'home'; step = 'welcome'; busy = false; password = ''; identifier = ''; name = '';
    ui.closeModal(); ui.closeSideDrawer(); ui.closeSheet();
    document.getElementById('app-shell')?.classList.add('is-hidden');
    window.scrollTo({ top: 0, behavior: 'instant' });
    layer().classList.remove('is-hidden'); render();
  }
  document.addEventListener('input', event => {
    const el = event.target as HTMLInputElement;
    if (el.closest('.taxibee-customer-auth')) {
      if (el.id === 'identifier') { identifier = el.value; el.type = identifierKind(identifier) === 'email' ? 'email' : 'text'; el.inputMode = identifierInputMode(identifier); }
      if (el.id === 'password' || el.id === 'new-password') password = el.value;
      if (el.id === 'name') name = el.value;
      syncBusy();
    }
  });
  // Bubble through the document's source and adapter handlers before reading state.
  // Microtasks can run between listeners, before a later listener updates a choice.
  for (const name of ['click', 'input', 'change']) window.addEventListener(name, rememberBooking);
  document.addEventListener('click', event => {
    const el = (event.target as Element).closest<HTMLElement>('[data-auth-action]');
    if (!el) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const action = el.dataset.authAction;
    if (action === 'open') return open(el.dataset.screenAfter || 'profile');
    if (action === 'browse') return showApp(previous);
    if (busy) return;
    if (action === 'password-visibility') { const target = document.getElementById(el.dataset.input || '') as HTMLInputElement; target.type = target.type === 'password' ? 'text' : 'password'; el.setAttribute('aria-label', target.type === 'password' ? 'Show password' : 'Hide password'); return; }
    if (action === 'back') step = step === 'identifier' ? 'welcome' : 'identifier';
    if (action === 'identifier') step = 'identifier';
    if (action === 'signup') { step = 'signup'; password = ''; }
    if (action === 'password') { step = 'password'; password = ''; }
    render();
  }, true);
  document.addEventListener('submit', event => {
    const form = event.target as HTMLFormElement;
    if (!form.matches('[data-auth-form]')) return;
    event.preventDefault(); event.stopImmediatePropagation(); if (busy) return;
    if (form.dataset.authForm === 'identifier') { if (identifierIsValid(identifier)) { step = 'password'; render(); } return; }
    const run = generation; busy = true; syncBusy();
    const request = form.dataset.authForm === 'signup'
      ? api.register({ name: name.trim(), password, role: 'customer', ...(identifierKind(identifier) === 'email' ? { email: identifier.trim() } : { phone: identifier.trim() }) })
      : api.login({ identifier: identifier.trim(), password });
    void request.then(result => complete(result, run)).catch(e => { if (run === generation) notice(e instanceof Error ? e.message : 'Sign-in failed. Please try again.'); }).finally(() => { busy = false; if (run === generation) syncBusy(); });
  }, true);
  return { open, rememberBooking, restoreDraft, clearDraft, browse: showApp,
    finish: (result: { token: string; user: AuthUser }) => complete(result, generation),
    close: () => showApp(previous),
  };
}
