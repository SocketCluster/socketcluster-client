/**
 * Module dependencies.
 */

var Emitter = require('emitter');
var Socket = require('engine.io-client');

/**
 * Module exports.
 */

if (!Object.create) {
  Object.create = (function () {
    function F() {};

    return function (o) {
      if (arguments.length != 1) {
        throw new Error('Object.create implementation only accepts one parameter.');
      }
      F.prototype = o;
      return new F();
    }
  })();
}

var Response = function (socket, id) {
  this.socket = socket;
  this.id = id;
};

Response.prototype._respond = function (responseData) {
  this.socket.send(this.socket.JSON.stringify(responseData));
};

Response.prototype.end = function (data) {
  if (this.id) {
    var responseData = {
      cid: this.id
    };
    if (data !== undefined) {
      responseData.data = data;
    }
    this._respond(responseData);
  }
};

Response.prototype.error = function (error, data) {
  if (this.id) {
    var err;
    if (error instanceof Error) {
      err = {name: error.name, message: error.message, stack: error.stack};      
    } else {
      err = error;
    }
    
    var responseData = {
      cid: this.id,
      error: err
    };
    if (data !== undefined) {
      responseData.data = data;
    }
    
    this._respond(responseData);
  }
};

var isBrowser = typeof window != 'undefined';

if (isBrowser) {
  var ActivityManager = function () {
    var self = this;
    
    this._interval = null;
    this._intervalDuration = 1000;
    this._counter = null;
    
    if (window.addEventListener) {
      window.addEventListener('blur', function () {
        self._triggerBlur();
      });
      window.addEventListener('focus', function () {
        self._triggerFocus();
      });
    } else if (window.attachEvent) {
      window.attachEvent('onblur', function () {
        self._triggerBlur();
      });
      window.attachEvent('onfocus', function () {
        self._triggerFocus();
      });
    } else {
      throw new Error('The browser does not support proper event handling');
    }
  };

  ActivityManager.prototype = Object.create(Emitter.prototype);

  ActivityManager.prototype._triggerBlur = function () {
    var self = this;
    
    var now = (new Date()).getTime();
    this._counter = now;
    
    // If interval skips 2 turns, then client is sleeping
    this._interval = setInterval(function () {
      var newCount = (new Date()).getTime();
      if (newCount - self._counter < self._intervalDuration * 3) {
        self._counter = newCount;
      }
    }, this._intervalDuration);
    
    this.emit('deactivate');
  };

  ActivityManager.prototype._triggerFocus = function () {
    clearInterval(this._interval);
    var now = (new Date()).getTime();
    if (this._counter != null && now - this._counter >= this._intervalDuration * 3) {
      this.emit('wakeup');
    }
    
    this.emit('activate');
  };

  var activityManager = new ActivityManager();
}

var SCSocket = function (options) {
  var self = this;
  
  var opts = {};
  for (var i in options) {
    opts[i] = options[i];
  }
  opts.forceBase64 = true;
  opts.path = (opts.path || '/socketcluster').replace(/\/$/, '') + '/';
  
  this._localEvents = {
    'connect': 1,
    'disconnect': 1,
    'upgrading': 1,
    'upgrade': 1,
    'upgradeError': 1,
    'open': 1,
    'error': 1,
    'packet': 1,
    'heartbeat': 1,
    'data': 1,
    'message': 1,
    'handshake': 1,
    'drain': 1,
    'flush': 1,
    'packetCreate': 1,
    'close': 1,
    'fail': 1
  };
  
  this._connectAttempts = 0;
  
  this._cid = 1;
  this._callbackMap = {};
  this._destId = null;
  this._emitBuffer = [];
  this._subscriptions = {};
  this._enableAutoReconnect = true;
  
  this._sessionDestRegex = /^([^_]*)_([^_]*)_([^_]*)_([^_]*)_/;
  
  this.options = opts;
  
  if (this.options.autoReconnect && this.options.autoReconnectOptions == null) {
    this.options.autoReconnectOptions = {
      delay: 10,
      randomness: 10
    };
  }
  
  if (this.options.url == null) {
    Socket.call(this, this.options);
  } else {
    Socket.call(this, this.options.url, this.options);
  }
  
  this.connected = false;
  this.connecting = true;
  
  if (isBrowser) {
    activityManager.on('wakeup', function () {
      self.close();
      self.connect();
    });
  }
};

SCSocket.prototype = Object.create(Socket.prototype);

SCSocket.prototype._setCookie = function (name, value, expirySeconds) {
  var exdate = null;
  if (expirySeconds) {
    exdate = new Date();
    exdate.setTime(exdate.getTime() + Math.round(expirySeconds * 1000));
  }
  var value = escape(value) + '; path=/;' + ((exdate == null) ? '' : ' expires=' + exdate.toUTCString() + ';');
  document.cookie = name + '=' + value;
};

SCSocket.prototype._getCookie = function (name) {
  var i, x, y, ARRcookies = document.cookie.split(';');
  for (i = 0; i < ARRcookies.length; i++) {
    x = ARRcookies[i].substr(0, ARRcookies[i].indexOf('='));
    y = ARRcookies[i].substr(ARRcookies[i].indexOf('=') + 1);
    x = x.replace(/^\s+|\s+$/g, '');
    if (x == name) {
      return unescape(y);
    }
  }
};

SCSocket.prototype._setSessionCookie = function (appName, socketId) {
  var sessionSegments = socketId.match(this._sessionDestRegex);
  var soidDest = sessionSegments ? sessionSegments[0] : null;
  var sessionCookieName = 'n/' + appName + '/ssid';
  
  var ssid = this._getCookie(sessionCookieName);
  var ssidDest = null;
  if (ssid) {
    ssidDest = ssid.match(this._sessionDestRegex);
    ssidDest = ssidDest ? ssidDest[0] : null;
  }
  if (!ssid || soidDest != ssidDest) {
    ssid = socketId;
    this._setCookie(sessionCookieName, ssid);
  }
  return ssid;
};

SCSocket.prototype.connect = SCSocket.prototype.open = function () {
  var self = this;
  
  if (!this.connected && !this.connecting) {
    this.connected = false;
    this.connecting = true;
    Socket.prototype.open.apply(this, arguments);
    this._resubscribe(function (err) {
      if (err) {
        self.emit('error', err);
      }
    });
    this.emit('ready');
  }
};

SCSocket.prototype.disconnect = function () {
  this._enableAutoReconnect = false;
  return Socket.prototype.close.apply(this);
};

SCSocket.prototype.onSCOpen = function () {
  this._connectAttempts = 0;
  this._enableAutoReconnect = true;
};

SCSocket.prototype._tryReconnect = function () {
  var self = this;
  
  if (!self.connected && !self.connecting &&
    this.options.autoReconnect && this._enableAutoReconnect) {
    
    this._emitBuffer = [];
    
    var reconnectOptions = this.options.autoReconnectOptions;
    var exponent = this._connectAttempts++;
    if (exponent > 5) {
      exponent = 5;
    }
    var initialTimeout = Math.round((reconnectOptions.delay + (reconnectOptions.randomness || 0) * Math.random()) * 1000);
    var timeout = Math.round(initialTimeout * Math.pow(1.5, exponent));
    setTimeout(function () {
      if (!self.connected && !self.connecting) {
        self.connect();
      }
    }, timeout);
  }
};

SCSocket.prototype.onSCError = function (err) {
  this.connecting = false;
  if (!this.connected) {
    this._tryReconnect();
  }
  if (this.listeners('error').length < 1) {
    setTimeout(function () {
      throw err;
    }, 0);
  }
};

SCSocket.prototype.onSCClose = function () {
  this.connected = false;
  this.connecting = false;
  if (!this._connectAttempts) {
    this._tryReconnect();
    Emitter.prototype.emit.call(this, 'disconnect');
  }
};

SCSocket.prototype.onSCMessage = function (message) {
  var self = this;
  
  var e;
  try {
    e = this.JSON.parse(message);
  } catch (err) {
    e = message;
  }
  
  if (e.event) {
    if (e.event == 'connect') {
      this.connected = true;
      this.connecting = false;
      
      if (isBrowser) {
        this.ssid = this._setSessionCookie(e.data.appName, this.id);
      } else {
        this.ssid = this.id;
      }
      Emitter.prototype.emit.call(this, e.event, e.data.soid);
      
      setTimeout(function () {
        self._flushEmitBuffer();
      }, 0);
      
    } else if (e.event == 'disconnect') {
      this.connected = false;
      this.connecting = false;
      Emitter.prototype.emit.call(this, 'disconnect');
    } else if (e.event == 'fail') {
      this.connected = false;
      this.connecting = false;
      Emitter.prototype.emit.call(this, 'error', e.data);
    } else {
      var response = new Response(this, e.cid);
      Emitter.prototype.emit.call(this, e.event, e.data, response);
    }
  } else if (e.cid == null) {
    Emitter.prototype.emit.call(this, 'raw', e);
  } else {
    var ret = this._callbackMap[e.cid];
    if (ret) {
      clearTimeout(ret.timeout);
      delete this._callbackMap[e.cid];
      ret.callback(e.error, e.data);
      if (e.error) {
        Emitter.prototype.emit.call(this, 'error', e.error);
      }
    }
  }
};

SCSocket.prototype._nextCallId = function () {
  return this._cid++;
};

SCSocket.prototype.createTransport = function () {
  return Socket.prototype.createTransport.apply(this, arguments);
};

SCSocket.prototype._emit = function (event, data, callback) {
  var eventObject = {
    event: event
  };
  if (data !== undefined) {
    eventObject.data = data;
  }
  if (callback) {
    var self = this;
    var cid = this._nextCallId();
    eventObject.cid = cid;
    
    var timeout = setTimeout(function () {
      delete self._callbackMap[cid];
      callback('Event response timed out', eventObject);
    }, this.pingTimeout);
    
    this._callbackMap[cid] = {callback: callback, timeout: timeout};
  }
  Socket.prototype.send.call(this, this.JSON.stringify(eventObject));
};

SCSocket.prototype._flushEmitBuffer = function () {
  var self = this;
  
  /*
    'subscribe' and 'ready' events have priority over other events 
    so they get emitted first.
  */
  
  var subscribeEvents = [];
  var readyEvents = [];
  var otherEvents = [];
  
  var ev;
  var len = this._emitBuffer.length;
  for (var i = 0; i < len; i++) {
    ev = this._emitBuffer[i];
    if (ev.event == 'subscribe') {
      subscribeEvents.push(ev);
    } else if (ev.event == 'ready') {
      readyEvents.push(ev);
    } else {
      otherEvents.push(ev);
    }
  }
  
  len = subscribeEvents.length;
  for (var j = 0; j < len; j++) {
    ev = subscribeEvents[j];
    this._emit(ev.event, ev.data, ev.callback);
  }
  
  len = readyEvents.length;
  for (var k = 0; k < len; k++) {
    ev = readyEvents[k];
    this._emit(ev.event, ev.data, ev.callback);
  }
  
  len = otherEvents.length;
  for (var m = 0; m < len; m++) {
    ev = otherEvents[m];
    this._emit(ev.event, ev.data, ev.callback);
  }
  
  this._emitBuffer = [];
};

SCSocket.prototype.emit = function (event, data, callback) {
  var self = this;
  
  if (this._localEvents[event] == null) {
    if (!this.connected && !this.connecting) {
      this.connect();
    }
    this._emitBuffer.push({event: event, data: data, callback: callback});
    if (this._emitBuffer.length < 2) {
      if (this.connected) {
        setTimeout(function () {
          self._flushEmitBuffer();
        }, 0);
      }
    }
  } else {
    switch (event) {
      case 'message':
        this.onSCMessage(data);
        break;
        
      case 'open':
        this.onSCOpen();
        break;
        
      case 'close':
        this.onSCClose();
        break;

      case 'error':
        this.onSCError(data);
        break;
    }
    Emitter.prototype.emit.call(this, event, data);
  }
  return this;
};

SCSocket.prototype._resubscribe = function (callback) {
  var self = this;
  
  var events = [];
  
  for (var event in this._subscriptions) {
    events.push(event);
  }
  if (events.length) {
    this.emit('subscribe', events, function (err) {
      if (err) {
        self.emit('error', err);
      }
      callback && callback(err);
    });
  }
};

SCSocket.prototype.on = function (event, listener, callback) {
  var self = this;
  
  if (this._localEvents[event] == null) {
    if (this._subscriptions[event]) {
      Emitter.prototype.on.call(self, event, listener);
      callback && callback();
    } else {
      Emitter.prototype.on.call(self, event, listener);
      this.emit('subscribe', event, function (err) {
        if (err) {
          Emitter.prototype.removeListener.call(self, event, listener);
          self.emit('error', err);
        } else {
          if (self._subscriptions[event] == null) {
            self._subscriptions[event] = 0;
          }
          self._subscriptions[event]++;
        }
        callback && callback(err);
      });
    }
  } else {
    Emitter.prototype.on.apply(this, arguments);
  }
};

SCSocket.prototype.once = function (event, listener, callback) {
  var self = this;
  
  this.on(event, listener, callback);
  Emitter.prototype.once.call(this, event, function () {
    self.removeListener(event, listener);
  });
};

SCSocket.prototype.removeListener = function (event, listener, callback) {
  var self = this;
  
  if (this._localEvents[event] == null) {
    Emitter.prototype.removeListener.call(this, event, listener);
    if (this._subscriptions[event] != null) {
      this._subscriptions[event]--;
      if (this._subscriptions[event] < 1) {
        this.emit('unsubscribe', event, function (err) {
          if (err) {
            self.emit('error', err);
          } else {
            delete self._subscriptions[event];
          }
          callback && callback(err);
        });
      }
    }
  } else {
    Emitter.prototype.removeListener.call(this, event, listener);
  }
};

/*
  removeAllListeners([event, callback]);
*/
SCSocket.prototype.removeAllListeners = function () {
  var self = this;
  
  var event, callback;
  if (typeof arguments[0] == 'string') {
    event = arguments[0];
    callback = arguments[1];
  } else {
    callback = arguments[0];
  }
  
  Emitter.prototype.removeAllListeners.call(this, event);
  
  this.emit('unsubscribe', event, function (err) {
    if (err) {
      self.emit('error', err);
    } else {
      if (event) {
        delete self._subscriptions[event];
      } else {
        self._subscriptions = {};
      }
    }
    callback && callback(err);
  });
};

SCSocket.prototype.listeners = function (event) {
  return Emitter.prototype.listeners.call(this, event);
};

if (typeof JSON != 'undefined') {
  SCSocket.prototype.JSON = JSON;
} else {
  SCSocket.prototype.JSON = require('./json').JSON;
}
SCSocket.JSON = SCSocket.prototype.JSON;

module.exports = SCSocket;