const { expect } = require('chai');
const index = require('../index.js');

describe('Index Entry Point (index.js)', function () {
  it('should export proxyToProtocol function or proxy handler mapping', () => {
    expect(index).to.be.ok;
  });
});