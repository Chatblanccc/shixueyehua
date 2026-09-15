'use strict';

// Original decompress returns a Promise too; lazy import bridges its maintained ESM fork.
module.exports = async function decompress(input, output, options) {
  const { default: extract } = await import('@xhmikosr/decompress');
  return extract(input, output, options);
};
