// Where the login token lives, depending on "Remember me":
//  - remembered: localStorage, so it survives closing the browser (the
//    backend issues a 30-day token in that case);
//  - not remembered: sessionStorage, so closing the browser signs the user
//    out - the safer default on a shared shop computer.
// Passwords are never stored by the app; the login form carries the
// standard autocomplete hints so the browser's own password manager can
// offer to save them.
const TOKEN_KEY = 'token';
const USERNAME_KEY = 'rememberedUsername';

const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const getToken = () =>
  safe(() => localStorage.getItem(TOKEN_KEY)) || safe(() => sessionStorage.getItem(TOKEN_KEY)) || '';

export const saveToken = (token, remember) => {
  if (remember) {
    safe(() => localStorage.setItem(TOKEN_KEY, token));
    safe(() => sessionStorage.removeItem(TOKEN_KEY));
  } else {
    safe(() => sessionStorage.setItem(TOKEN_KEY, token));
    safe(() => localStorage.removeItem(TOKEN_KEY));
  }
};

export const clearToken = () => {
  safe(() => localStorage.removeItem(TOKEN_KEY));
  safe(() => sessionStorage.removeItem(TOKEN_KEY));
};

export const getRememberedUsername = () => safe(() => localStorage.getItem(USERNAME_KEY)) || '';

export const setRememberedUsername = (username, remember) => {
  if (remember && username) {
    safe(() => localStorage.setItem(USERNAME_KEY, username));
  } else {
    safe(() => localStorage.removeItem(USERNAME_KEY));
  }
};
