module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  overrides: [
    {
      files: [
        'src/nodes/**/*.ts',
        'src/execution-runtime/**/*.ts',
        'src/services/**/*.ts',
        'src/utils/**/*.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: '@/services',
                message: 'Core/runtime layers must use precise module imports instead of root barrel exports.',
              },
              {
                name: '@/hooks',
                message: 'Core/runtime layers must use precise module imports instead of root barrel exports.',
              },
              {
                name: '@/nodes',
                message: 'Core/runtime layers must use precise module imports instead of root barrel exports.',
              },
            ],
            patterns: [
              {
                group: ['@/components/context', '@/components/context/*'],
                message: 'Core/runtime layers must not import workflow UI context directly.',
              },
            ],
          },
        ],
      },
    },
    {
      files: [
        'src/**/*.ts',
        'src/**/*.tsx',
      ],
      excludedFiles: [
        'src/**/*.{spec,test}.ts',
        'src/**/*.{spec,test}.tsx',
        'src/test-support/**/*.{ts,tsx}',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: '@/services',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: '@/hooks',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: '@/components/context',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: '@/nodes',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: './services',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: '../services',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: '../../services',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: '../../../services',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: './hooks',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: '../hooks',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: '../../hooks',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: '../../../hooks',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: './components/context',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: '../components/context',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: '../../components/context',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: '../../../components/context',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: './nodes',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: '../nodes',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: '../../nodes',
                message: 'Use precise module imports instead of root barrel exports.',
              },
              {
                name: '../../../nodes',
                message: 'Use precise module imports instead of root barrel exports.',
              },
            ],
          },
        ],
      },
    },
    {
      files: [
        'src/**/*.{spec,test}.ts',
        'src/**/*.{spec,test}.tsx',
        'src/test-support/**/*.{ts,tsx}',
      ],
      env: {
        browser: true,
        es2020: true,
        node: true,
      },
      rules: {
        '@typescript-eslint/explicit-function-return-type': 'off',
        'react-refresh/only-export-components': 'off',
        'no-console': 'off',
      },
    },
  ],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'prefer-const': 'error',
    'no-var': 'error',
  },
}
