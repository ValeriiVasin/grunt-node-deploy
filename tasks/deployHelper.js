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
 * @param {String} [options.keepReleases=3]   Amount of releases to keep
 */
function Deploy(options, done) {
  var releaseName = moment().format('YYYYMMDDHHmmss'),
      that = this;

  this.options = options;
  this._commands = [];

  this._tasks = {};
  this._rollbacks = [];

  // before and after tasks hashes
  this._before = {};
  this._after  = {};

  options.branch = options.branch || 'master';
  options.keepReleases = options.keepReleases || 3;
  options.tasks = options.tasks || {};

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
    registerUserTasks();
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

      that.invokeTasks(
        ['updateCode', 'npm', 'createSymlink', 'restart', 'deploy:cleanup'],
        this.async()
      );
    });

    task('updateCode', function (run, runLocally, onRollback) {
      onRollback(function () {
        run("rm -rf {{releasePath}}; true");
      });

      run('mkdir -p {{releasePath}}');
      run('git clone -q -b {{branch}} {{repository}} {{releasePath}}');
    });

    task('npm', function (run) {
      run('cd {{latestRelease}} && test -f {{latestRelease}}/package.json && npm install || true');
    });

    task('createSymlink', function (run, runLocally, onRollback) {
      onRollback(function () {
        if ( that._folders.previousRelease ) {
          run ('rm -f {{currentPath}}; ln -s {{previousRelease}} {{currentPath}}; true');
        } else {
          console.log('No previous release to rollback to, rollback of symlink skipped');
        }
      });

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

  /**
   * Register user-callbacks defined tasks
   */
  function registerUserTasks() {
    var tasks  = options.tasks,
        task   = that.task.bind(that),
        before = that.before.bind(that),
        after  = that.after.bind(that),
        taskName;

    // register user tasks
    for (taskName in tasks) {
      if ( tasks.hasOwnProperty(taskName) ) {
        task(taskName, tasks[taskName]);
      }
    }

    // register predefined user tasks order
    before('deploy', 'beforeDeploy');

    before('updateCode', 'beforeUpdateCode');
    after('updateCode', 'afterUpdateCode');

    before('npm', 'beforeNpm');
    after('npm', 'afterNpm');

    before('createSymlink', 'beforeCreateSymlink');
    after('createSymlink', 'afterCreateSymlink');

    before('restart', 'beforeRestart');
    after('restart', 'afterRestart');

    after('deploy', 'afterDeploy');
  }
}

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
 * @param {Object}   [options]      Task options
 * @param {Boolean}  [internal]     Internal task or not
 */
Deploy.prototype.task = function (name, taskFn, options) {
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
 * Register before task
 *
 * @method  before
 *
 * @param  {String} task        Task before which `beforeTask` should be run
 * @param  {String} beforeTask  Task that should be registered for run before `task`
 * @example
 *
 *     // run `mytask` before task `deploy`
 *     this.before('deploy', 'mytask');
 */
Deploy.prototype.before = function (task, beforeTask) {
  var beforeTasks = this._before[task];

  if ( !Array.isArray(beforeTasks) ) {
    this._before[task] = [beforeTask];
    return;
  }

  beforeTasks.push(beforeTask);
};

/**
 * Register after task
 *
 * @method  after
 *
 * @param  {String} task        Task after which `afterTask` should be run
 * @param  {String} beforeTask  Task that should be registered for run before `task`
 * @example
 *
 *     // run `mytask` before task `deploy`
 *     this.after('deploy', 'mytask');
 */
Deploy.prototype.after = function (task, afterTask) {
  var afterTasks = this._after[task];

  if ( !Array.isArray(afterTasks) ) {
    this._after[task] = [afterTask];
    return;
  }

  afterTasks.push(afterTask);
};


/**
 * Invoke registered function
 *
 * @method invokeTask
 *
 * @param  {String}   name Task name
 * @param  {Function} done Done callback
 */
Deploy.prototype.invokeTask = function (name, done) {
  var that = this,
      taskFn = this._tasks[name],
      run = this.run.bind(this),
      runLocally = this.runLocally.bind(this),
      onRollback = this._addRollback.bind(this),
      isTaskSync = true,
      taskContext;

  if (typeof done !== 'function') {
    throw 'Invoke task `'+ name +'`. You should provide `done` callback.';
  }

  // registered task is not a function. Skip it
  if ( typeof taskFn !== 'function' ) {
    done();
    return;
  }


  // rollback happened before
  if ( this._idle && !this._isRollback(name) ) {
    done();
    return;
  }

  // task invocation queue
  async.series([

    // flush all commands before invoking task
    function execCommands(callback) {
      that.exec(callback);
    },

    function invokeBeforeTasks(callback) {
      var beforeTasks = that._before[name];

      if (beforeTasks) {
        that.invokeTasks(beforeTasks, callback);
      } else {
        callback();
      }
    },

    invokeTask,

    function invokeAfterTasks(callback) {
      var afterTasks = that._after[name];

      if (afterTasks) {
        that.invokeTasks(afterTasks, callback);
      } else {
        callback();
      }
    }
  ], function (error) {
    if (error) {
      // error happened: rolling back
      console.log('Error while executing tasks: ' + (error.message ? error.message : error) );
      that._rollingBack(done);
    }
  });

  function invokeTask(callback) {
    var taskContext = {
      run: run,
      runLocally: runLocally,
      onRollback: onRollback,
      async: function () {
        isTaskSync = false;
        return taskDone;
      }
    };

    // invoke task
    try {
      console.log('Executing task: `'+ name +'`');
      taskFn.call(taskContext, run, runLocally, onRollback);

      // task successfully executed
      if ( isTaskSync ) {
        taskDone();
      }
    } catch (e) {
      callback(e);
    }

    function taskDone() {
      that.exec(callback);
    }
  }
};

/**
 * Invoke few tasks
 *
 * @method invokeTasks
 *
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
 * Add rollback task
 *
 * @method _addRollback
 * @private
 *
 * @param  {Function} rollbackFn Rollback task function
 */
Deploy.prototype._addRollback = function (rollbackFn) {
  // generate uniq rollback name
  var name = _.uniqueId('__rollback__');

  this.task(name, rollbackFn);
  this._rollbacks.unshift(name);
};

/**
 * Check if task is a rollback task
 *
 * @method _isRollback
 * @private
 *
 * @param  {String} name Task name
 * @return {Boolean}     Result
 */
Deploy.prototype._isRollback = function (name) {
  return this._rollbacks.indexOf(name) !== -1;
};

/**
 * Invoke all registered rollbacks (when something went wrong)
 *
 * @method _rollback
 * @private
 *
 * @param  {Function} done Callback
 */
Deploy.prototype._rollingBack = function (done) {
  console.log('Rolling back...');

  // this flag means that something went wrong and we are in rollbacks stage
  // All tasks that are in the queue should be skipped
  this._idle = true;

  // invoke rollback tasks
  this.invokeTasks(this._rollbacks, done);
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
