module.exports = {
  extends: 'standard',
  parser: 'babel-eslint',
  env: {
    mocha: true
  },
  parserOptions: {
    ecmaVersion: 6
  },
  rules: {
    'max-len': [2, 100, 2],
    'space-before-function-paren': ['error', 'never']
  }
}
