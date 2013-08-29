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
 *
 * @class Deploy
 * @constructor
 *
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

  this._tasks = {};
  this._rollbacks = [];

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

    _.extend(folders, {
      currentRelease:  length > 0 ? path.join(folders.releasesPath, releases[length - 1]) : null,
      previousRelease: length > 1 ? path.join(folders.releasesPath, releases[length - 2]) : null,
    });

    // for current release it will be redefined to {{releasePath}}
    folders.latestRelease = folders.currentRelease;

    registerTasks();
    done();
  });

  function registerTasks() {
    var task = that.task.bind(that),
        invokeTask = that.invokeTask.bind(that);

    task('setup', function (run) {
      run('mkdir -p {{releasesPath}} {{logsPath}} {{sharedPath}}');
    });

    // restart your app, currently it's empty, could be redefined
    task('restart');

    // Rollback
    task('rollback', function (run) {
      if ( that._folders.previousRelease ) {
        run('rm -Rf {{currentPath}}; ln -s {{previousRelease}} {{currentPath}}');
        invokeTask('rollback:cleanup', this.async());
      } else {
        throw 'Rolling back is impossible, there are less then 2 releases.';
      }
    });

    task('rollback:cleanup', function (run) {
      run('if [ `readlink {{currentPath}}` != {{currentRelease}} ]; then rm -rf {{currentRelease}}; fi');
    });

    // Deploy
    task('deploy', function (run) {
      that._folders.latestRelease = that._folders.releasePath;
      run('mkdir -p {{releasePath}}');

      that.invokeTasks(
        ['updateCode', 'npmInstall', 'createSymlink', 'restart', 'deploy:cleanup'],
        this.async()
      );
    });

    task('updateCode', function (run) {
      run('git clone -q -b {{branch}} {{repository}} {{releasePath}}');
    });

    task('npmInstall', function (run) {
      run('cd {{releasePath}} && test -f {{releasePath}}/package.json && npm install || true');
    });

    task('createSymlink', function (run) {
      run('rm -f {{currentPath}} && ln -s {{latestRelease}} {{currentPath}}');
    });

    task('deploy:cleanup', function (run) {
      run([
        'ls -1td {{releasesPath}}/*',
        'tail -n +' + (that.options.keepReleases + 1),
        'xargs rm -rf'
      ].join(' | '), { quiet: true });
    });
  }
}

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

  if (this._folders.previousRelease) {
    this.run('rm -Rf {{currentPath}}; ln -s {{previousRelease}} {{currentPath}}');
    this.exec(rollbackCleanup);
  } else {
    throw 'Rolling back is impossible, there are less then 2 releases.';
  }

  function rollbackCleanup() {
    that.run('if [ `readlink {{currentPath}}` != {{currentRelease}} ]; then rm -rf {{currentRelease}}; fi');
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
    command: this._shellEscape( this._expandCommand(command) ),
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
 * Register task
 *
 * @method task
 *
 * @param {String}   name           Task name
 * @param {Function} taskFn         Task function
 *   @param {Function} [run]        Run commands remotely
 *   @param {Function} [runLocally] Run commands on current machine
 *   @param {Function} [onRollback] Register rollback function
 */
Deploy.prototype.task = function (name, taskFn) {
  if (typeof taskFn === 'undefined') {
    taskFn = function () {};
  }

  if (typeof taskFn !== 'function') {
    throw 'You should provide function as `taskFn`';
  }

  // task definition
  this._tasks[name] = taskFn;
};

/**
 * Invoke registered function
 *
 * @method invokeTask
 * @param  {String}   name Task name
 * @param  {Function} done Done callback
 */
Deploy.prototype.invokeTask = function (name, done) {
  var that = this,
      taskFn = this._tasks[name],
      run = this.run.bind(this),
      runLocally = this.runLocally.bind(this),
      isTaskSync = true,
      taskContext;

  if ( typeof taskFn !== 'function' ) {
    done();
    return;
  }

  if (typeof done !== 'function') {
    throw 'Invoke task `'+ name +'`. You should provide `done` callback.';
  }

  // rollback happened before
  if (this._idle) {
    return;
  }

  taskContext = {
    run: run,
    runLocally: runLocally,
    onRollback: onRollback,
    async: function () {
      isTaskSync = false;
      return taskDone;
    }
  };

  // we should flush all commands before invoking task
  this.exec(invokeTask);

  function invokeTask() {
    // invoke task
    try {
      console.log('Executing task: `'+ name +'`');
      taskFn.call(taskContext, run, runLocally, onRollback);
    } catch (e) {
      console.log('Rolling back...');
      that._idle = true;

      async.eachSeries(that._rollbacks, invokeRollback, function () {
        console.log('Rolling back done...');
        done();
      });

      return;
    }

    // task successfully executed
    if ( isTaskSync ) {
      taskDone();
    }
  }

  function onRollback(rollbackFn) {
    that._rollbacks.unshift(rollbackFn);
  }

  function taskDone() {
    that.exec(done);
  }

  function invokeRollback(rollbackFn, done) {
    var isAsync = false;

    rollbackFn.call({
      async: function () {
        isAsync = true;
        return done;
      }
    });

    if ( !isAsync ) {
      done();
    }
  }
};

/**
 * @method invokeTasks
 * @param {String[]} tasks  Array of tasks to invoke
 * @param {Function} done   Callback
 */
Deploy.prototype.invokeTasks = function (tasks, done) {
  var that = this;

  async.eachSeries(tasks, function (name, callback) {
    that.invokeTask(name, callback);
  }, done);
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

Deploy.prototype._shellEscape = function (str) {
  return str.replace(/([\`\[\]\"\'])/g, '\\$1');
};

module.exports = {
  Deploy: Deploy
};
