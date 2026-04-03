import type { JsonValue } from '../../../packages/core/src/types.js';

interface BmiInput {
  heightCm: number;
  weightKg: number;
}

interface BmiOutput {
  heightCm: number;
  weightKg: number;
  bmi: number;
  category: string;
}

function classifyBmi(bmi: number): string {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Normal weight';
  if (bmi < 30) return 'Overweight';
  return 'Obese';
}

export const name = 'bmi_calculate';

export const description =
  'Calculate Body Mass Index (BMI) from height in centimeters and weight in kilograms. Returns the BMI value and WHO classification.';

export const inputSchema = {
  type: 'object',
  required: ['heightCm', 'weightKg'],
  additionalProperties: false,
  properties: {
    heightCm: { type: 'number', description: 'Height in centimeters.' },
    weightKg: { type: 'number', description: 'Weight in kilograms.' },
  },
};

export const outputSchema = {
  type: 'object',
  properties: {
    heightCm: { type: 'number' },
    weightKg: { type: 'number' },
    bmi: { type: 'number' },
    category: { type: 'string' },
  },
};

export async function execute(input: JsonValue): Promise<JsonValue> {
  const { heightCm, weightKg } = input as unknown as BmiInput;

  if (typeof heightCm !== 'number' || heightCm <= 0) {
    throw new Error('heightCm must be a positive number');
  }

  if (typeof weightKg !== 'number' || weightKg <= 0) {
    throw new Error('weightKg must be a positive number');
  }

  const heightM = heightCm / 100;
  const bmi = Math.round((weightKg / (heightM * heightM)) * 100) / 100;

  const result: BmiOutput = {
    heightCm,
    weightKg,
    bmi,
    category: classifyBmi(bmi),
  };

  return result as unknown as JsonValue;
}
