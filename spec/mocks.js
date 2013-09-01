function ExecMock() {
  this._responses = [];
  this._commands = [];
}

ExecMock.prototype.setResponses = function () {
  this._responses = Array.prototype.slice.call(arguments, 0);
};

ExecMock.prototype._mock = function (command, callback) {
  this._commands.push(command);
  callback(null, this._responses.pop());

  return {
    stdout: { pipe: function () {} },
    stderr: { pipe: function () {} }
  };
};

ExecMock.prototype.mock = function () {
  return this._mock.bind(this);
};

ExecMock.prototype.commands = function () {
  return this._commands;
};

ExecMock.prototype.recent = function () {
  return this._commands[ this._commands.length - 1 ];
};

ExecMock.prototype.clear = function () {
  this._commands = [];
};

module.exports = {
  ExecMock: ExecMock
};
