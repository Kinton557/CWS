/* Firebase Authentication for CWS. Loaded as a module on login.html, signup.html and dashboard.html.
   Exposes window.cwsFirebase. The server still keeps the session, orders and invoices. */
const cfg = window.CWS_FIREBASE || {};
const api = { enabled: false };
window.cwsFirebase = api;

if (cfg.apiKey && cfg.projectId) {
  const V = '10.14.1';
  const [{ initializeApp }, auth] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`)
  ]);
  const app = initializeApp(cfg);
  const fbAuth = auth.getAuth(app);

  const MESSAGES = {
    'auth/email-already-in-use': 'An account with that email already exists. Try logging in.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/weak-password': 'Password must be at least 8 characters.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/user-not-found': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
    'auth/network-request-failed': 'Network error. Please check your connection.',
    'auth/unauthorized-domain': 'This website address is not added in Firebase (Authentication > Settings > Authorized domains).',
    'auth/operation-not-allowed': 'Email/password sign-in is not switched on in Firebase yet.'
  };
  api.explain = (err) => MESSAGES[err && err.code] || 'Something went wrong. Please try again.';

  api.signIn = async (email, password) => {
    const cred = await auth.signInWithEmailAndPassword(fbAuth, email, password);
    return cred.user.getIdToken(true);
  };
  api.signUp = async (name, email, password) => {
    const cred = await auth.createUserWithEmailAndPassword(fbAuth, email, password);
    await auth.updateProfile(cred.user, { displayName: name });
    auth.sendEmailVerification(cred.user).catch(() => {});
    return cred.user.getIdToken(true);
  };
  api.resetPassword = (email) => auth.sendPasswordResetEmail(fbAuth, email);
  api.signOut = () => auth.signOut(fbAuth).catch(() => {});
  api.enabled = true;
}
document.dispatchEvent(new Event('cws-firebase-ready'));
