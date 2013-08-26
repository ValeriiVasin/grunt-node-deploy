'use strict';

var async  = require('async');
var exec   = require('child_process').exec;
var moment = require('moment');
var _      = require('underscore');

_.templateSettings = {
  interpolate : /\{\{(.+?)\}\}/g
};

/**
 * Deploy helper
 * @param {Object} options              Options to set up deploy
 * @param {String} options.user         User deploy from
 * @param {String} options.domain       Remote server domain
 * @param {String} options.deployTo     Remote folder to deploy in
 * @param {String} options.deployFrom   Remote folder to deploy from
 * @param {String} options.keepReleases Amount of releases to keep
 */
function Deploy(options) {
  this._user   = options.user;
  this._domain = options.domain;
  this._host   = this._user + '@' + this._domain;

  this._keepReleases = options.keepReleases || 3;
  this._hooks = options.hooks || {};

  this.options = options;

  this._folders = {};
  this._folders.project = options.deployTo;
  this._folders.logs = this._folders.project + '/logs';
  this._folders.shared = this._folders.project + '/shared';
  this._folders.releases = this._folders.project + '/releases';

  // always symlinked
  this._folders.current = this._folders.project + '/current';

  // will be resolved on deploy start
  this._folders.currentRelease = null;

  this._commands = [];
}

Deploy.prototype.setup = function (done) {
  console.log('Starting...');

  this.run('mkdir -p {{releases}}');
  this.run('mkdir -p {{logs}}');
  this.run('mkdir -p {{shared}}');

  this.exec(done);
};

Deploy.prototype.start = function (done) {
  var that = this;

  this._trigger('beforeDeploy', start);

  function start() {
    var timestamp = moment().format('YYYYMMDDHHmmss');

    that._folders.currentRelease = that._folders.releases + '/' + timestamp;

    var deployCommand = [
      'rsync -avzq',
      that.options.deployFrom,
      that._user + '@' + that._domain + ':' + that._folders.currentRelease
    ].join(' ');

    exec(deployCommand, npmInstall)
      .stdout.pipe(process.stdout);
  }

  /**
   * Install dependencies
   */
  function npmInstall(err) {
    if (err) {
      throw err;
    }

    that._npmInstall(symlink);
  }

  /**
   * Update/create symlink of current release
   */
  function symlink(err) {
    if (err) {
      throw err;
    }

    that.run('rm -f {{current}}');
    that.run('ln -s {{currentRelease}} {{current}}');
    that.exec(cleanup);
  }

  function cleanup(err) {
    if (err) {
      throw err;
    }

    that.cleanup(function (err) {
      if (err) {
        throw err;
      }

      that._trigger('afterDeploy', done);
    });
  }
};

/**
 * Install project dependencies
 *
 * @param  {Function} done Installing dependencies done hook
 */
Deploy.prototype._npmInstall = function (done) {
  var that = this;

  this._trigger('beforeNpm', function () {
    that.run('cd {{currentRelease}} && test -f {{currentRelease}}/package.json && npm install || true');
    that.exec(function (err) {
      if (err) {
        throw err;
      }

      that._trigger('afterNpm', done);
    });
  });
};

Deploy.prototype.rollback = function (done) {
  var that = this;

  this.run('ls -1 {{releases}}', null, { quiet: true });
  this.exec(rollback);

  function rollback(err, results) {
    var ls = results[0].trim(),
        folders = ls.split('\n'),
        currentRelease,
        previousRelease;

    if (folders.length < 2) {
      throw 'Rolling back is impossible, there are less then 2 releases.';
    }

    currentRelease = that._folders.releases + '/' + folders[folders.length - 1];
    previousRelease = that._folders.releases + '/' + folders[folders.length - 2];

    that.run('rm -f {{current}}');
    that.run('ln -s {{previousRelease}} {{current}}', { previousRelease: previousRelease });
    that.run('rm -Rf ' + currentRelease);
    that.exec(done);
  }
};

/**
 * Remove releases that are not needed
 *
 * @param  {Function} done Cleanup done callback
 */
Deploy.prototype.cleanup = function (done) {
  var that = this;

  this.run('ls -1 {{releases}}', null, { quiet: true });
  this.exec(function (err, results) {
    var folders,
        foldersToRemove;

    if (err) {
      throw err;
    }

    // split `ls` command response, trim last \n
    folders = results[0].trim().split('\n');
    foldersToRemove = folders.slice(0, -that._keepReleases);

    foldersToRemove.forEach(function (folder) {
      that.run('rm -Rf {{releases}}/' + folder);
    });

    that.exec(done);
  });
};

/**
 * Trigger hooks
 */
Deploy.prototype._trigger = function (name, done) {
  var that = this,
      hook = this._hooks[name],
      isHookAsync = false;

  if (typeof hook === 'undefined') {
    // hook is not defined
    done();
    return;
  } else if (typeof hook !== 'function') {
    console.log('Hook `%s` should be a function', name);
    done();
    return;
  }

  hook.call(
    {
      // async hooks execution
      async: function () {
        isHookAsync = true;
        return afterHook;
      }
    },

    this.run.bind(this),
    this.runLocally.bind(this)
  );

  if ( !isHookAsync ) {
    afterHook();
  }

  function afterHook() {
    that.exec(done);
  }
};

/**
 * Add commands for remote execution
 *
 * @param {String}  command                 Command to execute
 * @param {Object}  [data]                  Data object that will replace {{variables}} in command
 * @param {Object}  [options]               Command execution options
 * @param {Boolean} [options.local=false]   Run command locally
 * @param {Boolean} [options.quiet=false]   Do not show output on the screen
 */
Deploy.prototype.run = function (command, data, options) {
  options = _.extend({ quiet: false, local: false }, options || {});

  this._commands.push({
    command: this._expandCommand(command, data),
    local: options.local,
    quiet: options.quiet
  });
};

/**
 * Add commands for local execution
 *
 * @param {String}  command                 Command to execute
 * @param {Object}  [data]                  Data object that will replace {{variables}} in command
 * @param {Object}  [options]               Command execution options
 * @param {Boolean} [options.quiet=false]   Do not show output on the screen
 */
Deploy.prototype.runLocally = function (command, data, options) {
  options = _.extend({ quiet: false }, options || {});
  options.local = true;
  this.run(command, data, options);
};

/**
 * Expand command: augment with variables
 *
 * @param {String} command Command to expand
 * @param {Object} [data]  Additional data for expanding
 *
 * @return {String} Expanded command
 */
Deploy.prototype._expandCommand = function (command, data) {
  data = _.extend(
    {},
    { user: this._user, domain: this._domain },
    this._folders,
    data || {}
  );

  return _.template(command, data);
};

/**
 * Convert command to remote
 */
Deploy.prototype._remoteCommand = function (command) {
  command = command.replace(/\"/g, '\\\"');

  return _.template(
    'ssh -A {{host}} "{{command}}"',
    { host: this._host, command: command }
  );
};

/**
 * Execute stored commands
 *
 * @param  {Function} done Callback that will be called when all commands executed
 */
Deploy.prototype.exec = function (done) {
  var that = this;

  async.mapSeries(this._commands, function (command, callback) {
    var _exec,
        cmd = command.command;

    that.log(command);

    _exec = exec(
      command.local ? cmd : that._remoteCommand(cmd),
      callback
    );

    if ( !command.quiet ) {
      _exec.stdout.pipe(process.stdout);
      _exec.stderr.pipe(process.stderr);
    }
  }, function () {
    that._commands = [];
    done.apply(null, arguments);
  });
};

Deploy.prototype.log = function (command) {
  var isLocal = command.local,
      cmd     = command.command,
      log     = '* ';

  log = '*' + (' executing ' + (isLocal ? 'locally: ' : '') + '"' + cmd + '"').yellow;

  console.log(log);
};

module.exports = {
  Deploy: Deploy
};
