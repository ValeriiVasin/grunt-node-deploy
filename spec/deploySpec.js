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

  describe('run', function () {
    it('should run simple command remotely', function () {
      deploy.run('ls');
      deploy.exec(callback);

      expect( exec.recent() ).toBe('ssh -A user@domain.com "ls"');
    });
  });

  describe('runLocally', function () {
    it('should run simple command', function () {
      deploy.runLocally('ls');
      deploy.exec(callback);

      expect( exec.recent() ).toBe('ls');
    });
  });

  describe('Tasks', function () {
    beforeEach(function () {
      deploy.task('hello', function (run) {
        run('ls hello/');
      });

      deploy.task('world', function (run, runLocally) {
        runLocally('ls world/');
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
  });
});
