var AuthEngine = function () {
  this._internalStorage = {};
};

AuthEngine.prototype.saveToken = function (name, token, options, callback) {
  if (global.localStorage) {
    global.localStorage.setItem(name, token);
  } else {
    this._internalStorage[name] = token;
  }
  callback && callback();
};

AuthEngine.prototype.removeToken = function (name, callback) {
  if (global.localStorage) {
    global.localStorage.removeItem(name);
  }
  delete this._internalStorage[name];
  
  callback && callback();
};

AuthEngine.prototype.loadToken = function (name, callback) {
  var token;
  
  if (global.localStorage) {
    token = global.localStorage.getItem(name);
  } else {
    token = this._internalStorage[name] || null;
  }
  callback(null, token);
};

module.exports.AuthEngine = AuthEngine;