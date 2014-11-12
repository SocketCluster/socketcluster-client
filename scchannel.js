var Emitter = require('emitter');

if (!Object.create) {
  Object.create = require('./objectcreate');
}

var SCChannel = function (name, socket) {
  var self = this;
  
  Emitter.call(this);
  
  this.name = name;
  this.subscribing = false;
  this.subscribed = false;
  this.socket = socket;
};

SCChannel.prototype = Object.create(Emitter.prototype);

SCChannel.prototype.subscribe = function () {
  var self = this;
  
  if (!this.subscribed && !this.subscribing) {
    this.subscribing = true;
    this.socket.emit('subscribe', this.name, function (err) {
      self.subscribing = false;
      if (err) {
        self.emit('subscribeFail', err, self.name);
        Emitter.prototype.emit.call(self.socket, 'subscribeFail', err, self.name);
      } else {
        self.subscribed = true;
        self.emit('subscribe', self.name);
        Emitter.prototype.emit.call(self.socket, 'subscribe', self.name);
      }
    });
  }
  return this;
};

SCChannel.prototype.unsubscribe = function () {
  var self = this;
  
  if (this.subscribed || this.subscribing) {
    this.subscribing = false;
    this.subscribed = false;
    
    // The only case in which unsubscribe can fail is if the connection is closed or dies.
    // If that's the case, the server will automatically unsubscribe the client so
    // we don't need to check for failure since this operation can never really fail.
    
    this.socket.emit('unsubscribe', this.name, function (err) {
      self.emit('unsubscribe', self.name);
      Emitter.prototype.emit.call(self.socket, 'unsubscribe', self.name);
    });
  }
  return this;
};

SCChannel.prototype.isSubscribed = function (includePending) {
  return this.socket.isSubscribed(this.name, includePending);
};

SCChannel.prototype.publish = function (data, callback) {
  this.socket.publish(this.name, data, callback);
  return this;
};

SCChannel.prototype.watch = function (handler) {
  this.socket.watch(this.name, handler);
  return this;
};

SCChannel.prototype.unwatch = function (handler) {
  this.socket.unwatch(this.name, handler);
  return this;
};

SCChannel.prototype.destroy = function () {
  this.socket.destroyChannel(this.name);
};

module.exports = SCChannel;