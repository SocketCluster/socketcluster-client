var Emitter = require('emitter');

if (!Object.create) {
  Object.create = require('./objectcreate');
}

var SCChannel = function (name, socket) {
  var self = this;
  
  Emitter.call(this);
  
  this.SUBSCRIBED = 'subscribed';
  this.PENDING = 'pending';
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
  return this;
};

SCChannel.prototype.unsubscribe = function () {
  this.socket.unsubscribe(this.name);
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
