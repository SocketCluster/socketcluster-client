const scErrors = require('sc-errors');
const InvalidActionError = scErrors.InvalidActionError;

function Response(socket, id) {
  this.socket = socket;
  this.id = id;
  this.sent = false;
}

Response.prototype._respond = function (responseData) {
  if (this.sent) {
    throw new InvalidActionError('Response ' + this.id + ' has already been sent');
  } else {
    this.sent = true;
    this.socket.send(this.socket.encode(responseData));
  }
};

Response.prototype.end = function (data) {
  if (this.id) {
    let responseData = {
      rid: this.id
    };
    if (data !== undefined) {
      responseData.data = data;
    }
    this._respond(responseData);
  }
};

Response.prototype.error = function (error) {
  if (this.id) {
    let err = scErrors.dehydrateError(error);

    let responseData = {
      rid: this.id,
      error: err
    };

    this._respond(responseData);
  }
};

Response.prototype.callback = function (error, data) {
  if (error) {
    this.error(error); // TODO 2: cannot have both error and data anymore; check this is not used in the code
  } else {
    this.end(data);
  }
};

module.exports.Response = Response;
