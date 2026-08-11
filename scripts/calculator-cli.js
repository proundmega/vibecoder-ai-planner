#!/usr/bin/env node

/**
 * Calculator CLI
 * Usage: node calculator-cli.js <num1> <operator> <num2>
 * Operators: +, -, *, /
 */

const args = process.argv.slice(2);

function printUsage() {
  console.log("Calculator CLI");
  console.log("Usage: node calculator-cli.js <num1> <operator> <num2>");
  console.log("Operators: +, -, *, /");
  console.log("Example: node calculator-cli.js 10 + 5");
}

if (args.length === 0) {
  printUsage();
  process.exit(0);
}

if (args.length !== 3) {
  console.error("Error: Invalid number of arguments.");
  printUsage();
  process.exit(1);
}

const num1 = parseFloat(args[0]);
const operator = args[1];
const num2 = parseFloat(args[2]);

if (isNaN(num1) || isNaN(num2)) {
  console.error("Error: Both numbers must be valid numeric values.");
  process.exit(1);
}

let result;
switch (operator) {
  case '+':
    result = num1 + num2;
    break;
  case '-':
    result = num1 - num2;
    break;
  case '*':
    result = num1 * num2;
    break;
  case '/':
    if (num2 === 0) {
      console.error("Error: Division by zero is not allowed.");
      process.exit(1);
    }
    result = num1 / num2;
    break;
  default:
    console.error(`Error: Invalid operator '${operator}'. Supported operators: +, -, *, /`);
    process.exit(1);
}

// Format result to avoid floating point precision issues (e.g., 0.1 + 0.2)
const formattedResult = Number.isInteger(result) ? result : parseFloat(result.toFixed(10));
console.log(`Result: ${formattedResult}`);
