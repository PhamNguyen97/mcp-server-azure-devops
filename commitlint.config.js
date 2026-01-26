// commitlint.config.js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [0], // disable the 100 char limit
    'body-max-line-length': [0], // disable body line length limit
  },
}; 