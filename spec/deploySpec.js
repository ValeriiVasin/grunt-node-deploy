'use strict';

var Deploy = require('../tasks/deployHelper').Deploy;

describe('Commands', function () {
  var user = 'user',
      domain = 'domain.com',
      deployTo = '/remote/path',
      deployFrom = 'releases',
      deploy;

  beforeEach(function () {
    deploy = new Deploy({
      user: user,
      domain: domain,
      deployTo: deployTo,
      deployFrom: deployFrom,
      hooks: {}
    });
  });

  describe('Folders', function () {
    it('should set correct initial folders values', function () {
      expect(deploy._folders.current).toBe('/remote/path/current');
      expect(deploy._folders.shared).toBe('/remote/path/shared');
      expect(deploy._folders.logs).toBe('/remote/path/logs');
      expect(deploy._folders.releases).toBe('/remote/path/releases');
      expect(deploy._folders.currentRelease).toBeNull();
    });
  });

  describe('Remote commands', function () {
    it('shoud store correct commands into internal array', function () {
      deploy.run('ls');
      expect(deploy._commands).toEqual(
        ['ssh user@domain.com "ls"']
      );
    });

    it('should correctly escape commands', function () {
      deploy.run('echo "hello"');
      expect(deploy._commands[0]).toBe('ssh user@domain.com "echo \\"hello\\""');

      deploy.run('echo \'hello\'');
      expect(deploy._commands[1]).toBe('ssh user@domain.com "echo \'hello\'"');
    });

    describe('Replace template strings', function () {
      it('should replace {{user}} with user name', function () {
        deploy.run('echo "{{user}}"');
        expect( deploy._commands.pop() ).toBe('ssh user@domain.com "echo \\"user\\""');
      });

      it('should replace {{domain}} with domain value', function () {
        deploy.run('echo "{{domain}}"');
        expect( deploy._commands.pop() ).toBe('ssh user@domain.com "echo \\"domain.com\\""');
      });

      it('should replace {{current}} with `current` folder path', function () {
        deploy.run('ls {{current}}');
        expect( deploy._commands.pop() ).toBe('ssh user@domain.com "ls /remote/path/current"');
      });

      it('should replace {{releases}} with `releases` folder path', function () {
        deploy.run('ls {{releases}}');
        expect( deploy._commands.pop() ).toBe('ssh user@domain.com "ls /remote/path/releases"');
      });

      it('should replace {{shared}} with `shared` folder path', function () {
        deploy.run('ls {{shared}}');
        expect( deploy._commands.pop() ).toBe('ssh user@domain.com "ls /remote/path/shared"');
      });

      it('should replace {{logs}} with `logs` folder path', function () {
        deploy.run('ls {{logs}}');
        expect( deploy._commands.pop() ).toBe('ssh user@domain.com "ls /remote/path/logs"');
      });

      it('should replace {{currentRelease}} with `currentRelease` folder', function () {
        deploy._folders.currentRelease = '/remote/path/releases/201308260319';
        deploy.run('ls {{currentRelease}}');
        expect( deploy._commands.pop() ).toBe('ssh user@domain.com "ls /remote/path/releases/201308260319"');
      });

      it('should parse additional templates, provided as second argument', function () {
        deploy.run('ls {{folder}}', { folder: '/yet/another/folder' });
        expect( deploy._commands.pop() ).toBe('ssh user@domain.com "ls /yet/another/folder"');
      });

      it('should throw error if template string could not be replaced', function () {
        expect(function () {
          deploy.run('ls {{directory}}');
        }).toThrow();
      });
    });

  });
});
