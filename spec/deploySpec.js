'use strict';

var Deploy = require('../tasks/deployHelper').Deploy;

describe('All should be okay', function () {
  it('should work', function () {
    expect(Deploy).toBeDefined();
  });
});
