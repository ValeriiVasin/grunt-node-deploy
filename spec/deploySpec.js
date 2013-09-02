'use strict';

var proxyquire = require('proxyquire'),
    ExecMock   = require('./mocks').ExecMock;

describe('Deploy.', function () {
  var user = 'user',
      domain = 'domain.com',
      deployTo = '/remote/path',
      repository = 'git@github.com:caolan/async.git',
      branch = 'master',
      keepReleases = 3,

      callback = function () {},
      releasesMock,

      exec,

      Deploy,
      deploy;

  beforeEach(function () {
    releasesMock = ['20130901053034', '20130901062551', '20130901062995'];

    exec = new ExecMock();

    spyOn(console, 'log').andCallFake(callback);

    Deploy = proxyquire('../tasks/deployHelper', {
      child_process: { exec: exec.mock() }
    }).Deploy;

    // set response for initial `ls`
    exec.setResponses( releasesMock.join('\n') );

    deploy = new Deploy({
      user: user,
      domain: domain,
      deployTo: deployTo,
      repository: repository,
      branch: branch,
      keepReleases: keepReleases,
      tasks: {}
    }, callback);

    // clear initial commands
    exec.clear();
  });

  describe('Basics', function () {
    it('should run simple command remotely', function () {
      deploy.run('ls');
      deploy.exec(callback);

      expect( exec.recent() ).toBe('ssh -A user@domain.com "ls"');
    });

    it('should run simple command', function () {
      deploy.runLocally('ls');
      deploy.exec(callback);

      expect( exec.recent() ).toBe('ls');
    });

    it('should escape only remote command', function () {
      deploy.run('echo "hello"');
      deploy.runLocally('echo "hello"');
      deploy.exec(callback);

      expect( exec.commands() ).toEqual([
        'ssh -A user@domain.com "echo \\\"hello\\\""',
        'echo "hello"'
      ]);
    });
  });

  describe('Tasks.', function () {
    beforeEach(function () {
      jasmine.Clock.useMock();

      deploy.task('hello', function (run) {
        run('ls hello/');
      });

      deploy.task('world', function (run, runLocally) {
        runLocally('ls world/');
      });

      deploy.task('async', function (run, runLocally) {
        var done = this.async();

        run('ls one/');
        setTimeout(function () {
          runLocally('ls two/');
          done();
        }, 50);
      });
    });

    it('should run basic remote task', function () {
      deploy.invokeTask('hello', callback);
      expect( exec.recent() ).toBe('ssh -A user@domain.com "ls hello/"');
    });

    it('should run basic local task', function () {
      deploy.invokeTask('world', callback);
      expect( exec.recent() ).toBe('ls world/');
    });

    it('should invoke few tasks', function () {
      deploy.invokeTasks(['hello', 'world'], callback);
      expect( exec.commands() ).toEqual([
        'ssh -A user@domain.com "ls hello/"',
        'ls world/'
      ]);
    });

    it('should run async task', function () {
      deploy.invokeTask('async', callback);

      jasmine.Clock.tick(50);
      expect( exec.commands() ).toEqual([
        'ssh -A user@domain.com "ls one/"',
        'ls two/'
      ]);
    });

    describe('Before and After tasks.', function () {
      beforeEach(function () {
        deploy.task('beforeTask', function (run) {
          run('ls before/');
        });

        deploy.task('afterTask', function (run) {
          run('ls after/');
        });
      });

      it('should run task before the task', function () {
        deploy.before('hello', 'beforeTask');
        deploy.invokeTask('hello', callback);

        expect( exec.commands() ).toEqual([
          'ssh -A user@domain.com "ls before/"',
          'ssh -A user@domain.com "ls hello/"'
        ]);
      });

      it('should run task after the task', function () {
        deploy.after('hello', 'afterTask');
        deploy.invokeTask('hello', callback);

        expect( exec.commands() ).toEqual([
          'ssh -A user@domain.com "ls hello/"',
          'ssh -A user@domain.com "ls after/"'
        ]);
      });

      it('should run tasks before and after', function () {
        deploy.before('hello', 'beforeTask');
        deploy.after('hello', 'afterTask');
        deploy.invokeTask('hello', callback);

        expect( exec.commands() ).toEqual([
          'ssh -A user@domain.com "ls before/"',
          'ssh -A user@domain.com "ls hello/"',
          'ssh -A user@domain.com "ls after/"'
        ]);
      });

      it('should run tasks before and after', function () {
        deploy.before('hello', 'beforeTask');
        deploy.after('hello', 'afterTask');
        deploy.invokeTasks(['hello', 'world'], callback);

        expect( exec.commands() ).toEqual([
          'ssh -A user@domain.com "ls before/"',
          'ssh -A user@domain.com "ls hello/"',
          'ssh -A user@domain.com "ls after/"',
          'ls world/'
        ]);
      });
    });

    // task that contains another task (inside)
    describe('Nested tasks', function () {
      beforeEach(function () {
        deploy.task('A', function (run) {
          run('ls A/');
        });

        deploy.task('B', function (run, runLocally) {
          var done = this.async();

          runLocally('ls B/');
          run('ls C/');

          deploy.invokeTask('A', function () {
            runLocally('uptime');
            done();
          });
        });
      });

      it('should work fine', function () {

        deploy.invokeTask('B', callback);

        expect( exec.commands() ).toEqual([
          'ls B/',
          'ssh -A user@domain.com "ls C/"',
          'ssh -A user@domain.com "ls A/"',
          'uptime'
        ]);
      });
    });
  });

  describe('Rollbacks', function () {

    beforeEach(function () {
      deploy.task('A', function (run, runLocally, onRollback) {
        onRollback(function () {
          run('rm -Rf a/b/c');
        });

        run('mkdir -p a/b/c');
      });

      deploy.task('B', function (run, runLocally, onRollback) {
        onRollback(function () {
          run('rm -Rf c/b/a');
        });

        run('mkdir -p c/b/a');
      });

      deploy.task('error', function (run, runLocally, onRollback) {
        onRollback(function () {
          runLocally('rm -rf debug.log');
        });

        runLocally('touch debug.log');
        throw 'Something went wrong';
      });
    });

    it('should work properly if error happens in `before` task', function () {
      deploy.before('A', 'error');
      deploy.invokeTask('A', callback);

      expect( exec.commands() ).toEqual([
        'touch debug.log',
        'rm -rf debug.log'
      ]);
    });

    it('should work properly if error happens in `task`', function () {
      deploy.before('error', 'A');
      deploy.after('error', 'B');
      deploy.invokeTask('error', callback);

      expect( exec.commands() ).toEqual([
        'ssh -A user@domain.com "mkdir -p a/b/c"',
        'touch debug.log',
        'rm -rf debug.log',
        'ssh -A user@domain.com "rm -Rf a/b/c"'
      ]);
    });

    it('should work properly if error happens in `after` task', function () {
      // B => A => error
      deploy.before('A', 'B');
      deploy.after('A', 'error');
      deploy.invokeTask('A', callback);

      expect( exec.commands() ).toEqual([
        'ssh -A user@domain.com "mkdir -p c/b/a"',
        'ssh -A user@domain.com "mkdir -p a/b/c"',
        'touch debug.log',

        'rm -rf debug.log',
        'ssh -A user@domain.com "rm -Rf a/b/c"',
        'ssh -A user@domain.com "rm -Rf c/b/a"'
      ]);
    });

    it('should work properly if error happens in tasks queue', function () {
      deploy.invokeTasks(['A', 'B', 'error'], callback);

      expect( exec.commands() ).toEqual([
        'ssh -A user@domain.com "mkdir -p a/b/c"',
        'ssh -A user@domain.com "mkdir -p c/b/a"',
        'touch debug.log',

        'rm -rf debug.log',
        'ssh -A user@domain.com "rm -Rf c/b/a"',
        'ssh -A user@domain.com "rm -Rf a/b/c"'
      ]);
    });

    it('should work properly if error happens in nested task', function () {
      // A => nested => B => error
      deploy.task('nested', function (run, runLocally, onRollback) {
        var async = this.async();

        onRollback(function () {
          run('rm -Rf nested');
        });

        run('mkdir -p nested');

        deploy.invokeTasks(['B', 'error'], async);
      });

      deploy.before('nested', 'A');
      deploy.invokeTask('nested', callback);

      expect( exec.commands() ).toEqual([
        'ssh -A user@domain.com "mkdir -p a/b/c"',
        'ssh -A user@domain.com "mkdir -p nested"',
        'ssh -A user@domain.com "mkdir -p c/b/a"',
        'touch debug.log',

        'rm -rf debug.log',
        'ssh -A user@domain.com "rm -Rf c/b/a"',
        'ssh -A user@domain.com "rm -Rf nested"',
        'ssh -A user@domain.com "rm -Rf a/b/c"'
      ]);
    });

    // check errors that happen not via `throw` => usual callback('Error message');
  });
});
