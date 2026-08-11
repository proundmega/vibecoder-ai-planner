const Calculator = require('../utils/calculator');

describe('Calculator', () => {
  let calc;

  beforeEach(() => {
    calc = new Calculator();
  });

  test('adds two numbers correctly', () => {
    expect(calc.add(2, 3)).toBe(5);
    expect(calc.add(-1, 1)).toBe(0);
    expect(calc.add(0, 0)).toBe(0);
  });

  test('subtracts two numbers correctly', () => {
    expect(calc.subtract(5, 3)).toBe(2);
    expect(calc.subtract(0, 5)).toBe(-5);
    expect(calc.subtract(-1, -1)).toBe(0);
  });

  test('multiplies two numbers correctly', () => {
    expect(calc.multiply(4, 3)).toBe(12);
    expect(calc.multiply(-2, 3)).toBe(-6);
    expect(calc.multiply(0, 100)).toBe(0);
  });

  test('divides two numbers correctly', () => {
    expect(calc.divide(10, 2)).toBe(5);
    expect(calc.divide(7, 2)).toBe(3.5);
    expect(calc.divide(-10, 2)).toBe(-5);
  });

  test('throws an error when dividing by zero', () => {
    expect(() => calc.divide(10, 0)).toThrow('Division by zero');
  });
});
