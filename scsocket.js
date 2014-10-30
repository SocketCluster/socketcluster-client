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
  
  var opts = {
    autoReconnect: true,
    ackTimeout: 10000
  };
  for (var i in options) {
    opts[i] = options[i];
  }
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
    'raw': 1,
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
  this._base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  
  this._sessionDestRegex = /^([^_]*)_([^_]*)_([^_]*)_([^_]*)_/;
  
  this.options = opts;
  
  if (this.options.autoReconnect && this.options.autoReconnectOptions == null) {
    this.options.autoReconnectOptions = {
      delay: 10000,
      randomness: 10000
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
    this._resubscribe();
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
    var initialTimeout = Math.round(reconnectOptions.delay + (reconnectOptions.randomness || 0) * Math.random());
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
      self.emit('error', e.data);
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
    }
    if (e.error) {
      self.emit('error', e.error);
    }
  }
};

SCSocket.prototype._nextCallId = function () {
  return this._cid++;
};

SCSocket.prototype._isOwnDescendant = function (object, ancestors) {
  for (var i in ancestors) {
    if (ancestors[i] === object) {
      return true;
    }
  }
  return false;
};

SCSocket.prototype._arrayBufferToBase64 = function (arraybuffer) {
  var chars = this._base64Chars;
  var bytes = new Uint8Array(arraybuffer);
  var len = bytes.length;
  var base64 = '';

  for (var i = 0; i < len; i += 3) {
    base64 += chars[bytes[i] >> 2];
    base64 += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
    base64 += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
    base64 += chars[bytes[i + 2] & 63];
  }

  if ((len % 3) === 2) {
    base64 = base64.substring(0, base64.length - 1) + '=';
  } else if (len % 3 === 1) {
    base64 = base64.substring(0, base64.length - 2) + '==';
  }

  return base64;
};

SCSocket.prototype._convertBuffersToBase64 = function (object, ancestors) {
  if (!ancestors) {
    ancestors = [];
  }
  if (this._isOwnDescendant(object, ancestors)) {
    throw new Error('Cannot traverse circular structure');
  }
  var newAncestors = ancestors.concat([object]);
  
  if (object instanceof ArrayBuffer) {
    return {
      base64: true,
      data: this._arrayBufferToBase64(object)
    };
  }
  
  if (object instanceof Array) {
    var base64Array = [];
    for (var i in object) {
      base64Array[i] = this._convertBuffersToBase64(object[i], newAncestors);
    }
    return base64Array;
  }
  if (object instanceof Object) {
    var base64Object = {};
    for (var j in object) {
      base64Object[j] = this._convertBuffersToBase64(object[j], newAncestors);
    }
    return base64Object;
  }
  
  return object;
};

SCSocket.prototype.parse = function (message) {
  return this.JSON.parse(message);
};

SCSocket.prototype.stringify = function (object) {
  return this.JSON.stringify(this._convertBuffersToBase64(object));
};

SCSocket.prototype._emit = function (event, data, callback) {
  var self = this;
  
  var eventObject = {
    event: event
  };
  if (data !== undefined) {
    eventObject.data = data;
  }
  eventObject.cid = this._nextCallId();
  
  if (callback) {
    var timeout = setTimeout(function () {
      var error = new Error("Event response for '" + event + "' timed out");
      delete self._callbackMap[eventObject.cid];
      callback(error, eventObject);
      self.emit('error', error);
    }, this.options.ackTimeout);
    
    this._callbackMap[eventObject.cid] = {callback: callback, timeout: timeout};
  }
  Socket.prototype.send.call(this, this.stringify(eventObject));
};

SCSocket.prototype._flushEmitBuffer = function () {
  var self = this;
  
  // Some events have priority over other events
  
  var subUnsubEvents = [];
  var readyEvents = [];
  var otherEvents = [];
  
  var ev;
  var len = this._emitBuffer.length;
  for (var i = 0; i < len; i++) {
    ev = this._emitBuffer[i];
    if (ev.event == 'subscribe' || ev.event == 'unsubscribe') {
      subUnsubEvents.push(ev);
    } else if (ev.event == 'ready') {
      readyEvents.push(ev);
    } else {
      otherEvents.push(ev);
    }
  }
  
  len = subUnsubEvents.length;
  for (var j = 0; j < len; j++) {
    ev = subUnsubEvents[j];
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

SCSocket.prototype.publish = function (event, data, callback) {
  var pubData = {
    event: event,
    data: data
  };
  return this.emit('publish', pubData, function (err) {
    callback && callback(err);
  });
};

SCSocket.prototype._execParallel = function (tasks, count, callback) {
  var pendingCount = count;
  var errorCount = 0;
  var errorMap = {};
  
  for (var i in tasks) {
    (function (i) {
      tasks[i](function (err) {
        pendingCount--;
        if (err) {
          errorCount++;
          errorMap[i] = err;
        }
        if (pendingCount < 1 && callback) {
          if (errorCount) {
            if (count > 1) {
              callback(errorMap);
            } else {
              callback(errorMap[i]);
            }
          } else {
            callback();
          }
        }
      });
    })(i);
  }
};

SCSocket.prototype.subscribe = function (channels, callback) {
  var self = this;
  
  if (!(channels instanceof Array)) {
    channels = [channels];
  }
  
  var tasks = {};
  
  for (var i in channels) {
    (function (channel) {
      tasks[channel] = function (cb) {
        self.emit('subscribe', channel, function (err) {
          if (!err) {
            self._subscriptions[channel] = true;
          }
          cb(err);
        });
      };
    })(channels[i]);
  }
  
  this._execParallel(tasks, channels.length, callback);
};

SCSocket.prototype.unsubscribe = function (channels, callback) {
  var self = this;
  
  if (!(channels instanceof Array)) {
    channels = [channels];
  }
  
  var tasks = {};
  
  for (var i in channels) {
    (function (channel) {
      tasks[channel] = function (cb) {
        self.emit('unsubscribe', channel, function (err) {
          if (!err) {
            delete self._subscriptions[event];
          }
          cb(err);
        });
      };
    })(channels[i]);
  }
  
  this._execParallel(tasks, channels.length, callback);
};

SCSocket.prototype._resubscribe = function (callback) {
  var self = this;
  
  var events = [];
  for (var event in this._subscriptions) {
    events.push(event);
  }
  var error;
  var ackCount = 0;
  
  var ackHandler = function (err) {
    ackCount++;
    if (!error) {
      if (err) {
        error = err;
        callback && callback(err);
      } else if (ackCount >= events.length) {
        callback && callback();
      }
    }
  };
  for (var i in events) {
    this.emit('subscribe', events[i], ackHandler);
  }
};

if (typeof JSON != 'undefined') {
  SCSocket.prototype.JSON = JSON;
} else {
  SCSocket.prototype.JSON = require('./json').JSON;
}
SCSocket.JSON = SCSocket.prototype.JSON;

module.exports = SCSocket;