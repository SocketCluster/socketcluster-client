var AuthEngine = function () {
  this._internalStorage = {};
};

AuthEngine.prototype.saveToken = function (name, token, options, callback) {
  var store = options.persistent ? global.localStorage : global.sessionStorage;
  var secondaryStore = options.persistent ? global.sessionStorage : global.localStorage;
  
  if (store) {
    store.setItem(name, token);
    if (secondaryStore) {
      secondaryStore.removeItem(name);
    }
  } else {
    this._internalStorage[name] = token;
  }
  callback && callback();
};

AuthEngine.prototype.removeToken = function (name, callback) {
  var localStore = global.localStorage;
  var sessionStore = global.sessionStorage;
  
  if (localStore) {
    localStore.removeItem(name);
  }
  if (sessionStore) {
    sessionStore.removeItem(name);
  }
  delete this._internalStorage[name];
  
  callback && callback();
};

AuthEngine.prototype.loadToken = function (name, callback) {
  var localStore = global.localStorage;
  var sessionStore = global.sessionStorage;
  var token;
  
  // sessionStorage has priority over localStorage since it 
  // gets cleared when the session ends.
  if (sessionStore) {
    token = sessionStore.getItem(name);
  }
  if (localStore && token == null) {
    token = localStore.getItem(name);
  }
  if (token == null) {
    token = this._internalStorage[name] || null;
  }
  callback(null, token);
};

module.exports.AuthEngine = AuthEngine;