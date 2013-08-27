'use strict';

var async  = require('async');
var exec   = require('child_process').exec;
var moment = require('moment');
var _      = require('underscore');
var path   = require('path');

_.templateSettings = {
  interpolate : /\{\{(.+?)\}\}/g
};

/**
 * Deploy helper
 * @param {Object} options                    Options to set up deploy
 * @param {String} options.user               User deploy from
 * @param {String} options.domain             Remote server domain
 * @param {String} options.deployTo           Remote folder to deploy in
 *
 * @param {String} options.repository         Git repository of project
 * @param {String} [options.branch='master']  Git branch that will be used for deploy
 *
 * @param {String} [options.deployFrom]       Remote folder to deploy from
 * @param {String} [options.keepReleases=3]   Amount of releases to keep
 */
function Deploy(options, done) {
  var releaseName = moment().format('YYYYMMDDHHmmss'),
      that = this;

  this.options = options;
  this._commands = [];

  options.branch = options.branch || 'master';
  options.keepReleases = options.keepReleases || 3;
  options.hooks = options.hooks || {};

  this._folders = {
    logsPath:     path.join(options.deployTo, '/logs'),
    sharedPath:   path.join(options.deployTo, '/shared'),
    releasesPath: path.join(options.deployTo, '/releases'),

    currentPath:  path.join(options.deployTo, '/current'),
  };

  this._folders.releasePath = path.join(this._folders.releasesPath, releaseName);

  this.run('ls -1 {{releasesPath}}', { quiet: true });
  this.exec(function (err, results) {
    var ls = results[0],
        releases = ls.trim().split('\n'),
        length = releases.length,
        folders = that._folders;

    console.log(JSON.stringify(releases));

    _.extend(folders, {
      currentRelease:  length > 0 ? path.join(folders.releasesPath, releases[length - 1]) : null,
      previousRelease: length > 1 ? path.join(folders.releasesPath, releases[length - 2]) : null,
    });

    // for current release it will be redefined to {{releasePath}}
    folders.latestRelease = folders.currentRelease;

    done();
  });
}

Deploy.prototype.setup = function (done) {
  console.log('Starting...');

  this.run('mkdir -p {{releasesPath}} {{logsPath}} {{sharedPath}}');

  this.exec(done);
};

Deploy.prototype.start = function (done) {
  var that = this;

  this._folders.latestRelease = this._folders.releasePath;
  this._trigger('beforeDeploy', start);

  function start() {
    that.run('mkdir -p {{releasePath}}');
    that.run('git clone -q -b {{branch}} {{repository}} {{releasePath}}');
    that.exec(npmInstall);
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

    that.run('rm -f {{currentPath}}');
    that.run('ln -s {{releasePath}} {{currentPath}}');
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
    that.run('cd {{releasePath}} && test -f {{releasePath}}/package.json && npm install || true');
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

  this.run('ls -1 {{releasesPath}}', { quiet: true });
  this.exec(rollback);

  function rollback(err, results) {
    var ls = results[0].trim(),
        folders = ls.split('\n'),
        release,
        previousRelease;

    if (folders.length < 2) {
      throw 'Rolling back is impossible, there are less then 2 releases.';
    }

    release = that._folders.releasesPath + '/' + folders[folders.length - 1];
    previousRelease = that._folders.releasesPath + '/' + folders[folders.length - 2];

    that.run('rm -f {{currentPath}}');
    that.run('ln -s ' + previousRelease + ' {{currentPath}}');
    that.run('rm -Rf ' + release);
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

  this.run([
    'ls -1td {{releasesPath}}/*',
    'tail -n +' + (this.options.keepReleases + 1),
    'xargs rm -rf'
  ].join(' | '), { quiet: true });
  this.exec(done);
};

/**
 * Trigger hooks
 */
Deploy.prototype._trigger = function (name, done) {
  var that = this,
      hook = this.options.hooks[name],
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

  console.log(
    (moment().format('YYYY-MM-DD HH:mm:ss') + ' executing ' + '`' + name +'`').green
  );

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
 * @param {Object}  [options]               Command execution options
 * @param {Boolean} [options.local=false]   Run command locally
 * @param {Boolean} [options.quiet=false]   Do not show output on the screen
 */
Deploy.prototype.run = function (command, options) {
  options = _.extend({ quiet: false, local: false }, options || {});

  this._commands.push({
    command: this._expandCommand(command),
    local: options.local,
    quiet: options.quiet
  });
};

/**
 * Add commands for local execution
 *
 * @param {String}  command                 Command to execute
 * @param {Object}  [options]               Command execution options
 * @param {Boolean} [options.quiet=false]   Do not show output on the screen
 */
Deploy.prototype.runLocally = function (command, options) {
  options = _.extend({ quiet: false }, options || {});
  options.local = true;
  this.run(command, options);
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

/**
 * Expand command: augment with variables, e.g. folders, user, domain
 *
 * @param {String} command Command to expand
 * @return {String}        Expanded command
 */
Deploy.prototype._expandCommand = function (command) {
  var data = _.extend({}, this.options, this._folders);

  return _.template(command, data);
};

/**
 * Convert command to remote
 */
Deploy.prototype._remoteCommand = function (command) {
  command = command.replace(/\"/g, '\\\"');

  return _.template(
    'ssh -A {{host}} "{{command}}"',
    { host: this.options.user + '@' + this.options.domain, command: command }
  );
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
