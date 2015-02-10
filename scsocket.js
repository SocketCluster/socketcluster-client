var WebSocket = require('ws');
var Emitter = require('emitter');
var SCChannel = require('./scchannel');
var Response = require('./response').Response;
var ActivityManager = require('./activitymanager').ActivityManager;
var querystring = require('querystring');

if (!Object.create) {
  Object.create = require('./objectcreate');
}

var isBrowser = typeof window != 'undefined';

if (isBrowser) {
  var activityManager = new ActivityManager();
}


var SCSocket = function (options) {
  var self = this;
  
  // The socket's id is null until a connection has been established
  this.id = null;
  
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
    'fail': 1,
    'kickOut': 1
  };
  
  this._persistentEvents = {
    'subscribe': 1,
    'unsubscribe': 1,
    'ready': 1
  };
  
  this._connectAttempts = 0;
  
  this._cid = 1;
  this._callbackMap = {};
  this._destId = null;
  this._emitBuffer = [];
  this._channels = {};
  this._enableAutoReconnect = true;
  this._base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  
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
    activityManager.on('wakeup', function () {
      self.close();
      self.connect();
    });
  }
};

SCSocket.prototype = Object.create(Emitter.prototype);

SCSocket.ignoreStatuses = {
  1000: 'Socket closed normally',
  1001: 'Socket hung up'
};

SCSocket.errorStatuses = {
  1001: 'Socket was disconnected',
  1002: 'A WebSocket protocol error was encountered',
  1003: 'Server terminated socket because it received invalid data',
  1006: 'Socket connection closed',
  1007: 'Message format was incorrect',
  1008: 'Encountered a policy violation',
  1009: 'Message was too big to process',
  1010: 'Client ended the connection because the server did not comply with extension requirements',
  1011: 'Server encountered an unexpected fatal condition'
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

SCSocket.prototype.connect = SCSocket.prototype.open = function () {
  var self = this;
  
  if (!this.connected && !this.connecting) {
    this.connected = false;
    this.connecting = true;
    
    var uri = this.uri();
    this.socket = new WebSocket(uri, null, this.options);
    this.socket.binaryType = this.options.binaryType;
    
    this.socket.onopen = function () {
      self._onSCOpen();
    };

    this.socket.onclose = function (event) {
      self._onSCClose(event);
    };
    
    this.socket.onmessage = function (message, flags) {
      self._onSCMessage(message.data);
    };
    
    this._resubscribe();
    
    setTimeout(function () {
      self.emit('ready');
    }, 0);
  }
  return this;
};

SCSocket.prototype.disconnect = function (code, data) {
  code = code || 1000;
  this._enableAutoReconnect = false;
  this.socket.close(code, data);
  return this;
};

SCSocket.prototype.terminate = function () {
  this._enableAutoReconnect = false;
  this.socket.terminate();
  return this;
};

SCSocket.prototype._onSCOpen = function () {
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

SCSocket.prototype._onSCError = function (err) {
  if (this.listeners('error').length < 1) {
    setTimeout(function () {
      throw err;
    }, 0);
  } else {
    Emitter.prototype.emit.call(this, 'error', err);
  }
};

SCSocket.prototype._onSCClose = function (event) {
  var wasConnected = this.connected;
  
  this.connected = false;
  this.connecting = false;
  this.id = null;
  
  var channel, newState;
  for (var channelName in this._channels) {
    channel = this._channels[channelName];
    if (channel.state == channel.STATE_SUBSCRIBED ||
      channel.state == channel.STATE_PENDING) {
      
      newState = channel.STATE_PENDING;
    } else {
      newState = channel.STATE_UNSUBSCRIBED;
    }
    this._triggerChannelUnsubscribe(channel, newState);
  }

  if (wasConnected) {
    Emitter.prototype.emit.call(this, 'disconnect', event);
  }
  
  if (!SCSocket.ignoreStatuses[event.code]) {
    var err = new Error(SCSocket.errorStatuses[event.code] || 'Socket connection failed for unknown reasons');
    err.code = event.code;
    this._onSCError(err);
  }
  this._tryReconnect();
};

SCSocket.prototype._onSCMessage = function (message) {
  Emitter.prototype.emit.call(this, 'message', message);

  var e;
  try {
    e = this.parse(message);
  } catch (err) {
    e = message;
  }
  
  if (e.event) {
    if (e.event == 'connect') {
      this.connected = true;
      this.connecting = false;
      
      this.id = e.data.soid;
      
      Emitter.prototype.emit.call(this, e.event, e.data.soid);
      this._flushEmitBuffer();
    
    } else if (e.event == 'fail') {
      this.connected = false;
      this.connecting = false;
      this.emit('error', e.data);
      
    } else if (e.event == 'kickOut') {
      var kickData = e.data || {};
      var channelName = kickData.channel;
      var channel = this._channels[channelName];
      if (channel) {
        Emitter.prototype.emit.call(this, e.event, kickData.message, channelName);
        channel.emit(e.event, kickData.message, channelName);
        this._triggerChannelUnsubscribe(channel);
      }
    } else {
      var response = new Response(this, e.cid);
      Emitter.prototype.emit.call(this, e.event, e.data, response);
    }
  } else if (e.channel) {
    this._channelEmitter.emit(e.channel, e.data);
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
      this.emit('error', e.error);
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

SCSocket.prototype.send = function (data, options, callback) {
  this.socket.send(data, options, callback);
};

SCSocket.prototype._emit = function (eventObject) {
  eventObject.cid = this._nextCallId();
  
  if (eventObject.callback) {
    this._callbackMap[eventObject.cid] = eventObject;
  }
  
  var simpleEventObject = {
    event: eventObject.event,
    data: eventObject.data,
    cid: eventObject.cid
  };
  
  this.send(this.stringify(simpleEventObject));
};

SCSocket.prototype._flushEmitBuffer = function () {
  var len = this._emitBuffer.length;
  
  for (var i = 0; i < len; i++) {
    this._emit(this._emitBuffer[i]);
  }
  this._emitBuffer = [];
};

SCSocket.prototype.emit = function (event, data, callback) {
  var self = this;
  
  if (this._localEvents[event] == null) {
    if (!this.connected && !this.connecting) {
      this.connect();
    }
    var eventObject = {
      event: event,
      data: data,
      callback: callback
    };
    
    // Persistent events should never timeout.
    // Also, only set timeout if there is a callback.
    if (!this._persistentEvents[event] && callback) {
      eventObject.timeout = setTimeout(function () {
        var error = new Error("Event response for '" + event + "' timed out", eventObject);
        if (eventObject.cid) {
          delete self._callbackMap[eventObject.cid];
        }
        delete eventObject.callback;
        callback(error, eventObject);
        self.emit('error', error);
      }, this.options.ackTimeout);
    }
    this._emitBuffer.push(eventObject);
    if (this.connected) {
      this._flushEmitBuffer();
    }
  } else {
    Emitter.prototype.emit.call(this, event, data);
  }
  return this;
};

SCSocket.prototype.publish = function (channelName, data, callback) {
  var self = this;
  
  var pubData = {
    channel: channelName,
    data: data
  };
  return this.emit('publish', pubData, function (err) {
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

  if (channel.state == channel.STATE_UNSUBSCRIBED) {
    channel.state = channel.STATE_PENDING;
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
    if (channel.state != channel.STATE_UNSUBSCRIBED) {
    
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
  return this;
};

SCSocket.prototype.subscriptions = function (includePending) {
  var subs = [];
  var channel, includeChannel;
  for (var channelName in this._channels) {
    channel = this._channels[channelName];
    
    if (includePending) {
      includeChannel = channel && (channel.state == channel.STATE_SUBSCRIBED || 
        channel.state == channel.STATE_PENDING);
    } else {
      includeChannel = channel && channel.state == channel.STATE_SUBSCRIBED;
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
    return !!channel && (channel.state == channel.STATE_SUBSCRIBED ||
      channel.state == channel.STATE_PENDING);
  }
  return !!channel && channel.state == channel.STATE_SUBSCRIBED;
};

SCSocket.prototype._triggerChannelSubscribe = function (channel) {
  var channelName = channel.name;
  
  channel.state = channel.STATE_SUBSCRIBED;
  
  channel.emit('subscribe', channelName);
  Emitter.prototype.emit.call(this, 'subscribe', channelName);
};

SCSocket.prototype._triggerChannelSubscribeFail = function (err, channel) {
  var channelName = channel.name;
  
  channel.state = channel.STATE_UNSUBSCRIBED;
  
  channel.emit('subscribeFail', err, channelName);
  Emitter.prototype.emit.call(this, 'subscribeFail', err, channelName);
};

SCSocket.prototype._triggerChannelUnsubscribe = function (channel, newState) {
  var channelName = channel.name;
  var oldState = channel.state;
  
  if (newState) {
    channel.state = newState;
  } else {
    channel.state = channel.STATE_UNSUBSCRIBED;
  }
  if (oldState == channel.STATE_SUBSCRIBED) {
    channel.emit('unsubscribe', channelName);
    Emitter.prototype.emit.call(this, 'unsubscribe', channelName);
  }
};

SCSocket.prototype._resubscribe = function (callback) {
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
      if (channel.state == channel.STATE_PENDING) {
        self.emit('subscribe', channel.name, function (err) {
          ackHandler(err, channel);
        });
      }
    })(this._channels[i]);
  }
};

SCSocket.prototype.watch = function (channelName, handler) {
  this._channelEmitter.on(channelName, handler);
  return this;
};

SCSocket.prototype.unwatch = function (channelName, handler) {
  if (handler) {
    this._channelEmitter.removeListener(channelName, handler);
  } else {
    this._channelEmitter.removeAllListeners(channelName);
  }
  return this;
};

SCSocket.prototype.watchers = function (channelName) {
  return this._channelEmitter.listeners(channelName);
};

module.exports = SCSocket;