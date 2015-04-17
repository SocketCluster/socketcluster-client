!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.socketCluster=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

// If obj.hasOwnProperty has been overridden, then calling
// obj.hasOwnProperty(prop) will break.
// See: https://github.com/joyent/node/issues/1707
function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

module.exports = function(qs, sep, eq, options) {
  sep = sep || '&';
  eq = eq || '=';
  var obj = {};

  if (typeof qs !== 'string' || qs.length === 0) {
    return obj;
  }

  var regexp = /\+/g;
  qs = qs.split(sep);

  var maxKeys = 1000;
  if (options && typeof options.maxKeys === 'number') {
    maxKeys = options.maxKeys;
  }

  var len = qs.length;
  // maxKeys <= 0 means that we should not limit keys count
  if (maxKeys > 0 && len > maxKeys) {
    len = maxKeys;
  }

  for (var i = 0; i < len; ++i) {
    var x = qs[i].replace(regexp, '%20'),
        idx = x.indexOf(eq),
        kstr, vstr, k, v;

    if (idx >= 0) {
      kstr = x.substr(0, idx);
      vstr = x.substr(idx + 1);
    } else {
      kstr = x;
      vstr = '';
    }

    k = decodeURIComponent(kstr);
    v = decodeURIComponent(vstr);

    if (!hasOwnProperty(obj, k)) {
      obj[k] = v;
    } else if (isArray(obj[k])) {
      obj[k].push(v);
    } else {
      obj[k] = [obj[k], v];
    }
  }

  return obj;
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

},{}],2:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

var stringifyPrimitive = function(v) {
  switch (typeof v) {
    case 'string':
      return v;

    case 'boolean':
      return v ? 'true' : 'false';

    case 'number':
      return isFinite(v) ? v : '';

    default:
      return '';
  }
};

module.exports = function(obj, sep, eq, name) {
  sep = sep || '&';
  eq = eq || '=';
  if (obj === null) {
    obj = undefined;
  }

  if (typeof obj === 'object') {
    return map(objectKeys(obj), function(k) {
      var ks = encodeURIComponent(stringifyPrimitive(k)) + eq;
      if (isArray(obj[k])) {
        return map(obj[k], function(v) {
          return ks + encodeURIComponent(stringifyPrimitive(v));
        }).join(sep);
      } else {
        return ks + encodeURIComponent(stringifyPrimitive(obj[k]));
      }
    }).join(sep);

  }

  if (!name) return '';
  return encodeURIComponent(stringifyPrimitive(name)) + eq +
         encodeURIComponent(stringifyPrimitive(obj));
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

function map (xs, f) {
  if (xs.map) return xs.map(f);
  var res = [];
  for (var i = 0; i < xs.length; i++) {
    res.push(f(xs[i], i));
  }
  return res;
}

var objectKeys = Object.keys || function (obj) {
  var res = [];
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) res.push(key);
  }
  return res;
};

},{}],3:[function(require,module,exports){
'use strict';

exports.decode = exports.parse = require('./decode');
exports.encode = exports.stringify = require('./encode');

},{"./decode":1,"./encode":2}],4:[function(require,module,exports){
var SCSocket = require('./lib/scsocket');
module.exports.SCSocket = SCSocket;

module.exports.Emitter = require('emitter');

module.exports.connect = function (options) {
  return new SCSocket(options);
};
},{"./lib/scsocket":8,"emitter":9}],5:[function(require,module,exports){
module.exports.create = (function () {
  function F() {};

  return function (o) {
    if (arguments.length != 1) {
      throw new Error('Object.create implementation only accepts one parameter.');
    }
    F.prototype = o;
    return new F();
  }
})();
},{}],6:[function(require,module,exports){

var Response = function (socket, id) {
  this.socket = socket;
  this.id = id;
};

Response.prototype._respond = function (responseData) {
  this.socket.send(this.socket.stringify(responseData));
};

Response.prototype.end = function (data) {
  if (this.id) {
    var responseData = {
      rid: this.id
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
      rid: this.id,
      error: err
    };
    if (data !== undefined) {
      responseData.data = data;
    }
    
    this._respond(responseData);
  }
};

Response.prototype.callback = function (error, data) {
  if (error) {
    this.error(error, data);
  } else {
    this.end(data);
  }
};

module.exports.Response = Response;
},{}],7:[function(require,module,exports){
var Emitter = require('emitter');

if (!Object.create) {
  Object.create = require('./objectcreate');
}

var SCChannel = function (name, socket) {
  var self = this;
  
  Emitter.call(this);
  
  this.PENDING = 'pending';
  this.SUBSCRIBED = 'subscribed';
  this.UNSUBSCRIBED = 'unsubscribed';
  
  this.name = name;
  this.state = this.UNSUBSCRIBED;
  this.socket = socket;
};

SCChannel.prototype = Object.create(Emitter.prototype);

SCChannel.prototype.getState = function () {
  return this.state;
};

SCChannel.prototype.subscribe = function () {
  this.socket.subscribe(this.name);
};

SCChannel.prototype.unsubscribe = function () {
  this.socket.unsubscribe(this.name);
};

SCChannel.prototype.isSubscribed = function (includePending) {
  return this.socket.isSubscribed(this.name, includePending);
};

// publish([data, guaranteeDelivery, callback])
SCChannel.prototype.publish = function () {
  var data = arguments[0];
  var guaranteeDelivery, callback;
  if (arguments[1] instanceof Function) {
    guaranteeDelivery = false;
    callback = arguments[1];
  } else {
    guaranteeDelivery = arguments[1];
    callback = arguments[2];
  }
  this.socket.publish(this.name, data, guaranteeDelivery, callback);
};

SCChannel.prototype.watch = function (handler) {
  this.socket.watch(this.name, handler);
};

SCChannel.prototype.unwatch = function (handler) {
  this.socket.unwatch(this.name, handler);
};

SCChannel.prototype.destroy = function () {
  this.socket.destroyChannel(this.name);
};

module.exports = SCChannel;
},{"./objectcreate":5,"emitter":9}],8:[function(require,module,exports){
(function (global){
var WebSocket = require('ws');
var Emitter = require('emitter');
var SCChannel = require('./scchannel');
var Response = require('./response').Response;
var ExpiryManager = require('expirymanager').ExpiryManager;
var querystring = require('querystring');
var LinkedList = require('linked-list');
var uuid = require('node-uuid');

if (!Object.create) {
  Object.create = require('./objectcreate');
}

var isBrowser = typeof window != 'undefined';


var SCSocket = function (options) {
  var self = this;
  
  Emitter.call(this);
  
  var opts = {
    port: null,
    autoReconnect: true,
    ackTimeout: 10000,
    initTimeout: 9000,
    hostname: global.location && location.hostname,
    path: '/socketcluster/',
    secure: global.location && location.protocol == 'https:',
    timestampRequests: false,
    timestampParam: 't',
    binaryType: 'arraybuffer',
    deliveryTrackingDefaultDuration: 120000,
    deliveryTrackingCheckInterval: 10000
  };
  for (var i in options) {
    opts[i] = options[i];
  }
  
  this.id = null;
  this.state = this.CLOSED;
  
  this.ackTimeout = opts.ackTimeout;
  
  // pingTimeout will be ackTimeout at the start, but it will
  // be updated with values provided by the 'ready' event
  this.pingTimeout = this.ackTimeout;
  this.initTimeout = opts.initTimeout;
  this.deliveryTrackingDuration = opts.deliveryTrackingDefaultDuration;
  this.deliveryTrackingCheckInterval = opts.deliveryTrackingCheckInterval;
  
  this._localEvents = {
    'open': 1,
    'connect': 1,
    'connectFail': 1,
    'disconnect': 1,
    'message': 1,
    'error': 1,
    'raw': 1,
    'fail': 1,
    'kickOut': 1,
    'setAuthToken': 1,
    'removeAuthToken': 1,
    'ready': 1
  };
  
  this._connectAttempts = 0;
  
  this._cid = 1;
  this._callbackMap = {};
  this._destId = null;
  this._emitBuffer = new LinkedList();
  this._channels = {};
  this._base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  this._tokenData = null;
  this._pingTimeoutTicker = null;
  this._alreadyReceivedManager = new ExpiryManager();
  this._pendingReceptionMap = {};
  this._lastSeq = -1;
  
  this.options = opts;
  
  if (this.options.autoReconnect) {
    if (this.options.autoReconnectOptions == null) {
      this.options.autoReconnectOptions = {};
    }
    
    var reconnectOptions = this.options.autoReconnectOptions;
    if (reconnectOptions.initialDelay == null) {
      reconnectOptions.initialDelay = 10000;
    }
    if (reconnectOptions.randomness == null) {
      reconnectOptions.randomness = 10000;
    }
    if (reconnectOptions.multiplier == null) {
      reconnectOptions.multiplier = 1.5;
    }
    if (reconnectOptions.maxDelay == null) {
      reconnectOptions.maxDelay = 60000;
    }
  }
  
  if (this.options.subscriptionRetryOptions == null) {
    this.options.subscriptionRetryOptions = {};
  }
  
  var subscriptionOptions = this.options.subscriptionRetryOptions;
  if (subscriptionOptions.initialDelay == null) {
    subscriptionOptions.initialDelay = 5000;
  }
  if (subscriptionOptions.randomness == null) {
    subscriptionOptions.randomness = 0;
  }
  if (subscriptionOptions.multiplier == null) {
    subscriptionOptions.multiplier = 1.5;
  }
  if (subscriptionOptions.maxDelay == null) {
    subscriptionOptions.maxDelay = 20000;
  }
  
  this.options.path = this.options.path.replace(/\/$/, '') + '/';
  
  this.options.query = opts.query || {};
  if (typeof this.options.query == 'string') {
    this.options.query = querystring.parse(this.options.query);
  }

  this.options.port = opts.port || (global.location && location.port ?
    location.port : (this.options.secure ? 443 : 80));
  
  this.connect();
  
  this._channelEmitter = new Emitter();
  
  if (isBrowser) {
    var unloadHandler = function () {
      self.disconnect();
    };

    if (global.attachEvent) {
      global.attachEvent('onunload', unloadHandler);
    } else if (global.addEventListener) {
      global.addEventListener('beforeunload', unloadHandler, false);
    }
  }
};

SCSocket.prototype = Object.create(Emitter.prototype);

SCSocket.CONNECTING = SCSocket.prototype.CONNECTING = 'connecting';
SCSocket.OPEN = SCSocket.prototype.OPEN = 'open';
SCSocket.CLOSED = SCSocket.prototype.CLOSED = 'closed';

SCSocket.ignoreStatuses = {
  1000: 'Socket closed normally',
  1001: 'Socket hung up'
};

SCSocket.errorStatuses = {
  1001: 'Socket was disconnected',
  1002: 'A WebSocket protocol error was encountered',
  1003: 'Server terminated socket because it received invalid data',
  1005: 'Socket closed without status code',
  1006: 'Socket hung up',
  1007: 'Message format was incorrect',
  1008: 'Encountered a policy violation',
  1009: 'Message was too big to process',
  1010: 'Client ended the connection because the server did not comply with extension requirements',
  1011: 'Server encountered an unexpected fatal condition',
  4000: 'Server ping timed out',
  4001: 'Client pong timed out',
  4002: "Client socket initialization timed out - Client did not receive a 'ready' event"
};

SCSocket.prototype.uri = function () {
  var query = this.options.query || {};
  var schema = this.options.secure ? 'wss' : 'ws';
  var port = '';

  if (this.options.port && (('wss' == schema && this.options.port != 443)
    || ('ws' == schema && this.options.port != 80))) {
    port = ':' + this.options.port;
  }

  if (this.options.timestampRequests) {
    query[this.options.timestampParam] = (new Date()).getTime();
  }

  query = querystring.stringify(query);

  if (query.length) {
    query = '?' + query;
  }

  return schema + '://' + this.options.hostname + port + this.options.path + query;
};

SCSocket.prototype.getState = function () {
  return this.state;
};

SCSocket.prototype._cleanupAlreadyReceived = function () {
  this._alreadyReceivedManager.extractExpiredKeys();
};

SCSocket.prototype.getBytesReceived = function () {
  return this.socket.bytesReceived;
};

SCSocket.prototype.connect = SCSocket.prototype.open = function () {
  var self = this;
  
  if (this.state == this.CLOSED) {
    this.state = this.CONNECTING;
    
    var uri = this.uri();
    var socket = new WebSocket(uri, null, this.options);
    socket.binaryType = this.options.binaryType;
    this.socket = socket;
    
    socket.onopen = function () {
      self._onSCOpen(socket);
    };
    
    socket.onclose = function (event) {
      self._onSCClose(socket, event.code, event.reason);
    };
    
    socket.onmessage = function (message, flags) {
      self._onSCMessage(socket, message.data);
    };
  }
};

SCSocket.prototype.disconnect = function (code, data) {
  code = code || 1000;
  
  if (this.state == this.OPEN) {
    this.sendObject({
      disconnect: 1,
      code: code,
      data: data
    });
    
    this.socket.close(code);
    this._onSCClose(this.socket, code, data);
  }
};

SCSocket.prototype._onSCOpen = function (socket) {
  var self = this;
  
  this.state = this.OPEN;
  this._connectAttempts = 0;
  this._lastSeq = -1;
  
  this._alreadyReceivedCleanupInterval = setInterval(function () {
    self._cleanupAlreadyReceived();
  }, this.deliveryTrackingCheckInterval);

  this._resubscribe(socket);
  Emitter.prototype.emit.call(this, 'connect');
  
  this._flushEmitBuffer(socket);
  this._resetPingTimeout(socket);
  
  clearTimeout(this._initTimeoutTicker);
  
  // In case 'ready' event isn't triggered on time
  this._initTimeoutTicker = setTimeout(function () {
    socket.close(4002);
    self._onSCClose(socket, 4002);
  }, this.initTimeout);
};

SCSocket.prototype._tryReconnect = function (initialDelay) {
  var self = this;
  
  var exponent = this._connectAttempts++;
  var reconnectOptions = this.options.autoReconnectOptions;
  var timeout;
  
  if (initialDelay == null || exponent > 0) {
    var initialTimeout = Math.round(reconnectOptions.initialDelay + (reconnectOptions.randomness || 0) * Math.random());
    
    timeout = Math.round(initialTimeout * Math.pow(reconnectOptions.multiplier, exponent));
  } else {
    timeout = initialDelay;
  }
  
  if (timeout > reconnectOptions.maxDelay) {
    timeout = reconnectOptions.maxDelay;
  }
  
  clearTimeout(this._reconnectTimeout);
  
  this._reconnectTimeout = setTimeout(function () {
    self.connect();
  }, timeout);
};

SCSocket.prototype._onSCError = function (err) {
  var self = this;
  
  // Throw error in different stack frame so that error handling
  // cannot interfere with a reconnect action.
  setTimeout(function () {
    if (self.listeners('error').length < 1) {
        throw err;
    } else {
      Emitter.prototype.emit.call(self, 'error', err);
    }
  }, 0);
};

SCSocket.prototype._suspendSubscriptions = function () {
  var channel, newState;
  for (var channelName in this._channels) {
    channel = this._channels[channelName];
    if (channel.state == channel.SUBSCRIBED ||
      channel.state == channel.PENDING) {
      
      newState = channel.PENDING;
    } else {
      newState = channel.UNSUBSCRIBED;
    }
    this._triggerChannelUnsubscribe(channel, newState);
  }
};

SCSocket.prototype._onSCClose = function (socket, code, data) {
  clearTimeout(this._pingTimeoutTicker);
  clearInterval(this._alreadyReceivedCleanupInterval);
  this._alreadyReceivedManager.clear();
  
  if (this.state != this.CLOSED) {
    var oldState = this.state;
    
    this.id = null;

    this._suspendSubscriptions();
    this.state = this.CLOSED;

    delete socket.onopen;
    delete socket.onclose;
    delete socket.onmessage;
    
    if (oldState == this.OPEN) {
      Emitter.prototype.emit.call(this, 'disconnect', code, data);
    } else if (oldState == this.CONNECTING) {
      Emitter.prototype.emit.call(this, 'connectFail', code, data);
    }
    
    // Try to reconnect
    // on server ping timeout (4000)
    // or on client pong timeout (4001)
    // or on close without status (1005)
    // or on initialization timeout (4002)
    // or on socket hung up (1006)
    if (this.options.autoReconnect) {
      if (code == 4000 || code == 4001 || code == 1005) {
        // If there is a ping or pong timeout or socket closes without 
        // status, don't wait before trying to reconnect - These could happen
        // if the client wakes up after a period of inactivity and in this case we
        // want to re-establish the connection as soon as possible.
        this._tryReconnect(0);
        
      } else if (code == 1006 || code == 4002) {
        this._tryReconnect();
      }
    }
    
    if (!SCSocket.ignoreStatuses[code]) {
      var err = new Error(SCSocket.errorStatuses[code] || 'Socket connection failed for unknown reasons');
      err.code = code;
      this._onSCError(err);
    }
  }
};

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

SCSocket.prototype._onSCMessage = function (socket, message) {
  Emitter.prototype.emit.call(this, 'message', message);

  // If ping
  if (message == '1') {
    this._resetPingTimeout(socket);
    if (this.state == this.OPEN) {
      // Send a pong to whatever this.socket currently is
      this.send('2');
    }
  } else {
    var obj;
    try {
      obj = this.parse(message);
    } catch (err) {
      obj = message;
    }
    
    if (obj.event) {
      if (obj.event == 'fail') {
        this._onSCError(obj.data);
        
      } else if (obj.event == 'publish') {
        var publishData = obj.data;
        var mid = publishData.mid;
        var seq = publishData.seq;
        
        var isSubscribed = this.isSubscribed(publishData.channel, true);
        
        if (this.deliveryTrackingDuration && mid != null) {
          var response = new Response(this, obj.cid);
          var isAlreadyDelivered = this._alreadyReceivedManager.getExpiry(mid) != null;
          if (!isAlreadyDelivered && isSubscribed) {
            var i;
            // If seq is 0, then we reset to a fresh sequence of messages
            if (seq == 0) {
               i = 0;
               this._pendingReceptionMap = {};
            } else {
              i = this._lastSeq + 1;
            }
            this._pendingReceptionMap[seq] = publishData;
            var pendingPublishData = this._pendingReceptionMap[i];
            
            while (pendingPublishData) {
              this._lastSeq = i;
              delete this._pendingReceptionMap[i];
              this._channelEmitter.emit(pendingPublishData.channel, pendingPublishData.data);
              pendingPublishData = this._pendingReceptionMap[++i];
            }
            this._alreadyReceivedManager.expire([mid], Math.round(this.deliveryTrackingDuration / 1000));
          }
          response.end(mid);
        } else if (isSubscribed) {
          this._channelEmitter.emit(publishData.channel, publishData.data);
        }
      } else if (obj.event == 'kickOut') {
        var kickData = obj.data || {};
        var channelName = kickData.channel;
        var channel = this._channels[channelName];
        if (channel) {
          Emitter.prototype.emit.call(this, obj.event, kickData.message, channelName);
          channel.emit(obj.event, kickData.message, channelName);
          this._triggerChannelUnsubscribe(channel);
        }
      } else if (obj.event == 'setAuthToken') {
        var tokenData = obj.data;
        var response = new Response(this, obj.cid);
        
        if (tokenData) {
          this._tokenData = tokenData;
          
          if (tokenData.persistent && tokenData.expiresInMinutes != null) {
            this._setCookie(tokenData.cookieName, tokenData.token, tokenData.expiresInMinutes * 60);
          } else {
            this._setCookie(tokenData.cookieName, tokenData.token);
          }
          Emitter.prototype.emit.call(this, obj.event, tokenData.token);
          response.end();
        } else {
          response.error('No token data provided with setAuthToken event');
        }
      } else if (obj.event == 'removeAuthToken') {
        if (this._tokenData) {
          this._setCookie(this._tokenData.cookieName, null, -1);
          Emitter.prototype.emit.call(this, obj.event);
        }
        var response = new Response(this, obj.cid);
        response.end();
      } else if (obj.event == 'ready') {
        if (obj.data) {
          this.id = obj.data.id;
          this.pingTimeout = obj.data.pingTimeout;
          // Optimize the deliveryTrackingExpiry to be the shortest amount of time necessary
          // in order to guarantee exactly-once delivery of published messages.
          // We add ackTimeout to account for latency (margin of error).
          this.deliveryTrackingDuration = obj.data.deliveryTimeout + this.ackTimeout;
        }
        this._resetPingTimeout(socket);
        clearTimeout(this._initTimeoutTicker);
        Emitter.prototype.emit.call(this, obj.event, obj.data);
      } else {
        var response = new Response(this, obj.cid);
        Emitter.prototype.emit.call(this, obj.event, obj.data, function (error, data) {
          response.callback(error, data);
        });
      }
    } else if (obj.disconnect) {
      this._onSCClose(socket, obj.code, obj.data);
    } else if (obj.rid != null) {
      var ret = this._callbackMap[obj.rid];
      if (ret) {
        clearTimeout(ret.timeout);
        delete this._callbackMap[obj.rid];
        ret.callback(obj.error, obj.data);
      }
      if (obj.error) {
        this._onSCError(obj.error);
      }
    } else {
      Emitter.prototype.emit.call(this, 'raw', obj);
    }
  }
};

SCSocket.prototype._resetPingTimeout = function (socket) {
  var self = this;
  
  var now = (new Date()).getTime();
  clearTimeout(this._pingTimeoutTicker);
  
  this._pingTimeoutTicker = setTimeout(function () {
    socket.close(4000);
    self._onSCClose(socket, 4000);
  }, this.pingTimeout);
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
  
  if (typeof ArrayBuffer != 'undefined' && object instanceof ArrayBuffer) {
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
  return JSON.parse(message);
};

SCSocket.prototype.stringify = function (object) {
  return JSON.stringify(this._convertBuffersToBase64(object));
};

SCSocket.prototype._send = function (socket, data, options) {
  if (!socket || socket.readyState != socket.OPEN) {
    this._onSCClose(socket, 1005);
  } else {
    socket.send(data, options);
  }
};

SCSocket.prototype._sendObject = function (socket, object, options) {
  this._send(socket, this.stringify(object), options);
};

SCSocket.prototype.send = function (data, options) {
  this._send(this.socket, data, options);
};

SCSocket.prototype.sendObject = function (object, options) {
  this._sendObject(this.socket, object, options);
};

SCSocket.prototype._emitRaw = function (socket, eventObject) {
  eventObject.cid = this._nextCallId();
  
  if (eventObject.callback) {
    this._callbackMap[eventObject.cid] = eventObject;
  }
  
  var simpleEventObject = {
    event: eventObject.event,
    data: eventObject.data,
    cid: eventObject.cid
  };
  
  this._sendObject(socket, simpleEventObject);
};

SCSocket.prototype._flushEmitBuffer = function (socket) {
  var currentNode = this._emitBuffer.head;
  var nextNode;

  while (currentNode) {
    nextNode = currentNode.next;
    var eventObject = currentNode.data;
    currentNode.detach();
    this._emitRaw(socket, eventObject);
    currentNode = nextNode;
  }
};

SCSocket.prototype._handleEventAckTimeout = function (eventObject, eventNode) {
  var errorMessage = "Event response for '" + eventObject.event + "' timed out";
  if (eventObject.errorDetails) {
    errorMessage += ' - ' + eventObject.errorDetails;
  }
  var error = new Error(errorMessage);
  error.type = 'timeout';
  
  if (eventObject.cid) {
    delete this._callbackMap[eventObject.cid];
  }
  var callback = eventObject.callback;
  delete eventObject.callback;
  if (eventNode) {
    eventNode.detach();
  }
  callback.call(eventObject, error, eventObject);
  this._onSCError(error);
};

// Emit directly without appending to emitBuffer
// The last two optional arguments (a and b) can be options and/or callback
SCSocket.prototype._emitDirect = function (socket, event, data, a, b) {
  var self = this;
  
  var callback, options;
  
  if (b) {
    options = a;
    callback = b;
  } else {
    if (a instanceof Function) {
      callback = a;
    } else {
      options = a;
    }
  }
  
  var eventObject = {
    event: event,
    data: data,
    callback: callback
  };
  
  // Message to provide in case of error
  if (options && options.errorDetails) {
    eventObject.errorDetails = options.errorDetails;
  }
  
  // Events which do not have a callback will be treated as volatile
  if (callback) {
    eventObject.timeout = setTimeout(function () {
      self._handleEventAckTimeout(eventObject);
    }, this.ackTimeout);
  }
  
  if (this.state == this.OPEN) {
    this._emitRaw(socket, eventObject);
  }
};

SCSocket.prototype._emit = function (socket, event, data, callback) {
  var self = this;
  
  if (this.state == this.CLOSED || socket.readyState == socket.CLOSED) {
    this.connect();
  }
  var eventObject = {
    event: event,
    data: data,
    callback: callback
  };
  
  var eventNode = new LinkedList.Item();
  eventNode.data = eventObject;
  
  // Events which do not have a callback will be treated as volatile
  if (callback) {
    eventObject.timeout = setTimeout(function () {
      self._handleEventAckTimeout(eventObject, eventNode);
    }, this.ackTimeout);
  }
  this._emitBuffer.append(eventNode);
  
  if (this.state == this.OPEN) {
    this._flushEmitBuffer(socket);
  }
};

SCSocket.prototype.emit = function (event, data, callback) {
  if (this._localEvents[event] == null) {
    this._emit(this.socket, event, data, callback);
  } else {
    Emitter.prototype.emit.call(this, event, data);
  }
};

// publish(channelName, [data, guaranteeDelivery, callback])
SCSocket.prototype.publish = function () {
  var self = this;
  
  var channelName = arguments[0];
  var data = arguments[1];
  var guaranteeDelivery, callback;
  if (arguments[2] instanceof Function) {
    guaranteeDelivery = false;
    callback = arguments[2];
  } else {
    guaranteeDelivery = arguments[2];
    callback = arguments[3];
  }
  
  var pubData = {
    channel: channelName,
    data: data
  };
  if (guaranteeDelivery) {
    pubData.mid = uuid.v4();
  }
  this.emit('publish', pubData, function (err) {
    callback && callback(err);
  });
};

SCSocket.prototype._retrySubscribe = function (socket, channel) {
  var self = this;
  
  if (this.state == this.OPEN) {
    if (channel.subscribeAttempts == null) {
      channel.subscribeAttempts = 0;
    }
    
    var subscriptionOptions = this.options.subscriptionRetryOptions;
    var initialTimeout = Math.round(subscriptionOptions.initialDelay + (subscriptionOptions.randomness || 0) * Math.random());
    var timeout = Math.round(initialTimeout * Math.pow(subscriptionOptions.multiplier, channel.subscribeAttempts));
    channel.subscribeAttempts++;
    
    if (timeout > subscriptionOptions.maxDelay) {
      timeout = subscriptionOptions.maxDelay;
    }
    
    clearTimeout(channel.retrySubscribeTimeoutTicker);
    channel.retrySubscribeTimeoutTicker = setTimeout(function () {
      if (channel.state == channel.PENDING) {
        self._trySubscribe(socket, channel);
      }
    }, timeout);
  }
};

SCSocket.prototype._trySubscribe = function (socket, channel) {
  var self = this;
  
  if (this.state == this.OPEN) {
    var options = {
      errorDetails: 'Channel: ' + channel.name
    };
    this._emitDirect(socket, 'subscribe', channel.name, options, function (err) {
      if (err) {
        if (err.type == 'timeout') {
          self._retrySubscribe(socket, channel);
        } else {
          self._triggerChannelSubscribeFail(err, channel);
        }
      } else {
        channel.subscribeAttempts = 0;
        self._triggerChannelSubscribe(channel);
      }
    });
  }
};

SCSocket.prototype.subscribe = function (channelName) {
  var channel = this._channels[channelName];
  
  if (!channel) {
    channel = new SCChannel(channelName, this);
    this._channels[channelName] = channel;
  }
  clearTimeout(channel.retryUnsubscribeTimeoutTicker);

  if (channel.state == channel.UNSUBSCRIBED) {
    channel.state = channel.PENDING;
    
    channel.subscribeAttempts = 0;
    this._trySubscribe(this.socket, channel);
  }
  
  return channel;
};

SCSocket.prototype._retryUnsubscribe = function (socket, channel) {
  var self = this;
  
  if (this.state == this.OPEN) {
    if (channel.unsubscribeAttempts == null) {
      channel.unsubscribeAttempts = 0;
    }
    
    var subscriptionOptions = this.options.subscriptionRetryOptions;
    var initialTimeout = Math.round(subscriptionOptions.initialDelay + (subscriptionOptions.randomness || 0) * Math.random());
    var timeout = Math.round(initialTimeout * Math.pow(subscriptionOptions.multiplier, channel.unsubscribeAttempts));
    channel.unsubscribeAttempts++;
    
    if (timeout > subscriptionOptions.maxDelay) {
      timeout = subscriptionOptions.maxDelay;
    }
    
    clearTimeout(channel.retryUnsubscribeTimeoutTicker);
    channel.retryUnsubscribeTimeoutTicker = setTimeout(function () {
      // Only unsubscribe from server if client channel is in UNSUBSCRIBED state
      if (channel.state == channel.UNSUBSCRIBED) {
        self._tryUnsubscribe(socket, channel);
      }
    }, timeout);
  }
};

SCSocket.prototype._tryUnsubscribe = function (socket, channel) {
  var self = this;
  
  if (this.state == this.OPEN) {
    var options = {
      errorDetails: 'Channel: ' + channel.name
    };
    this._emitDirect(socket, 'unsubscribe', channel.name, options, function (err) {
      if (err) {
        self._retryUnsubscribe(socket, channel);
      } else {
        channel.unsubscribeAttempts = 0;
      }
    });
  }
};

SCSocket.prototype.unsubscribe = function (channelName) {

  var channel = this._channels[channelName];
  
  if (channel) {
    if (channel.state != channel.UNSUBSCRIBED) {
    
      this._triggerChannelUnsubscribe(channel);
      
      channel.unsubscribeAttempts = 0;
      this._tryUnsubscribe(this.socket, channel);
    }
  }
};

SCSocket.prototype.channel = function (channelName) {
  var currentChannel = this._channels[channelName];
  
  if (!currentChannel) {
    currentChannel = new SCChannel(channelName, this);
    this._channels[channelName] = currentChannel;
  }
  return currentChannel;
};

SCSocket.prototype.destroyChannel = function (channelName) {
  var channel = this._channels[channelName];
  channel.unwatch();
  channel.unsubscribe();
  delete this._channels[channelName];
};

SCSocket.prototype.subscriptions = function (includePending) {
  var subs = [];
  var channel, includeChannel;
  for (var channelName in this._channels) {
    channel = this._channels[channelName];
    
    if (includePending) {
      includeChannel = channel && (channel.state == channel.SUBSCRIBED || 
        channel.state == channel.PENDING);
    } else {
      includeChannel = channel && channel.state == channel.SUBSCRIBED;
    }
    
    if (includeChannel) {
      subs.push(channelName);
    }
  }
  return subs;
};

SCSocket.prototype.isSubscribed = function (channel, includePending) {
  var channel = this._channels[channel];
  if (includePending) {
    return !!channel && (channel.state == channel.SUBSCRIBED ||
      channel.state == channel.PENDING);
  }
  return !!channel && channel.state == channel.SUBSCRIBED;
};

SCSocket.prototype._triggerChannelSubscribe = function (channel) {
  var channelName = channel.name;
  
  if (channel.state != channel.SUBSCRIBED) {
    channel.state = channel.SUBSCRIBED;
    
    channel.emit('subscribe', channelName);
    Emitter.prototype.emit.call(this, 'subscribe', channelName);
  }
};

SCSocket.prototype._triggerChannelSubscribeFail = function (err, channel) {
  var channelName = channel.name;
  
  if (channel.state != channel.UNSUBSCRIBED) {
    channel.state = channel.UNSUBSCRIBED;
    
    channel.emit('subscribeFail', err, channelName);
    Emitter.prototype.emit.call(this, 'subscribeFail', err, channelName);
  }
};

SCSocket.prototype._triggerChannelUnsubscribe = function (channel, newState) {
  var channelName = channel.name;
  var oldState = channel.state;
  
  clearTimeout(channel.retrySubscribeTimeoutTicker);
  
  if (newState) {
    channel.state = newState;
  } else {
    channel.state = channel.UNSUBSCRIBED;
  }
  if (oldState == channel.SUBSCRIBED) {
    channel.emit('unsubscribe', channelName);
    Emitter.prototype.emit.call(this, 'unsubscribe', channelName);
  }
};

SCSocket.prototype._resubscribe = function (socket) {
  var self = this;
  
  var channels = [];
  for (var channelName in this._channels) {
    channels.push(channelName);
  }
  
  for (var i in this._channels) {
    (function (channel) {
      if (channel.state == channel.PENDING) {
        channel.subscribeAttempts = 0;
        self._trySubscribe(socket, channel);
      }
    })(this._channels[i]);
  }
};

SCSocket.prototype.watch = function (channelName, handler) {
  this._channelEmitter.on(channelName, handler);
};

SCSocket.prototype.unwatch = function (channelName, handler) {
  if (handler) {
    this._channelEmitter.removeListener(channelName, handler);
  } else {
    this._channelEmitter.removeAllListeners(channelName);
  }
};

SCSocket.prototype.watchers = function (channelName) {
  return this._channelEmitter.listeners(channelName);
};

module.exports = SCSocket;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./objectcreate":5,"./response":6,"./scchannel":7,"emitter":9,"expirymanager":11,"linked-list":13,"node-uuid":14,"querystring":3,"ws":15}],9:[function(require,module,exports){

/**
 * Module dependencies.
 */

var index = require('indexof');

/**
 * Expose `Emitter`.
 */

module.exports = Emitter;

/**
 * Initialize a new `Emitter`.
 *
 * @api public
 */

function Emitter(obj) {
  if (obj) return mixin(obj);
};

/**
 * Mixin the emitter properties.
 *
 * @param {Object} obj
 * @return {Object}
 * @api private
 */

function mixin(obj) {
  for (var key in Emitter.prototype) {
    obj[key] = Emitter.prototype[key];
  }
  return obj;
}

/**
 * Listen on the given `event` with `fn`.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.on = function(event, fn){
  this._callbacks = this._callbacks || {};
  (this._callbacks[event] = this._callbacks[event] || [])
    .push(fn);
  return this;
};

/**
 * Adds an `event` listener that will be invoked a single
 * time then automatically removed.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.once = function(event, fn){
  var self = this;
  this._callbacks = this._callbacks || {};

  function on() {
    self.off(event, on);
    fn.apply(this, arguments);
  }

  fn._off = on;
  this.on(event, on);
  return this;
};

/**
 * Remove the given callback for `event` or all
 * registered callbacks.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.off =
Emitter.prototype.removeListener =
Emitter.prototype.removeAllListeners = function(event, fn){
  this._callbacks = this._callbacks || {};

  // all
  if (0 == arguments.length) {
    this._callbacks = {};
    return this;
  }

  // specific event
  var callbacks = this._callbacks[event];
  if (!callbacks) return this;

  // remove all handlers
  if (1 == arguments.length) {
    delete this._callbacks[event];
    return this;
  }

  // remove specific handler
  var i = index(callbacks, fn._off || fn);
  if (~i) callbacks.splice(i, 1);
  return this;
};

/**
 * Emit `event` with the given args.
 *
 * @param {String} event
 * @param {Mixed} ...
 * @return {Emitter}
 */

Emitter.prototype.emit = function(event){
  this._callbacks = this._callbacks || {};
  var args = [].slice.call(arguments, 1)
    , callbacks = this._callbacks[event];

  if (callbacks) {
    callbacks = callbacks.slice(0);
    for (var i = 0, len = callbacks.length; i < len; ++i) {
      callbacks[i].apply(this, args);
    }
  }

  return this;
};

/**
 * Return array of callbacks for `event`.
 *
 * @param {String} event
 * @return {Array}
 * @api public
 */

Emitter.prototype.listeners = function(event){
  this._callbacks = this._callbacks || {};
  return this._callbacks[event] || [];
};

/**
 * Check if this emitter has `event` handlers.
 *
 * @param {String} event
 * @return {Boolean}
 * @api public
 */

Emitter.prototype.hasListeners = function(event){
  return !! this.listeners(event).length;
};

},{"indexof":10}],10:[function(require,module,exports){

var indexOf = [].indexOf;

module.exports = function(arr, obj){
  if (indexOf) return arr.indexOf(obj);
  for (var i = 0; i < arr.length; ++i) {
    if (arr[i] === obj) return i;
  }
  return -1;
};
},{}],11:[function(require,module,exports){
var ExpiryManager = module.exports.ExpiryManager = function () {
  this._keys = {};
  this._expiries = {};
};

ExpiryManager.prototype._isEmpty = function (obj) {
  for (var i in obj) {
    if (obj.hasOwnProperty(i)) {
      return false;
    }
  }
  return true;
};

ExpiryManager.prototype._simplifyKey = function (key) {
  if (key instanceof Array) {
    // Use escape sequence to delimit array
    return '\\u001b' + key.join('\\u001b');
  }
  return key;
};

ExpiryManager.prototype._expandKey = function (key) {
  var regex = /^\\u001b/;
  if (regex.test(key)) {
    return key.replace(regex, '').split('\\u001b');
  }
  return key;
};

ExpiryManager.prototype.now = function () {
  return Math.round((new Date()).getTime() / 1000);
};

ExpiryManager.prototype.expire = function (keys, seconds) {
  this.unexpire(keys);
  var expiry = this.now() + seconds;
  var len = keys.length;
  var key;
  for (var i = 0; i < len; i++) {
    key = this._simplifyKey(keys[i]);
    this._keys[key] = expiry;
    if (this._expiries[expiry] == null) {
      this._expiries[expiry] = {};
    }
    this._expiries[expiry][key] = 1;
  }
};

ExpiryManager.prototype.unexpire = function (keys) {
  var len = keys.length;
  var expiry, key;
  for (var i = 0; i < len; i++) {
    key = this._simplifyKey(keys[i]);
    expiry = this._keys[key];
    delete this._keys[key];
    if (expiry && this._expiries[expiry] != null) {
      delete this._expiries[expiry][key];
      if (this._isEmpty(this._expiries[expiry])) {
        delete this._expiries[expiry];
      }
    }
  }
};

ExpiryManager.prototype.getExpiry = function (key) {
  key = this._simplifyKey(key);
  return this._keys[key];
};

ExpiryManager.prototype.getKeysByExpiry = function (expiry) {
  var keys = [];
  var keyMap = this._expiries[expiry];
  for (var i in keyMap) {
    if (keyMap.hasOwnProperty(i)) {
      keys.push(this._expandKey(i));
    }
  }
  return keys;
};

ExpiryManager.prototype.getExpiredKeys = function (time) {
  var expiredKeys = [];
  var now = time || this.now();
  var expiries = this._expiries;
  
  for (var i in expiries) {
    if (expiries.hasOwnProperty(i)) {
      if (i <= now) {
        for (var j in expiries[i]) {
          if (expiries[i].hasOwnProperty(j)) {
            expiredKeys.push(this._expandKey(j));
          }
        }
      } else {
        break;
      }
    }
  }
  return expiredKeys;
};

ExpiryManager.prototype.extractExpiredKeys = function (time) {
  var expiredKeys = this.getExpiredKeys(time);
  this.unexpire(expiredKeys);
  return expiredKeys;
};

ExpiryManager.prototype.clear = function () {
  this._keys = {};
  this._expiries = {};
};
},{}],12:[function(require,module,exports){
'use strict';

/**
 * Constants.
 */

var errorMessage;

errorMessage = 'An argument without append, prepend, ' +
    'or detach methods was given to `List';

/**
 * Creates a new List: A linked list is a bit like an Array, but
 * knows nothing about how many items are in it, and knows only about its
 * first (`head`) and last (`tail`) items. Each item (e.g. `head`, `tail`,
 * &c.) knows which item comes before or after it (its more like the
 * implementation of the DOM in JavaScript).
 * @global
 * @private
 * @constructor
 * @class Represents an instance of List.
 */

function List(/*items...*/) {
    if (arguments.length) {
        return List.from(arguments);
    }
}

var ListPrototype;

ListPrototype = List.prototype;

/**
 * Creates a new list from the arguments (each a list item) passed in.
 * @name List.of
 * @param {...ListItem} [items] - Zero or more items to attach.
 * @returns {list} - A new instance of List.
 */

List.of = function (/*items...*/) {
    return List.from.call(this, arguments);
};

/**
 * Creates a new list from the given array-like object (each a list item)
 * passed in.
 * @name List.from
 * @param {ListItem[]} [items] - The items to append.
 * @returns {list} - A new instance of List.
 */
List.from = function (items) {
    var list = new this(), length, iterator, item;

    if (items && (length = items.length)) {
        iterator = -1;

        while (++iterator < length) {
            item = items[iterator];

            if (item !== null && item !== undefined) {
                list.append(item);
            }
        }
    }

    return list;
};

/**
 * List#head
 * Default to `null`.
 */
ListPrototype.head = null;

/**
 * List#tail
 * Default to `null`.
 */
ListPrototype.tail = null;

/**
 * Returns the list's items as an array. This does *not* detach the items.
 * @name List#toArray
 * @returns {ListItem[]} - An array of (still attached) ListItems.
 */
ListPrototype.toArray = function () {
    var item = this.head,
        result = [];

    while (item) {
        result.push(item);
        item = item.next;
    }

    return result;
};

/**
 * Prepends the given item to the list: Item will be the new first item
 * (`head`).
 * @name List#prepend
 * @param {ListItem} item - The item to prepend.
 * @returns {ListItem} - An instance of ListItem (the given item).
 */
ListPrototype.prepend = function (item) {
    if (!item) {
        return false;
    }

    if (!item.append || !item.prepend || !item.detach) {
        throw new Error(errorMessage + '#prepend`.');
    }

    var self, head;

    // Cache self.
    self = this;

    // If self has a first item, defer prepend to the first items prepend
    // method, and return the result.
    head = self.head;

    if (head) {
        return head.prepend(item);
    }

    // ...otherwise, there is no `head` (or `tail`) item yet.

    // Detach the prependee.
    item.detach();

    // Set the prependees parent list to reference self.
    item.list = self;

    // Set self's first item to the prependee, and return the item.
    self.head = item;

    return item;
};

/**
 * Appends the given item to the list: Item will be the new last item (`tail`)
 * if the list had a first item, and its first item (`head`) otherwise.
 * @name List#append
 * @param {ListItem} item - The item to append.
 * @returns {ListItem} - An instance of ListItem (the given item).
 */

ListPrototype.append = function (item) {
    if (!item) {
        return false;
    }

    if (!item.append || !item.prepend || !item.detach) {
        throw new Error(errorMessage + '#append`.');
    }

    var self, head, tail;

    // Cache self.
    self = this;

    // If self has a last item, defer appending to the last items append
    // method, and return the result.
    tail = self.tail;

    if (tail) {
        return tail.append(item);
    }

    // If self has a first item, defer appending to the first items append
    // method, and return the result.
    head = self.head;

    if (head) {
        return head.append(item);
    }

    // ...otherwise, there is no `tail` or `head` item yet.

    // Detach the appendee.
    item.detach();

    // Set the appendees parent list to reference self.
    item.list = self;

    // Set self's first item to the appendee, and return the item.
    self.head = item;

    return item;
};

/**
 * Creates a new ListItem: A linked list item is a bit like DOM node:
 * It knows only about its "parent" (`list`), the item before it (`prev`),
 * and the item after it (`next`).
 * @global
 * @private
 * @constructor
 * @class Represents an instance of ListItem.
 */

function ListItem() {}

List.Item = ListItem;

var ListItemPrototype = ListItem.prototype;

ListItemPrototype.next = null;

ListItemPrototype.prev = null;

ListItemPrototype.list = null;

/**
 * Detaches the item operated on from its parent list.
 * @name ListItem#detach
 * @returns {ListItem} - The item operated on.
 */
ListItemPrototype.detach = function () {
    // Cache self, the parent list, and the previous and next items.
    var self = this,
        list = self.list,
        prev = self.prev,
        next = self.next;

    // If the item is already detached, return self.
    if (!list) {
        return self;
    }

    // If self is the last item in the parent list, link the lists last item
    // to the previous item.
    if (list.tail === self) {
        list.tail = prev;
    }

    // If self is the first item in the parent list, link the lists first item
    // to the next item.
    if (list.head === self) {
        list.head = next;
    }

    // If both the last and first items in the parent list are the same,
    // remove the link to the last item.
    if (list.tail === list.head) {
        list.tail = null;
    }

    // If a previous item exists, link its next item to selfs next item.
    if (prev) {
        prev.next = next;
    }

    // If a next item exists, link its previous item to selfs previous item.
    if (next) {
        next.prev = prev;
    }

    // Remove links from self to both the next and previous items, and to the
    // parent list.
    self.prev = self.next = self.list = null;

    // Return self.
    return self;
};

/**
 * Prepends the given item *before* the item operated on.
 * @name ListItem#prepend
 * @param {ListItem} item - The item to prepend.
 * @returns {ListItem} - The item operated on, or false when that item is not
 * attached.
 */
ListItemPrototype.prepend = function (item) {
    if (!item || !item.append || !item.prepend || !item.detach) {
        throw new Error(errorMessage + 'Item#prepend`.');
    }

    // Cache self, the parent list, and the previous item.
    var self = this,
        list = self.list,
        prev = self.prev;

    // If self is detached, return false.
    if (!list) {
        return false;
    }

    // Detach the prependee.
    item.detach();

    // If self has a previous item...
    if (prev) {
        // ...link the prependees previous item, to selfs previous item.
        item.prev = prev;

        // ...link the previous items next item, to self.
        prev.next = item;
    }

    // Set the prependees next item to self.
    item.next = self;

    // Set the prependees parent list to selfs parent list.
    item.list = list;

    // Set the previous item of self to the prependee.
    self.prev = item;

    // If self is the first item in the parent list, link the lists first item
    // to the prependee.
    if (self === list.head) {
        list.head = item;
    }

    // If the the parent list has no last item, link the lists last item to
    // self.
    if (!list.tail) {
        list.tail = self;
    }

    // Return the prependee.
    return item;
};

/**
 * Appends the given item *after* the item operated on.
 * @name ListItem#append
 * @param {ListItem} item - The item to append.
 * @returns {ListItem} - The item operated on, or false when that item is not
 * attached.
 */
ListItemPrototype.append = function (item) {
    // If item is falsey, return false.
    if (!item || !item.append || !item.prepend || !item.detach) {
        throw new Error(errorMessage + 'Item#append`.');
    }

    // Cache self, the parent list, and the next item.
    var self = this,
        list = self.list,
        next = self.next;

    // If self is detached, return false.
    if (!list) {
        return false;
    }

    // Detach the appendee.
    item.detach();

    // If self has a next item...
    if (next) {
        // ...link the appendees next item, to selfs next item.
        item.next = next;

        // ...link the next items previous item, to the appendee.
        next.prev = item;
    }

    // Set the appendees previous item to self.
    item.prev = self;

    // Set the appendees parent list to selfs parent list.
    item.list = list;

    // Set the next item of self to the appendee.
    self.next = item;

    // If the the parent list has no last item or if self is the parent lists
    // last item, link the lists last item to the appendee.
    if (self === list.tail || !list.tail) {
        list.tail = item;
    }

    // Return the appendee.
    return item;
};

/**
 * Expose `List`.
 */

module.exports = List;

},{}],13:[function(require,module,exports){
'use strict';

module.exports = require('./_source/linked-list.js');

},{"./_source/linked-list.js":12}],14:[function(require,module,exports){
//     uuid.js
//
//     Copyright (c) 2010-2012 Robert Kieffer
//     MIT License - http://opensource.org/licenses/mit-license.php

(function() {
  var _global = this;

  // Unique ID creation requires a high quality random # generator.  We feature
  // detect to determine the best RNG source, normalizing to a function that
  // returns 128-bits of randomness, since that's what's usually required
  var _rng;

  // Node.js crypto-based RNG - http://nodejs.org/docs/v0.6.2/api/crypto.html
  //
  // Moderately fast, high quality
  if (typeof(_global.require) == 'function') {
    try {
      var _rb = _global.require('crypto').randomBytes;
      _rng = _rb && function() {return _rb(16);};
    } catch(e) {}
  }

  if (!_rng && _global.crypto && crypto.getRandomValues) {
    // WHATWG crypto-based RNG - http://wiki.whatwg.org/wiki/Crypto
    //
    // Moderately fast, high quality
    var _rnds8 = new Uint8Array(16);
    _rng = function whatwgRNG() {
      crypto.getRandomValues(_rnds8);
      return _rnds8;
    };
  }

  if (!_rng) {
    // Math.random()-based (RNG)
    //
    // If all else fails, use Math.random().  It's fast, but is of unspecified
    // quality.
    var  _rnds = new Array(16);
    _rng = function() {
      for (var i = 0, r; i < 16; i++) {
        if ((i & 0x03) === 0) r = Math.random() * 0x100000000;
        _rnds[i] = r >>> ((i & 0x03) << 3) & 0xff;
      }

      return _rnds;
    };
  }

  // Buffer class to use
  var BufferClass = typeof(_global.Buffer) == 'function' ? _global.Buffer : Array;

  // Maps for number <-> hex string conversion
  var _byteToHex = [];
  var _hexToByte = {};
  for (var i = 0; i < 256; i++) {
    _byteToHex[i] = (i + 0x100).toString(16).substr(1);
    _hexToByte[_byteToHex[i]] = i;
  }

  // **`parse()` - Parse a UUID into it's component bytes**
  function parse(s, buf, offset) {
    var i = (buf && offset) || 0, ii = 0;

    buf = buf || [];
    s.toLowerCase().replace(/[0-9a-f]{2}/g, function(oct) {
      if (ii < 16) { // Don't overflow!
        buf[i + ii++] = _hexToByte[oct];
      }
    });

    // Zero out remaining bytes if string was short
    while (ii < 16) {
      buf[i + ii++] = 0;
    }

    return buf;
  }

  // **`unparse()` - Convert UUID byte array (ala parse()) into a string**
  function unparse(buf, offset) {
    var i = offset || 0, bth = _byteToHex;
    return  bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]];
  }

  // **`v1()` - Generate time-based UUID**
  //
  // Inspired by https://github.com/LiosK/UUID.js
  // and http://docs.python.org/library/uuid.html

  // random #'s we need to init node and clockseq
  var _seedBytes = _rng();

  // Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
  var _nodeId = [
    _seedBytes[0] | 0x01,
    _seedBytes[1], _seedBytes[2], _seedBytes[3], _seedBytes[4], _seedBytes[5]
  ];

  // Per 4.2.2, randomize (14 bit) clockseq
  var _clockseq = (_seedBytes[6] << 8 | _seedBytes[7]) & 0x3fff;

  // Previous uuid creation time
  var _lastMSecs = 0, _lastNSecs = 0;

  // See https://github.com/broofa/node-uuid for API details
  function v1(options, buf, offset) {
    var i = buf && offset || 0;
    var b = buf || [];

    options = options || {};

    var clockseq = options.clockseq != null ? options.clockseq : _clockseq;

    // UUID timestamps are 100 nano-second units since the Gregorian epoch,
    // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
    // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
    // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.
    var msecs = options.msecs != null ? options.msecs : new Date().getTime();

    // Per 4.2.1.2, use count of uuid's generated during the current clock
    // cycle to simulate higher resolution clock
    var nsecs = options.nsecs != null ? options.nsecs : _lastNSecs + 1;

    // Time since last uuid creation (in msecs)
    var dt = (msecs - _lastMSecs) + (nsecs - _lastNSecs)/10000;

    // Per 4.2.1.2, Bump clockseq on clock regression
    if (dt < 0 && options.clockseq == null) {
      clockseq = clockseq + 1 & 0x3fff;
    }

    // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
    // time interval
    if ((dt < 0 || msecs > _lastMSecs) && options.nsecs == null) {
      nsecs = 0;
    }

    // Per 4.2.1.2 Throw error if too many uuids are requested
    if (nsecs >= 10000) {
      throw new Error('uuid.v1(): Can\'t create more than 10M uuids/sec');
    }

    _lastMSecs = msecs;
    _lastNSecs = nsecs;
    _clockseq = clockseq;

    // Per 4.1.4 - Convert from unix epoch to Gregorian epoch
    msecs += 12219292800000;

    // `time_low`
    var tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
    b[i++] = tl >>> 24 & 0xff;
    b[i++] = tl >>> 16 & 0xff;
    b[i++] = tl >>> 8 & 0xff;
    b[i++] = tl & 0xff;

    // `time_mid`
    var tmh = (msecs / 0x100000000 * 10000) & 0xfffffff;
    b[i++] = tmh >>> 8 & 0xff;
    b[i++] = tmh & 0xff;

    // `time_high_and_version`
    b[i++] = tmh >>> 24 & 0xf | 0x10; // include version
    b[i++] = tmh >>> 16 & 0xff;

    // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)
    b[i++] = clockseq >>> 8 | 0x80;

    // `clock_seq_low`
    b[i++] = clockseq & 0xff;

    // `node`
    var node = options.node || _nodeId;
    for (var n = 0; n < 6; n++) {
      b[i + n] = node[n];
    }

    return buf ? buf : unparse(b);
  }

  // **`v4()` - Generate random UUID**

  // See https://github.com/broofa/node-uuid for API details
  function v4(options, buf, offset) {
    // Deprecated - 'format' argument, as supported in v1.2
    var i = buf && offset || 0;

    if (typeof(options) == 'string') {
      buf = options == 'binary' ? new BufferClass(16) : null;
      options = null;
    }
    options = options || {};

    var rnds = options.random || (options.rng || _rng)();

    // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
    rnds[6] = (rnds[6] & 0x0f) | 0x40;
    rnds[8] = (rnds[8] & 0x3f) | 0x80;

    // Copy bytes to buffer, if provided
    if (buf) {
      for (var ii = 0; ii < 16; ii++) {
        buf[i + ii] = rnds[ii];
      }
    }

    return buf || unparse(rnds);
  }

  // Export public API
  var uuid = v4;
  uuid.v1 = v1;
  uuid.v4 = v4;
  uuid.parse = parse;
  uuid.unparse = unparse;
  uuid.BufferClass = BufferClass;

  if (typeof(module) != 'undefined' && module.exports) {
    // Publish as node.js module
    module.exports = uuid;
  } else  if (typeof define === 'function' && define.amd) {
    // Publish as AMD module
    define(function() {return uuid;});
 

  } else {
    // Publish as global (in browsers)
    var _previousRoot = _global.uuid;

    // **`noConflict()` - (browser only) to reset global 'uuid' var**
    uuid.noConflict = function() {
      _global.uuid = _previousRoot;
      return uuid;
    };

    _global.uuid = uuid;
  }
}).call(this);

},{}],15:[function(require,module,exports){

/**
 * Module dependencies.
 */

var global = (function() { return this; })();

/**
 * WebSocket constructor.
 */

var WebSocket = global.WebSocket || global.MozWebSocket;

/**
 * Module exports.
 */

module.exports = WebSocket ? ws : null;

/**
 * WebSocket constructor.
 *
 * The third `opts` options object gets ignored in web browsers, since it's
 * non-standard, and throws a TypeError if passed to the constructor.
 * See: https://github.com/einaros/ws/issues/227
 *
 * @param {String} uri
 * @param {Array} protocols (optional)
 * @param {Object) opts (optional)
 * @api public
 */

function ws(uri, protocols, opts) {
  var instance;
  if (protocols) {
    instance = new WebSocket(uri, protocols);
  } else {
    instance = new WebSocket(uri);
  }
  return instance;
}

if (WebSocket) ws.prototype = WebSocket.prototype;

},{}]},{},[4])(4)
});
