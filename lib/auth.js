function AuthEngine() {
  this._internalStorage = {};
  this.isLocalStorageEnabled = this._checkLocalStorageEnabled();
}

AuthEngine.prototype._checkLocalStorageEnabled = function () {
  let err;
  try {
    // Some browsers will throw an error here if localStorage is disabled.
    global.localStorage;

    // Safari, in Private Browsing Mode, looks like it supports localStorage but all calls to setItem
    // throw QuotaExceededError. We're going to detect this and avoid hard to debug edge cases.
    global.localStorage.setItem('__scLocalStorageTest', 1);
    global.localStorage.removeItem('__scLocalStorageTest');
  } catch (e) {
    err = e;
  }
  return !err;
};

AuthEngine.prototype.saveToken = function (name, token, options) {
  if (this.isLocalStorageEnabled && global.localStorage) {
    global.localStorage.setItem(name, token);
  } else {
    this._internalStorage[name] = token;
  }
  return Promise.resolve(token);
};

AuthEngine.prototype.removeToken = function (name) {
  let loadPromise = this.loadToken(name);

  if (this.isLocalStorageEnabled && global.localStorage) {
    global.localStorage.removeItem(name);
  } else {
    delete this._internalStorage[name];
  }

  return loadPromise;
};

AuthEngine.prototype.loadToken = function (name) {
  let token;

  if (this.isLocalStorageEnabled && global.localStorage) {
    token = global.localStorage.getItem(name);
  } else {
    token = this._internalStorage[name] || null;
  }

  return Promise.resolve(token);
};

module.exports = AuthEngine;
