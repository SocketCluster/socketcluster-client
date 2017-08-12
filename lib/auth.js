var AuthEngine = function () {
  this._internalStorage = {};
  this.tokenWatchers = {};
  this._localStorageChangeHandlers = {};
};

AuthEngine.prototype._isLocalStorageEnabled = function () {
  var err;
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

AuthEngine.prototype.saveToken = function (name, token, options, callback) {
  if (this._isLocalStorageEnabled() && global.localStorage) {
    global.localStorage.setItem(name, token);
  } else {
    this._internalStorage[name] = token;
    this._callWatchers(name, token);
  }
  callback && callback(null, token);
};

AuthEngine.prototype.removeToken = function (name, callback) {
  var token;

  this.loadToken(name, function (err, authToken) {
    token = authToken;
  });

  if (this._isLocalStorageEnabled() && global.localStorage) {
    global.localStorage.removeItem(name);
  } else {
    delete this._internalStorage[name];
    this._callWatchers(name, null);
  }

  callback && callback(null, token);
};

AuthEngine.prototype.loadToken = function (name, callback) {
  var token;

  if (this._isLocalStorageEnabled() && global.localStorage) {
    token = global.localStorage.getItem(name);
  } else {
    token = this._internalStorage[name] || null;
  }
  callback(null, token);
};

AuthEngine.prototype._callWatchers = function (name, value) {
  var watcherList = this.tokenWatchers[name];
  if (watcherList) {
    watcherList.forEach(function (watcher) {
      watcher(value);
    });
  }
};

AuthEngine.prototype._listenToLocalStorageKeyChange = function (name) {
  var self = this;

  if (!this._localStorageChangeHandlers[name]) {
    var listener = function (event) {
      if (event.key == name) {
        self._callWatchers(name, event.newValue);
      }
    };
    this._localStorageChangeHandlers[name] = listener;
    global.addEventListener('storage', listener);
  }
};

AuthEngine.prototype._stopListeningToLocalStorageKeyChange = function (name) {
  var listener = this._localStorageChangeHandlers[name];
  if (listener) {
    global.removeEventListener('storage', listener);
  }
};

AuthEngine.prototype._addTokenChangeWatcher = function (name, watcher) {
  if (!this.tokenWatchers[name]) {
    this.tokenWatchers[name] = [];
  }
  this.tokenWatchers[name].push(watcher);
};

AuthEngine.prototype._removeTokenChangeWatcher = function (name, watcher) {
  if (this.tokenWatchers[name]) {
    this.tokenWatchers[name] = this.tokenWatchers[name].filter(function (currentWatcher) {
      return currentWatcher !== watcher;
    });
    if (!this.tokenWatchers[name].length) {
      delete this.tokenWatchers[name];
    }
  }
};

AuthEngine.prototype._hasTokenChangeWatchers = function (name) {
  return !!(this.tokenWatchers[name] && this.tokenWatchers[name].length);
};

AuthEngine.prototype.watchToken = function (name, callback) {
  if (this._isLocalStorageEnabled() && global.localStorage) {
    this._listenToLocalStorageKeyChange(name);
  }
  this._addTokenChangeWatcher(name, callback);
};

AuthEngine.prototype.unwatchToken = function (name, callback) {
  this._removeTokenChangeWatcher(name, callback);
  if (this._isLocalStorageEnabled() && global.localStorage && !this._hasTokenChangeWatchers(name)) {
    this._stopListeningToLocalStorageKeyChange(name);
  }
};

module.exports.AuthEngine = AuthEngine;
