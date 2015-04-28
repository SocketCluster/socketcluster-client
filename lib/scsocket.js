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
    initTimeout: 9000,
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
  
  this.ackTimeout = opts.ackTimeout;
  
  // pingTimeout will be ackTimeout at the start, but it will
  // be updated with values provided by the 'ready' event
  this.pingTimeout = this.ackTimeout;
  this.initTimeout = opts.initTimeout;
  
  var maxTimeout = Math.pow(2, 31) - 1;
  
  var verifyDuration = function (propertyName) {
    if (self[propertyName] > maxTimeout) {
      throw new Error('The ' + propertyName +
        ' value provided exceeded the maximum amount allowed');
    }
  };
  
  verifyDuration('ackTimeout');
  verifyDuration('pingTimeout');
  verifyDuration('initTimeout');
  
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
    'subscribe': 1,
    'unsubscribe': 1,
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
  this._pingTimeoutTicker = null;
  
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

SCSocket.prototype.getBytesReceived = function () {
  return this.socket.bytesReceived;
};

SCSocket.prototype.connect = SCSocket.prototype.open = function () {
  var self = this;
  
  if (this.state == this.CLOSED) {
    this._clearAllSocketBindings();
    
    this.state = this.CONNECTING;
    
    var uri = this.uri();
    var socket = new WebSocket(uri, null, this.options);
    socket.binaryType = this.options.binaryType;
    this.socket = socket;
    
    socket.onopen = function () {
      // Do not open if the socket was switched while we were 
      // connecting to it
      if (socket == self.socket) {
        self._onSCOpen();
      }
    };
    
    socket.onclose = function (event) {
      // Need to make sure that the current active socket is the same as the one
      // which we bound this onclose handler to - Otherwise we might mess up
      // the state of the SCSocket
      if (socket == self.socket) {
        self._onSCClose(event.code, event.reason);
      }
    };
    
    socket.onmessage = function (message, flags) {
      // Only consider messages from the current active socket
      if (socket == self.socket) {
        self._onSCMessage(message.data);
      }
    };
  }
};

SCSocket.prototype.disconnect = function (code, data) {
  code = code || 1000;
  
  if (this.state == this.OPEN) {
    var packet = {
      code: code,
      data: data
    };
    this._emitDirect('#disconnect', packet);
    
    this._onSCClose(code, data);
    this.socket.close(code);
  }
};

SCSocket.prototype._onSCOpen = function () {
  var self = this;
  
  this.state = this.OPEN;
  this._connectAttempts = 0;

  this._resubscribe();
  Emitter.prototype.emit.call(this, 'connect');
  
  this._flushEmitBuffer();
  this._resetPingTimeout();
  
  clearTimeout(this._initTimeoutTicker);
  
  // In case 'ready' event isn't triggered on time
  this._initTimeoutTicker = setTimeout(function () {
    self._onSCClose(4002);
    self.socket.close(4002);
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
  clearTimeout(this._pingTimeoutTicker);
  clearTimeout(this._reconnectTimeout);
};

SCSocket.prototype._onSCClose = function (code, data) {
  this._clearAllSocketBindings();
  
  delete this.socket.onopen;
  delete this.socket.onclose;
  delete this.socket.onmessage;
  
  if (this.state != this.CLOSED) {
    var oldState = this.state;
    
    this.id = null;

    this._suspendSubscriptions();
    this.state = this.CLOSED;
    
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

SCSocket.prototype._isPrivateTransmittedEvent = function (event) {
  return !!event && event.indexOf('#') == 0;
};

SCSocket.prototype._onSCMessage = function (message) {
  Emitter.prototype.emit.call(this, 'message', message);

  // If ping
  if (message == '1') {
    this._resetPingTimeout();
    if (this.socket.readyState == this.socket.OPEN) {
      this.socket.send('2');
    }
  } else {
    var obj;
    try {
      obj = this.parse(message);
    } catch (err) {
      obj = message;
    }
    var eventName = obj.event;
    
    if (eventName) {
      var eventData = obj.data || {};
      
      if (this._isPrivateTransmittedEvent(eventName)) {
        if (eventName == '#fail') {
          this._onSCError(eventData);
          
        } else if (eventName == '#publish') {
          var publishData = eventData;
          var isSubscribed = this.isSubscribed(publishData.channel, true);
          
          if (isSubscribed) {
            this._channelEmitter.emit(publishData.channel, publishData.data);
          }
        } else if (eventName == '#kickOut') {
          var channelName = eventData.channel;
          var channel = this._channels[channelName];
          if (channel) {
            Emitter.prototype.emit.call(this, 'kickOut', eventData.message, channelName);
            channel.emit('kickOut', eventData.message, channelName);
            this._triggerChannelUnsubscribe(channel);
          }
        } else if (eventName == '#setAuthToken') {
          var tokenData = eventData;
          var response = new Response(this, obj.cid);
          
          if (tokenData) {
            this._tokenData = tokenData;
            
            if (tokenData.persistent && tokenData.expiresInMinutes != null) {
              this._setCookie(tokenData.cookieName, tokenData.token, tokenData.expiresInMinutes * 60);
            } else {
              this._setCookie(tokenData.cookieName, tokenData.token);
            }
            Emitter.prototype.emit.call(this, 'setAuthToken', tokenData.token);
            response.end();
          } else {
            response.error('No token data provided with setAuthToken event');
          }
        } else if (eventName == '#removeAuthToken') {
          if (this._tokenData) {
            this._setCookie(this._tokenData.cookieName, null, -1);
            Emitter.prototype.emit.call(this, 'removeAuthToken');
          }
          var response = new Response(this, obj.cid);
          response.end();
        } else if (eventName == '#ready') {
          if (eventData) {
            this.id = eventData.id;
            this.pingTimeout = eventData.pingTimeout;
          }
          this._resetPingTimeout();
          clearTimeout(this._initTimeoutTicker);
          Emitter.prototype.emit.call(this, 'ready', eventData);
          
        } else if (eventName == '#disconnect') {
          this._onSCClose(eventData.code, eventData.data);
        } else {
          var response = new Response(this, obj.cid);
          Emitter.prototype.emit.call(this, eventName, eventData, function (error, data) {
            response.callback(error, data);
          });
        }
      } else {
        var response = new Response(this, obj.cid);
        Emitter.prototype.emit.call(this, eventName, eventData, function (error, data) {
          response.callback(error, data);
        });
      }
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

SCSocket.prototype._resetPingTimeout = function () {
  var self = this;
  
  var now = (new Date()).getTime();
  clearTimeout(this._pingTimeoutTicker);
  
  this._pingTimeoutTicker = setTimeout(function () {
    self._onSCClose(4000);
    self.socket.close(4000);
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

SCSocket.prototype.send = function (data) {
  if (this.socket.readyState != this.socket.OPEN) {
    this._onSCClose(1005);
  } else {
    this.socket.send(data);
  }
};

SCSocket.prototype.sendObject = function (object) {
  this.send(this.stringify(object));
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
  this.emit('#publish', pubData, function (err) {
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
    channel._lastSubUnsubCid = this._emitDirect('#subscribe', channel.name, options, function (err) {
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
    channel._lastSubUnsubCid = this._emitDirect('#unsubscribe', channel.name, options);
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

module.exports = SCSocket;
