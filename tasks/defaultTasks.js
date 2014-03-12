'use strict';

var Tasks = {
  setup: function (run) {
    run('mkdir -p {{releasesPath}} {{logsPath}} {{sharedPath}}');
  },

  deploy: function (run) {
    // change latestReleath path
    this.folders.latestRelease = this.folders.releasePath;

    this.invoke(
      ['updateCode', 'npm', 'createSymlink', 'restart', 'deployCleanup'],
      this.async()
    );
  },

  updateCode: function (run, runLocally, onRollback) {
    onRollback(function () {
      run("rm -rf {{releasePath}}; true");
    });

    run('mkdir -p {{releasePath}}');
    run('git clone -q -b {{branch}} {{repository}} {{releasePath}}');
  },

  npm: function (run) {
    run('cd {{latestRelease}} && test -f {{latestRelease}}/package.json && npm install || true');
  },

  createSymlink: function (run, runLocally, onRollback) {
    onRollback(function () {
      if ( this.folders.previousRelease ) {
        run('rm -f {{currentPath}}; ln -s {{previousRelease}} {{currentPath}}; true');
      } else {
        console.log('No previous release to rollback to, rollback of symlink skipped');
      }
    });

    run('rm -f {{currentPath}} && ln -s {{latestRelease}} {{currentPath}}');
  },

  deployCleanup: function (run) {
    run([
      'ls -1td {{releasesPath}}/*',
      'tail -n +' + (this.options.keepReleases + 1),
      'xargs rm -rf'
    ].join(' | '), { quiet: true });
  },

  rollback: function (run) {
    if ( this.folders.previousRelease ) {
      run('rm -Rf {{currentPath}}; ln -s {{previousRelease}} {{currentPath}}');
      this.invoke('rollbackCleanup', this.async());
    } else {
      throw 'Rolling back is impossible, there are less then 2 releases.';
    }
  },

  rollbackCleanup: function (run) {
    run('if [ `readlink {{currentPath}}` != {{currentRelease}} ]; then rm -rf {{currentRelease}}; fi');
  },

  restartNginx: function (run) {
    run('/etc/init.d/nginx restart');
  }
};

module.exports = Tasks;
