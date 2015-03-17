var WebSocket = require('ws');
var Emitter = require('emitter');
var SCChannel = require('./scchannel');
var Response = require('./response').Response;
var querystring = require('querystring');
var LinkedList = require('linked-list');

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
    hostname: global.location && location.hostname,
    path: '/socketcluster/',
    secure: global.location && location.protocol == 'https:',
    timestampRequests: false,
    timestampParam: 't',
    binaryType: 'arraybuffer'
  };
  for (var i in options) {
    opts[i] = options[i];
  }
  
  this.id = null;
  this.state = this.CLOSED;
  this.pingTimeout = opts.ackTimeout;
  
  this._localEvents = {
    'open': 1,
    'connect': 1,
    'connectFail': 1,
    'disconnect': 1,
    'error': 1,
    'raw': 1,
    'fail': 1,
    'kickOut': 1,
    'setAuthToken': 1,
    'removeAuthToken': 1,
    'ready': 1
  };
  
  this._persistentEvents = {
    'subscribe': 1,
    'unsubscribe': 1
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
  this._lastPingResetTime = null;
  
  this.options = opts;
  
  if (this.options.autoReconnect && this.options.autoReconnectOptions == null) {
    this.options.autoReconnectOptions = {
      delay: 10000,
      randomness: 10000
    };
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
  1006: 'Socket hung up',
  1007: 'Message format was incorrect',
  1008: 'Encountered a policy violation',
  1009: 'Message was too big to process',
  1010: 'Client ended the connection because the server did not comply with extension requirements',
  1011: 'Server encountered an unexpected fatal condition',
  4000: 'Server ping timed out',
  4001: 'Client pong timed out'
};

SCSocket.prototype.uri = function(){
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
      var code = event.code;
      
      // Ignore normal close (1000)
      if (code != 1000) {
        self._onSCClose(socket, code, event.reason);
      }
    };
    
    socket.onmessage = function (message, flags) {
      self._onSCMessage(socket, message.data);
    };
    
    this._resubscribe(socket);
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
    
    this._onSCClose(this.socket, code, data);
    this.socket.close(code);
  }
};

SCSocket.prototype._onSCOpen = function (socket) {
  this.state = this.OPEN;
  this._connectAttempts = 0;

  Emitter.prototype.emit.call(this, 'connect');
  this._flushEmitBuffer(socket);
  this._resetPingTimeout(socket);
};

SCSocket.prototype._tryReconnect = function (delay) {
  var self = this;
  
  var reconnectOptions = this.options.autoReconnectOptions;
  var exponent = this._connectAttempts++;
  if (exponent > 5) {
    exponent = 5;
  }
  
  var timeout;
  if (delay == null) {
    var initialTimeout = Math.round(reconnectOptions.delay + (reconnectOptions.randomness || 0) * Math.random());
    timeout = Math.round(initialTimeout * Math.pow(1.5, exponent));
  } else {
    timeout = delay;
  }
 
  
  clearTimeout(this._reconnectTimeout);
  
  this._reconnectTimeout = setTimeout(function () {
    if (self.state == self.CLOSED) {
      self.connect();
    }
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
  if (this.state != this.CLOSED) {
    var oldState = this.state;
    
    this.id = null;
    
    clearTimeout(this._pingTimeoutTicker);

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
    
    // Try to reconnect if the socket hung up (1006)
    // or in case of ping timeout (4000)
    if (this.options.autoReconnect) {
      if (code == 4000) {
        // If ping timeout, don't wait before trying to reconnect
        this._tryReconnect(0);
        
      } else if (code == 1006){
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

  var e;
  try {
    e = this.parse(message);
  } catch (err) {
    e = message;
  }
  
  if (e.event) {
    if (e.event == 'fail') {
      this._onSCError(e.data);
      
    } else if (e.event == 'kickOut') {
      var kickData = e.data || {};
      var channelName = kickData.channel;
      var channel = this._channels[channelName];
      if (channel) {
        Emitter.prototype.emit.call(this, e.event, kickData.message, channelName);
        channel.emit(e.event, kickData.message, channelName);
        this._triggerChannelUnsubscribe(channel);
      }
    } else if (e.event == 'setAuthToken') {
      var tokenData = e.data;
      var response = new Response(this, e.cid);
      
      if (tokenData) {
        this._tokenData = tokenData;
        
        if (tokenData.persistent && tokenData.expiresInMinutes != null) {
          this._setCookie(tokenData.cookieName, tokenData.token, tokenData.expiresInMinutes * 60);
        } else {
          this._setCookie(tokenData.cookieName, tokenData.token);
        }
        Emitter.prototype.emit.call(this, e.event, tokenData.token);
        response.end();
      } else {
        response.error('No token data provided with setAuthToken event');
      }
    } else if (e.event == 'removeAuthToken') {
      if (this._tokenData) {
        this._setCookie(this._tokenData.cookieName, null, -1);
        Emitter.prototype.emit.call(this, e.event);
      }
      var response = new Response(this, e.cid);
      response.end();
    } else if (e.event == 'ready') {
      if (e.data) {
        this.id = e.data.id;
        this.pingTimeout = e.data.pingTimeout;
      }
      this._resetPingTimeout(socket);
      Emitter.prototype.emit.call(this, e.event, e.data);
    } else {
      var response = new Response(this, e.cid);
      Emitter.prototype.emit.call(this, e.event, e.data, function (error, data) {
        response.callback(error, data);
      });
    }
  } else if (e.ping) {
    this._resetPingTimeout(socket);
    if (this.state == this.OPEN) {
      this.sendObject({pong: 1});
    }
  } else if (e.channel) {
    this._channelEmitter.emit(e.channel, e.data);
  } else if (e.disconnect) {
    this._onSCClose(socket, e.code, e.data);
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
      this._onSCError(e.error);
    }
  }
};

SCSocket.prototype._resetPingTimeout = function (socket) {
  var self = this;
  
  // Ping timeout can be caused either by
  // network failure or client-side inactivity
  
  var now = (new Date()).getTime();
  var timeDiff = 0;
  if (this._lastPingResetTime != null) {
    timeDiff = now - this._lastPingResetTime;
  }
  this._lastPingResetTime = now;
  
  // If the time difference since last reset is greater 
  // than pingTimeout, then we know that the client
  // was inactive and some resets were skipped - In this
  // case we will ignore the current ping reset
  
  if (timeDiff <= this.pingTimeout) {
    clearTimeout(this._pingTimeoutTicker);
    this._pingTimeoutTicker = setTimeout(function () {
      socket.close();
      self._onSCClose(socket, 4000);
    }, this.pingTimeout);
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
  socket.send(data, options);
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
  var self = this;
  
  var currentNode = this._emitBuffer.head;

  while (currentNode) {
    var eventObject = currentNode.data;
    currentNode.detach();
    self._emitRaw(socket, eventObject);
    currentNode = currentNode.next;
  }
};

SCSocket.prototype._emit = function (socket, event, data, callback) {
  var self = this;
  
  if (this._localEvents[event] == null) {
    if (this.state == this.CLOSED) {
      this.connect();
    }
    var eventObject = {
      event: event,
      data: data,
      callback: callback
    };
    
    var eventNode = new LinkedList.Item();
    eventNode.data = eventObject;
    
    // Only non-persistent events should timeout and they
    // must have a callback or else they will be treated
    // as volatile
    if (!this._persistentEvents[event] && callback) {
      eventObject.timeout = setTimeout(function () {
        var error = new Error("Event response for '" + event + "' timed out", eventObject);
        
        if (eventObject.cid) {
          delete self._callbackMap[eventObject.cid];
        }
        delete eventObject.callback;
        eventNode.detach();
        callback.call(eventObject, error, eventObject);
        self._onSCError(error);
      }, this.options.ackTimeout);
    }
    this._emitBuffer.append(eventNode);
    
    if (this.state == this.OPEN) {
      this._flushEmitBuffer(socket);
    }
  } else {
    Emitter.prototype.emit.call(this, event, data);
  }
};

SCSocket.prototype.emit = function (event, data, callback) {
  this._emit(this.socket, event, data, callback);
};

SCSocket.prototype.publish = function (channelName, data, callback) {
  var self = this;
  
  var pubData = {
    channel: channelName,
    data: data
  };
  this.emit('publish', pubData, function (err) {
    callback && callback(err);
  });
};

SCSocket.prototype.subscribe = function (channelName) {
  var self = this;
  
  var channel = this._channels[channelName];
  
  if (!channel) {
    channel = new SCChannel(channelName, this);
    this._channels[channelName] = channel;
  }

  if (channel.state == channel.UNSUBSCRIBED) {
    channel.state = channel.PENDING;
    this.emit('subscribe', channelName, function (err) {
      if (err) {
        self._triggerChannelSubscribeFail(err, channel);
      } else {
        self._triggerChannelSubscribe(channel);
      }
    });
  }
  
  return channel;
};

SCSocket.prototype.unsubscribe = function (channelName) {

  var channel = this._channels[channelName];
  
  if (channel) {
    if (channel.state != channel.UNSUBSCRIBED) {
    
      this._triggerChannelUnsubscribe(channel);
      
      // The only case in which unsubscribe can fail is if the connection is closed or dies.
      // If that's the case, the server will automatically unsubscribe the client so
      // we don't need to check for failure since this operation can never really fail.
      
      this.emit('unsubscribe', channelName);
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
  
  channel.state = channel.SUBSCRIBED;
  
  channel.emit('subscribe', channelName);
  Emitter.prototype.emit.call(this, 'subscribe', channelName);
};

SCSocket.prototype._triggerChannelSubscribeFail = function (err, channel) {
  var channelName = channel.name;
  
  channel.state = channel.UNSUBSCRIBED;
  
  channel.emit('subscribeFail', err, channelName);
  Emitter.prototype.emit.call(this, 'subscribeFail', err, channelName);
};

SCSocket.prototype._triggerChannelUnsubscribe = function (channel, newState) {
  var channelName = channel.name;
  var oldState = channel.state;
  
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

SCSocket.prototype._resubscribe = function (socket, callback) {
  var self = this;
  
  var channels = [];
  for (var channelName in this._channels) {
    channels.push(channelName);
  }
  var error;
  var ackCount = 0;
  
  var ackHandler = function (err, channel) {
    ackCount++;
    
    if (err) {
      self._triggerChannelSubscribeFail(err, channel);
    } else {
      self._triggerChannelSubscribe(channel);
    }
    if (!error) {
      if (err) {
        error = err;
        callback && callback(err);
      } else if (ackCount >= channels.length) {
        callback && callback();
      }
    }
  };
  for (var i in this._channels) {
    (function (channel) {
      if (channel.state == channel.PENDING) {
        self._emit(socket, 'subscribe', channel.name, function (err) {
          ackHandler(err, channel);
        });
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