var Emitter = require('emitter');
var Socket = require('engine.io-client');
var SCChannel = require('./scchannel');
var querystring = require('querystring');
var LinkedList = require('linked-list');

if (!Object.create) {
  Object.create = require('./objectcreate');
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


var SCSocket = function (options) {
  var self = this;
  
  Emitter.call(this);
  
  var opts = {
    port: null,
    autoReconnect: true,
    ackTimeout: 10000,
    initTimeout: 9000,
    binaryType: 'arraybuffer'
  };
  for (var i in options) {
    opts[i] = options[i];
  }
  opts.path = (opts.path || '/socketcluster').replace(/\/$/, '') + '/';
  
  this.id = null;
  this.state = this.CLOSED;
  
  this.ackTimeout = opts.ackTimeout;
  this.initTimeout = opts.initTimeout;
  
  this._localEvents = {
    'connect': 1,
    'disconnect': 1,
    'pingTimeout': 1,
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
    'fail': 1,
    'kickOut': 1,
    'setAuthToken': 1,
    'removeAuthToken': 1,
    'ready': 1
  };
  
  this._connectAttempts = 0;
  
  this._cid = 1;
  this._callbackMap = {};
  this._emitBuffer = new LinkedList();
  this._channels = {};
  this._base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  this._tokenData = null;
  
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

  this._channelEmitter = new Emitter();
  this.connect();
};

SCSocket.prototype = Object.create(Emitter.prototype);

SCSocket.CONNECTING = SCSocket.prototype.CONNECTING = 'connecting';
SCSocket.OPEN = SCSocket.prototype.OPEN = 'open';
SCSocket.CLOSED = SCSocket.prototype.CLOSED = 'closed';

SCSocket.RECONNECT_IMMEDIATE = SCSocket.prototype.RECONNECT_IMMEDIATE = 'immediate';
SCSocket.RECONNECT_DELAYED = SCSocket.prototype.RECONNECT_DELAYED = 'delayed';

SCSocket.prototype.getState = function () {
  return this.state;
};

SCSocket.prototype.connect = SCSocket.prototype.open = function () {
  var self = this;
  
  if (this.state == this.CLOSED) {
    this._clearAllSocketBindings();
    
    this.state = this.CONNECTING;
    
    var socket;
    if (this.options.url == null) {
      socket = new Socket(this.options);
    } else {
      socket = new Socket(this.options.url, this.options);
    }
    socket.binaryType = this.options.binaryType;
    this.socket = socket;
    
    socket.on('open', function () {
      if (socket == self.socket) {
        self._onSCOpen();
      }
    });
    
    socket.on('error', function (err) {
      if (socket == self.socket) {
        self._onSCError(err);
      }
    });
    
    socket.on('close', function () {
      if (socket == self.socket) {
        self._onSCClose(self.RECONNECT_DELAYED);
      }
    });
    
    socket.on('message', function (message) {
      if (socket == self.socket) {
        self._onSCMessage(message);
      }
    });
  }
};

SCSocket.prototype.disconnect = function (reason) {
  if (this.state == this.OPEN) {
    this._onSCClose();
    this.socket.close();
  }
};

SCSocket.prototype._onSCOpen = function () {
  var self = this;
  
  this.state = this.OPEN;
  this._connectAttempts = 0;
  
  this._resubscribe();
  Emitter.prototype.emit.call(this, 'connect');
  
  this._flushEmitBuffer();
  
  clearTimeout(this._initTimeoutTicker);
  
  // In case 'ready' event isn't triggered on time
  this._initTimeoutTicker = setTimeout(function () {
    self.socket.close();
    var error = new Error("Client socket initialization timed out - Client did not receive a 'ready' event");
    error.type = 'timeout';
    
    self._onSCError(error);
    self._onSCClose(self.RECONNECT_DELAYED);
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

SCSocket.prototype._clearAllSocketBindings = function (code, data) {
  clearTimeout(this._initTimeoutTicker);
  clearTimeout(this._reconnectTimeout);
};

// The reconnect argument can be:
// RECONNECT_IMMEDIATE: 'immediate'
// RECONNECT_DELAYED: 'delayed'
// or null (no reconnect)
SCSocket.prototype._onSCClose = function (reconnect) {
  this._clearAllSocketBindings();
  
  if (this.state != this.CLOSED) {
    var oldState = this.state;
    
    this.id = null;

    this._suspendSubscriptions();
    this.state = this.CLOSED;

    var socket = this.socket;
    socket.removeListener('open');
    socket.removeListener('error');
    socket.removeListener('close');
    socket.removeListener('message');
    
    if (oldState == this.OPEN) {
      Emitter.prototype.emit.call(this, 'disconnect');
    } else if (oldState == this.CONNECTING) {
      Emitter.prototype.emit.call(this, 'connectFail');
    }
    
    // Try to reconnect if applicable
    if (this.options.autoReconnect) {
      if (reconnect == this.RECONNECT_IMMEDIATE) {
        this._tryReconnect(0);
      } else if (reconnect == this.RECONNECT_DELAYED) {
        this._tryReconnect();
      }
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

SCSocket.prototype._onSCMessage = function (message) {
  Emitter.prototype.emit.call(this, 'message', message);

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
      var isSubscribed = this.isSubscribed(publishData.channel, true);
      
      if (isSubscribed) {
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
      }
      clearTimeout(this._initTimeoutTicker);
      Emitter.prototype.emit.call(this, obj.event, obj.data);
    } else if (obj.event == 'pingTimeout') {
      this._onSCClose(this.RECONNECT_IMMEDIATE);
    } else {
      var response = new Response(this, obj.cid);
      Emitter.prototype.emit.call(this, obj.event, obj.data, function (error, data) {
        response.callback(error, data);
      });
    }
  } else if (obj.disconnect) {
    this._onSCClose();
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
  return this.JSON.parse(message);
};

SCSocket.prototype.stringify = function (object) {
  return this.JSON.stringify(this._convertBuffersToBase64(object));
};

SCSocket.prototype.send = function (data, options) {
  if (this.socket.readyState != this.OPEN) {
    var error = new Error('Failed to send - Underlying connection was not open');
    this._onSCError(error);
    this._onSCClose(this.RECONNECT_DELAYED);
  } else {
    this.socket.send(data, options);
  }
};

SCSocket.prototype.sendObject = function (object, options) {
  this.send(this.stringify(object), options);
};

SCSocket.prototype._emitRaw = function (eventObject) {
  eventObject.cid = this._nextCallId();
  
  if (eventObject.callback) {
    this._callbackMap[eventObject.cid] = eventObject;
  }
  
  var simpleEventObject = {
    event: eventObject.event,
    data: eventObject.data,
    cid: eventObject.cid
  };
  
  this.sendObject(simpleEventObject);
  return eventObject.cid;
};

SCSocket.prototype._flushEmitBuffer = function () {
  var currentNode = this._emitBuffer.head;
  var nextNode;

  while (currentNode) {
    nextNode = currentNode.next;
    var eventObject = currentNode.data;
    currentNode.detach();
    this._emitRaw(eventObject);
    currentNode = nextNode;
  }
};

SCSocket.prototype._handleEventAckTimeout = function (eventObject, eventNode) {
  var errorMessage = "Event response for '" + eventObject.event + "' timed out";
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
SCSocket.prototype._emitDirect = function (event, data, a, b) {
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
  
  if (callback && !options.noTimeout) {
    eventObject.timeout = setTimeout(function () {
      self._handleEventAckTimeout(eventObject);
    }, this.ackTimeout);
  }
  
  var cid = null;
  if (this.state == this.OPEN) {
    cid = this._emitRaw(eventObject);
  }
  return cid;
};

SCSocket.prototype._emit = function (event, data, callback) {
  var self = this;
  
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
  
  // Events which do not have a callback will be treated as volatile
  if (callback) {
    eventObject.timeout = setTimeout(function () {
      self._handleEventAckTimeout(eventObject, eventNode);
    }, this.ackTimeout);
  }
  this._emitBuffer.append(eventNode);
  
  if (this.state == this.OPEN) {
    this._flushEmitBuffer();
  }
};

SCSocket.prototype.emit = function (event, data, callback) {
  if (this._localEvents[event] == null) {
    this._emit(event, data, callback);
  } else {
    Emitter.prototype.emit.call(this, event, data);
  }
};

SCSocket.prototype.publish = function (channelName, data, callback) {
  var pubData = {
    channel: channelName,
    data: data
  };
  this.emit('publish', pubData, function (err) {
    callback && callback(err);
  });
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

// Cancel any pending subscribe or subscribe callback
SCSocket.prototype._cancelPendingSubUnsubCallback = function (channel) {
  var lastCid = channel._lastSubUnsubCid;
  if (lastCid != null) {
    delete this._callbackMap[lastCid];
  }
};

SCSocket.prototype._trySubscribe = function (channel) {
  var self = this;
  
  if (this.state == this.OPEN) {
    var options = {
      noTimeout: true
    };
    // We never want to track both a pending subscribe and pending unsubscribe 
    // callback at the same time on the same channel - We only care about the latest action
    this._cancelPendingSubUnsubCallback(channel);
    channel._lastSubUnsubCid = this._emitDirect('subscribe', channel.name, options, function (err) {
      if (err) {
        self._triggerChannelSubscribeFail(err, channel);
      } else {
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

  if (channel.state == channel.UNSUBSCRIBED) {
    channel.state = channel.PENDING;
    this._trySubscribe(channel);
  }
  
  return channel;
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

SCSocket.prototype._tryUnsubscribe = function (channel) {
  var self = this;
  
  if (this.state == this.OPEN) {
    var options = {
      noTimeout: true
    };
    // We never want to track both a pending subscribe and pending unsubscribe 
    // callback at the same time on the same channel - We only care about the latest action
    this._cancelPendingSubUnsubCallback(channel);
    
    // This operation cannot fail because the TCP protocol guarantees delivery
    // so long as the connection remains open. If the connection closes,
    // the server will automatically unsubscribe the socket and thus complete
    // the operation on the server side.
    channel._lastSubUnsubCid = this._emitDirect('unsubscribe', channel.name, options);
  }
};

SCSocket.prototype.unsubscribe = function (channelName) {

  var channel = this._channels[channelName];
  
  if (channel) {
    if (channel.state != channel.UNSUBSCRIBED) {
    
      this._triggerChannelUnsubscribe(channel);
      this._tryUnsubscribe(channel);
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

SCSocket.prototype._resubscribe = function () {
  var self = this;
  
  var channels = [];
  for (var channelName in this._channels) {
    channels.push(channelName);
  }
  
  for (var i in this._channels) {
    (function (channel) {
      if (channel.state == channel.PENDING) {
        channel.subscribeAttempts = 0;
        self._trySubscribe(channel);
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

if (typeof JSON != 'undefined') {
  SCSocket.prototype.JSON = JSON;
} else {
  SCSocket.prototype.JSON = require('./json').JSON;
}
SCSocket.JSON = SCSocket.prototype.JSON;

module.exports = SCSocket;
