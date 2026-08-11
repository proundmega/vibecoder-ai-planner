/**
 * Calculator module providing basic math operations.
 */

/**
 * Adds two numbers.
 * @param {number} a 
 * @param {number} b 
 * @returns {number}
 */
function add(a, b) {
  return a + b;
}

/**
 * Subtracts b from a.
 * @param {number} a 
 * @param {number} b 
 * @returns {number}
 */
function subtract(a, b) {
  return a - b;
}

/**
 * Multiplies two numbers.
 * @param {number} a 
 * @param {number} b 
 * @returns {number}
 */
function multiply(a, b) {
  return a * b;
}

/**
 * Divides a by b.
 * @param {number} a 
 * @param {number} b 
 * @returns {number}
 * @throws {Error} If b is zero.
 */
function divide(a, b) {
  if (b === 0) {
    throw new Error('Division by zero is not allowed.');
  }
  return a / b;
}

module.exports = {
  add,
  subtract,
  multiply,
  divide
};
