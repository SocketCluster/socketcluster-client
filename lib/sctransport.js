var WebSocket = require('ws');
var SCEmitter = require('sc-emitter').SCEmitter;
var formatter = require('sc-formatter');
var Response = require('./response').Response;
var querystring = require('querystring');

var SCTransport = function (authEngine, options) {
  this.state = this.CLOSED;
  this.auth = authEngine;
  this.options = options;
  this.pingTimeout = options.ackTimeout;
  
  this._cid = 1;
  this._pingTimeoutTicker = null;
  this._callbackMap = {};
  
  this.open();
};

SCTransport.prototype = Object.create(SCEmitter.prototype);

SCTransport.CONNECTING = SCTransport.prototype.CONNECTING = 'connecting';
SCTransport.OPEN = SCTransport.prototype.OPEN = 'open';
SCTransport.CLOSED = SCTransport.prototype.CLOSED = 'closed';

SCTransport.prototype.uri = function () {
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

SCTransport.prototype._nextCallId = function () {
  return this._cid++;
};

SCTransport.prototype.open = function () {
  var self = this;
  
  this.state = this.CONNECTING;
  var uri = this.uri();
  
  var wsSocket = new WebSocket(uri, null, this.options);
  wsSocket.binaryType = this.options.binaryType;
  this.socket = wsSocket;
  
  wsSocket.onopen = function () {
    self._onOpen();
  };
  
  wsSocket.onclose = function (event) {
    self._onClose(event.code, event.reason);
  };
  
  wsSocket.onmessage = function (message, flags) {
    self._onMessage(message.data);
  };
  
  // Capture and ignore errors, these errors will be handled
  // in the onclose handler instead.
  wsSocket.onerror = function (error) {};
};

SCTransport.prototype._onOpen = function () {
  var self = this;
  
  this._resetPingTimeout();
  
  this._handshake(function (err, status) {
    if (err) {
      self._onError(err);
      self._onClose(4003);
      self.socket.close(4003);
    } else {
      self.state = self.OPEN;
      SCEmitter.prototype.emit.call(self, 'open', status);
      self._resetPingTimeout();
    }
  });
};

SCTransport.prototype._handshake = function (callback) {
  var self = this;
  this.auth.loadToken(this.options.authTokenName, function (err, token) {
    if (err) {
      callback(err);
    } else {
      // Don't wait for this.state to be 'open'.
      // The underlying WebSocket (this.socket) is already open.
      var options = {
        force: true
      };
      self.emit('#handshake', {
        authToken: token
      }, options, callback);
    }
  });
};

SCTransport.prototype._onClose = function (code, data) {
  delete this.socket.onopen;
  delete this.socket.onclose;
  delete this.socket.onmessage;
  delete this.socket.onerror;
    
  if (this.state == this.OPEN) {
    this.state = this.CLOSED;
    SCEmitter.prototype.emit.call(this, 'close', code, data);
    
  } else if (this.state == this.CONNECTING) {
    this.state = this.CLOSED;
    SCEmitter.prototype.emit.call(this, 'openAbort', code, data);
  }
};

SCTransport.prototype._onMessage = function (message) {
  SCEmitter.prototype.emit.call(this, 'event', 'message', message);
  
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
    var event = obj.event;
    
    if (event) {
      var response = new Response(this, obj.cid);
      SCEmitter.prototype.emit.call(this, 'event', event, obj.data, response);
    } else if (obj.rid != null) {
      var eventObject = this._callbackMap[obj.rid];
      if (eventObject) {
        clearTimeout(eventObject.timeout);
        delete this._callbackMap[obj.rid];
        eventObject.callback(obj.error, obj.data);
      }
      if (obj.error) {
        this._onError(obj.error);
      }
    } else {
      SCEmitter.prototype.emit.call(this, 'event', 'raw', obj);
    }
  }
};

SCTransport.prototype._onError = function (err) {
  SCEmitter.prototype.emit.call(this, 'error', err);
};

SCTransport.prototype._resetPingTimeout = function () {
  var self = this;
  
  var now = (new Date()).getTime();
  clearTimeout(this._pingTimeoutTicker);
  
  this._pingTimeoutTicker = setTimeout(function () {
    self._onClose(4000);
    self.socket.close(4000);
  }, this.pingTimeout);
};

SCTransport.prototype.getBytesReceived = function () {
  return this.socket.bytesReceived;
};

SCTransport.prototype.close = function (code, data) {
  code = code || 1000;
  
  if (this.state == this.OPEN) {
    var packet = {
      code: code,
      data: data
    };
    this.emit('#disconnect', packet);
    
    this._onClose(code, data);
    this.socket.close(code);
    
  } else if (this.state == this.CONNECTING) {
    this._onClose(code, data);
    this.socket.close(code);
  }
};

SCTransport.prototype.emitRaw = function (eventObject) {
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


SCTransport.prototype._handleEventAckTimeout = function (eventObject) {
  var errorMessage = "Event response for '" + eventObject.event + "' timed out";
  var error = new Error(errorMessage);
  error.type = 'timeout';
  
  if (eventObject.cid) {
    delete this._callbackMap[eventObject.cid];
  }
  var callback = eventObject.callback;
  delete eventObject.callback;
  callback.call(eventObject, error, eventObject);
  this._onError(error);
};

// The last two optional arguments (a and b) can be options and/or callback
SCTransport.prototype.emit = function (event, data, a, b) {
  var self = this;
  
  var callback, options;
  
  if (b) {
    options = a;
    callback = b;
  } else {
    if (a instanceof Function) {
      options = {};
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
    }, this.options.ackTimeout);
  }
  
  var cid = null;
  if (this.state == this.OPEN || options.force) {
    cid = this.emitRaw(eventObject);
  }
  return cid;
};

SCTransport.prototype.cancelPendingResponse = function (cid) {
  delete this._callbackMap[cid];
};

SCTransport.prototype.parse = function (message) {
  return formatter.parse(message);
};

SCTransport.prototype.stringify = function (object) {
  return formatter.stringify(object);
};

SCTransport.prototype.send = function (data) {
  if (this.socket.readyState != this.socket.OPEN) {
    this._onClose(1005);
  } else {
    this.socket.send(data);
  }
};

SCTransport.prototype.sendObject = function (object) {
  this.send(this.stringify(object));
};

module.exports.SCTransport = SCTransport;
